// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and a fake Internet.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { PublicIpApp } from '../src/app.js';
import {
  ACTIONS,
  DNS_BACKOFF_FIRST,
  IPV6_RETRY,
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
  WIDGETS,
  WIDGET_ACTIONS,
} from '../src/constants.js';
import { CF_TOKEN, DUCK_TOKEN, IP, installNet } from './helpers/fakeFetch.js';
import { createFakeTimers } from './helpers/fakeTimers.js';

let fake;
afterEach(() => fake?.restore());

const T0 = Date.parse('2026-10-14T08:00:00Z');
const MIN = 60_000;
const DEVICE = 'ext:public-ip:internet';
const DUCK = { duckdns_domains: 'myhome', duckdns_token: DUCK_TOKEN };
const CLOUDFLARE = {
  cloudflare_token: CF_TOKEN,
  cloudflare_zone: 'example.com',
  cloudflare_records: 'home',
};

/** The device as Gladys hands it back once created (with the addresses it kept). */
const created = (stored = {}) => ({
  external_id: DEVICE,
  name: 'Internet',
  features: ['online', 'ipv4', 'ipv6'].map((key) => ({
    external_id: `${DEVICE}:${key}`,
    category: key === 'online' ? 'unknown' : 'text',
    type: key === 'online' ? 'binary' : 'text',
    ...(stored[key] ? { last_value_string: stored[key] } : {}),
  })),
});

async function setup({ devices = [created()], net = {} } = {}) {
  fake = installNet(net);
  const gladys = createFakeGladys({ selector: 'public-ip', devices });
  const timers = createFakeTimers();
  const clock = { now: T0 };
  const logs = [];
  const log = (...args) => logs.push(args.join(' '));
  const app = new PublicIpApp({
    gladys,
    logger: { info: log, warn: log, error: log, debug: log },
    now: () => clock.now,
    timers,
  });
  gladys.onScanRequest(() => app.publishDevices());
  gladys.onDeviceCreated((device) => app.deviceCreated(device));
  gladys.onSceneAction(SCENE_ACTIONS.GET_IP, () => app.getPublicIp());
  gladys.onSceneAction(SCENE_ACTIONS.UPDATE_DNS, () => app.updateDnsNow());
  gladys.onWidgetGet(WIDGETS.PUBLIC_IP, (request) => app.getWidget(request));
  gladys.onWidgetAction(WIDGETS.PUBLIC_IP, (actionKey) => app.widgetAction(actionKey));
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());
  await gladys.connect();
  /** Move the clock to the next check and run it. */
  const tick = async (minutes) => {
    const [timer] = timers.timeouts();
    assert.ok(timer, 'a check is scheduled');
    if (minutes !== undefined) {
      assert.equal(timer.ms, minutes * MIN, 'the delay of the next check');
    }
    clock.now += timer.ms;
    await timers.runTimeouts();
  };
  return { app, gladys, timers, clock, logs, tick };
}

const events = (gladys, key) => gladys.fake.sceneEvents.filter((e) => e.key === key);

test('start: the device, two agreeing sources, calm IPv6, no event', async () => {
  const { app, gladys, tick } = await setup();
  await app.start({});
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.external_id),
    [DEVICE],
  );
  assert.equal(fake.to('echo').filter((c) => !c.host.includes('6')).length, 2, 'two IPv4 sources');
  assert.equal(gladys.fake.lastState(`${DEVICE}:online`), 1);
  assert.equal(gladys.fake.lastState(`${DEVICE}:ipv4`), IP.V4);
  assert.equal(gladys.fake.lastState(`${DEVICE}:ipv6`), '—');
  const status = gladys.fake.connectionStatus;
  assert.equal(status.connected, true, 'no IPv6 is not an error');
  assert.match(
    status.message.en,
    /Public IPv4 9\.9\.9\.9\. IPv6 is not available from the container/,
  );
  assert.equal(gladys.fake.sceneEvents.length, 0, 'the first reading only sets the baseline');
  // The next check: one IPv4 request, IPv6 left alone for 30 minutes.
  const before = fake.calls.length;
  await tick(5);
  assert.deepEqual(
    fake.calls.slice(before).map((c) => c.host),
    ['ipv4.icanhazip.com'],
    'one request, the next source in the rotation',
  );
  app.stop();
});

