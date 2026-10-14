// -----------------------------------------------------------------------------
// Transitions -> scene events: one per transition, nothing without a baseline.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_TRIGGERS } from '../src/constants.js';
import { addressEvents, initialInternet, internetStep } from '../src/triggers.js';

test('an address change fires once, the first reading nothing', () => {
  assert.deepEqual(addressEvents('ipv4', null, '9.9.9.9'), []);
  assert.deepEqual(addressEvents('ipv4', '9.9.9.9', '9.9.9.9'), []);
  assert.deepEqual(addressEvents('ipv6', '2620:fe::fe', '2606:4700:4700::1111'), [
    {
      key: SCENE_TRIGGERS.IP_CHANGED,
      data: { family: 'ipv6', old_ip: '2620:fe::fe', new_ip: '2606:4700:4700::1111' },
    },
  ]);
});

const T0 = Date.parse('2026-10-14T08:00:00Z');
const MIN = 60_000;

test('lost after N failed checks, restored with the outage duration', () => {
  const run = (state, reachable, at) =>
    internetStep(state, reachable, { now: T0 + at * MIN, threshold: 2, ipv4: '9.9.9.9' });
  let step = run(initialInternet(), true, 0);
  assert.deepEqual(step.events, [], 'the first reading only sets the baseline');
  step = run(step.state, false, 5);
  assert.deepEqual(step.events, [], 'one failed check is not an outage');
  assert.equal(step.state.online, true);
  step = run(step.state, false, 6);
  assert.deepEqual(step.events, [
    { key: SCENE_TRIGGERS.LOST, data: { lost_at: '2026-10-14T08:05:00.000Z', ipv4: '9.9.9.9' } },
  ]);
  step = run(step.state, false, 7);
  assert.deepEqual(step.events, [], 'once per outage');
  step = run(step.state, true, 17);
  assert.deepEqual(step.events, [
    {
      key: SCENE_TRIGGERS.RESTORED,
      data: { duration_minutes: 12, lost_at: '2026-10-14T08:05:00.000Z', ipv4: '9.9.9.9' },
    },
  ]);
  assert.deepEqual(step.state, { ...initialInternet(), online: true });
  // A single failure between two good checks fires nothing.
  step = run(run(step.state, false, 20).state, true, 21);
  assert.deepEqual(step.events, []);
});

test('down from the start: no "lost", and no "restored" without it', () => {
  let step = internetStep(initialInternet(), false, { now: T0, threshold: 1 });
  assert.equal(step.state.online, false);
  assert.deepEqual(step.events, []);
  step = internetStep(step.state, true, { now: T0 + 5 * MIN, threshold: 1 });
  assert.equal(step.state.online, true);
  assert.deepEqual(step.events, []);
});
