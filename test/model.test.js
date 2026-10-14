// -----------------------------------------------------------------------------
// Addresses, configuration and the "two sources agree" decision.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, recordNames } from '../src/config.js';
import { KINDS, classify, isPublic, normalizeAddress, parseAnswer } from '../src/model.js';
import { detectFamily, rotation } from '../src/sources.js';

test('an echo answer is a bare address of the right family, nothing else', () => {
  assert.deepEqual(parseAnswer('9.9.9.9', 'ipv4'), { address: '9.9.9.9', kind: KINDS.PUBLIC });
  // icanhazip ends with a newline; ipify and ident.me do not (seen on 2026-10-14).
  assert.deepEqual(parseAnswer('9.9.9.9\n', 'ipv4'), { address: '9.9.9.9', kind: KINDS.PUBLIC });
  assert.equal(parseAnswer('2620:fe::fe', 'ipv4'), undefined, 'IPv6 from an IPv4 source');
  assert.equal(parseAnswer('9.9.9.9', 'ipv6'), undefined);
  assert.equal(parseAnswer('<html><body>9.9.9.9</body></html>', 'ipv4'), undefined);
  assert.equal(parseAnswer('1.2.3.04', 'ipv4'), undefined, 'leading zeros are ambiguous');
  assert.equal(parseAnswer('', 'ipv4'), undefined);
  assert.equal(parseAnswer(`${'9'.repeat(200)}`, 'ipv4'), undefined);
});

test('IPv6 is normalized so two sources compare equal', () => {
  assert.equal(normalizeAddress('2606:4700:4700:0:0:0:0:1111', 'ipv6'), '2606:4700:4700::1111');
  assert.equal(normalizeAddress('2620:FE::FE', 'ipv6'), '2620:fe::fe');
  assert.equal(normalizeAddress('fe80::1%eth0', 'ipv6'), undefined);
});

test('only a public address counts; CGNAT is told apart', () => {
  const cases = [
    ['9.9.9.9', 'ipv4', KINDS.PUBLIC],
    ['100.64.0.1', 'ipv4', KINDS.CGNAT],
    ['100.127.255.254', 'ipv4', KINDS.CGNAT],
    ['100.128.0.1', 'ipv4', KINDS.PUBLIC],
    ['10.1.2.3', 'ipv4', KINDS.PRIVATE],
    ['172.31.0.1', 'ipv4', KINDS.PRIVATE],
    ['192.168.1.1', 'ipv4', KINDS.PRIVATE],
    ['127.0.0.1', 'ipv4', KINDS.PRIVATE],
    ['169.254.1.1', 'ipv4', KINDS.PRIVATE],
    ['203.0.113.7', 'ipv4', KINDS.RESERVED],
    ['224.0.0.1', 'ipv4', KINDS.RESERVED],
    ['2620:fe::fe', 'ipv6', KINDS.PUBLIC],
    ['fd12::1', 'ipv6', KINDS.PRIVATE],
    ['fe80::1', 'ipv6', KINDS.PRIVATE],
    ['::1', 'ipv6', KINDS.PRIVATE],
    ['2001:db8::1', 'ipv6', KINDS.RESERVED],
    ['::ffff:102:304', 'ipv6', KINDS.RESERVED],
  ];
  for (const [address, family, kind] of cases) {
    assert.equal(classify(address, family), kind, address);
  }
  assert.equal(isPublic('9.9.9.9', 'ipv4'), true);
  assert.equal(isPublic('—', 'ipv4'), false);
});

