# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15). It
detects the **public IP address** of the house (IPv4, IPv6 when the container
has it) through three free IP-echo services (ipify, icanhazip, ident.me),
exposes an "Internet" device, fires "public IP changed", "Internet lost" and
"Internet restored" scene triggers, and optionally keeps a **Duck DNS** or
**Cloudflare** name pointed at the house. No account needed. Unofficial: not
affiliated with ipify, icanhazip, ident.me, Duck DNS or Cloudflare.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js               SDK wiring only (handlers registered before connect())
src/app.js             PublicIpApp: check loop, device, triggers, DNS sync,
                       scene actions, widget, Test button, status
src/sources.js         ask an IP-echo service; detectFamily: the "two sources
                       agree" decision, rotation, early stop
src/model.js           answer -> address, normalization, public / CGNAT /
                       private / reserved (pure)
src/dns/provider.js    DnsError, scrub, DnsProvider (what was pushed, backoff,
                       final errors, last result)
src/dns/duckdns.js     the Duck DNS update URL and answer
src/dns/cloudflare.js  token verify, zone, A/AAAA records, PATCH, dry-run plan
src/devices.js         the "Internet" device, feature keys, states (pure)
src/triggers.js        transitions -> scene events (pure)
src/widget.js          the "public_ip" widget (pure)
src/config.js          config_schema normalized (DEFAULTS, BOUNDS), Duck DNS
                       sub-domains, Cloudflare record names
src/constants.js       sources, endpoints, pacing, manifest keys
src/i18n.js            runtime texts (en/fr), durations
src/http.js            the only network access (fetch, timeout, User-Agent,
                       no redirect, errors without the query string)
test/fixtures/         Cloudflare answers: two real errors (2026-10-14), the
                       rest shaped after the API reference
test/helpers/          a fake Internet (echo services, Duck DNS, a small
                       Cloudflare), fake timers; Gladys is the SDK's fake
```

## Rules

- **Unofficial.** Every user-facing surface says "unofficial connector, not
  affiliated with ipify, icanhazip, ident.me, Duck DNS or Cloudflare" (the
  widget says "unofficial connector"). Never use a logo of any of them.
- **Keys are forever**: the manifest keys and the widget button action
  (`src/constants.js`), the config keys, the feature keys (`FEATURE` in
  `src/devices.js`: `online`, `ipv4`, `ipv6`), the external id `internet`,
  the trigger field values (`ipv4`, `ipv6`) and the event variables are
  stored in user scenes and dashboards. Never rename them.
- **Two sources or nothing** (`detectFamily`): an address is adopted when
  two different services agree on it, or when one confirms the address
  already known; a single service answering something new is never enough
  (no false "public IP changed" from a broken service). Disagreeing services
  keep the current address and say so in the status.
- **Only public addresses**: private, loopback, link-local, documentation,
  multicast and reserved answers are never adopted; 100.64.0.0/10 is flagged
  "behind CGNAT" in the status (never red). A real echo service sees the
  carrier's shared address, so this flag only catches odd setups: see
  TODO.md.
- **IPv6 missing is calm**: a Docker bridge usually has no IPv6. No answer
  over IPv6 is reported as "not available from the container" (connected
  stays true), re-probed every 30 minutes (`IPV6_RETRY`) until it was seen
  once, then at every check. It never counts as an outage while IPv4 works.
- **Be polite with the IP services** (ipify says "without limit", ident.me
  asks to e-mail first above 500 requests per second; we stay far below
  both):
  - one check every `interval` minutes (default 5, never below 1): one
    request per family in the steady state, to the next service in turn;
    two (three on a disagreement) on a change and at start;
  - while the checks fail (an outage), one check per minute
    (`OUTAGE_RECHECK`), the requests then fail locally;
  - a (re)start within a minute of the last check does not check again
    (`MIN_CHECK_SPACING`); the Test button asks each service once.
- **Be polite with the DNS providers**: Duck DNS and Cloudflare are only
  called once at start ("to make sure") and when the address changes; a
  failure backs off 2, 4, 8… minutes up to an hour (`DNS_BACKOFF_*`); a final
  error (Duck DNS `KO`, a malformed token, a refused Cloudflare token, an
  unknown zone) stops the automatic updates until the configuration is saved
  again. "Update DNS now" always tries, at most once per 30 s
  (`MANUAL_COOLDOWN`). A provider whose settings did not change keeps its
  state across a reconnection (no new "once at start").
- **Cloudflare writes as little as possible**: read the records of each name
  (`name.exact`), PATCH only those whose content differs, with the `type`,
  `name`, `ttl` and `proxied` just read (proxy and TTL kept); never create
  nor delete a record, never touch another type. A missing record is an
  error (with backoff), not a creation.
- **Secrets**: the Duck DNS token travels in the query string (its API), the
  Cloudflare token only in the `Authorization` header. Neither is ever
  logged, in an error, a status, a state, an event or a result:
  `http.js` errors carry the host and path only, the clients `scrub` their
  messages, `test/app.test.js` checks it.
- **No address in the logs**: the logs say "IPv4 changed", never the
  address (users paste logs in the forum). The address may appear in the
  Gladys UI (status, device, widget, trigger variables).
- **One event per transition** (`src/triggers.js`): the first reading only
  sets the baseline, except that after a restart the address Gladys kept on
  the `ipv4` / `ipv6` text feature (`last_value_string`) is the baseline, so
  a change during a power cut still fires once. "Internet lost" only after a
  connection seen up, "restored" only after a "lost". No event from a scene
  action nor from the Test button.
- **Equality matching**: the core compares trigger fields by equality, so
  "both IP versions" is the empty `family` field, not an `any` value.
- **Read-only rootfs**: write nothing on disk; the state lives in memory.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag.
- **Changelog**: every user-visible change adds a line under
  `## [Unreleased]` in `CHANGELOG.md`.
