# Milestone 1 evidence: identity and persistent metadata

Phase 1 is in progress. This record separates the validated backend checkpoint from the still-pending browser integration. It will be completed with full environment/source details, observations and recovery records after verification.

## Backend foundation observations

The current run used Go 1.27.2 with the race detector and an isolated real PostgreSQL/Redis Compose project. It reported seven unit cases and eight integration cases passing. The disposable test stack was removed afterward; the normal application database volume was preserved.

| Scenario                       | Invariant and procedure                                                                                             | Observed outcome                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Password helpers               | Hash the same password twice, verify correct/wrong inputs, reject malformed expensive recipes                       | Random salts differ; correct password verifies; invalid inputs fail closed                                   |
| Hash capacity                  | Cancel a request waiting for an occupied hash slot                                                                  | Cancellation returned instead of starting more work                                                          |
| Session token helper           | Generate two tokens; check entropy encoding and stored digest                                                       | Distinct canonical 43-character tokens; 32-byte SHA-256 digests                                              |
| Production settings            | Start with HTTP defaults/registration enabled, then deliberate HTTPS/WSS settings                                   | Unsafe browser/admission defaults rejected; Secure host cookie selected                                      |
| Cursor helper                  | Round-trip timestamp/UUID; submit malformed/trailing/oversized data                                                 | Exact tuple preserved; invalid cursors rejected                                                              |
| Identity persistence           | Register/login; inspect stored hashes and cookie flags; replay revoked token; expire session                        | No plaintext token/password stored; logout replay and expiry return 401; logs omit tested credentials        |
| Ownership/revisions            | Bob spoofs Alice's owner header; Alice edits; submit stale revision; create another channel                         | Bob gets 403; owner edit increments revision; stale/duplicate mutations return 409                           |
| Concurrent admission/FKs       | Race two creates for one owner; insert an orphan channel                                                            | Exactly one 201 and one 409; one row persists; FK rejects orphan                                             |
| Input/CSRF/errors              | Wrong Origin, extra role field, short password, absent account, excessive limit, invalid cursor, unsupported method | Structured 403/400/422/401/400/400/405 with request-ID correlation                                           |
| Atomic registration/migrations | Force session insert constraint failure; replay migration concurrently; attempt public-schema DDL                   | Partial user rolled back; one migration history row; foreign schema permission denied                        |
| Public feed                    | Use real SQL rows including draft/deleted entries and equal-timestamp published metadata fixtures                   | Draft/deleted IDs return 404; cursor pages neither repeat nor skip tie rows; incomplete publication rejected |
| Shared rate budget             | Two Redis clients race twenty increments against a budget of seven; exercise HTTP retry response                    | Exactly seven admitted; HTTP 429 includes Retry-After                                                        |
| Fresh API instance             | Resolve existing account/channel from a new handler instance; revoke all sessions                                   | Same persisted identity/channel loaded; revocation applies to the original instance                          |

The raw Go test event stream currently lives in `.local/evidence/phase-1-go-tests.jsonl` and is preserved before the final evidence package. A fresh handler instance is not yet an actual OS process/database restart experiment; the latter will be recorded separately.

## Pending for phase completion

Frontend registration/login/channel/catalogue/watch integration, production reload checks, real process/database restart observations, dependency outage behaviour, full Compose deployment checks, source/environment fingerprints and CI validation.

The [learning guide](../learning/phase-1/README.md) explains the model and mechanisms behind these assertions.
