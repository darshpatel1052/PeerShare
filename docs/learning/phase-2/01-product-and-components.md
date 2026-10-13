# 1. Using the product and understanding its components

Open `/studio/` after signing in and creating a channel. Pick an MP4, give it a title, optionally add a description/tags, and start uploading. The browser checks the file, transfers chunks, and asks the API to verify the complete source. Processing happens in the background. A ready video remains a private draft: use **Preview video**, then **Publish video**. It appears on your channel and Explore, with a public watch link.

For an interruption, return to Studio, select the original MP4, and use **Resume with selected file**. The server returns recorded chunks; the browser checks the file against its saved hashes and sends only missing or damaged chunks. **Pause upload** cancels browser requests while keeping received chunks. **Cancel upload** ends the session; its cleanup will release storage. Uploads expire after 24 hours.

Processing can be cancelled before a result is accepted. Failed/cancelled jobs can be retried up to three total attempts, retaining their source and logical job. An invalid file will continue to fail; retry is useful for a temporary storage/process problem, not for repairing invalid bytes. Delete the draft and choose a valid source for that case. **Delete video** requires a confirmation inside the UI, hides the video immediately and schedules file cleanup. Unpublish hides public metadata and future HTTP media requests; it cannot recall bytes already delivered or buffered.

## The pieces and why they exist

| Piece                           | What it does                                                                | Why it belongs there                                                                          |
| ------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `app/studio/page.tsx`           | Declares the static route and renders Studio                                | Next.js exports the shell; live creator data is fetched after authentication                  |
| `components/studio.tsx`         | File selection, hashes, upload batches, resume, polling and creator actions | These require browser APIs, events and React state, so this is a client component             |
| `components/studio-preview.tsx` | Loads owner-only playback metadata and manages a player instance            | Player lifecycle stays separate from upload form state                                        |
| `lib/api.ts`                    | Fetches same-origin APIs, sends JSON/binary bodies, handles errors/timeouts | Forms share one predictable network/error implementation                                      |
| `packages/contracts`            | Generated TypeScript schemas from OpenAPI                                   | Backend/frontend field names and nullability are reviewable and type checked                  |
| `packages/player`               | HLS playback, segment integrity, explicit peer opt-in                       | Uploaded videos reuse the existing verified player instead of creating another playback stack |
| `httpapi/uploads.go`            | Validates requests, checks identity, streams chunks, returns bounded errors | HTTP responsibilities stop at durable source/job submission; no long encode runs in a handler |
| `store/uploads.go`              | Upload records, admission, grants, parts, ownership and publication queries | SQL transactions and constraints own authoritative decisions                                  |
| `store/jobs.go`                 | Claims, leases, acceptance, retry/cancel and cleanup accounting             | A process restart must not erase scheduling or authority                                      |
| `httpapi/worker.go`             | One-job executor, FFprobe/FFmpeg calls and output descriptor creation       | CPU-heavy work runs independently of browser request lifetimes                                |
| `httpapi/reconcile.go`          | Expiry, interrupted claims, abandoned files and quota settlement            | Work lost between storage and SQL becomes discoverable and repairable                         |
| `httpapi/media.go`              | Checks accepted generation and visibility, then serves HTTP content/ranges  | A file existing on disk does not make it public                                               |
| Gateway scripts                 | Serve the exported web UI and proxy APIs/media                              | Browser requests stay on one application origin; private media cannot bypass the API          |

These are code responsibilities in one Go service. A Go package named `httpapi` does not imply its worker runs in an HTTP request: `main.go` starts `RunMediaWorker` on a separate goroutine. Splitting that executor/coordinator into its own service is later work, not an accomplished distributed boundary.

## React details used here

`useState` holds values that render: selected file, fields, notices, stored uploads and processing states. A file is a browser `File` object; it is not a string path the Go server can read. `useRef` holds the current transfer's `AbortController` and the preview's video element/player handles without causing renders.

`useEffect` loads/polls creator state and tears down timers/players on route departure. `useCallback` keeps the refresh function stable for the polling effect. Uploading and publication have separate controls: the upload bar reports acknowledged source bytes, while processing progress reports completed pipeline stages. It does not measure the exact percentage of FFmpeg frames encoded.

The browser hashes one 8 MiB slice at a time with Web Crypto. This avoids reading a 250 MiB source into one large buffer. Up to three uploads run concurrently; `Promise.allSettled` waits for the whole batch, including successes when another request fails. A network failure does not erase a chunk another request already stored.

The setup idempotency key and a JSON description of its request may be stored in localStorage to survive an ambiguous create response. They are scoped to the signed-in user. File bytes, login credentials and temporary part tokens are not stored there. An upload itself remains discoverable from the database even without browser storage.

Metadata forms carry a revision. Polling can refresh the library without replacing the edit form you are typing in. A stale save receives 409; the form keeps your text and offers **Reload saved details**. Save/discard/reload are explicit decisions.

The studio retains the graphite/lime theme, local fonts, responsive layout and useful product copy. It shows actual server records, not pretend engagement or placeholder published videos. The current library lists the latest 30 owned uploads; direct upload IDs remain accessible through the API.
