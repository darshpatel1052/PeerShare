# Recorded benchmark evidence

Read the [report](../../../benchmarks/report.md) for results and supported resume wording, and the [protocol](../../../benchmarks/protocol.md) for workload and stopping criteria.

The raw archive preserves both successful and failed levels. `manifest.json` gives the byte length and SHA-256 of every delivered raw file. Source revisions in the records identify the measured application; later PeerShare branding does not change historical measurements.

- `baseline-v1` / `optimized-v1`: isolated synthetic catalogue campaign, three repeated steady trials, overload, recovery and cache conditions.
- `plans`: PostgreSQL execution plans before and after the query/index changes.
- `pipeline-v1`: seven real moving-video jobs, independently verified outputs, resources and the byte-identical measured script.
- `public-segments-before` / `public-segments-after`: paced anonymous HLS segments with payload hashes and playback deadlines. The after run used a documented DNS override with normal TLS verification.
- `public-peers-v1`: three pairs of eight real browser contexts, origin counters, per-viewer integrity, completion and dropped-frame records. Consent setup is included in conservative reduction figures.
- `temporary-video-cleanup.json`: anonymous 404 verification after the approved temporary clip was unpublished.

Synthetic accounts are not customers; metadata records are not encoded videos. The browser generator's dropped frames are a material limit. Response-body bytes exclude transport overhead and are not billed AWS savings. The normal public platform and its editorial showcase were retained. Catalogue benchmark replicas were stopped after measurement.

Export only allowlisted records with `node scripts/benchmark/export.mjs`; regenerate figures with `MPLCONFIGDIR=/tmp/peerscreen-matplotlib python3 scripts/benchmark/charts.py`. Private cookies, fixture session files, database credentials and Terraform state stay outside this archive.
