# ADR 0002: identity and persistent catalogue

Status: accepted for the local Phase 1 checkpoint, 13 October 2026.

## Problem

Static fixture metadata cannot represent persisted accounts, canonical ownership or concurrent channel edits. The browser must consume a real API while preserving the static frontend and verified media delivery already proved in Phase 0.

## Decisions

- Use a Go `net/http` API and pgx PostgreSQL pool. PostgreSQL owns users, hashed sessions, channels and video publication metadata. Database constraints protect relationships across concurrent requests; transactions bind related writes.
- Store Argon2id password hashes with random salts. Issue random opaque cookie tokens and persist only their SHA-256 digest. Authenticate every private request against unexpired, non-revoked database state. Cookie flags and exact mutation-Origin checks work together.
- Derive ownership from the authenticated session and channel's owner foreign key. Use a locked row plus expected revision for edits, returning 409 when a form is stale.
- Keep Redis limited to atomic authentication counters. A Redis failure refuses new authentication attempts; catalogue and existing-session reads continue through PostgreSQL. Losing Redis does not lose accounts/sessions.
- Serve static Next.js output and same-origin metadata requests through the local gateway. Media flows directly to the media server/player; the Go API returns metadata/URLs. Development uses explicit API/health rewrites without the static export's trailing-slash policy.
- Define OpenAPI 3.1.1 and generate browser TypeScript DTOs. Isolate the generator's supported TypeScript 5 dependency while leaving the frontend on TypeScript 7. Generated types aid compilation; runtime validation stays on the server.
- Use descending `(published_at, id)` keyset pagination and published/non-deleted filtering in both lists and details. Keep ready state separate from publication state and reserve generation/attempt fields for later processing work.
- Pin Go/database/cache/build images, keep local credentials outside Git, and use non-root/read-only application containers. Migration/import are explicit one-shot services. The normal PostgreSQL volume persists; test runners own a separate disposable project.

## Consequences and limits

The browser no longer invents catalogue metadata or owner identity. Sessions and channel metadata survive actual API and database restarts. A shared Redis counter also works across handler instances, but the current gateway TCP address makes the local bucket gateway-wide. Production needs a trusted client-address/admission policy.

The database runtime role currently owns its application schema and can perform DDL there; role splitting is deferred. Session cleanup occurs when that user signs in, not through a global scheduled sweeper. Readiness requires both dependencies even though some reads remain usable when Redis is down. This checkpoint proves one-host persistence/recovery, not backups, multi-host HA or media-processing guarantees.

The imported video is generated media with version identity derived from its bytes. Upload admission, object storage, jobs, transcoding and publication recovery are later phases. Public registration remains disabled in production configuration until the admission policy exists.

## Evidence

See [the Phase 1 report](../evidence/milestone-1.md) and [learning guide](../learning/phase-1/README.md) for actual procedures, observations, code paths, tradeoffs and limitations.
