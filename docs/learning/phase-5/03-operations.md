# Operate the first deployment rehearsal

The normal app stays at `http://localhost:3000`. `npm run test:gateway` builds a disposable production-mode rehearsal at `https://localhost:3443` and removes that test project's volumes afterward. It does not switch the user's normal project to production or copy their accounts into the rehearsal.

The rehearsal generates its own creator and video through the real publishing pipeline before closing public registration. It then uses a localhost self-signed certificate to exercise HTTPS/WSS, production cookie attributes, two API replicas, shared-session reads, published media and real peer transfer. Self-signed browser test trust is a local tool choice; the public domain needs a valid renewed certificate. Production uploads remain disabled in this first preset until creator admission is added.

## Readiness and liveness answer different questions

`/health/live` means the process can answer. Catalogue `/health/ready` also checks PostgreSQL and Redis, which its product requests need. The web service has its own liveness response, so losing an API replica does not make the static process appear dead. Envoy actively checks each catalogue endpoint. Both its normal and initial idle check intervals are explicit; the initial idle default otherwise schedules its next probe after 60 seconds. [Envoy health-check fields](https://www.envoyproxy.io/docs/envoy/latest/api-v3/config/core/v3/health_check.proto.html).

All backend/database/broker host ports are removed by the gateway overlay. The TLS port and loopback-only Envoy operator port remain. In the AWS package, administrative/metrics ports will stay private; the overlay is a localhost rehearsal and not the final public host binding. `/metrics` and operator fixture media are blocked at the public gateway route.

## Measurements with bounded labels

Go exposes a Prometheus histogram of HTTP duration by **route pattern, known method and status class**, plus current goroutine/heap and database connection gauges. The label is `GET /api/v1/videos/{id}`, not a particular UUID or query. This keeps cardinality bounded and avoids recording users, titles, cookies, capability tokens or addresses. Histogram buckets let a later Prometheus deployment calculate latency quantiles; the current endpoint is not a completed monitoring dashboard.

The tracker exposes connection/swarm counts and announce/offer/answer/rejection counters on its internal metrics path. Envoy provides upstream health, routing and connection statistics through its private admin endpoint. These are operational observations; the creator's browser-reported Analytics remains a separate product feature with separate permissions.

`API_REPLICA_DIAGNOSTICS=true` enables a response header identifying the serving container in the private rehearsal. It is off by default. One cookie reading the same account across two different headers demonstrates the shared-session model. Removing one test API then checking the remaining healthy endpoint demonstrates process-level routing, not host-level high availability.

## Useful diagnosis

If a public video fails, start with the metadata URL and generated HTTPS manifest/integrity URLs. Check their status and MIME, then the player error. If HTTP works but peers do not, check the WSS route, opt-in, same accepted video/rendition, peer payload and STUN candidate types. `npm run check:stun` intentionally contacts the configured public STUN endpoint through the real opted-in local player; routine suites keep STUN off. It does not record SDP or addresses.

Before AWS deployment, the remaining operational work includes a real full-data restore, certificate renewal/reload, image publication/rollback, traces across service/event boundaries, bounded monitoring/log shipping, and a finite costed teardown. Build those as useful operator flows; the current checkpoint does not add a speculative failure matrix.