test('a change confirmed by two sources fires once and updates Duck DNS', async () => {
  const { app, gladys, tick, logs } = await setup();
  await app.start({ ...DUCK });
  const duck = () => fake.to('www.duckdns.org');
  assert.equal(duck().length, 1, 'once at start, to make sure');
  assert.equal(duck()[0].params.ip, IP.V4);
  assert.equal(duck()[0].params.domains, 'myhome');
  // One lying source: nothing happens.
  fake.net.override = { icanhazip: IP.V4_OTHER };
  await tick(5);
  assert.equal(gladys.fake.sceneEvents.length, 0);
  // The real change.
  fake.net.override = {};
  fake.net.ipv4 = IP.V4_NEW;
  await tick(5);
  assert.deepEqual(events(gladys, SCENE_TRIGGERS.IP_CHANGED), [
    {
      key: SCENE_TRIGGERS.IP_CHANGED,
      data: { family: 'ipv4', old_ip: IP.V4, new_ip: IP.V4_NEW },
    },
  ]);
  assert.equal(gladys.fake.lastState(`${DEVICE}:ipv4`), IP.V4_NEW);
  assert.equal(duck().length, 2);
  assert.equal(duck()[1].params.ip, IP.V4_NEW);
  assert.match(
    gladys.fake.connectionStatus.message.fr,
    /IPv4 publique 149\.112\.112\.112\..* Duck DNS à jour\.$/,
  );
  await tick(5);
  assert.equal(duck().length, 2, 'nothing more while the address stays');
  assert.equal(events(gladys, SCENE_TRIGGERS.IP_CHANGED).length, 1);
  assert.ok(!logs.join('\n').includes(IP.V4_NEW), 'the addresses stay out of the logs');
  app.stop();
});

test('an outage: lost after two failed checks a minute apart, restored with its duration', async () => {
  const { app, gladys, tick } = await setup();
  await app.start({});
  fake.net.down = true;
  await tick(5);
  assert.equal(events(gladys, SCENE_TRIGGERS.LOST).length, 0, 'one failure is not an outage');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  await tick(1);
  assert.deepEqual(events(gladys, SCENE_TRIGGERS.LOST)[0].data, {
    lost_at: new Date(T0 + 5 * MIN).toISOString(),
    ipv4: IP.V4,
  });
  assert.equal(gladys.fake.lastState(`${DEVICE}:online`), 0);
  assert.equal(gladys.fake.lastState(`${DEVICE}:ipv4`), IP.V4, 'the last address is kept');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /Internet looks down/);
  await tick(1);
  fake.net.down = false;
  await tick(1);
  assert.deepEqual(events(gladys, SCENE_TRIGGERS.RESTORED)[0].data, {
    duration_minutes: 3,
    lost_at: new Date(T0 + 5 * MIN).toISOString(),
    ipv4: IP.V4,
  });
  assert.equal(gladys.fake.lastState(`${DEVICE}:online`), 1);
  assert.equal(events(gladys, SCENE_TRIGGERS.LOST).length, 1);
  await tick(5);
  app.stop();
});

test('IPv6 when the container has it: detected, and a change of it fires', async () => {
  const { app, gladys, tick } = await setup({ net: { ipv6: IP.V6 } });
  await app.start({ detect_ipv6: true });
  assert.equal(gladys.fake.lastState(`${DEVICE}:ipv6`), IP.V6);
  assert.match(gladys.fake.connectionStatus.message.en, /IPv6 2620:fe::fe/);
  fake.net.ipv6 = IP.V6_NEW;
  await tick(5);
  assert.deepEqual(events(gladys, SCENE_TRIGGERS.IP_CHANGED)[0].data, {
    family: 'ipv6',
    old_ip: IP.V6,
    new_ip: IP.V6_NEW,
  });
  app.stop();
});

