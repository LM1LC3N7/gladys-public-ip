// -----------------------------------------------------------------------------
// What every dynamic DNS provider shares: the error type, and the state of
// one provider between two updates (what was pushed, the backoff, the last
// result shown in the widget and the status).
// -----------------------------------------------------------------------------

import { DNS_BACKOFF_FIRST, DNS_BACKOFF_MAX } from '../constants.js';

export class DnsError extends Error {
  /**
   * `code`: 'auth', 'config', 'missing_record', 'refused', 'http', 'timeout',
   * 'network'. A `final` error (a refused token, a wrong zone) stops the
   * automatic retries until the configuration is saved again; the "Update
   * DNS now" button still tries.
   */
  constructor(code, message, { final = false } = {}) {
    super(message);
    this.name = 'DnsError';
    this.code = code;
    this.final = final;
  }
}

/** Remove a secret from a text before it reaches a log, a status or a result. */
export const scrub = (text, secret) =>
  secret ? String(text).replaceAll(secret, '***') : String(text);

/**
 * One provider and its update state. `client.sync({ ipv4, ipv6 })` pushes
 * the addresses and resolves { changed: boolean, detail?: string }.
 */
export class DnsProvider {
  constructor({ name, client, fingerprint, wantsIpv6 = true }) {
    this.name = name;
    this.client = client;
    this.fingerprint = fingerprint;
    this.wantsIpv6 = wantsIpv6;
    /** The addresses the provider is known to point to (null: never synced). */
    this.synced = { ipv4: null, ipv6: null };
    this.failures = 0;
    this.retryAt = 0;
    this.final = false;
    this.lastSuccessAt = null;
    this.lastChanged = false;
    this.lastError = null;
    this.lastErrorAt = null;
    this.running = undefined;
  }

  /** The addresses this provider should point to, from the detected ones. */
  target({ ipv4, ipv6 }) {
    return { ipv4: ipv4 ?? null, ipv6: this.wantsIpv6 ? (ipv6 ?? null) : null };
  }

  /** An address is known and differs from what was pushed. */
  needsSync(addresses) {
    const target = this.target(addresses);
    return (
      (target.ipv4 !== null && target.ipv4 !== this.synced.ipv4) ||
      (target.ipv6 !== null && target.ipv6 !== this.synced.ipv6)
    );
  }

  /** May the automatic loop try now? (the button always may) */
  due(now) {
    return !this.final && now >= this.retryAt;
  }

  /** Push the addresses; never throws, records the outcome. Calls never overlap. */
  sync(addresses, now) {
    if (!this.running) {
      this.running = this.doSync(addresses, now).finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  async doSync(addresses, now) {
    const target = this.target(addresses);
    try {
      const result = await this.client.sync(target);
      this.synced = {
        ipv4: target.ipv4 ?? this.synced.ipv4,
        ipv6: target.ipv6 ?? this.synced.ipv6,
      };
      this.failures = 0;
      this.retryAt = 0;
      this.final = false;
      this.lastSuccessAt = now;
      this.lastChanged = result.changed;
      this.lastError = null;
      this.lastErrorAt = null;
      return { ok: true, ...result };
    } catch (err) {
      const error =
        err instanceof DnsError ? err : new DnsError('network', String(err?.message ?? err));
      this.failures += 1;
      this.final = error.final;
      this.retryAt =
        now + Math.min(DNS_BACKOFF_MAX, DNS_BACKOFF_FIRST * 2 ** Math.min(10, this.failures - 1));
      this.lastError = error.message;
      this.lastErrorAt = now;
      return { ok: false, error };
    }
  }

  /** The snapshot the widget and the status read. */
  status() {
    return {
      name: this.name,
      lastSuccessAt: this.lastSuccessAt,
      lastChanged: this.lastChanged,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
      final: this.final,
      retryAt: this.retryAt,
      synced: { ...this.synced },
    };
  }
}
