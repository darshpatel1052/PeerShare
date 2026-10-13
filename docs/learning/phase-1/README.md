# Phase 1 learning path: identity and a persistent catalogue

This guide explains the implemented code, including tradeoffs and limits. Read the chapters in order, then follow a request through the source. The [original brief](../../project-brief.md) describes the later system; it does not mean all those components are running now.

1. [Architecture and one request's journey](01-architecture.md): component boundaries, metadata versus media, static hosting, connection pools, Redis, and local orchestration.
2. [Data modelling and SQL](02-data-model.md): entities, keys, relationships, normalization, constraints, indexes, migrations, transactions and pagination.
3. [Go through the actual API](03-go.md): modules, packages, structs, methods, pointers, interfaces, errors, contexts, goroutines, channels and shutdown.
4. [API and authentication](04-api-and-auth.md): HTTP contracts, validation, password hashing, cookie sessions, CSRF/origin checks, ownership, revisions and typed frontend requests.
5. [Verification and evidence](../../evidence/milestone-1.md): what each test protects, the actual procedure, observed results and the limits of those results. This report is completed after the implementation is verified.

## What changes in this phase

The Phase 0 video/player stays real. Metadata moves from a hard-coded page into PostgreSQL and is fetched through a Go HTTP API. Users can create accounts and channels, and ownership is enforced against persisted identity. The first video is an explicitly generated fixture imported by an operator command; it is not evidence of a working upload/transcoding pipeline.

## Reading the repository

| Location                                 | Responsibility                                         |
| ---------------------------------------- | ------------------------------------------------------ |
| `services/api/cmd/peerscreen/main.go`    | Process startup, commands, dependencies and shutdown   |
| `services/api/internal/config`           | Validated environment configuration                    |
| `services/api/internal/httpapi`          | Routing, middleware, JSON contracts and authorization  |
| `services/api/internal/auth`             | Password hashes and opaque session-token helpers       |
| `services/api/internal/store`            | PostgreSQL queries and transactions                    |
| `services/api/internal/store/migrations` | Ordered, checksummed schema changes                    |
| `services/api/internal/ratelimit`        | Atomic shared Redis authentication counters            |
| `contracts/openapi/catalog-v1.yaml`      | Reviewable API contract                                |
| `packages/contracts`                     | Generated TypeScript request/response types            |
| `apps/web`                               | Browser pages and API consumers                        |
| `deploy/compose/local.yml`               | Pinned local database/cache containers                 |
| `scripts`                                | Reproducible setup, build, run and evidence collection |

The Go `internal` directories also enforce an import boundary: external modules cannot casually import these application implementation packages. The API exposes HTTP to the browser rather than exposing Go internals.

## How to study actively

Start with registration and channel creation, then inspect `GET /api/v1/me`. Explain why the server can recover your identity without keeping a session map in memory. Find where a channel's owner is assigned and why the client cannot change it. Make two edits using the same revision and predict the second response. Trace a cursor's timestamp/UUID pair into the SQL comparison. Finally, compare the invariant in each learning chapter with the corresponding integration test.

Use the separate test database for experiments. The integration runner has its own Compose project and volume; it cleans those resources after the run. It does not remove your application's persistent database volume.