test('IPv6 never seen is re-probed every 30 minutes; detection can be turned off', async () => {
  const { app, clock, tick } = await setup();
  await app.start({ interval: 10 });
  const v6 = () => fake.calls.filter((c) => /^(api6|ipv6|6\.)/.test(c.host)).length;
  assert.equal(v6(), 3);
  await tick(10);
  await tick(10);
  assert.equal(v6(), 3);
  clock.now = T0 + IPV6_RETRY;
  await tick(10);
  assert.equal(v6(), 6);
  app.stop();
  const calls = fake.calls.length;
  clock.now += 10 * MIN;
  await app.start({ detect_ipv6: false });
  assert.ok(fake.calls.slice(calls).every((c) => !/^(api6|ipv6|6\.)/.test(c.host)));
  app.stop();
});

test('after a restart, the address Gladys kept is the baseline', async () => {
  const { app, gladys } = await setup({ devices: [created({ ipv4: IP.V4_NEW })] });
  await app.start({});
  assert.deepEqual(events(gladys, SCENE_TRIGGERS.IP_CHANGED)[0].data, {
    family: 'ipv4',
    old_ip: IP.V4_NEW,
    new_ip: IP.V4,
  });
  app.stop();
  // A stored value that is not a public address is no baseline.
  const again = await setup({ devices: [created({ ipv4: '—' })] });
  await again.app.start({});
  assert.equal(again.gladys.fake.sceneEvents.length, 0);
  again.app.stop();
});

test('Cloudflare: checked at start, patched on a change, kept on a reconnection', async () => {
  const { app, clock, tick } = await setup();
  await app.start({ ...CLOUDFLARE });
  const cf = () => fake.to('api.cloudflare.com');
  assert.deepEqual(
    cf().map((c) => `${c.method} ${c.path}`),
    ['GET /client/v4/zones', 'GET /client/v4/zones/023e105f4ecef8ad9ca31a8372d0c353/dns_records'],
    'the A record already points here: nothing written',
  );
  // A reconnection to Gladys with the same configuration: no new DNS call.
  clock.now += 2 * MIN;
  await app.start({ ...CLOUDFLARE });
  assert.equal(cf().length, 2);
  fake.net.ipv4 = IP.V4_NEW;
  await tick(5);
  const patch = cf().find((c) => c.method === 'PATCH');
  assert.deepEqual(patch.body, {
    type: 'A',
    name: 'home.example.com',
    content: IP.V4_NEW,
    ttl: 1,
    proxied: true,
  });
  app.stop();
});

test('DNS failures: backoff, a refused token stops until the button', async () => {
  const { app, gladys, tick } = await setup({ net: { duck: 502 } });
  await app.start({ ...DUCK, interval: 1 });
  const duck = () => fake.to('www.duckdns.org').length;
  assert.equal(duck(), 1);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /Duck DNS: www\.duckdns\.org\/update: HTTP 502\. Next try in 2 min/,
  );
  assert.equal(gladys.fake.connectionStatus.connected, true);
  await tick(1);
  assert.equal(duck(), 1, 'backing off');
  fake.net.duck = 'KO';
  await tick(1);
  assert.equal(duck(), 2, `retried after ${DNS_BACKOFF_FIRST / MIN} minutes`);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /answered KO.*Updates stopped/);
  for (let i = 0; i < 5; i += 1) {
    await tick(1);
  }
  assert.equal(duck(), 2, 'a refused token is not retried by itself');
  fake.net.duck = 'OK';
  const ack = await gladys.fake.widgetAction(WIDGETS.PUBLIC_IP, WIDGET_ACTIONS.UPDATE_DNS, {}, {});
  assert.equal(ack.success, true);
  assert.deepEqual(ack.data.message ?? ack.data, {
    en: 'Duck DNS: already up to date',
    fr: 'Duck DNS : déjà à jour',
  });
  assert.equal(duck(), 3, 'the button always tries');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  app.stop();
});

