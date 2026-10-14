// -----------------------------------------------------------------------------
// The DNS providers: Duck DNS, Cloudflare, and the shared retry state.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { DNS_BACKOFF_FIRST, DNS_BACKOFF_MAX } from '../src/constants.js';
import { CloudflareClient } from '../src/dns/cloudflare.js';
import { DuckDnsClient, parseUpdateAnswer, updateUrl } from '../src/dns/duckdns.js';
import { DnsError, DnsProvider } from '../src/dns/provider.js';
import { CF_TOKEN, DUCK_TOKEN, IP, ZONE_ID, fixture, installNet } from './helpers/fakeFetch.js';

let fake;
afterEach(() => fake?.restore());

const duck = (raw = {}) =>
  new DuckDnsClient(
    normalizeConfig({ duckdns_domains: 'myhome', duckdns_token: DUCK_TOKEN, ...raw }).duckdns,
  );
const cloudflare = (raw = {}) =>
  new CloudflareClient(
    normalizeConfig({
      cloudflare_token: CF_TOKEN,
      cloudflare_zone: 'example.com',
      cloudflare_records: 'home',
      ...raw,
    }).cloudflare,
  );

test('Duck DNS: one GET with both addresses, OK and KO read from the answer', async () => {
  const url = new URL(
    updateUrl({ domains: ['myhome', 'vpn'], token: DUCK_TOKEN }, { ipv4: IP.V4, ipv6: IP.V6 }),
  );
  assert.equal(url.origin + url.pathname, 'https://www.duckdns.org/update');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    domains: 'myhome,vpn',
    token: DUCK_TOKEN,
    ip: IP.V4,
    ipv6: IP.V6,
    verbose: 'true',
  });
  assert.deepEqual(parseUpdateAnswer('OK\n9.9.9.9\n\nUPDATED'), { changed: true });
  assert.deepEqual(parseUpdateAnswer('OK\n9.9.9.9\n\nNOCHANGE'), { changed: false });
  assert.deepEqual(parseUpdateAnswer('OK'), { changed: false });
  assert.throws(
    () => parseUpdateAnswer('KO'),
    (err) => err.final && err.code === 'refused',
  );

  fake = installNet();
  assert.deepEqual(await duck().sync({ ipv4: IP.V4, ipv6: null }), { changed: true });
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].params.ip, IP.V4);
  assert.equal(fake.calls[0].params.ipv6, undefined);
});

test('Duck DNS: a malformed token is refused before any request; errors never show it', async () => {
  fake = installNet();
  await assert.rejects(duck({ duckdns_token: 'not-a-token' }).sync({ ipv4: IP.V4 }), (err) => {
    assert.equal(err.final, true);
    assert.match(err.message, /not a Duck DNS token/);
    assert.ok(!err.message.includes('not-a-token'));
    return true;
  });
  assert.equal(fake.calls.length, 0);
  fake.net.duck = 502;
  await assert.rejects(duck().sync({ ipv4: IP.V4 }), (err) => {
    assert.equal(err.final, false, 'a server error is retried');
    assert.match(err.message, /www\.duckdns\.org\/update: HTTP 502/);
    assert.ok(!err.message.includes(DUCK_TOKEN));
    return true;
  });
});

test('Cloudflare: only the stale records are patched, ttl and proxied kept', async () => {
  fake = installNet();
  const client = cloudflare();
  // The A record is up to date, the AAAA one is not.
  assert.deepEqual(await client.sync({ ipv4: IP.V4, ipv6: IP.V6_NEW }), { changed: true });
  const patches = fake.calls.filter((c) => c.method === 'PATCH');
  assert.equal(patches.length, 1);
  assert.equal(
    patches[0].path,
    `/client/v4/zones/${ZONE_ID}/dns_records/6b8e0ae4fb7b4c4a8b9c2c1dbd0c9a11`,
  );
  assert.deepEqual(patches[0].body, {
    type: 'AAAA',
    name: 'home.example.com',
    content: IP.V6_NEW,
    ttl: 300,
    proxied: false,
  });
  assert.equal(patches[0].headers.Authorization, `Bearer ${CF_TOKEN}`);
  assert.ok(
    fake.calls.every((c) => !c.url.includes(CF_TOKEN)),
    'the token stays in the header',
  );
  assert.ok(
    fake.calls.every((c) => ['GET', 'PATCH'].includes(c.method)),
    'never create nor delete',
  );
  // The zone id is cached: the second sync only reads the records, and writes nothing.
  const before = fake.calls.length;
  assert.deepEqual(await client.sync({ ipv4: IP.V4, ipv6: IP.V6_NEW }), { changed: false });
  assert.deepEqual(
    fake.calls.slice(before).map((c) => `${c.method} ${c.path}`),
    [`GET /client/v4/zones/${ZONE_ID}/dns_records`],
  );
  assert.equal(fake.calls.at(-1).params['name.exact'], 'home.example.com');
  // No IPv6 known: the AAAA record is left alone, the A one follows the IPv4.
  await client.sync({ ipv4: IP.V4_NEW, ipv6: null });
  const a = fake.net.cf.records.find((r) => r.type === 'A');
  assert.deepEqual([a.content, a.ttl, a.proxied, a.comment], [IP.V4_NEW, 1, true, 'Gladys']);
  assert.equal(fake.net.cf.records.find((r) => r.type === 'AAAA').content, IP.V6_NEW);
});

