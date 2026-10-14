// -----------------------------------------------------------------------------
// The widget content and the device states. Pure.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { WIDGET_ACTIONS } from '../src/constants.js';
import { buildInternetDevice, internetStates, storedAddress } from '../src/devices.js';
import { duration } from '../src/i18n.js';
import { publicIpWidget } from '../src/widget.js';

const NOW = Date.parse('2026-10-14T12:00:00Z');
const H = 3_600_000;

const family = (extra = {}) => ({
  address: null,
  seenSince: null,
  changedAt: null,
  available: null,
  cgnat: false,
  ...extra,
});

const snapshot = (extra = {}) => ({
  families: {
    ipv4: family({ address: '9.9.9.9', seenSince: NOW - 3 * H }),
    ipv6: family({ available: false }),
  },
  internet: { online: true, failures: 0, firstFailureAt: null },
  detectIpv6: true,
  lastCheckAt: NOW - 60_000,
  providers: [],
  ...extra,
});

const rows = (content) =>
  Object.fromEntries(
    content.components
      .find((c) => c.type === 'status')
      .items.map((i) => [i.label.en ?? i.label, i]),
  );

test('the widget: addresses, age, providers, and the button only with a provider', () => {
  let content = publicIpWidget({ snapshot: snapshot(), now: NOW, language: 'fr' });
  assert.deepEqual(validateWidgetContent(content), [], 'rendered exactly as sent');
  let r = rows(content);
  assert.equal(r.Internet.value, 'Connecté');
  assert.equal(r.IPv4.value, '9.9.9.9');
  assert.equal(r.IPv6.value, 'Indisponible');
  assert.equal(r.IPv6.color, 'neutral', 'no IPv6 is never red');
  assert.equal(r['Unchanged for'].value, '≥ 3 h 00', 'no change seen since the start');
  assert.match(content.components.at(-1).text, /Vérifié il y a 1 min · connecteur non officiel/);
  assert.ok(!content.components.some((c) => c.type === 'button'));

  content = publicIpWidget({
    snapshot: snapshot({
      internet: { online: false, failures: 3, firstFailureAt: NOW - 12 * 60_000 },
      providers: [
        { name: 'duckdns', lastSuccessAt: NOW - 2 * H, lastError: null, final: false },
        {
          name: 'cloudflare',
          lastSuccessAt: null,
          lastError: 'Cloudflare refused the API token',
          lastErrorAt: NOW - 60_000,
          final: true,
        },
      ],
    }),
    now: NOW,
    language: 'en',
  });
  assert.deepEqual(validateWidgetContent(content), []);
  r = rows(content);
  assert.deepEqual([r.Internet.value, r.Internet.color], ['Down for 12 min', 'danger']);
  assert.equal(r.IPv4.color, 'warning', 'the last address, maybe stale');
  assert.equal(r['Duck DNS'].value, 'Updated 2 h 00 ago');
  assert.equal(r.Cloudflare.color, 'danger');
  const button = content.components.find((c) => c.type === 'button');
  assert.deepEqual(button.action, { key: WIDGET_ACTIONS.UPDATE_DNS });
});

test('the device: three features, states, the address Gladys kept', () => {
  const gladys = createFakeGladys({ selector: 'public-ip' });
  const device = buildInternetDevice(gladys);
  assert.equal(device.external_id, 'ext:public-ip:internet');
  assert.deepEqual(
    device.features.map((f) => [f.external_id, f.category, f.type]),
    [
      ['ext:public-ip:internet:online', 'unknown', 'binary'],
      ['ext:public-ip:internet:ipv4', 'text', 'text'],
      ['ext:public-ip:internet:ipv6', 'text', 'text'],
    ],
  );
  assert.deepEqual(
    internetStates(device.external_id, { online: null, ipv4: '9.9.9.9', ipv6: null }).map(
      (s) => s.text ?? s.state,
    ),
    ['9.9.9.9', '—'],
    'online not decided yet: not published',
  );
  const created = {
    ...device,
    features: device.features.map((f) => ({ ...f, last_value_string: '9.9.9.9' })),
  };
  assert.equal(storedAddress(created, 'ipv4'), '9.9.9.9');
  assert.equal(storedAddress({ external_id: 'x' }, 'ipv4'), undefined);
});

test('durations read well in both languages', () => {
  assert.equal(duration(42_000), '42 s');
  assert.equal(duration(5 * 60_000), '5 min');
  assert.equal(duration(3 * H + 5 * 60_000), '3 h 05');
  assert.equal(duration(50 * H, 'fr'), '2 j 2 h');
  assert.equal(duration(50 * H, 'en'), '2 d 2 h');
});
