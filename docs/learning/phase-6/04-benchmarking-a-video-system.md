# Measuring a video platform you can explain in an interview

A useful benchmark answers a specific question under recorded conditions. PeerShare has several different kinds of work. Listing video metadata reads PostgreSQL. Uploading transfers bytes and persists reservations. Processing runs FFmpeg and publishes an accepted media version. Watching reads HLS fragments from private S3 through the authorized API. Peer delivery moves verified fragments between browsers. One requests-per-second figure cannot describe all of them.

The [protocol](../../benchmarks/protocol.md) states the workload and passing criteria. The measurement report links raw results, including failed levels. Keep that context with any resume number.

## Content and data are different fixtures

The public product has original visual explainers in six editorial showcase channels. These are actual MP4 uploads with artwork, processed into 480p/720p HLS and published through the normal API. Their descriptions identify their origin. We do not manufacture subscribers or claim the accounts are customers.

The large private database is a separate query fixture. Its 10,000 accounts, 100,000 video records, subscriptions, playlists and playback summaries are synthetic. The video records have valid metadata and publication fields, but no uploaded media. They exercise search, cursor pagination, Following and analytics over realistic relationships without creating 100,000 pretend public videos or consuming enormous storage.

A foreign key makes a video refer to an existing channel. Subscriptions join users and channels; their composite primary key prevents a duplicate follow. Playlist items have both an identity key and a deferrable position constraint, allowing reorder transactions to temporarily exchange positions. The seeder's `ON CONFLICT` must name the nondeferrable primary key: PostgreSQL cannot use a deferrable unique constraint as the conflict arbiter. That was a real setup issue corrected before measurement.

Synthetic data is not harmless merely because it lives in another database. A normal API also starts reconciliation and background consumers. If it were pointed at live S3 with a database missing real uploads, cleanup could mistake production objects for orphans. If it joined the live Kafka group, it could consume real projection events. The benchmark APIs therefore run in explicit read-only mode, start no workers or consumers, have no S3 credentials, and use private temporary media roots. Redis index 2 separates their rate/cache keys. The public deployment keeps its normal data and permissions.

## Why arrival rate matters

A closed loop sends a request and waits before sending the next one. When the service slows down, that client naturally sends less work. A finite closed-loop burst can look successful because the generator backs off without saying so.

The catalogue campaign uses k6's constant-arrival-rate executor. At 200 operations per second, it schedules that many starts each second independently of response speed. Virtual users provide enough in-flight slots to overlap the waiting. If every slot is occupied, `dropped_iterations` exposes scheduled work that never started. Drops are failures of the offered workload even when the completed HTTP responses look good.

Each operation here is one HTTP request plus full body consumption and a JSON-contract check. The mix contains searches, catalogue/cursor pages, channel feeds, video details, Following, private playlists and analytics. Authentication uses existing private synthetic sessions; password hashing and Google authentication are not included. Browser rendering and video decoding are separate experiments.

The target is declared in advance: under 1% failed operations, p95 under 250 ms, p99 under 500 ms and no dropped work. A failed contract counts as a failure even if the server sent status 200. Status-class counters distinguish rate limits, server errors and transport failures. Successful latency is shown separately from failures, so a collection of timeouts cannot disappear into an attractive successful p95.

The highest passing one-minute step is only a candidate. Three further two-minute runs must pass before calling that level sustained. The spike then deliberately overloads the path; recovery shows whether it returns to normal after demand drops. This is a measured lower bound under this protocol, not proof that every intermediate rate or larger deployment is supported.

## What p95, p99 and throughput mean

A p95 of 75 ms says at least 95% of the successful samples in that run were no slower than about 75 ms. It does not say every user sees that latency. The p99 describes the slower 1% boundary. Averages can hide these tails.

Completed operations divided by the requested scenario seconds describes work for that offered window, including allowed final drain. k6's built-in counter rate uses the whole run, including setup and drain, so it is slightly lower. Both are retained. Reporting the former without saying how late completions are handled would make the result hard to reproduce.

The load generator is external to AWS, and the private catalogue is reached through one SSH tunnel carrying verified HTTPS. This avoids exposing a synthetic dataset publicly, but includes network, TLS and tunnel costs. Connection startup appears in the latency distribution. CPU, memory, OOM and throttling observations help determine whether the server, generator or path is constrained. The first failed rate is not automatically the server's theoretical maximum.

The API replicas, PostgreSQL, Redis, Kafka and normal product services share one 2-vCPU/8-GiB host. Two API processes demonstrate replica routing and shared state; they do not provide multi-machine availability. A workstation loopback result cannot be relabelled as this AWS deployment's capacity.

