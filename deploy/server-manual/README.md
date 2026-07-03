# Server manual-deploy snapshot (reference only)

These two files are a **verbatim copy of the emergency, hand-built deploy**
that was running on the production VPS (`72.60.103.200`) as of
**2026-07-01**. They are kept here for reference/history only.

**Do not treat these as the canonical build.** The repo root
[`Dockerfile`](../../Dockerfile) and
[`docker-compose.yml`](../../docker-compose.yml) are the intended,
production-grade setup.

## What this snapshot is

On 2026-07-01 the app was brought up on the VPS by copying the source
(then at upstream commit `54b8652`, i.e. **none** of the local
customizations on `main`), writing the simple `Dockerfile` below,
building it locally as the image `wacrm:local`, and pointing
`/var/www/wacrm/docker-compose.yml` at that image.

- `Dockerfile` — pulled from `root@72.60.103.200:/root/wacrm-src/Dockerfile`
- `docker-compose.yml` — pulled from `/var/www/wacrm/docker-compose.yml`

## How it differs from the repo's canonical setup

| | This snapshot (server) | Repo root (canonical) |
|---|---|---|
| Base image | `node:20-bookworm-slim` | `node:20-alpine` |
| Build | single-stage, `npm ci --include=dev` + `npm run start` | multi-stage, Next.js **standalone**, `node server.js` |
| Runtime user | root | non-root `nextjs` (uid 1001) |
| Image size | larger (dev deps + full `.next`) | minimal (standalone output only) |
| compose image | `wacrm:local` (built on the box) | `ghcr.io/umeshsureban/wacrm:latest` |
| Healthcheck | `GET /login` | `GET /api/health` |
| Source | upstream `54b8652`, no local work | current `main` (merge + rebrand) |

## Migrating off this workaround

The proper fix is to deploy the repo's `main` (with today's merge +
rebrand) via the canonical image build, then switch
`/var/www/wacrm/docker-compose.yml` back to the GHCR image and the
`/api/health` healthcheck. Until then, the VPS keeps serving
`wacrm:local`.
