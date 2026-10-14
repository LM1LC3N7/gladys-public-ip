// -----------------------------------------------------------------------------
// The only place that talks to the network: `fetch` with a timeout and an
// identifying User-Agent. The tests replace it with `setFetch()`.
//
// Errors never carry a URL: the Duck DNS token travels in the query string
// (that is its API), so an HttpError names the host and the path only.
// -----------------------------------------------------------------------------

import { USER_AGENT } from './constants.js';

let fetchImpl = (...args) => globalThis.fetch(...args);

/** Replace the fetch implementation (tests only). Returns the previous one. */
export function setFetch(impl) {
  const previous = fetchImpl;
  fetchImpl = impl;
  return previous;
}

export class HttpError extends Error {
  /** `code`: 'http' (a status), 'timeout' or 'network'. */
  constructor(code, message, { status, body } = {}) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

const where = (url) => {
  const u = new URL(url);
  return `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
};

/**
 * One request; resolves { status, text } of a 2xx answer, throws an
 * HttpError otherwise. The body of an error is kept (truncated) for the
 * caller to read a provider's error codes, never put in the message.
 */
export async function request(url, { method = 'GET', headers = {}, body, timeout = 15_000 } = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: { 'User-Agent': USER_AGENT, ...headers },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(Math.max(1, timeout)),
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    const cause = err?.cause?.code ? ` (${err.cause.code})` : '';
    throw new HttpError(
      timedOut ? 'timeout' : 'network',
      timedOut ? `${where(url)}: no answer in time` : `${where(url)}: unreachable${cause}`,
    );
  }
  const text = await response.text();
  if (response.status < 200 || response.status >= 300) {
    throw new HttpError('http', `${where(url)}: HTTP ${response.status}`, {
      status: response.status,
      body: text.slice(0, 2000),
    });
  }
  return { status: response.status, text };
}
