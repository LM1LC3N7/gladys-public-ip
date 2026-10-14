// -----------------------------------------------------------------------------
// Asking the IP-echo services, and deciding which address to believe.
//
// The rule: an address is adopted when two sources agree on it, or when a
// source confirms the address already known. A single source answering
// something new is never enough, so a broken or lying source cannot fire a
// false "public IP changed". The sources are asked one after the other,
// starting from a rotating index, and the asking stops as soon as the
// decision is made: one request per family in the steady state, two or three
// on a change.
// -----------------------------------------------------------------------------

import { SOURCES, SOURCE_TIMEOUT } from './constants.js';
import { HttpError, request } from './http.js';
import { KINDS, parseAnswer } from './model.js';

/** One source -> { source, ok: true, address, kind } or { source, ok: false, error }. */
export async function askSource(source, family) {
  try {
    const { text } = await request(source.url, {
      headers: { Accept: 'text/plain' },
      timeout: SOURCE_TIMEOUT,
    });
    const answer = parseAnswer(text, family);
    if (!answer) {
      return { source: source.name, ok: false, error: 'not an address' };
    }
    return { source: source.name, ok: true, ...answer };
  } catch (err) {
    const error = err instanceof HttpError ? err.code : 'error';
    return {
      source: source.name,
      ok: false,
      error: err?.status ? `HTTP ${err.status}` : error,
    };
  }
}

/** The sources of a family, the `start`-th first (the load is spread). */
export function rotation(family, start = 0) {
  const list = SOURCES[family];
  const offset = ((start % list.length) + list.length) % list.length;
  return [...list.slice(offset), ...list.slice(0, offset)];
}

/**
 * Detect the address of one family.
 *   current   the address believed so far (or null)
 *   start     the rotation index
 *   ask       (source, family) => Promise<answer> (askSource by default)
 * Resolves {
 *   reachable   at least one source answered an address
 *   address     the address to believe now (the current one when undecided)
 *   confirmed   the decision was made (false: no two sources agreed)
 *   cgnat       a source answered an address of the shared CGNAT space
 *   answers     every answer, for the logs and the Test button
 * }
 */
export async function detectFamily({ family, current = null, start = 0, ask = askSource }) {
  const votes = new Map();
  const answers = [];
  let cgnat = false;
  for (const source of rotation(family, start)) {
    const answer = await ask(source, family);
    answers.push(answer);
    if (!answer.ok) {
      continue;
    }
    if (answer.kind !== KINDS.PUBLIC) {
      // Not an address a DNS name can point to: remembered, never adopted.
      cgnat ||= answer.kind === KINDS.CGNAT;
      continue;
    }
    if (answer.address === current) {
      return { reachable: true, address: current, confirmed: true, cgnat, answers };
    }
    const count = (votes.get(answer.address) ?? 0) + 1;
    votes.set(answer.address, count);
    if (count >= 2) {
      return { reachable: true, address: answer.address, confirmed: true, cgnat, answers };
    }
  }
  return {
    reachable: answers.some((a) => a.ok),
    address: current,
    confirmed: false,
    cgnat,
    answers,
  };
}
