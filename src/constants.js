// -----------------------------------------------------------------------------
// Constants of the public IP integration.
// -----------------------------------------------------------------------------

/** Every request says who it is: the IP services and the DNS providers alike. */
export const USER_AGENT = 'gladys-public-ip/0.1 (+https://github.com/LM1LC3N7/gladys-public-ip)';

/**
 * The IP-echo services, per address family. The host names are
 * family-specific (A-only or AAAA-only records, checked on 2026-10-14), so
 * the request itself goes out over IPv4 or IPv6 and the answer is the address
 * of that family. Three operators (ipify, icanhazip, ident.me): a change must
 * be seen by two of them before it is believed.
 */
export const SOURCES = {
  ipv4: [
    { name: 'ipify', url: 'https://api.ipify.org' },
    { name: 'icanhazip', url: 'https://ipv4.icanhazip.com' },
    { name: 'ident.me', url: 'https://4.ident.me' },
  ],
  ipv6: [
    { name: 'ipify', url: 'https://api6.ipify.org' },
    { name: 'icanhazip', url: 'https://ipv6.icanhazip.com' },
    { name: 'ident.me', url: 'https://6.ident.me' },
  ],
};

export const FAMILIES = ['ipv4', 'ipv6'];

export const DUCKDNS_URL = 'https://www.duckdns.org/update';
export const CLOUDFLARE_API_URL = 'https://api.cloudflare.com/client/v4';

// --- Timeouts and pacing (see CLAUDE.md) -----------------------------------------

/** An IP-echo answer is a few bytes: past 8 s the source is considered down. */
export const SOURCE_TIMEOUT = 8_000;
export const DNS_TIMEOUT = 15_000;
/** An answer longer than this is not an address (an HTML page, a portal). */
export const MAX_ANSWER_LENGTH = 100;

/** While the internet looks down, check every minute to see it come back. */
export const OUTAGE_RECHECK = 60_000;
/** IPv6 unreachable from the container (the usual Docker bridge): re-probe this rarely. */
export const IPV6_RETRY = 30 * 60_000;
/** A (re)start within a minute of the last check does not check again. */
export const MIN_CHECK_SPACING = 60_000;
/** A failed DNS update is retried after 2, 4, 8... minutes, at most every hour. */
export const DNS_BACKOFF_FIRST = 2 * 60_000;
export const DNS_BACKOFF_MAX = 60 * 60_000;
/** "Update DNS now" twice within 30 s answers the first result again. */
export const MANUAL_COOLDOWN = 30_000;

/** Manifest keys (forever: stored in user scenes and dashboards). */
export const ACTIONS = { TEST: 'test_connection' };
export const SCENE_ACTIONS = { GET_IP: 'get_public_ip', UPDATE_DNS: 'update_dns_now' };
export const SCENE_TRIGGERS = {
  IP_CHANGED: 'public_ip_changed',
  LOST: 'internet_lost',
  RESTORED: 'internet_restored',
};
export const WIDGETS = { PUBLIC_IP: 'public_ip' };
/** The action of the widget button (forever: cached widget contents carry it). */
export const WIDGET_ACTIONS = { UPDATE_DNS: 'update_dns' };

/** The DNS providers, as named in statuses and results. */
export const PROVIDERS = { DUCKDNS: 'duckdns', CLOUDFLARE: 'cloudflare' };
