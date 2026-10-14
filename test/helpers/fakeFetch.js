// -----------------------------------------------------------------------------
// A fake Internet for the tests: the three IP-echo services per family, Duck
// DNS and the Cloudflare API, behind a fake `fetch` that records every call
// and fails loudly on an unexpected URL. No test touches the network.
//
// The addresses are well-known public resolvers (Quad9, Cloudflare): public,
// so they pass the validation, and nobody's home.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { setFetch } from '../../src/http.js';

setFetch(async (url) => {
  throw new Error(`Network call without a fake fetch in a test: ${url}`);
});

export const IP = {
  V4: '9.9.9.9',
  V4_NEW: '149.112.112.112',
  V4_OTHER: '1.0.0.1',
  V6: '2620:fe::fe',
  V6_NEW: '2606:4700:4700::1111',
};
export const DUCK_TOKEN = 'a7c4d5e6-1b2c-4d3e-8f90-123456789abc';
export const CF_TOKEN = 'cf-token-Sn3lZJTBX6kkg7OdcBUAxOO963GEIyGQ';
export const ZONE_ID = '023e105f4ecef8ad9ca31a8372d0c353';

export function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
}

const text = (body, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain' } });
export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const unreachable = () => {
  throw new TypeError('fetch failed', { cause: { code: 'ENETUNREACH' } });
};

const ECHO = {
  'api.ipify.org': ['ipv4', 'ipify'],
  'ipv4.icanhazip.com': ['ipv4', 'icanhazip'],
  '4.ident.me': ['ipv4', 'ident.me'],
  'api6.ipify.org': ['ipv6', 'ipify'],
  'ipv6.icanhazip.com': ['ipv6', 'icanhazip'],
  '6.ident.me': ['ipv6', 'ident.me'],
};

/**
 * Install the fake Internet. `net` is mutable during a test:
 *   down            every request fails (the line is cut)
 *   ipv4 / ipv6     what the echo services answer (ipv6 null: no IPv6 route)
 *   override        { 'ipify': '1.2.3.4' | Error | Response } per source name
 *   duck            the Duck DNS answer text ('OK...', 'KO') or a status number
 *   cf              { zones, records: [...], status } the Cloudflare account
 */
export function installNet(options = {}) {
  const calls = [];
  const net = {
    down: false,
    ipv4: IP.V4,
    ipv6: null,
    override: {},
    duck: 'OK\n9.9.9.9\n\nUPDATED',
    cf: {
      zones: fixture('cloudflare-zones.json').result,
      records: fixture('cloudflare-records-home.json').result,
      error: undefined,
    },
    ...options,
  };
  const previous = setFetch(async (url, init = {}) => {
    const u = new URL(url);
    const call = {
      url,
      host: u.host,
      path: u.pathname,
      params: Object.fromEntries(u.searchParams),
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    if (net.down) {
      unreachable();
    }
    if (ECHO[u.host]) {
      const [family, name] = ECHO[u.host];
      const value = net.override[name] ?? net[family];
      if (value instanceof Response) {
        return value;
      }
      if (value === null || value === undefined || value instanceof Error) {
        return unreachable();
      }
      return text(name === 'icanhazip' ? `${value}\n` : value);
    }
    if (u.host === 'www.duckdns.org') {
      return typeof net.duck === 'number' ? text('', net.duck) : text(net.duck);
    }
    if (u.host === 'api.cloudflare.com') {
      return cloudflare(net.cf, call);
    }
    throw new Error(`Unexpected network call in a test: ${url}`);
  });
  return {
    calls,
    net,
    restore: () => setFetch(previous),
    /** The calls to one host (or to the IP services). */
    to: (host) => calls.filter((c) => (host === 'echo' ? ECHO[c.host] : c.host === host)),
  };
}

const ok = (result) => json({ success: true, errors: [], messages: [], result });

/** A tiny Cloudflare: verify, zones by name, records by name.exact, PATCH. */
function cloudflare(cf, call) {
  if (cf.error) {
    return json(cf.error.body, cf.error.status);
  }
  const base = '/client/v4';
  const path = call.path.slice(base.length);
  if (path === '/user/tokens/verify') {
    return json(fixture('cloudflare-verify.json'));
  }
  if (path === '/zones') {
    return ok(cf.zones.filter((z) => z.name === call.params.name));
  }
  const list = /^\/zones\/([0-9a-f]{32})\/dns_records$/.exec(path);
  if (list && call.method === 'GET') {
    return ok(cf.records.filter((r) => r.name === call.params['name.exact']));
  }
  const one = /^\/zones\/([0-9a-f]{32})\/dns_records\/([0-9a-f]{32})$/.exec(path);
  if (one && call.method === 'PATCH') {
    const record = cf.records.find((r) => r.id === one[2]);
    Object.assign(record, call.body);
    return ok(record);
  }
  throw new Error(`Unexpected Cloudflare call in a test: ${call.method} ${path}`);
}
