# Analytics cache and creator access checkpoint

Local verification on 14 October 2026, extending the Phase 5 networking checkpoint `20c1176`:

- `npm run test:integration`: 57 top-level cases, 82 including named subcases, no failures; real isolated PostgreSQL, limiter Redis, separate cache Redis, Kafka and FFmpeg; Go race detector enabled.
- `TestIntegrationAnalyticsCacheSharesResultsAuthorizesAndRefreshes`: first SQL result stored; a second independent Redis client reused it after another accepted telemetry batch; explicit no-cache read returned current bytes; an unrelated signed-in owner received 404 before lookup; title/deletion changed the read result; a closed cache client still yielded a successful SQL result. This is a client failure check, not a timed Redis-host outage.
- `TestIntegrationCreatorApprovalGrantExpiryAndRevocation`: production permission denied an unapproved existing user, accepted a 24-hour grant, refused a previously signed part after revocation, refused an expired grant, allowed owner abort and retained session access. The test uses the isolated HTTP identity harness; secure cookie/TLS verification remains the separate gateway rehearsal.
- `npm run check`: formatting/types and eight existing JavaScript unit cases passed.
- `npm run web-build`: production static export passed.

The cache saves repeated aggregate computation, but no before/after throughput or latency benchmark was run at this checkpoint. No AWS account access, provisioning, DNS edit or paid-plan change occurred. Private test output is retained in `.local/evidence/phase-2-go-tests.jsonl` (the runner's historical filename). Detailed concepts and reproduction are in [the Redis/creator guide](../../learning/phase-5/04-redis-and-creator-access.md).
