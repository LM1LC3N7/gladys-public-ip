// -----------------------------------------------------------------------------
// The "public_ip" dashboard widget: the connection, the addresses, how long
// they have not changed, the state of each DNS provider and an "Update DNS
// now" button. Pure.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_ACTIONS } from './constants.js';
import { PROVIDER_NAMES, T, duration } from './i18n.js';

const pick = (text, language) => (typeof text === 'string' ? text : (text[language] ?? text.en));

function internetRow(internet, now, language) {
  const row = { label: T.widget.internet, icon: 'activity' };
  if (internet.online === true) {
    return { ...row, value: pick(T.widget.online, language), color: WIDGET_COLORS.SUCCESS };
  }
  if (internet.online === false) {
    return {
      ...row,
      value: pick(T.widget.offlineFor(duration(now - internet.firstFailureAt, language)), language),
      color: WIDGET_COLORS.DANGER,
    };
  }
  return { ...row, value: pick(T.widget.unknown, language), color: WIDGET_COLORS.NEUTRAL };
}

function addressRow(label, family, { enabled = true, online }, language) {
  const row = { label, icon: 'globe' };
  if (!enabled) {
    return { ...row, value: pick(T.widget.off, language), color: WIDGET_COLORS.NEUTRAL };
  }
  if (family.available === false) {
    return { ...row, value: pick(T.widget.unavailable, language), color: WIDGET_COLORS.NEUTRAL };
  }
  if (family.address) {
    return {
      ...row,
      value: family.address,
      color: online === false ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
    };
  }
  if (family.cgnat) {
    return { ...row, value: pick(T.widget.cgnat, language), color: WIDGET_COLORS.WARNING };
  }
  return { ...row, value: '—', color: WIDGET_COLORS.NEUTRAL };
}

function providerRow(provider, now, language) {
  const row = { label: PROVIDER_NAMES[provider.name], icon: 'server' };
  if (provider.final) {
    return { ...row, value: pick(T.widget.stopped, language), color: WIDGET_COLORS.DANGER };
  }
  if (provider.lastError && (provider.lastErrorAt ?? 0) >= (provider.lastSuccessAt ?? 0)) {
    return {
      ...row,
      value: `${pick(T.widget.error, language)} · ${provider.lastError}`.slice(0, 40),
      color: WIDGET_COLORS.WARNING,
    };
  }
  if (provider.lastSuccessAt) {
    return {
      ...row,
      value: pick(T.widget.updatedAgo(duration(now - provider.lastSuccessAt, language)), language),
      color: WIDGET_COLORS.SUCCESS,
    };
  }
  return { ...row, value: pick(T.widget.waiting, language), color: WIDGET_COLORS.NEUTRAL };
}

/**
 * `snapshot`: { families: { ipv4, ipv6 }, internet, detectIpv6, lastCheckAt,
 * providers: [DnsProvider.status()] } as built by the app.
 */
export function publicIpWidget({ snapshot, now, language = 'en' }) {
  const { families, internet, providers = [] } = snapshot;
  const components = [{ type: 'text', text: T.widget.title, variant: 'heading' }];
  const items = [
    internetRow(internet, now, language),
    addressRow('IPv4', families.ipv4, { online: internet.online }, language),
    addressRow(
      'IPv6',
      families.ipv6,
      { enabled: snapshot.detectIpv6, online: internet.online },
      language,
    ),
  ];
  const v4 = families.ipv4;
  if (v4.address && (v4.changedAt ?? v4.seenSince)) {
    // Without a change seen since the start, the address is at least that old.
    const age = duration(now - (v4.changedAt ?? v4.seenSince), language);
    items.push({
      label: T.widget.unchangedFor,
      value: v4.changedAt ? age : `≥ ${age}`,
      icon: 'clock',
      color: WIDGET_COLORS.INFO,
    });
  }
  for (const provider of providers) {
    items.push(providerRow(provider, now, language));
  }
  components.push({ type: 'status', items });
  const checked = snapshot.lastCheckAt
    ? pick(T.widget.checkedAgo(duration(now - snapshot.lastCheckAt, language)), language)
    : pick(T.widget.unknown, language);
  components.push({
    type: 'text',
    text: `${checked} · ${pick(T.widget.unofficial, language)}`,
    variant: 'caption',
  });
  if (providers.length > 0) {
    components.push({
      type: 'button',
      label: T.widget.updateDns,
      icon: 'refresh-cw',
      style: 'secondary',
      action: { key: WIDGET_ACTIONS.UPDATE_DNS },
    });
  }
  return { ttl_seconds: 60, components };
}
