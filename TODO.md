# TODO

## Before announcing

- [ ] Test on a real Gladys 5.1+: the device from Discovery, the widget and
      its button, the three triggers (unplug the router's WAN for the outage).
- [ ] Test with a real Duck DNS account (the answer `OK` / `KO`, the
      `verbose=true` lines) and a real Cloudflare token built from the "Edit
      zone DNS" template.
- [ ] Test on a Docker host with IPv6 enabled for the bridge, and on one
      without (the usual case).
- [ ] Reserve "Public IP" in the forum thread (gist P1 #77, P2 #171 Duck DNS,
      #166 Cloudflare), then add the `gladys-assistant-integration` topic to
      publish in the store.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).

## To confirm

- [ ] The host API hands back `last_value_string` on the text features of a
      created device (typed in the SDK, not seen live): it is the baseline
      that lets a change during a restart fire "public IP changed". Without
      it, the first check after a restart only sets the baseline.
- [ ] Cloudflare: `GET /zones?name=` with an "Edit zone DNS" token (the
      reference lists "Zone Read" among the accepted permissions). The Zone ID
      can be typed instead, which skips the lookup.
- [ ] Cloudflare: the PATCH body carries `type`, `name`, `ttl` and `proxied`
      as just read, because the reference marks them required; check that a
      record's comment and tags are left untouched.
- [ ] Cloudflare: `/user/tokens/verify` refuses an account-owned token; the
      Test button then goes on with the zone lookup. Check the message.
- [ ] The IPv6 answers of `api6.ipify.org`, `ipv6.icanhazip.com` and
      `6.ident.me` (no IPv6 route from the build container: built after the
      IPv4 answers and the services' documentation).
- [ ] Duck DNS with `ipv6=` only (no IPv4 known): the spec says the IPv4
      autodetection is then off; check it does not clear the A record.
- [ ] The `unknown` / `binary` "Internet connected" feature renders as a
      yes/no on the device page (same choice as gladys-livebox).

## Ideas

- CGNAT detection from the router's WAN address (e.g. the IP that
  gladys-livebox reads): an echo service never sees the 100.64.0.0/10 address
  itself, only the carrier's shared one.
- Other dynamic DNS providers (deSEC, OVH DynHost, No-IP, Gandi LiveDNS).
- A "latency" feature (the time of the echo request), and a daily outage
  count.
- Let the user add their own echo URL (a self-hosted one).
