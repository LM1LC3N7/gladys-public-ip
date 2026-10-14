// -----------------------------------------------------------------------------
// The integration itself: the check loop (addresses, connection), the
// "Internet" device, the scene triggers, the dynamic DNS providers, the
// scene actions, the widget and the Test button. index.js only wires the
// SDK handlers to it.
//
// What lives in memory, for the life of the container (never on disk): the
// addresses believed so far, the connection state and the DNS providers'
// state. A reconnection to Gladys or a saved configuration keeps them; after
// a restart, the addresses Gladys kept on the device's text features are the
// baseline again.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { cloudflareEnabled, duckdnsEnabled, normalizeConfig } from './config.js';
import {
  FAMILIES,
  IPV6_RETRY,
  MANUAL_COOLDOWN,
  MIN_CHECK_SPACING,
  OUTAGE_RECHECK,
  PROVIDERS,
  SOURCES,
  WIDGETS,
  WIDGET_ACTIONS,
} from './constants.js';
import {
  FEATURE,
  buildInternetDevice,
  ids,
  internetDevice,
  internetStates,
  storedAddress,
} from './devices.js';
import { CloudflareClient } from './dns/cloudflare.js';
import { DuckDnsClient } from './dns/duckdns.js';
import { DnsError, DnsProvider } from './dns/provider.js';
import { PROVIDER_NAMES, T, duration } from './i18n.js';
import { KINDS, isPublic, normalizeAddress } from './model.js';
import { askSource, detectFamily } from './sources.js';
import { addressEvents, initialInternet, internetStep } from './triggers.js';
import { publicIpWidget } from './widget.js';

const defaultTimers = { setTimeout, clearTimeout };

const newFamily = () => ({
  /** The address believed (null: none yet). */
  address: null,
  /** When this process first confirmed it (null: only seeded from Gladys so far). */
  seenSince: null,
  /** When a change to it was detected (null: no change seen since the start). */
  changedAt: null,
  /** Did the last check reach a decision? */
  confirmed: false,
  /** Did the family answer at all (IPv6 is often missing on a Docker bridge)? */
  available: null,
  everAvailable: false,
  retryAt: 0,
  cgnat: false,
  /** Rotation index of the sources. */
  start: 0,
});

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

/** Join a list of { en, fr } texts. */
const join = (texts, separator = '') => ({
  en: texts.map((t) => t.en).join(separator),
  fr: texts.map((t) => t.fr).join(separator),
});

