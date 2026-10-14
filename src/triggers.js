// -----------------------------------------------------------------------------
// Transitions -> scene events. Pure. One event per transition; nothing fires
// without a previous value (the first reading only sets the baseline).
// -----------------------------------------------------------------------------

import { SCENE_TRIGGERS } from './constants.js';

/** The address of a family moved from `previous` to `current`. */
export function addressEvents(family, previous, current) {
  if (!previous || !current || previous === current) {
    return [];
  }
  return [
    {
      key: SCENE_TRIGGERS.IP_CHANGED,
      data: { family, old_ip: previous, new_ip: current },
    },
  ];
}

/** The state of the connection before any check. */
export const initialInternet = () => ({
  online: null,
  failures: 0,
  firstFailureAt: null,
  lostAnnounced: false,
});

const iso = (ms) => new Date(ms).toISOString();

/**
 * One check of the connection: `reachable` is false when every source of
 * every family failed. The connection is lost after `threshold` failed
 * checks in a row, restored at the first good one. "Lost" only fires after
 * a connection that was seen up, and "restored" only after a "lost": the
 * two always come in pairs.
 *   -> { state, events }
 */
export function internetStep(state, reachable, { now, threshold, ipv4 = null }) {
  if (reachable) {
    const events = [];
    if (state.online === false && state.lostAnnounced) {
      events.push({
        key: SCENE_TRIGGERS.RESTORED,
        data: {
          duration_minutes: Math.max(0, Math.round((now - state.firstFailureAt) / 60_000)),
          lost_at: iso(state.firstFailureAt),
          ipv4,
        },
      });
    }
    return { state: { ...initialInternet(), online: true }, events };
  }
  const failures = state.failures + 1;
  const firstFailureAt = state.firstFailureAt ?? now;
  if (failures < threshold || state.online === false) {
    return { state: { ...state, failures, firstFailureAt }, events: [] };
  }
  const announce = state.online === true;
  return {
    state: { online: false, failures, firstFailureAt, lostAnnounced: announce },
    events: announce
      ? [{ key: SCENE_TRIGGERS.LOST, data: { lost_at: iso(firstFailureAt), ipv4 } }]
      : [],
  };
}