test('the configuration: bounds, Duck DNS sub-domains, Cloudflare record names', () => {
  const config = normalizeConfig({
    interval: '0',
    failures_before_lost: 99,
    detect_ipv6: 'false',
    duckdns_domains: 'MyHome.duckdns.org, vpn, vpn, bad_name!',
    cloudflare_zone: 'Example.COM',
    cloudflare_records: 'home, vpn.example.com, @, café',
  });
  assert.equal(config.interval, 1, 'never below a minute');
  assert.equal(config.failuresBeforeLost, 10);
  assert.equal(config.detectIpv6, false);
  assert.deepEqual(config.duckdns.domains, ['myhome', 'vpn']);
  assert.deepEqual(config.duckdns.invalid, ['bad_name!']);
  assert.equal(config.duckdns.ipv6, false, 'Duck DNS AAAA is opt-in');
  assert.equal(config.cloudflare.zone, 'example.com');
  assert.deepEqual(config.cloudflare.records, [
    'home.example.com',
    'vpn.example.com',
    'example.com',
    'xn--caf-dma.example.com',
  ]);
  const defaults = normalizeConfig({});
  assert.equal(defaults.interval, 5);
  assert.equal(defaults.failuresBeforeLost, 2);
  assert.equal(defaults.detectIpv6, true);
  // With a Zone ID the zone name is unknown: the names must be complete.
  assert.deepEqual(recordNames('home.example.com, home', '023e105f4ecef8ad9ca31a8372d0c353'), {
    names: ['home.example.com'],
    invalid: ['home'],
  });
});

/** A fake `ask`: answers per source name, records the order. */
function asker(answers) {
  const asked = [];
  const ask = async (source) => {
    asked.push(source.name);
    const value = answers[source.name];
    if (value === undefined || value instanceof Error) {
      return { source: source.name, ok: false, error: 'network' };
    }
    return { source: source.name, ok: true, ...parseAnswer(value, 'ipv4') };
  };
  return { ask, asked };
}

const all = (ip) => ({ ipify: ip, icanhazip: ip, 'ident.me': ip });

test('steady state: one source confirming the known address is enough', async () => {
  const { ask, asked } = asker(all('9.9.9.9'));
  const result = await detectFamily({ family: 'ipv4', current: '9.9.9.9', start: 1, ask });
  assert.equal(result.address, '9.9.9.9');
  assert.equal(result.confirmed, true);
  assert.deepEqual(asked, ['icanhazip'], 'one request, rotating source');
  assert.deepEqual(
    rotation('ipv4', 2).map((s) => s.name),
    ['ident.me', 'ipify', 'icanhazip'],
  );
});

test('a new address needs two sources: a lying source fires nothing', async () => {
  // The first reading: two agreeing sources.
  let run = asker(all('9.9.9.9'));
  let result = await detectFamily({ family: 'ipv4', current: null, ask: run.ask });
  assert.deepEqual([result.address, result.confirmed, run.asked.length], ['9.9.9.9', true, 2]);
  // A real change: confirmed by the second source.
  run = asker(all('149.112.112.112'));
  result = await detectFamily({ family: 'ipv4', current: '9.9.9.9', ask: run.ask });
  assert.deepEqual([result.address, result.confirmed], ['149.112.112.112', true]);
  // A broken source answering something else: the next one confirms the current address.
  run = asker({ ...all('9.9.9.9'), ipify: '1.0.0.1' });
  result = await detectFamily({ family: 'ipv4', current: '9.9.9.9', ask: run.ask });
  assert.deepEqual([result.address, result.confirmed], ['9.9.9.9', true]);
  // A lone source, the others down: undecided, the current address is kept.
  run = asker({ ipify: '1.0.0.1' });
  result = await detectFamily({ family: 'ipv4', current: '9.9.9.9', ask: run.ask });
  assert.deepEqual([result.address, result.confirmed, result.reachable], ['9.9.9.9', false, true]);
  // Three different answers (a load-balanced line): undecided too.
  run = asker({ ipify: '1.0.0.1', icanhazip: '149.112.112.112', 'ident.me': '8.8.4.4' });
  result = await detectFamily({ family: 'ipv4', current: null, ask: run.ask });
  assert.deepEqual([result.address, result.confirmed], [null, false]);
});

test('every source down: unreachable; a CGNAT answer is flagged, never adopted', async () => {
  let result = await detectFamily({ family: 'ipv4', current: '9.9.9.9', ask: asker({}).ask });
  assert.deepEqual([result.reachable, result.confirmed, result.address], [false, false, '9.9.9.9']);
  assert.equal(result.answers.length, 3);
  result = await detectFamily({ family: 'ipv4', ask: asker(all('100.64.1.2')).ask });
  assert.deepEqual([result.reachable, result.cgnat, result.address], [true, true, null]);
});