export class PublicIpApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'public-ip' }),
    now = Date.now,
    timers = defaultTimers,
    ask = askSource,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.ask = ask;
    this.config = normalizeConfig();
    this.families = { ipv4: newFamily(), ipv6: newFamily() };
    this.internet = initialInternet();
    /** name -> DnsProvider */
    this.providers = new Map();
    this.timer = undefined;
    this.generation = 0;
    this.checking = undefined;
    this.lastCheckAt = 0;
    this.lastStatus = undefined;
    this.lastManual = { at: 0, results: undefined };
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    const generation = ++this.generation;
    this.config = normalizeConfig(raw);
    this.buildProviders();
    try {
      await this.publishDevices();
    } catch (err) {
      this.logger.warn(`Publishing the device failed: ${err.message}`);
    }
    this.seedFromGladys();
    try {
      if (this.now() - this.lastCheckAt >= MIN_CHECK_SPACING) {
        await this.check();
      } else {
        // A reconnection right after a check: no new request, only the DNS of a new config.
        await this.syncDns();
        await this.publishStates();
        await this.reportStatus();
      }
    } catch (err) {
      this.logger.warn(`First check failed: ${err.message}`);
    }
    if (generation === this.generation) {
      this.schedule();
    }
  }

  stop() {
    this.generation += 1;
    this.timers.clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** The next check: `interval` minutes, or one minute while the checks fail. */
  schedule() {
    const interval = this.config.interval * 60_000;
    const delay = this.internet.failures > 0 ? Math.min(interval, OUTAGE_RECHECK) : interval;
    const generation = this.generation;
    this.timer = this.timers.setTimeout(async () => {
      this.timer = undefined;
      try {
        await this.check();
      } catch (err) {
        this.logger.warn(`Check failed: ${err.message}`);
      }
      if (generation === this.generation) {
        this.schedule();
      }
    }, delay);
  }

  /**
   * One provider per filled section; a provider whose settings did not
   * change keeps its state (no new "once at start" update on a mere
   * reconnection), a new or changed one starts from scratch.
   */
  buildProviders() {
    const wanted = [];
    const { duckdns, cloudflare } = this.config;
    if (duckdnsEnabled(this.config)) {
      wanted.push({
        name: PROVIDERS.DUCKDNS,
        fingerprint: JSON.stringify(duckdns),
        wantsIpv6: duckdns.ipv6,
        client: () => new DuckDnsClient(duckdns),
      });
    }
    if (cloudflareEnabled(this.config)) {
      wanted.push({
        name: PROVIDERS.CLOUDFLARE,
        fingerprint: JSON.stringify(cloudflare),
        // Only the AAAA records that exist are updated: their presence is the opt-in.
        wantsIpv6: true,
        client: () => new CloudflareClient(cloudflare),
      });
    }
    const next = new Map();
    for (const w of wanted) {
      const existing = this.providers.get(w.name);
      next.set(
        w.name,
        existing?.fingerprint === w.fingerprint
          ? existing
          : new DnsProvider({
              name: w.name,
              client: w.client(),
              fingerprint: w.fingerprint,
              wantsIpv6: w.wantsIpv6,
            }),
      );
    }
    this.providers = next;
  }

  /** Discovery offers the one device: the Internet connection of the house. */
  async publishDevices() {
    await this.gladys.publishDiscoveredDevices([buildInternetDevice(this.gladys)]);
  }

  /** After a restart: the addresses Gladys kept are the baseline of the trigger. */
  seedFromGladys() {
    const device = internetDevice(this.gladys);
    if (!device) {
      return;
    }
    for (const family of FAMILIES) {
      const state = this.families[family];
      const stored = storedAddress(device, family === 'ipv4' ? FEATURE.IPV4 : FEATURE.IPV6);
      if (!state.address && stored && isPublic(stored, family)) {
        state.address = normalizeAddress(stored, family);
      }
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  // --- The check ---------------------------------------------------------------

  check() {
    if (!this.checking) {
      this.checking = this.doCheck().finally(() => {
        this.checking = undefined;
      });
    }
    return this.checking;
  }

  /** Should this family be asked now? */
  wanted(family, now) {
    if (family === 'ipv4') {
      return true;
    }
    const state = this.families.ipv6;
    // An IPv6 never seen is probed every 30 minutes, not at every check.
    return (
      this.config.detectIpv6 &&
      (state.available !== false || state.everAvailable || now >= state.retryAt)
    );
  }

  async doCheck() {
    const now = this.now();
    const events = [];
    let reachable = false;
    for (const family of FAMILIES) {
      if (!this.wanted(family, now)) {
        continue;
      }
      const state = this.families[family];
      const result = await detectFamily({
        family,
        current: state.address,
        start: state.start,
        ask: this.ask,
      });
      state.start += 1;
      reachable ||= result.reachable;
      this.logger.debug(
        `${family}: ${result.answers.map((a) => `${a.source} ${a.ok ? a.kind : a.error}`).join(', ')}`,
      );
      if (family === 'ipv6') {
        // No answer over IPv6 is the usual Docker bridge, not an outage: noted calmly.
        state.available = result.reachable;
        state.everAvailable ||= result.reachable;
        state.retryAt = result.reachable ? 0 : now + IPV6_RETRY;
      }
      state.cgnat = result.cgnat;
      state.confirmed = result.confirmed || !result.reachable;
      if (!result.confirmed) {
        if (result.reachable) {
          // Debug only: a line with several exits disagrees at every check (the status says it).
          this.logger.debug(`The ${family} sources disagree: keeping the current address`);
        }
        continue;
      }
      if (result.address !== state.address) {
        const previous = state.address;
        events.push(...addressEvents(family, previous, result.address));
        state.address = result.address;
        state.changedAt = previous ? now : null;
        state.seenSince = now;
        if (previous) {
          this.logger.info(`Public ${family} changed (confirmed by two sources)`);
        }
      } else if (!state.seenSince) {
        state.seenSince = now;
      }
    }
    const step = internetStep(this.internet, reachable, {
      now,
      threshold: this.config.failuresBeforeLost,
      ipv4: this.families.ipv4.address,
    });
    this.internet = step.state;
    this.lastCheckAt = now;
    for (const event of step.events) {
      this.logger.info(`Internet ${event.key === 'internet_lost' ? 'lost' : 'restored'}`);
    }
    await this.publishStates();
    for (const event of [...step.events, ...events]) {
      await this.gladys
        .publishSceneEvent(event.key, event.data)
        .catch((err) => this.logger.warn(`Scene event ${event.key} failed: ${err.message}`));
    }
    const synced = reachable ? await this.syncDns() : 0;
    await this.reportStatus();
    if (events.length > 0 || step.events.length > 0 || synced > 0) {
      this.gladys.requestWidgetRefresh(WIDGETS.PUBLIC_IP);
    }
  }

  /** The addresses a DNS record may point to: confirmed in this process only. */
  addresses() {
    const { ipv4, ipv6 } = this.families;
    return {
      ipv4: ipv4.seenSince ? ipv4.address : null,
      ipv6:
        this.config.detectIpv6 && ipv6.available !== false && ipv6.seenSince ? ipv6.address : null,
    };
  }

  async publishStates(device = internetDevice(this.gladys)) {
    if (!device) {
      return;
    }
    const { ipv4, ipv6 } = this.families;
    await this.gladys
      .publishChangedStates(
        internetStates(device.external_id, {
          online: this.internet.online,
          ipv4: ipv4.address,
          ipv6: this.config.detectIpv6 && ipv6.available !== false ? ipv6.address : null,
        }),
        { heartbeat: 60 * 60_000 },
      )
      .catch((err) => this.logger.warn(`Publishing the states failed: ${err.message}`));
  }

  /** The device was just created: give it its states now. */
  async deviceCreated(device) {
    if (device?.external_id === ids.internet(this.gladys) && this.lastCheckAt) {
      await this.publishStates(device);
    }
  }

  // --- Dynamic DNS ---------------------------------------------------------------

  /** The automatic updates: a provider behind the address, and not backing off. */
  async syncDns() {
    const addresses = this.addresses();
    if (!addresses.ipv4 && !addresses.ipv6) {
      return 0;
    }
    let count = 0;
    for (const provider of this.providers.values()) {
      const now = this.now();
      if (!provider.needsSync(addresses) || !provider.due(now)) {
        continue;
      }
      count += 1;
      this.logResult(provider, await provider.sync(addresses, now));
    }
    return count;
  }

  logResult(provider, result) {
    const name = PROVIDER_NAMES[provider.name];
    if (result.ok) {
      this.logger.info(`${name}: ${result.changed ? 'updated' : 'already up to date'}`);
    } else {
      this.logger.warn(`${name}: ${result.error.message}`);
    }
  }

  /** "Update DNS now": every provider, whatever its backoff (a user asked). */
  async manualUpdate() {
    const now = this.now();
    if (this.lastManual.results && now - this.lastManual.at < MANUAL_COOLDOWN) {
      return this.lastManual.results;
    }
    if (this.checking) {
      await this.checking;
    }
    const addresses = this.addresses();
    if (!addresses.ipv4 && !addresses.ipv6) {
      return [];
    }
    const results = [];
    for (const provider of this.providers.values()) {
      const result = await provider.sync(addresses, this.now());
      this.logResult(provider, result);
      results.push({ name: provider.name, ...result });
    }
    this.lastManual = { at: now, results };
    await this.reportStatus();
    this.gladys.requestWidgetRefresh(WIDGETS.PUBLIC_IP);
    return results;
  }

  /** The scene action: { success, updated, error }. */
  async updateDnsNow() {
    if (this.providers.size === 0) {
      return { success: false, updated: 0, error: T.update.none.en };
    }
    const results = await this.manualUpdate();
    if (results.length === 0) {
      return { success: false, updated: 0, error: T.update.noAddress.en };
    }
    const failed = results.find((r) => !r.ok);
    return {
      success: !failed,
      updated: results.filter((r) => r.ok && r.changed).length,
      error: failed ? `${PROVIDER_NAMES[failed.name]}: ${failed.error.message}` : '',
    };
  }

  // --- Status --------------------------------------------------------------------

  async reportStatus() {
    const now = this.now();
    const { ipv4, ipv6 } = this.families;
    if (this.internet.online === false) {
      await this.setStatus(false, T.lost(duration(now - this.internet.firstFailureAt)));
      return;
    }
    if (this.internet.online === null) {
      await this.setStatus(
        this.internet.failures === 0,
        this.internet.failures ? T.noAnswerYet : T.checking,
      );
      return;
    }
    const parts = [T.ok(ipv4.address, this.addresses().ipv6)];
    if (this.config.detectIpv6 && ipv6.available === false) {
      parts.push(T.ipv6Unavailable);
    }
    if (ipv4.cgnat && !ipv4.seenSince) {
      parts.push(T.cgnat);
    }
    if (!ipv4.confirmed) {
      parts.push(T.unconfirmed);
    }
    let connected = true;
    for (const provider of this.providers.values()) {
      const name = PROVIDER_NAMES[provider.name];
      const s = provider.status();
      if (s.final) {
        connected = false;
        parts.push(T.dnsFinal(name, s.lastError));
      } else if (s.lastError) {
        parts.push(T.dnsRetry(name, s.lastError, duration(Math.max(0, s.retryAt - now))));
      } else if (s.lastSuccessAt) {
        parts.push(T.dnsOk(name));
      } else {
        parts.push(T.dnsWaiting(name));
      }
    }
    await this.setStatus(connected, join(parts));
  }

  // --- Scene action and widget -----------------------------------------------------

  /** The scene action: what the last check found (it never fires an event itself). */
  async getPublicIp() {
    if (this.checking) {
      await this.checking;
    }
    const { ipv4 } = this.families;
    return {
      ipv4: ipv4.address,
      ipv6: this.addresses().ipv6,
      last_change: iso(ipv4.changedAt),
      online: this.internet.online !== false,
    };
  }

  snapshot() {
    return {
      families: this.families,
      internet: this.internet,
      detectIpv6: this.config.detectIpv6,
      lastCheckAt: this.lastCheckAt,
      providers: [...this.providers.values()].map((p) => p.status()),
    };
  }

  async getWidget({ language } = {}) {
    return publicIpWidget({
      snapshot: this.snapshot(),
      now: this.now(),
      language: language ?? 'en',
    });
  }

  async widgetAction(actionKey) {
    if (actionKey !== WIDGET_ACTIONS.UPDATE_DNS) {
      throw new Error(`Unknown widget action ${actionKey}`);
    }
    if (this.providers.size === 0) {
      return T.update.none;
    }
    const results = await this.manualUpdate();
    if (results.length === 0) {
      return T.update.noAddress;
    }
    const toast = join(
      results.map((r) => {
        const name = PROVIDER_NAMES[r.name];
        if (!r.ok) {
          return T.update.failed(name, r.error.message);
        }
        return r.changed ? T.update.updated(name) : T.update.unchanged(name);
      }),
      ' · ',
    );
    // A widget toast holds 200 characters.
    return { en: toast.en.slice(0, 200), fr: toast.fr.slice(0, 200) };
  }

  // --- The Test button -------------------------------------------------------------

  /**
   * Ask every source once (in parallel), then check each DNS provider
   * without writing anything: Duck DNS has no dry run (its fields are only
   * checked locally), Cloudflare is asked for the token, the zone and the
   * records. Nothing here feeds the triggers.
   */
  async testConnection() {
    const lines = [T.test.title];
    const families = this.config.detectIpv6 ? FAMILIES : ['ipv4'];
    const answers = await Promise.all(
      families.flatMap((family) =>
        SOURCES[family].map((source) => this.ask(source, family).then((a) => ({ family, ...a }))),
      ),
    );
    // No IPv6 at all is the usual case: one calm line rather than three failures.
    const noIpv6 = answers.every((a) => a.family === 'ipv4' || !a.ok);
    for (const a of answers) {
      const family = a.family === 'ipv4' ? 'IPv4' : 'IPv6';
      if (a.family === 'ipv6' && noIpv6) {
        continue;
      }
      lines.push(
        a.ok
          ? T.test.answer(family, a.source, a.address, a.kind)
          : T.test.failed(family, a.source, a.error),
      );
    }
    if (!this.config.detectIpv6) {
      lines.push(T.test.ipv6Off);
    } else if (noIpv6) {
      lines.push(T.test.ipv6None);
    }
    // The addresses a sync would push: the believed ones, else what the test saw.
    const seen = (family) =>
      answers.find((a) => a.family === family && a.ok && a.kind === KINDS.PUBLIC)?.address ?? null;
    const known = this.addresses();
    const addresses = { ipv4: known.ipv4 ?? seen('ipv4'), ipv6: known.ipv6 ?? seen('ipv6') };
    if (this.providers.size === 0) {
      lines.push(T.test.noDns);
    }
    for (const provider of this.providers.values()) {
      lines.push(...(await this.testProvider(provider, addresses)));
    }
    return join(lines, '\n');
  }

  async testProvider(provider, addresses) {
    const name = PROVIDER_NAMES[provider.name];
    const { client } = provider;
    const problems = client.problems();
    if (problems.length > 0) {
      return [T.test.problem(name, problems.join(', '))];
    }
    if (provider.name === PROVIDERS.DUCKDNS) {
      return [T.test.duckdnsReady(client.domains.map((d) => `${d}.duckdns.org`).join(', '))];
    }
    const lines = [];
    try {
      lines.push(T.test.tokenStatus(await client.verifyToken()));
    } catch (err) {
      // Cloudflare unreachable: nothing more to learn. A refusal may only mean an
      // account-owned token (verified elsewhere): the zone lookup tells.
      if (!(err instanceof DnsError) || ['network', 'timeout'].includes(err.code)) {
        return [T.test.problem(name, err.message)];
      }
      lines.push(T.test.tokenUnverified(err.message));
    }
    try {
      const { plan } = await client.plan(provider.target(addresses));
      for (const step of plan) {
        lines.push(
          step.missing
            ? T.test.missing(step.name)
            : T.test.record(step.record.name, step.record.type, step.record.content, step.target),
        );
      }
    } catch (err) {
      lines.push(T.test.problem(name, err.message));
    }
    return lines;
  }
}
