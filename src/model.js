// -----------------------------------------------------------------------------
// Addresses: parse an IP-echo answer, normalize it, tell a public address
// from a private, reserved or carrier-grade NAT one. Pure.
// -----------------------------------------------------------------------------

import { BlockList, isIPv4, isIPv6 } from 'node:net';
import { MAX_ANSWER_LENGTH } from './constants.js';

/** What an address is, for the decision and the status. */
export const KINDS = {
  PUBLIC: 'public',
  CGNAT: 'cgnat',
  PRIVATE: 'private',
  RESERVED: 'reserved',
};

const blocks = (entries, type) => {
  const list = new BlockList();
  for (const [network, prefix] of entries) {
    list.addSubnet(network, prefix, type);
  }
  return list;
};

// RFC 6598: the shared space of carrier-grade NAT, flagged rather than refused.
const CGNAT_V4 = blocks([['100.64.0.0', 10]], 'ipv4');
// RFC 1918 and the link-local / loopback ranges: a LAN address.
const PRIVATE_V4 = blocks(
  [
    ['10.0.0.0', 8],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
  ],
  'ipv4',
);
// RFC 6890 special-purpose space that never identifies a home on the Internet.
const RESERVED_V4 = blocks(
  [
    ['0.0.0.0', 8],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ],
  'ipv4',
);
// Only global unicast (2000::/3) is public; ULA, link-local and the rest are not.
const GLOBAL_V6 = blocks([['2000::', 3]], 'ipv6');
const PRIVATE_V6 = blocks(
  [
    ['fc00::', 7],
    ['fe80::', 10],
    ['::1', 128],
  ],
  'ipv6',
);
// Documentation (RFC 3849, RFC 9637) inside 2000::/3.
const RESERVED_V6 = blocks(
  [
    ['2001:db8::', 32],
    ['3fff::', 20],
  ],
  'ipv6',
);

/**
 * The canonical text of an address of the given family, or undefined:
 * IPv6 lowercased and compressed (the URL parser does it), so the same
 * address read from two sources compares equal.
 */
export function normalizeAddress(text, family) {
  const value = String(text ?? '').trim();
  if (family === 'ipv4') {
    return isIPv4(value) ? value : undefined;
  }
  if (family === 'ipv6' && isIPv6(value) && !value.includes('%')) {
    return new URL(`http://[${value}]/`).hostname.slice(1, -1);
  }
  return undefined;
}

export function classify(address, family) {
  if (family === 'ipv4') {
    if (CGNAT_V4.check(address, 'ipv4')) {
      return KINDS.CGNAT;
    }
    if (PRIVATE_V4.check(address, 'ipv4')) {
      return KINDS.PRIVATE;
    }
    return RESERVED_V4.check(address, 'ipv4') ? KINDS.RESERVED : KINDS.PUBLIC;
  }
  if (PRIVATE_V6.check(address, 'ipv6')) {
    return KINDS.PRIVATE;
  }
  if (!GLOBAL_V6.check(address, 'ipv6') || RESERVED_V6.check(address, 'ipv6')) {
    return KINDS.RESERVED;
  }
  return KINDS.PUBLIC;
}

/**
 * The body of an IP-echo answer -> { address, kind } or undefined. The
 * services answer the bare address, some with a final newline; anything
 * longer or different (an HTML page, a captive portal) is not an answer.
 */
export function parseAnswer(body, family) {
  const text = String(body ?? '').trim();
  if (!text || text.length > MAX_ANSWER_LENGTH) {
    return undefined;
  }
  const address = normalizeAddress(text, family);
  return address ? { address, kind: classify(address, family) } : undefined;
}

/** A usable address of a family (the baseline seeded from Gladys must be one). */
export const isPublic = (text, family) => {
  const address = normalizeAddress(text, family);
  return address !== undefined && classify(address, family) === KINDS.PUBLIC;
};
