// -----------------------------------------------------------------------------
// Cloudflare DNS (https://developers.cloudflare.com/api/), with an API token
// built from the "Edit zone DNS" template, sent only in the Authorization
// header.
//
//   GET   /user/tokens/verify                      the Test button only
//   GET   /zones?name=<zone>                       the zone id (cached)
//   GET   /zones/<id>/dns_records?name.exact=<n>   the A / AAAA records of a name
//   PATCH /zones/<id>/dns_records/<record id>      only when the content differs
//
// The PATCH body carries the type, name, ttl and proxied flag just read from
// the record, so they stay exactly as they are; only the content changes.
// Records are never created nor deleted: a missing one is reported.
// -----------------------------------------------------------------------------

import { CLOUDFLARE_API_URL, DNS_TIMEOUT } from '../constants.js';
import { ZONE_ID } from '../config.js';
import { HttpError, request } from '../http.js';
import { DnsError, scrub } from './provider.js';

const TYPES = { ipv4: 'A', ipv6: 'AAAA' };
/** Error codes of a token Cloudflare refuses (besides the 401 / 403 statuses). */
const AUTH_CODES = new Set([6003, 6111, 9106, 9109, 10000, 10001]);

/** The first error of a Cloudflare JSON body, "message (code)". */
function cloudflareMessage(body) {
  try {
    const error = JSON.parse(body)?.errors?.[0];
    return error ? { code: error.code, text: `${error.message} (${error.code})` } : {};
  } catch {
    return {};
  }
}

export class CloudflareClient {
  constructor({ token = '', zone = '', records = [], invalid = [] }) {
    this.token = token;
    this.zone = zone;
    this.records = records;
    this.invalid = invalid;
    this.zoneId = ZONE_ID.test(zone) ? zone : undefined;
  }

  /** The problems of the fields, checked without any request ([] when fine). */
  problems() {
    const problems = [];
    if (!this.token) {
      problems.push('no API token');
    }
    if (!this.zone) {
      problems.push('no zone');
    }
    if (this.records.length === 0) {
      problems.push('no record name');
    }
    if (this.invalid.length > 0) {
      problems.push(`invalid record name "${this.invalid[0]}"`);
    }
    return problems;
  }

  async call(path, { method = 'GET', body } = {}) {
    let text;
    try {
      ({ text } = await request(`${CLOUDFLARE_API_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        timeout: DNS_TIMEOUT,
      }));
    } catch (err) {
      if (!(err instanceof HttpError)) {
        throw new DnsError('network', scrub(String(err?.message ?? err), this.token));
      }
      const detail = cloudflareMessage(err.body);
      const auth = err.status === 401 || err.status === 403 || AUTH_CODES.has(detail.code);
      throw new DnsError(
        auth ? 'auth' : err.code,
        scrub(
          auth
            ? `the API token was refused${detail.text ? `: ${detail.text}` : ''}`
            : (detail.text ?? err.message),
          this.token,
        ),
        { final: auth },
      );
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new DnsError('http', 'the answer is not JSON');
    }
    if (json?.success !== true) {
      const detail = cloudflareMessage(text);
      throw new DnsError('http', scrub(detail.text ?? 'request refused', this.token));
    }
    return json.result;
  }

  /** The token status ("active", "disabled", "expired"). */
  async verifyToken() {
    return (await this.call('/user/tokens/verify'))?.status ?? 'unknown';
  }

  async resolveZone() {
    if (this.zoneId) {
      return this.zoneId;
    }
    const zones = await this.call(`/zones?${new URLSearchParams({ name: this.zone })}`);
    const zone = (zones ?? []).find((z) => String(z.name).toLowerCase() === this.zone);
    if (!zone?.id) {
      throw new DnsError(
        'config',
        `zone "${this.zone}" not found for this token (check the name, or paste the Zone ID)`,
        { final: true },
      );
    }
    this.zoneId = zone.id;
    return zone.id;
  }

  /** The A and AAAA records of a name: [{ id, type, name, content, ttl, proxied }]. */
  async addressRecords(zoneId, name) {
    const query = new URLSearchParams({ 'name.exact': name, per_page: '100' });
    const records = await this.call(`/zones/${zoneId}/dns_records?${query}`);
    return (records ?? [])
      .filter((r) => (r.type === 'A' || r.type === 'AAAA') && String(r.name).toLowerCase() === name)
      .map(({ id, type, name: recordName, content, ttl, proxied }) => ({
        id,
        type,
        name: recordName,
        content,
        ttl,
        proxied,
      }));
  }

  /**
   * What a sync would do, without writing: per name, the A / AAAA records and
   * whether their content differs from the target. Used by sync() and by the
   * Test button (the dry run).
   */
  async plan({ ipv4, ipv6 }) {
    const problems = this.problems();
    if (problems.length > 0) {
      throw new DnsError('config', problems.join(', '), { final: true });
    }
    const zoneId = await this.resolveZone();
    const plan = [];
    try {
      for (const name of this.records) {
        const records = await this.addressRecords(zoneId, name);
        for (const record of records) {
          const target = (record.type === TYPES.ipv4 ? ipv4 : ipv6) ?? null;
          plan.push({ record, target, stale: target !== null && record.content !== target });
        }
        if (records.length === 0) {
          plan.push({ name, missing: true });
        }
      }
    } catch (err) {
      // A zone looked up by name may have been re-created: look it up again next time.
      if (!ZONE_ID.test(this.zone)) {
        this.zoneId = undefined;
      }
      throw err;
    }
    return { zoneId, plan };
  }

  async sync(addresses) {
    const { zoneId, plan } = await this.plan(addresses);
    let changed = false;
    for (const step of plan.filter((s) => s.stale)) {
      const { id, type, name, ttl, proxied } = step.record;
      await this.call(`/zones/${zoneId}/dns_records/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: { type, name, content: step.target, ttl, proxied },
      });
      changed = true;
    }
    const missing = plan.filter((s) => s.missing).map((s) => s.name);
    if (missing.length > 0) {
      throw new DnsError(
        'missing_record',
        `no A or AAAA record named ${missing.join(', ')} (create it in the dashboard first)`,
      );
    }
    return { changed };
  }
}