test('scene actions: the addresses, and "update DNS now"', async () => {
  const { app, gladys, tick } = await setup();
  await app.start({ ...DUCK });
  fake.net.ipv4 = IP.V4_NEW;
  await tick(5);
  const ip = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_IP, {});
  assert.deepEqual(ip.data.outputs, {
    ipv4: IP.V4_NEW,
    ipv6: null,
    last_change: new Date(T0 + 5 * MIN).toISOString(),
    online: true,
  });
  const update = await gladys.fake.sceneAction(SCENE_ACTIONS.UPDATE_DNS, {});
  assert.deepEqual(update.data.outputs, { success: true, updated: 1, error: '' });
  // Twice within 30 s: the same answer, no second request.
  const calls = fake.to('www.duckdns.org').length;
  await gladys.fake.sceneAction(SCENE_ACTIONS.UPDATE_DNS, {});
  assert.equal(fake.to('www.duckdns.org').length, calls);
  assert.equal(events(gladys, SCENE_TRIGGERS.IP_CHANGED).length, 1, 'no event from an action');
  app.stop();
  const bare = await setup();
  await bare.app.start({});
  const none = await bare.gladys.fake.sceneAction(SCENE_ACTIONS.UPDATE_DNS, {});
  assert.deepEqual(none.data.outputs, {
    success: false,
    updated: 0,
    error: 'No dynamic DNS provider is configured.',
  });
  bare.app.stop();
});

test('the widget through Gladys', async () => {
  const { app, gladys } = await setup();
  await app.start({ ...DUCK });
  const ack = await gladys.fake.widgetGet(WIDGETS.PUBLIC_IP, { language: 'en' });
  const content = ack.data.content;
  assert.deepEqual(validateWidgetContent(content), []);
  const items = content.components.find((c) => c.type === 'status').items;
  assert.deepEqual(
    items.map((i) => i.value),
    ['Connected', IP.V4, 'Unavailable', '≥ 0 s', 'Updated 0 s ago'],
  );
  assert.equal(content.components.find((c) => c.type === 'button').label.en, 'Update DNS now');
  app.stop();
});

test('the Test button: every source, a dry run of Cloudflare, nothing written', async () => {
  const { app, gladys } = await setup();
  await app.start({ ...DUCK, ...CLOUDFLARE });
  fake.net.ipv4 = IP.V4_NEW;
  fake.net.override = { 'ident.me': new Error('down') };
  const before = fake.calls.length;
  const ack = await gladys.fake.action(ACTIONS.TEST, {});
  const message = ack.data.message.en;
  assert.match(message, /IPv4 · ipify: 149\.112\.112\.112/);
  assert.match(message, /IPv4 · ident\.me: no answer \(unreachable\)/);
  assert.match(ack.data.message.fr, /ident\.me : pas de réponse \(injoignable\)/);
  assert.match(message, /IPv6 · no source reachable over IPv6/);
  assert.match(message, /Duck DNS: ready for myhome\.duckdns\.org/);
  assert.match(message, /Cloudflare: API token active/);
  assert.match(message, /home\.example\.com A 9\.9\.9\.9 → up to date/);
  assert.match(message, /home\.example\.com AAAA 2620:fe::fe → left as is/);
  const calls = fake.calls.slice(before);
  assert.ok(
    calls.every((c) => c.method === 'GET'),
    'a dry run',
  );
  assert.ok(
    calls.every((c) => c.host !== 'www.duckdns.org'),
    'Duck DNS has no dry run',
  );
  assert.equal(gladys.fake.sceneEvents.length, 0, 'the test feeds no trigger');
  assert.match(ack.data.message.fr, /Cloudflare : jeton d’API actif/);
  app.stop();
});

test('the tokens never leak: statuses, states, events, widget, logs, results', async () => {
  const { app, gladys, logs, tick } = await setup({ net: { duck: 'KO' } });
  await app.start({ ...DUCK, ...CLOUDFLARE });
  fake.net.cf.error = {
    status: 403,
    body: { success: false, errors: [{ code: 10000, message: 'Authentication error' }] },
  };
  fake.net.ipv4 = IP.V4_NEW;
  await tick(5);
  const said = JSON.stringify([
    gladys.fake.connectionStatuses,
    gladys.fake.states,
    gladys.fake.sceneEvents,
    gladys.fake.discoveredDevices,
    await gladys.fake.widgetGet(WIDGETS.PUBLIC_IP, {}),
    await gladys.fake.action(ACTIONS.TEST, {}),
    await gladys.fake.sceneAction(SCENE_ACTIONS.UPDATE_DNS, {}),
    logs,
  ]);
  assert.match(said, /Authentication error/);
  assert.ok(!said.includes(DUCK_TOKEN), 'the Duck DNS token leaked');
  assert.ok(!said.includes(CF_TOKEN), 'the Cloudflare token leaked');
  assert.ok(!said.includes('undefined'), 'a text with a hole');
  app.stop();
});