test('Cloudflare: a missing record is reported, never created; a zone ID skips the lookup', async () => {
  fake = installNet();
  await assert.rejects(
    cloudflare({ cloudflare_records: 'home, nas' }).sync({ ipv4: IP.V4_NEW }),
    (err) => err.code === 'missing_record' && /nas\.example\.com/.test(err.message) && !err.final,
  );
  assert.equal(
    fake.net.cf.records.find((r) => r.type === 'A').content,
    IP.V4_NEW,
    'home still done',
  );
  const calls = fake.calls.length;
  await cloudflare({ cloudflare_zone: ZONE_ID, cloudflare_records: 'home.example.com' }).sync({
    ipv4: IP.V4_NEW,
  });
  assert.ok(fake.calls.slice(calls).every((c) => c.path !== '/client/v4/zones'));
  fake.net.cf.zones = [];
  await assert.rejects(
    cloudflare().sync({ ipv4: IP.V4 }),
    (err) => err.code === 'config' && err.final && /Zone ID/.test(err.message),
  );
});

test('Cloudflare: a refused token stops the retries, a rate limit does not', async () => {
  fake = installNet();
  fake.net.cf.error = { status: 403, body: fixture('cloudflare-403-no-auth.json') };
  await assert.rejects(cloudflare().sync({ ipv4: IP.V4 }), (err) => {
    assert.equal(err.code, 'auth');
    assert.equal(err.final, true);
    assert.match(err.message, /API token was refused: Missing X-Auth-Email header \(9106\)/);
    return true;
  });
  // A real answer of 2026-10-14 (a shared address hammered by bad tokens).
  fake.net.cf.error = { status: 429, body: fixture('cloudflare-429.json') };
  await assert.rejects(
    cloudflare().sync({ ipv4: IP.V4 }),
    (err) => !err.final && /Too many authentication failures/.test(err.message),
  );
  fake.net.down = true;
  await assert.rejects(
    cloudflare().verifyToken(),
    (err) => err.code === 'network' && !err.message.includes(CF_TOKEN),
  );
});

test('a provider syncs what changed, backs off on failure, stops on a final error', async () => {
  let answer = { changed: true };
  let fail;
  const pushed = [];
  const client = {
    sync: async (target) => {
      pushed.push(target);
      if (fail) {
        throw fail;
      }
      return answer;
    },
  };
  const provider = new DnsProvider({ name: 'duckdns', client, fingerprint: 'x', wantsIpv6: false });
  const addresses = { ipv4: IP.V4, ipv6: IP.V6 };
  assert.equal(provider.needsSync(addresses), true, 'once at start');
  assert.deepEqual((await provider.sync(addresses, 0)).ok, true);
  assert.deepEqual(pushed[0], { ipv4: IP.V4, ipv6: null }, 'Duck DNS AAAA is opt-in');
  assert.equal(provider.needsSync(addresses), false);
  assert.equal(provider.needsSync({ ipv4: IP.V4_NEW, ipv6: null }), true);
  assert.equal(
    provider.needsSync({ ipv4: null, ipv6: null }),
    false,
    'nothing known, nothing to push',
  );
  fail = new DnsError('http', 'boom');
  await provider.sync({ ipv4: IP.V4_NEW }, 1000);
  assert.equal(provider.retryAt, 1000 + DNS_BACKOFF_FIRST);
  assert.equal(provider.due(1000 + DNS_BACKOFF_FIRST - 1), false);
  await provider.sync({ ipv4: IP.V4_NEW }, 2000);
  assert.equal(provider.retryAt, 2000 + 2 * DNS_BACKOFF_FIRST);
  for (let i = 0; i < 10; i += 1) {
    await provider.sync({ ipv4: IP.V4_NEW }, 3000);
  }
  assert.equal(provider.retryAt, 3000 + DNS_BACKOFF_MAX, 'at most an hour');
  fail = new DnsError('auth', 'refused', { final: true });
  await provider.sync({ ipv4: IP.V4_NEW }, 4000);
  assert.equal(provider.due(10 ** 12), false);
  fail = undefined;
  answer = { changed: false };
  const result = await provider.sync({ ipv4: IP.V4_NEW }, 5000);
  assert.deepEqual([result.ok, provider.final, provider.lastError], [true, false, null]);
  assert.equal(provider.status().synced.ipv4, IP.V4_NEW);
});
