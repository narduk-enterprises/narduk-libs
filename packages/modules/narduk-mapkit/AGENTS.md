# Agent notes for narduk-mapkit

## Cross-cutting infra & topology docs

This repo is part of the `narduk-geo` GitHub org family. For anything that
spans repos -- which repos exist and what each does, the two-tile-server
split on the Proxmox host, Coolify deploy/routing for earth.nard.uk /
earthdata.nard.uk, Doppler secrets layout, or the self-hosted CI runner
setup -- check **narduk-geo/geo-infrastructure** first instead of
re-deriving it:

- Repo index: https://github.com/narduk-geo/geo-infrastructure/blob/main/docs/repo-index.md
- Topology (tile servers, Coolify, Doppler, CI runners): https://github.com/narduk-geo/geo-infrastructure/blob/main/docs/topology.md

If you learn something cross-cutting that is not there yet, add it there,
not here -- that repo is the single source of truth so future agent
sessions do not rediscover the same topology from scratch.
