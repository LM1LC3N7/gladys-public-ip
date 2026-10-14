# Public IP

**Unofficial connector, not affiliated with ipify, icanhazip, ident.me, Duck DNS
or Cloudflare.** It tells Gladys the public address of your home (IPv4, and
IPv6 when available), warns your scenes when it changes or when the Internet
goes down, and can keep a Duck DNS or Cloudflare name pointed at your home. No
account needed for the detection.

## What you get

| Surface                 | Content                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| The **Internet** device | Internet connected (yes / no), public IPv4, public IPv6                                                                                  |
| Scene triggers          | **public IP changed** (IPv4, IPv6 or both; old and new address), **Internet lost**, **Internet restored** (with the outage duration)     |
| Scene actions           | **get the public IP** (IPv4, IPv6, last change, connected), **update the DNS now**                                                       |
| Dashboard widget        | **Public IP**: the connection, the addresses, how long they have not changed, the state of each DNS provider, an "Update DNS now" button |
| Dynamic DNS (optional)  | **Duck DNS** and **Cloudflare**, updated at start and whenever the address changes                                                       |

## Setup

1. Install the integration. The check starts right away.
2. Open **Discovery** and add the **Internet** device to see the connection
   and the addresses on the device page.
3. Optional: put the **Public IP** widget on a dashboard.
4. Optional: fill the Duck DNS or Cloudflare section (below), save, then press
   **Test detection and DNS** to check everything without writing anything.

The address is checked every 5 minutes (option **Check interval**, 1 to 60).
Each check is one tiny request to one of three free services (ipify,
icanhazip, ident.me), taken in turn. A new address is only believed once two
different services give the same one: a broken service cannot fire a false
"public IP changed".

**IPv6**: a Docker container usually has no IPv6. The integration then says
so calmly in its status ("IPv6 is not available from the container") and
tries again every 30 minutes; nothing is wrong. Turn **Detect the public IPv6
too** off to stop trying.

## Dynamic DNS

### Duck DNS

1. Sign in on [duckdns.org](https://www.duckdns.org/), create a sub-domain
   (`myhome` gives `myhome.duckdns.org`) and copy the **token** shown on the
   page.
2. In the configuration, type the sub-domain(s) (separated by commas) and
   paste the token.
3. **Also send the IPv6** is off by default: an IPv6 name only helps when
   your router lets incoming IPv6 through, otherwise it can break access over
   IPv4.

Duck DNS is updated once at start, then only when the address changes. Duck
DNS has no test mode: the Test button only checks the fields.

### Cloudflare

1. In the Cloudflare dashboard, **My Profile → API Tokens → Create Token**,
   template **Edit zone DNS**, limited to your zone. Copy the token.
2. Create the records you want to follow (type A, and AAAA for IPv6) in the
   DNS page of the zone, with any address: the integration never creates nor
   deletes a record, it only changes the address of existing ones. The proxy
   setting (orange cloud) and the TTL are kept as they are.
3. In the configuration, paste the token, type the zone (`example.com`, or
   its Zone ID from the zone's Overview page) and the record names
   (`home.example.com, vpn` — a short name is completed with the zone, `@`
   is the zone itself).
4. Press **Test detection and DNS**: it shows the token status and, for each
   record, whether it is up to date or would be updated.

An update that fails is tried again after 2, 4, 8… minutes, at most every
hour. A refused token stops the updates until you save the configuration
again; the **Update DNS now** button always tries.

## Scenes

- **Public IP changed**: leave the version empty for both, or pick IPv4 or
  IPv6. Variables: `family` (`ipv4` or `ipv6`), `old_ip`, `new_ip`. Example:
  send yourself the new address, restart a VPN.
- **Internet lost**: no service answered the chosen number of checks in a
  row (2 by default; while the checks fail they run every minute). Variables:
  `lost_at`, `ipv4` (the last known address).
- **Internet restored**: the services answer again. Variables:
  `duration_minutes`, `lost_at`, `ipv4`.

The action **get the public IP** gives `ipv4`, `ipv6`, `last_change` and
`online`; **update the DNS now** gives `success`, `updated` and `error`.

The first check after a start only learns the address; after a restart, the
address kept by the **Internet** device is compared with the new one, so a
change during a power cut is still announced.

## Troubleshooting

- **"The IP services disagree"**: your connection leaves through several
  addresses (load balancing, VPN). The address is kept until two services
  agree.
- **"Behind a carrier-grade NAT"**: your operator shares one public address
  between several customers. A DNS name cannot reach your home; ask your
  operator for a full-stack (dedicated) IPv4, or use IPv6.
- **Internet lost while it works**: a firewall or an ad blocker may block the
  three services (`api.ipify.org`, `ipv4.icanhazip.com`, `4.ident.me`).
- **Duck DNS answered KO**: the token or a sub-domain is wrong.
- **Cloudflare: zone not found**: check the name, or paste the Zone ID
  instead (some tokens cannot list zones).
- Logs: the integration's log level is set with the `LOG_LEVEL` variable.
  The addresses and the tokens never appear in the logs.

## Privacy

The IP services see the address of your home (that is what they echo back),
nothing else. Duck DNS and Cloudflare receive the addresses you ask them to
publish. The tokens are stored by Gladys as secrets and only sent to their
own service: Duck DNS in its update request, Cloudflare in the
`Authorization` header.
