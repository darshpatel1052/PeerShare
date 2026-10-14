# Redis beyond rate limiting, and creator admission

The product already uses Redis for atomic sign-in and playback limits. The new use is shared creator analytics caching: repeated dashboard requests can reuse aggregate results across API processes. PostgreSQL remains the source for users, sessions, video ownership, upload reservations and accepted playback reports. Kafka remains the processing/event transport. Redis losing its cache changes performance and freshness, not those records.

## Read the actual flow

1. The session middleware loads the user from PostgreSQL. A cached analytics document cannot sign someone in.
2. `AnalyticsScope` checks channel ownership and, for a video dashboard, whether the video is still present. It returns a version based on the channel revision and the videos' latest metadata timestamp/count.
3. Go forms a key containing the schema version, owner, channel, metadata version and optional video ID. This prevents unrelated channels or the channel/video views from sharing an entry.
4. A hit returns the previous aggregate. A miss runs `CreatorAnalytics`, whose repeatable-read transaction produces consistent totals and the detail table. The serialized result is stored for **15 seconds**, with a **256 KiB** entry limit.
5. The dashboard's Refresh action sends `Cache-Control: no-cache`, which bypasses the lookup and computes current results. It also replaces the shared entry.

Telemetry can appear up to fifteen seconds later during ordinary reads. This is a stated freshness choice, not immediate event-driven cache invalidation. Video/channel edits select a different key. Deleted video endpoints are checked before accessing Redis. The cached owner dashboard is private; its HTTP response uses `private, no-store`, so a browser/proxy cannot reuse it as public content. Public playback and unpublished-media permission checks do not use this cache.

## Why two Redis processes?

The rate limiter runs with a 64 MiB data limit and `noeviction`. Dropping a rate counter early could weaken a limit. The analytics instance uses 32 MiB and `allkeys-lru`, allowing older entries to disappear to make room for recently used results. Both instances disable disk persistence because their records are disposable. Using database numbers 0 and 1 in one Redis process would **not** separate its memory limit or eviction policy.

The cache container has an 80 MiB process limit to allow overhead beyond stored data. The extra instance runs on the same host, rather than creating a managed AWS cache bill. Cache operations have a 200 ms context bound and no retries. A failed cache request falls back to PostgreSQL; the sign-in/upload limiter retains its stricter failure behaviour. Private metrics expose fixed `hit`, `miss`, `error` and `bypass` labels, with no owner IDs in labels. Those counters show whether reuse occurs; they do not prove a latency or throughput improvement. That requires the later benchmark.

Go's `atomic.Uint64` supports concurrent counter increments without locking the entire request path. `context.WithTimeout` limits waiting and propagates request cancellation. The optional cache client is closed with the API to release its connections.

## Production creator permission

Account identity, channel ownership and permission to start expensive work are distinct. Production registration remains closed for the initial release. Existing/restored accounts can sign in. A signed-in account receives creator permission only when its user ID has a nonexpired row in `catalog.creator_access`.

The table contains `user_id` (primary/foreign key), `granted_at` and `expires_at`. An operator with server access uses:

```sh
/peerscreen creator-access grant USER_ID 24
/peerscreen creator-access revoke USER_ID
```

The grant lasts 1–720 hours. This command grants permission to an **existing** PeerScreen account; it does not invite an email, create an account or connect a Google identity. No public administrative endpoint is added. PostgreSQL's clock decides whether the grant remains live. The existing owners are not silently approved during migration.

Production channel creation, artwork writes, new uploads, part grants/transfer, completion and processing retries check this permission. New upload setup and processing retries additionally use a shared per-user Redis limit of ten requests per minute. Existing PostgreSQL quota checks still serialize creator/platform storage reservations. These controls serve different purposes: request rate, permission and total capacity.

Revoked creators can inspect or abort an old upload and remove their videos. Already accepted processing work follows its existing job state; revoking permission does not pretend that a queued job was cancelled. Development keeps the normal open local creator workflow. `UPLOADS_ENABLED` is a separate deployment switch; production defaults to false, and enabling it does not bypass approval.

## Hands-on exercise

Sign in to the local app, open Analytics twice, and inspect the private cache counters through the internal API metrics. Play your video and press Refresh: the new report is read from PostgreSQL. Inspect `analytics_cache.go`, then follow its call to `AnalyticsScope` and `CreatorAnalytics` to see how cache data and database authority differ.

In the isolated production rehearsal, grant a creator for a bounded period, start an upload, revoke the permission and try sending another part. That operation is refused while abort remains available. Do not run expiry/revocation experiments against another person's account.

References: [Redis cache-aside](https://redis.io/docs/latest/develop/use-cases/cache-aside/), [Redis eviction policies](https://redis.io/docs/latest/develop/reference/eviction/). The exact bounds above are PeerScreen's implementation choices.
