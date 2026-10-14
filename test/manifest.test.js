// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BOUNDS, DEFAULTS } from '../src/config.js';
import {
  ACTIONS,
  FAMILIES,
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
  WIDGETS,
  WIDGET_ACTIONS,
} from '../src/constants.js';
import { addressEvents, initialInternet, internetStep } from '../src/triggers.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const index = read('index.js');
const app = read('src/app.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) {
      yield* texts(item, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.location, undefined, 'the address comes from the network, not the house');
  assert.match(manifest.gladys_version, />=5\.1\.0/);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-public-ip:${manifest.version}`);
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  assert.deepEqual(manifest.categories, ['network']);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
  assert.match(manifest.description.en, /Unofficial connector/);
  assert.match(manifest.description.fr, /Connecteur non officiel/);
  assert.match(manifest.config_schema[0].description.en, /not affiliated with ipify/);
});

test('every text is bilingual, every link https', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
  for (const field of manifest.config_schema) {
    for (const link of field.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('the configuration matches the code; the tokens are secrets', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.equal(fields[key].default, value, key);
  }
  for (const [key, { min, max }] of Object.entries(BOUNDS)) {
    assert.deepEqual([fields[key].min, fields[key].max], [min, max], key);
  }
  assert.equal(fields.duckdns_token.type, 'secret');
  assert.equal(fields.cloudflare_token.type, 'secret');
  // Every value field is read by normalizeConfig (sections store nothing).
  const config = read('src/config.js');
  for (const field of manifest.config_schema.filter((f) => f.type !== 'section')) {
    assert.ok(config.includes(`raw.${field.key}`), `${field.key} is never read`);
  }
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  assert.deepEqual(manifest.widgets.map((w) => w.key).sort(), Object.values(WIDGETS).sort());
  for (const name of Object.keys(SCENE_ACTIONS)) {
    assert.ok(index.includes(`onSceneAction(SCENE_ACTIONS.${name}`), name);
  }
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(index.includes(`onAction(ACTIONS.${name}`), name);
  }
  assert.ok(index.includes('onWidgetAction(WIDGETS.PUBLIC_IP'));
  assert.ok(app.includes('WIDGET_ACTIONS.UPDATE_DNS'), WIDGET_ACTIONS.UPDATE_DNS);
});

test('the trigger fields and variables are what the code fires', () => {
  const triggers = Object.fromEntries(manifest.scene_triggers.map((t) => [t.key, t]));
  const family = triggers[SCENE_TRIGGERS.IP_CHANGED].fields.find((f) => f.key === 'family');
  // The core matches by equality: "both" is the empty field, never a value.
  assert.equal(family.required, false);
  assert.deepEqual(
    family.options.map((o) => o.value),
    FAMILIES,
  );
  const now = Date.parse('2026-10-14T08:00:00Z');
  const lost = internetStep(
    internetStep(initialInternet(), true, { now, threshold: 1 }).state,
    false,
    { now, threshold: 1, ipv4: '9.9.9.9' },
  );
  const restored = internetStep(lost.state, true, {
    now: now + 60_000,
    threshold: 1,
    ipv4: '9.9.9.9',
  });
  const fired = [
    ...addressEvents('ipv4', '9.9.9.9', '149.112.112.112'),
    ...lost.events,
    ...restored.events,
  ];
  assert.equal(fired.length, 3);
  for (const event of fired) {
    const declared = triggers[event.key].variables.map((v) => v.key).sort();
    assert.deepEqual(Object.keys(event.data).sort(), declared, event.key);
    for (const field of triggers[event.key].fields ?? []) {
      assert.ok(field.key in event.data, `${event.key}.${field.key} is compared with the event`);
    }
  }
});

test('the scene action outputs are what the code returns', () => {
  const outputs = Object.fromEntries(
    manifest.scene_actions.map((a) => [a.key, a.outputs.map((o) => o.key).sort()]),
  );
  assert.deepEqual(outputs[SCENE_ACTIONS.GET_IP], ['ipv4', 'ipv6', 'last_change', 'online']);
  assert.deepEqual(outputs[SCENE_ACTIONS.UPDATE_DNS], ['error', 'success', 'updated']);
  for (const key of [...outputs[SCENE_ACTIONS.GET_IP], ...outputs[SCENE_ACTIONS.UPDATE_DNS]]) {
    assert.match(app, new RegExp(`\\b${key}:`), `${key} is returned by src/app.js`);
  }
});
