# 3. HTTP contracts and retry-safe multipart uploads

The full contract lives in `contracts/openapi/catalog-v1.yaml`. `npm run contracts:generate` produces the TypeScript schema; `contracts:check` detects drift. A hand-written frontend type cannot protect you when Go returns different fields, so public schemas should stay in the contract.

## Main endpoints

All mutation requests require the configured `Origin`. Creator endpoints require the opaque session cookie. IDs are canonical UUIDs. JSON remains limited to 16 KiB; only the scoped part PUT accepts an 8 MiB maximum binary stream. The gateway counts streamed bytes too, including requests without Content-Length.

| Request under `/api/v1`                              | Purpose                                                 | Typical result                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `POST /uploads`                                      | Reserve space and create a private draft/session        | 201 new, 200 equivalent retry, 409 changed request/key, 429 capacity             |
| `GET /uploads`                                       | Latest 30 creator-owned uploads/jobs                    | 200 with `items`                                                                 |
| `GET /uploads/{id}`                                  | Resume state; open-session parts rechecked against disk | 200, 404 for another owner                                                       |
| `POST /uploads/{id}/parts/presign`                   | Issue 1–3 current permissions                           | 200 with numbers, relative URLs, tokens, expected bytes and expiry               |
| `PUT /uploads/{id}/parts/{number}`                   | Receive one exact-sized chunk                           | 200 digest/size; 403 bad/expired token; 409 busy/conflict; 422 wrong source/size |
| `POST /uploads/{id}/complete`                        | Recheck/assemble source and queue a job                 | 202 queued, 200 completion replay, 409 missing/corrupt/expired/busy              |
| `POST /uploads/{id}/abort` or `DELETE /uploads/{id}` | Idempotently end an open upload                         | 204; completed uploads use video deletion instead                                |
| `GET /videos/{id}/processing`                        | Owner processing/publication state                      | 200 Upload schema                                                                |
| `POST /videos/{id}/processing/retry`                 | Requeue an eligible job with capacity                   | 204; bounded to 3 total attempts                                                 |
| `POST /videos/{id}/processing/cancel`                | Invalidate the active attempt                           | 204; ready result wins if acceptance already committed                           |
| `GET /videos/{id}/preview`                           | Ready owner's private playback configuration            | 200; sharing disabled                                                            |
| `PATCH /videos/{id}`                                 | Title/description/tags with revision                    | 204 or 409 stale edit                                                            |
| `POST /videos/{id}/publish` or `/unpublish`          | Change visibility of a ready video                      | 200                                                                              |
| `DELETE /videos/{id}`                                | Tombstone and durable cleanup                           | 204, safe to repeat                                                              |
| `GET /videos/{id}`                                   | Public watch metadata                                   | 404 while private/deleted                                                        |
| `GET /media/{key}`                                   | Accepted and visible media content                      | 200/206; HEAD/ranges supported; private owner or published viewer                |

Errors have `code`, `message` and `request_id`. A human-readable message explains the next action; a code lets the client distinguish a missing chunk from a wrong file. The request ID ties a response to safe server logs without logging credentials or binary source content.

## Idempotency means logical reuse

The studio generates a UUID request key and sends it in `Idempotency-Key`. The database scopes it to the owner. The request fingerprint includes normalized channel, metadata, size and chunk hashes. An equivalent retry finds the same upload/video; different details using that key conflict. A dropped response can therefore be retried without silently creating a second draft.

Completion checks the persisted state first. If the source was already committed, it returns that logical result. The unique video/job constraint prevents duplicate queue records. Publishing again preserves the existing publication timestamp; it does not create another video.

Do not treat every 409 alike. `part_busy` and `completion_busy` mean another operation holds a lock; refresh/retry shortly. `checksum_mismatch` means the selected bytes are wrong. A stale revision means somebody changed the metadata; preserve your edit until you choose how to reconcile it.

## File and part identity

For a 20 MiB source, parts are 8 MiB, 8 MiB and 4 MiB. Part numbers start at 1. A 250 MiB file has 32 parts, with the last part smaller. The server computes the expected length from the session and part number; the client cannot request extra parts or send an oversized last part.

A permission is a random opaque token, stored in the database only as its SHA-256 hash. The request uses `Upload-Token`; the token is scoped to one upload/part and expires within ten minutes. It also requires the owner cookie, so it is not an anonymous upload URL. Reissuing a permission replaces the previous one. Tokens remain in memory and are excluded from evidence.

The filename is content-addressed: `upload-id/part-001-sha256`. Bytes stream through `io.MultiWriter` into a temporary file and SHA-256 digest. The code checks actual length, expected digest and existing recorded identity, flushes the file, renames it and syncs the directory before recording it. Identical retries can repair a corrupted local object; different bytes cannot overwrite an accepted part's logical identity.

During completion, each recorded part is reopened, ordered, length checked and hashed again while being copied into the source. The full source is hashed separately. Its private key includes video ID and content hash. No source file is served by a public media route. The worker verifies the source size/hash again before parsing it.

## Storage and SQL cannot commit together

If a part rename succeeds but SQL recording fails, the object can be unreferenced. If source assembly succeeds but completion's database commit fails, a source object can be unreferenced. A retry either adopts the same logical content or leaves an orphan eligible for cleanup. Ambiguous SQL failures are checked before removing data: a failed response is not proof the commit failed.

The periodic reconciler removes old temporary/unreferenced objects after a ten-minute grace period and preserves live or accepted attempts. Abort, expiry and delete remain recorded even if cleanup fails. Reservations survive until cleanup succeeds. This is how the implementation handles failure windows instead of pretending the filesystem participates in a database transaction.

## Private playback

The gateway proxies uploaded-media paths to the API on both media ports. It decodes paths before deciding whether a file is protected; encoded names cannot enter the fixture's static-file route. Only the operator fixture is served directly. The API checks video state, deletion, accepted generation/attempt and owner/public visibility before opening a file. Real-path containment rejects a symlink escaping the media root.

Public descriptor fetches omit cookies. Studio preview explicitly uses same-origin credentials and same-origin media URLs; peer sharing remains off. Unpublish/delete reject new anonymous metadata and HTTP media fetches. Already delivered browser/peer buffers cannot be recalled by this visibility change.
