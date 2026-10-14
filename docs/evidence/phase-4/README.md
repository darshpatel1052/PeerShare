# Phase 4 evidence

Status: the library/backend foundation is verified; the connected UI, telemetry/analytics and uploaded-media peer exercises remain in progress. No cross-network result has yet been recorded. The user has confirmed devices on two networks can be used for that later exercise.

## Foundation checkpoint, 14 October 2026

- Formatting, generated OpenAPI types, TypeScript and all eight JavaScript cases passed.
- Full Go suite passed with the race detector: **46 top-level cases, 70 including named subcases**, zero failures or skipped tests. Applicable integration cases use real isolated PostgreSQL, Redis, Kafka, gRPC and FFmpeg. [Named results](library-backend.json).
- Actual Docker images processed and published a generated 720p MP4, served 480p/720p segments, followed the channel, returned the Following/search result, saved the video to a private playlist, and denied anonymous playlist access. Complete profiled teardown and an empty disposable project were checked. [Container observations](library-containers.json).
- The normal `peerscreen` project and its user data were not used for destructive verification. Migration `0007_viewer_library.sql` is additive; existing applied migrations are unchanged.

| New scenario                                                | Observed result                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TestIntegrationSubscriptionsReplayFollowingAndSearch`      | Repeated/eight concurrent follows preserve one pair; anonymous mutation/Following denied; search title/tag edits and cursor pagination work; unpublished metadata excluded; repeated unfollow removes the feed relationship; origin/length bounds enforced                                                                                                  |
| `TestIntegrationPlaylistsOwnershipVisibilityOrderAndReplay` | Stable creation key returns one ID; changed input conflicts; private reads/mutations deny other users; duplicate save is unchanged; invalid reorder rolls back; valid reorder swaps positions; stale revision conflicts; public reads omit unpublished IDs/metadata; owner can remove unavailable items; deleted creation key cannot resurrect the playlist |
| `TestIntegrationConcurrentPlaylistCreationAndRevision`      | Eight equivalent creates return one playlist; two edits based on one revision produce one commit and one explicit revision conflict                                                                                                                                                                                                                         |

These library cases use controlled published catalogue metadata. Their scope is relational/API behavior, not video encoding. The container check separately exercises the real source-upload and packaged media pipeline.

## Findings and corrected failure runs

The initial broad run passed the new library cases but exposed two existing regression failures. Equivalent media submissions could contend on the secondary `(video_id,generation_id)` unique index even though `ON CONFLICT(id)` handled the primary key. Per-job transaction locking before insertion now serializes the equivalent submissions; the complete concurrent RPC regression passed.

The lifecycle poison-record check repeatedly failed because stale `peerscreen-test` app containers survived dependency teardown. Kafka group logs showed a second catalogue consumer. Compose services behind the `app` profile were not included in the default down operation. The helper now includes that profile for down/stop, and the image runner asserts that no disposable app containers remain. After removing only the stale test project, the original fifteen-second poison-record check and the full connected media suite passed. Extending the timeout did not resolve the cause and was reverted.

Bounded Kafka protocol-code diagnostics and test consumer logs improve future failure analysis without recording credentials or message payloads. The corrected suite, not the earlier failed runs, is the source of the passing case record.

## Reproduce and interpret

```sh
npm run check
npm run contracts:check
npm run test:integration
npm run test:containers
```

Run dependency suites sequentially; they share the disposable project. This host requires `PEERSCREEN_BUILD_NETWORK=host` for image downloads. The runtime network remains private. Private credentials, cookies, tokens and actual Google configuration are excluded from committed evidence.

[Foundation source fingerprints](library-fingerprints.json) bind the backend/contracts/runtime scripts and records to this checkpoint. Git history provides its exact commit. Phase 3's closing [CI run succeeded](https://github.com/darshpatel1052/Peer-Screen/actions/runs/38533968360); that historical success is separate from this checkpoint's subsequent CI.
