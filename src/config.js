// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized:
// the rest of the code never deals with `undefined` or strings from a form.
// -----------------------------------------------------------------------------

import { domainToASCII } from 'node:url';

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULTS = {
  interval: 5,
  failures_before_lost: 2,
  detect_ipv6: true,
  duckdns_ipv6: false,
};

export const BOUNDS = {
  interval: { min: 1, max: 60 },
  failures_before_lost: { min: 1, max: 10 },
};

const number = (value, key) => {
  const n = Number(value);
  const { min, max } = BOUNDS[key];
  return Number.isFinite(n) && String(value ?? '').trim() !== ''
    ? Math.min(max, Math.max(min, Math.round(n)))
    : DEFAULTS[key];
};

const text = (value) => (typeof value === 'string' ? value.trim() : '');

const flag = (value, fallback) => {
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  return fallback;
};

const list = (value) =>
  text(value)
    .split(/[\s,;]+/)
    .map((v) => v.trim())
    .filter(Boolean);

/** Duck DNS tokens are UUIDs: anything else is refused before any request. */
export const DUCKDNS_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DUCKDNS_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** "myhome, vpn.duckdns.org" -> ['myhome', 'vpn'] (+ the entries refused). */
export function parseDuckDomains(value) {
  const domains = [];
  const invalid = [];
  for (const entry of list(value)) {
    const name = entry
      .toLowerCase()
      .replace(/\.$/, '')
      .replace(/\.duckdns\.org$/, '');
    if (DUCKDNS_NAME.test(name)) {
      if (!domains.includes(name)) {
        domains.push(name);
      }
    } else {
      invalid.push(entry.slice(0, 60));
    }
  }
  return { domains, invalid };
}

/** A Cloudflare zone is a 32-hex Zone ID or a domain name. */
export const ZONE_ID = /^[0-9a-f]{32}$/;

/** Lowercase, punycode, no trailing dot; '' when not a host name. */
export function asciiName(value) {
  const name = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
  if (!name || name.length > 253) {
    return '';
  }
  const ascii = domainToASCII(name);
  return /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/.test(ascii) ? ascii : '';
}

/**
 * The full record names: "@" is the zone itself, a name not ending with the
 * zone is taken as relative to it ("home" -> "home.example.com"). With a
 * Zone ID the names must be complete (the zone name is unknown).
 */
export function recordNames(value, zone) {
  const names = [];
  const invalid = [];
  const zoneName = ZONE_ID.test(zone) ? '' : asciiName(zone);
  for (const entry of list(value)) {
    let name;
    if (entry === '@') {
      name = zoneName;
    } else {
      const ascii = asciiName(entry);
      name =
        !ascii || !zoneName || ascii === zoneName || ascii.endsWith(`.${zoneName}`)
          ? ascii
          : `${ascii}.${zoneName}`;
    }
    if (name && name.includes('.')) {
      if (!names.includes(name)) {
        names.push(name);
      }
    } else {
      invalid.push(entry.slice(0, 60));
    }
  }
  return { names, invalid };
}

export function normalizeConfig(raw = {}) {
  const duck = parseDuckDomains(raw.duckdns_domains);
  const zone = text(raw.cloudflare_zone).toLowerCase();
  const records = recordNames(raw.cloudflare_records, zone);
  return {
    interval: number(raw.interval, 'interval'),
    failuresBeforeLost: number(raw.failures_before_lost, 'failures_before_lost'),
    detectIpv6: flag(raw.detect_ipv6, DEFAULTS.detect_ipv6),
    duckdns: {
      domains: duck.domains,
      invalid: duck.invalid,
      token: text(raw.duckdns_token),
      ipv6: flag(raw.duckdns_ipv6, DEFAULTS.duckdns_ipv6),
    },
    cloudflare: {
      token: text(raw.cloudflare_token),
      zone: ZONE_ID.test(zone) ? zone : asciiName(zone),
      records: records.names,
      invalid: records.invalid,
    },
  };
}

/** A provider is on as soon as its fields are filled (off by default). */
export const duckdnsEnabled = (config) =>
  config.duckdns.domains.length > 0 || config.duckdns.token !== '';
export const cloudflareEnabled = (config) =>
  config.cloudflare.token !== '' ||
  config.cloudflare.zone !== '' ||
  config.cloudflare.records.length > 0;
