# gladys-public-ip

[Gladys Assistant](https://gladysassistant.com) external integration for the
**public IP address** of the house: IPv4 and IPv6 detection, a "public IP
changed" scene trigger, "Internet lost" / "Internet restored" triggers, and
optional dynamic DNS updates (**Duck DNS**, **Cloudflare**). No account
needed. **Unofficial, not affiliated with ipify, icanhazip, ident.me, Duck
DNS or Cloudflare.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/app.js (PublicIpApp)
                 ├─ src/sources.js        ask the IP-echo services, two must agree
                 ├─ src/model.js          parse, normalize, classify addresses (pure)
                 ├─ src/triggers.js       transitions -> scene events (pure)
                 ├─ src/dns/duckdns.js    Duck DNS update
                 ├─ src/dns/cloudflare.js Cloudflare zone, records, PATCH of the content
                 ├─ src/dns/provider.js   per-provider state: what was pushed, backoff
                 ├─ src/devices.js        the "Internet" device and its states (pure)
                 └─ src/widget.js         the "public_ip" widget (pure)
```

- **Detection**: every `interval` minutes (5 by default, 1 at least), one
  request per family to one of three IP-echo services (ipify, icanhazip,
  ident.me), in turn. Their host names are family-specific (A-only for IPv4,
  AAAA-only for IPv6), so a request over IPv6 fails fast when the container
  has none. An address is adopted when two services agree on it, or when a
  service confirms the address already known.
- **Outage**: a check where no service answers is a failure; after
  `failures_before_lost` failures in a row (2 by default) the Internet is
  lost. While the checks fail, they run every minute.
- **Dynamic DNS**: each configured provider is updated once at start, then
  when the address changes; failures back off from 2 minutes to an hour; a
  refused token stops until the configuration is saved again.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npx github:GladysAssistant/integration-store .  # store admission checks
```

The tests run against `createFakeGladys()` and a fake Internet
(`test/helpers/fakeFetch.js`): the IP services, Duck DNS and a small
Cloudflare. Two Cloudflare error answers in `test/fixtures/` are real
(2026-10-14); the success answers are shaped after the API reference.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0.
