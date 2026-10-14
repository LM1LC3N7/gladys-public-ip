// -----------------------------------------------------------------------------
// Duck DNS (https://www.duckdns.org/spec.jsp): one GET updates every
// sub-domain of the account.
//
//   /update?domains=a,b&token=<uuid>&ip=<ipv4>[&ipv6=<ipv6>]&verbose=true
//
// The answer is "OK" (verbose: "OK\n<ipv4>\n<ipv6>\nUPDATED|NOCHANGE") or
// "KO" (a wrong token or a sub-domain of another account). There is no read
// endpoint and no dry run: the Test button only checks the fields locally.
// The token travels in the query string, so it is scrubbed from every error.
// -----------------------------------------------------------------------------

import { DNS_TIMEOUT, DUCKDNS_URL } from '../constants.js';
import { DUCKDNS_TOKEN } from '../config.js';
import { HttpError, request } from '../http.js';
import { DnsError, scrub } from './provider.js';

/** The problems of the fields, checked without any request ([] when fine). */
export function duckdnsProblems({ domains, invalid, token }) {
  const problems = [];
  if (domains.length === 0) {
    problems.push('no sub-domain');
  }
  if (invalid.length > 0) {
    problems.push(`invalid sub-domain "${invalid[0]}"`);
  }
  if (!DUCKDNS_TOKEN.test(token)) {
    problems.push(token ? 'the token is not a Duck DNS token (a UUID)' : 'no token');
  }
  return problems;
}

export function updateUrl({ domains, token }, { ipv4, ipv6 }) {
  const params = new URLSearchParams({ domains: domains.join(','), token });
  if (ipv4) {
    params.set('ip', ipv4);
  }
  if (ipv6) {
    params.set('ipv6', ipv6);
  }
  params.set('verbose', 'true');
  return `${DUCKDNS_URL}?${params}`;
}

/** The answer -> { changed } or a DnsError. */
export function parseUpdateAnswer(text) {
  const lines = String(text ?? '')
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim());
  if (lines[0] === 'OK') {
    return { changed: lines.includes('UPDATED') };
  }
  if (lines[0] === 'KO') {
    throw new DnsError('refused', 'answered KO: check the token and the sub-domains', {
      final: true,
    });
  }
  throw new DnsError('http', 'unexpected answer');
}

export class DuckDnsClient {
  constructor({ domains = [], invalid = [], token = '' }) {
    this.domains = domains;
    this.invalid = invalid;
    this.token = token;
  }

  problems() {
    return duckdnsProblems(this);
  }

  async sync({ ipv4, ipv6 }) {
    const problems = this.problems();
    if (problems.length > 0) {
      throw new DnsError('config', problems.join(', '), { final: true });
    }
    if (!ipv4 && !ipv6) {
      return { changed: false };
    }
    let text;
    try {
      ({ text } = await request(updateUrl(this, { ipv4, ipv6 }), {
        headers: { Accept: 'text/plain' },
        timeout: DNS_TIMEOUT,
      }));
    } catch (err) {
      const code = err instanceof HttpError ? err.code : 'network';
      throw new DnsError(code, scrub(err.message, this.token));
    }
    return parseUpdateAnswer(text);
  }
}
