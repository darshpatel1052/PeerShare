# Preliminary first-release checks — 15 October 2026

The substantial dataset, sustained-load and real-media campaign is documented in the [benchmark report](../../../benchmarks/report.md). These earlier records retain their smaller scope.

These are completed runs, replacing the earlier benchmark deferral. [Context](context.json) identifies the **server deployment**, separately from the client Git/working-tree fields inside each raw report. Client hardware is the local workstation; it is not the AWS server specification.

## Catalogue metadata

Every profile made 300 requests per round, three rounds, after ten warmup requests. Each successful response was consumed and checked as the actual JSON catalogue contract. All **4,500 measured requests succeeded**, with no deadline stops: 2,700 local and 1,800 public AWS requests. The dataset contained **one published video**. This deliberately preserves the user's catalogue; it is not a large-dataset benchmark.

| Target           | Concurrent requests | Successful responses/sec, round range | p95 latency, round range | Record                    |
| ---------------- | ------------------: | ------------------------------------: | -----------------------: | ------------------------- |
| Local app        |                   1 |                               264–388 |             5.65–6.60 ms | [Raw](api-local-c1.json)  |
| Local app        |                   8 |                           1,388–2,468 |            5.89–11.34 ms | [Raw](api-local-c8.json)  |
| Local app        |                  16 |                           3,055–5,306 |            4.40–13.37 ms | [Raw](api-local-c16.json) |
| Public AWS HTTPS |                   1 |                             25.6–25.8 |           41.67–44.89 ms | [Raw](api-aws-c1.json)    |
| Public AWS HTTPS |                   8 |                               180–203 |           45.50–69.38 ms | [Raw](api-aws-c8.json)    |

Latency includes response-body consumption and JSON validation in the client. Percentiles describe successful requests; status/error counters are separate. The concurrency-1 AWS rounds lasted roughly twelve seconds each. The higher-concurrency rounds were shorter. The local runs are short bursts on a shared workstation with the normal operator profile running. There was no dedicated CPU isolation, controlled network latency or sustained overload/arrival-rate experiment. These measurements do **not** establish maximum capacity or a production latency SLO.

The endpoint reads PostgreSQL catalogue data. These numbers do not demonstrate an analytics Redis cache speedup. The two production APIs share sessions and database state; this benchmark does not attribute individual requests to replicas because public replica diagnostics are disabled.

## Actual media, measured separately

[Archived preliminary record](media-preliminary-one-round.json) contains **one** comparison from the disposable local test stack: three independent Chromium contexts per condition, cache disabled, a generated source processed by the real pipeline. The saved HTTP baseline delivered 9,739,152 gateway response-body bytes; the peer condition delivered 2,820,000, with a 2,489,120-byte difference after including consent setup. This short, buffering-dependent window does not establish a fixed savings percentage.

An earlier three-round console run was completed, but its fixed-name raw file was overwritten by another test run before archival. Those three console figures are excluded from this evidence. New benchmark campaigns must use unique output directories and retain raw reports before a later run can replace them.

The separate [public Chromium run](../public-chromium.json) verified actual AWS HTTPS/WSS and S3-backed playback, including received peer payload and sharing-off HTTP fallback. Both browsers were on the same workstation. [Public STUN](../public-stun.json) discovered a server-reflexive candidate after consent. Neither proves two-network transfer; that result requires the user's two devices.

## Reproduce

```sh
npm run benchmark:api -- --base http://localhost:3000 --requests 300 --concurrency 8 --repeats 3 --label api-local-c8
npm run benchmark:api -- --base https://peerscreen.darshpatel.dev --requests 300 --concurrency 8 --repeats 3 --label api-aws-c8
PEERSCREEN_PEER_BENCHMARK_REPEATS=3 npm run test:browser -- tests/browser/uploaded-peer.spec.ts
```

The first two commands read only the catalogue and save private JSON under `.local/evidence/LABEL.json`. The media command uses the disposable test stack; do not overlap it with another runner using that stack. It preserves normal application data. Preserve the raw results and the matching source/build context when comparing later changes.