## How the benchmark led to code changes

The initial query combined two search predicates with an `OR`: a video's full-text document matched, or its channel's title contained the search text. These predicates live in different tables. The planner could walk the chronological video index and test each row against the channel predicate. An absent term could therefore visit the entire 100,000-row catalogue before returning an empty page.

PostgreSQL's GIN index helps find full-text matches. It cannot by itself answer the other table's substring predicate. The revised Go query finds the newest matching text page and matching-channel pages independently, merges their IDs with SQL `UNION`, then fetches the final newest page. `UNION` removes a video that matched both branches.

Both branches apply publication, deletion, fixture, channel, cursor and Following restrictions before their limits. Taking `limit + 1` from each branch is sufficient: a video outside the newest `limit + 1` in every branch cannot become one of the globally newest `limit + 1`. The extra item establishes whether another page exists. The final `(published_at, id)` order and cursor retain deterministic pagination when timestamps tie.

A first rewrite still allowed a bad plan for absent channel matches. `LATERAL` makes each matching channel drive a bounded indexed page; if no channel matches, that branch has no video work. A covering channel-feed index includes `source_kind`, allowing fixture filtering without fetching every candidate heap row when index-only visibility conditions permit. Execution plans show whether those expectations actually hold.

Go constructs this statement from fixed SQL fragments. User query strings, IDs and cursor values stay in positional bind arguments. Building a few query shapes is useful because an omitted filter no longer has to be represented as `parameter is null OR ...` throughout a generic prepared plan. It must not become string interpolation of user input.

Analytics exposed a separate index problem. The published-only feed index could not support a version/ownership scope that includes drafts and unpublished videos. Every Redis hit still performs this authorization/version query, so an expensive scope query limits the cache's value. A nonpartial `(channel_id, updated_at)` index with included metadata makes that scope inexpensive and also narrows the underlying channel aggregation. It does not remove the playback join or make analytics free.

The regression tests check search across both branches, duplicate removal, cursor pages, hidden metadata, Following and channel filters. Plan captures include both custom and generic PostgreSQL plans because prepared statements may use either. Individual plan timings depend strongly on cache and I/O state; the repeated mixed campaign decides the product result.

## Redis beyond rate limiting

The production analytics cache is a separate Redis process with its own memory policy. A cached aggregate has a 15-second TTL. Ownership is checked before reading it, and a metadata version changes the cache key after relevant edits. Redis does not decide channel ownership, publication or upload capacity.

The hot-channel profile repeatedly reads one channel; the fresh profile sends `Cache-Control: no-cache`. Replica counters reveal actual hits, misses, errors and bypasses. Only attribute an observed difference to cache use when those counters confirm the condition. The mixed workload rotates through many owners, so it naturally has a different hit rate. A hot-key result should not be advertised as the speedup for every request.

## Media and peer results need their own language

Moving-video jobs measure the actual API, chunk checksums, queue, worker, encoding, S3 output and catalogue projection. Upload-to-ready time includes more than FFmpeg. Four accepted uploads do not mean four simultaneous transcodes: the configured worker may queue them and process them serially. Output verification reads both real manifests and sampled segment hashes after timing has finished.

The paced segment workload requests actual public HLS fragments and checks full SHA-256 payloads. Its virtual clients do not execute a page or decode video. A simulated client must download a fragment within its playback duration to avoid falling behind; fragment-deadline misses are reported separately from HTTP errors.

The browser comparison does decode the complete same 30-second clip in eight independent contexts. It repeats HTTP-only and peer-assisted conditions with fixed rendition, disabled HTTP cache and fresh contexts. The leader starts four seconds ahead in both conditions. Peer consent is set through the product UI, and its extra media setup cost is counted. Origin response-body counters include partial writes; browser counters describe verified payload. Neither equals billed wire traffic. The report shows both the measured-window difference and the difference including consent setup.

These browsers share one workstation and network. They establish real verified peer exchange under those conditions. The user separately reported successful cross-network playback; no browser types or byte counters were supplied for that manual exercise. Keep the distinction when discussing the project.

## Using the result on a resume

State the dataset as synthetic records, name the tested deployment and describe the metric. Prefer a sustained rate with latency/error conditions, a concrete processing time, or a repeated equivalent-work peer result. Keep the report available so an interviewer can inspect the source revision, workload, failed rates and raw records. Do not turn virtual clients into customers, metadata rows into encoded videos, a tested lower bound into a universal maximum, or measured body bytes into AWS invoice savings.
