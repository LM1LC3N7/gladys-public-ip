# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-10-14

### Added

- Public IPv4 detection every 1 to 60 minutes (5 by default) through three
  free IP services taken in turn (ipify, icanhazip, ident.me); a new address
  is only believed once two services agree.
- Public IPv6 detection when the container has IPv6; without it, a calm
  status and a new try every 30 minutes.
- An "Internet" device: connected, public IPv4, public IPv6.
- Scene triggers "public IP changed" (IPv4, IPv6 or both, with the old and
  new address), "Internet lost" (after 2 failed checks by default) and
  "Internet restored" (with the outage duration).
- Scene actions "get the public IP" and "update the DNS now".
- Optional dynamic DNS: Duck DNS (IPv4, IPv6 on request) and Cloudflare
  (the address of existing A / AAAA records, proxy and TTL kept), updated at
  start and on every change, with a backoff on failure.
- A "Public IP" dashboard widget with an "Update DNS now" button.
- A "Test detection and DNS" button: every service once, then a dry run of
  the DNS providers.

[Unreleased]: https://github.com/LM1LC3N7/gladys-public-ip/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-public-ip/releases/tag/v0.1.1