- **Manifest texts** are `{ en, fr }` objects; the catalog description holds
  10 to 100 characters per language; `test/manifest.test.js` ties the
  manifest to the code (keys, defaults, bounds, trigger variables against the
  events the code fires, action outputs).
- **User-facing text** is bilingual, `docs/en.md` and `docs/fr.md` kept in
  sync. Comments explain why, in English.
- **Tests never touch the network** (`installNet` replaces `fetch`).

## Choices made where the spec left room

- The trigger field values are `ipv4` / `ipv6` (readable in a message as
  `{{family}}`), and "any" is the empty field (equality matching).
- Duck DNS AAAA is opt-in (`duckdns_ipv6`, off): many routers drop incoming
  IPv6, and a AAAA record would then break access that works over IPv4.
  Cloudflare updates the AAAA records that exist: their presence is the
  opt-in.
- A provider is on as soon as its fields are filled (no extra switch).
- The third source is ident.me (family-specific `4.` / `6.` hosts, a
  different operator from ipify and icanhazip).
- `update_dns_now` returns language-neutral outputs (`success`, `updated`,
  `error` in English) since a scene output has no language.

## What was checked against the real services (2026-10-14)

- `api.ipify.org`, `ipv4.icanhazip.com`, `4.ident.me`: plain-text address,
  icanhazip with a final newline; the build container's proxy left through
  several addresses, so the three disagreed: the "two sources" rule kept the
  address undecided, as intended.
- DNS: the IPv4 hosts have A records only, the IPv6 hosts AAAA only.
- The IPv6 hosts are unreachable from the build container (built blind).
- Duck DNS: the spec page (`OK` / `KO`, `verbose=true`, `ipv6=`); no update
  call was made.
- Cloudflare: the API reference and the official Python SDK (5.9.0:
  `name.exact` query style, PATCH body); two real error answers with a bogus
  token (`10502` rate limit on a shared address, `9106` / `9107` without a
  token). No record was read or written.

## CI and pushes

- Group the commits and push **at most once a day**, unless the maintainer
  explicitly asks otherwise: the GitHub Actions quota is limited.
- If every CI job fails in under 2 seconds, the quota is exhausted: it is
  not a bug in the code.
- The Docker image cannot be built in the Claude Code cloud container (no
  network for `apk` inside `docker build`): the CI builds it.
