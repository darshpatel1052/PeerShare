# Creator experience: data, APIs, components, and playback

Prepared 14 October 2026. This change continues the completed local Phase 2 foundation.

## What you can now do

- Open **Workspace → Settings → Appearance** to choose Dark or Light. The choice belongs to this device and survives a reload.
- Open **Workspace → Channel & account** to upload a JPG/PNG channel banner or restore the default. The default contains no PeerScreen lettering.
- Open **Studio → Edit details** on a video to choose its thumbnail. Save the image separately from the title, description, and tags. **Use video frame** restores the frame generated from the video.
- Use **All videos**, **Drafts**, **Published**, and **Unpublished** to organize the library. **Delete draft** removes an unwanted draft after confirmation.
- Play videos with PeerScreen's own controls. Space/K plays or pauses when the player frame has focus; left/right seeks five seconds; M mutes; F opens fullscreen. The sliders and buttons also work with keyboard focus and pointer/touch input.

Unpublishing hides a video from viewers and moves it to **Unpublished**. It does not erase your source. Deleting is the explicit action that removes it from Studio and schedules storage cleanup. This is deliberately separate because creators often take a video offline and publish it again later.

## The two state machines already in our model

A video's **processing state** answers whether the uploaded bytes are usable: pending → processing → ready, or failed/cancelled. Its **publication state** answers who may see it: draft → published → unpublished → published. They are separate columns because a video can be ready and private, or ready and public. The existing PostgreSQL constraint prevents publishing an unfinished video.

The UI previously put all these videos in one list. The filters now use the actual `publication_state`, so an unpublished video cannot accidentally appear under Drafts. There is no second copy of that video in the database. The views are filters over the same records. Deleted rows retain tombstones for worker fencing and cleanup, but the ownership query excludes them immediately.

## Why artwork has its own data model

The worker's accepted generation identifies a particular, immutable set of HLS files and segment hashes. A custom thumbnail is editorial metadata. Mixing those concepts would either force reprocessing when changing a cover image or silently mutate files identified by an old accepted generation.

Migration `0004_creator_images.sql` therefore adds:

| Record                      | Meaning                                        |
| --------------------------- | ---------------------------------------------- |
| `creator_images.id`         | Random UUID for one immutable normalized JPEG  |
| `owner_id`                  | PeerScreen user who uploaded it                |
| `byte_length`               | Exact stored size used for the artwork budget  |
| `created_at`                | Used when safely removing retired artwork      |
| `channels.banner_image_id`  | Nullable foreign key to the selected banner    |
| `videos.thumbnail_image_id` | Nullable foreign key to the selected thumbnail |

A nullable foreign key means “use the default” when absent. PostgreSQL enforces that a selected image really exists. The generated video thumbnail remains in `thumbnail_key`; a selected creator image takes precedence when the API computes `thumbnail_url`. Playback generations and integrity descriptors do not change.

We add a migration instead of editing older migrations. Existing databases remember each applied migration's checksum. Editing an applied file would make the next startup reject the altered history.

## What happens when you save an image

1. React keeps the chosen `File` in component state and uses `URL.createObjectURL` for a local preview. Its effect revokes the old preview URL when the file changes or the component unmounts. File bytes never go into localStorage.
2. The browser sends a binary PUT request with the session cookie, the exact application Origin, and an `If-Match` header containing the current resource revision.
3. The gateway allows a 5 MiB body only on these image endpoints. Ordinary JSON endpoints retain their 16 KiB limit; multipart video chunks retain their separate 8 MiB limit.
4. Go checks the authenticated owner before decoding. `http.MaxBytesReader` limits compressed bytes. `image.DecodeConfig` reads dimensions before allocating a full image; only JPEG/PNG, at most six million pixels, are accepted.
5. Go decodes and resizes with `golang.org/x/image/draw`'s Catmull-Rom filter. It composites transparency onto white and writes a fresh JPEG. Banners fit within 1920 × 640; thumbnails within 1280 × 720, preserving aspect ratio. The UI uses `object-fit: cover` for its display crop. The stored JPEG must be at most 1 MiB.
6. The JPEG receives a new UUID filename. Go writes and syncs it, then syncs its directory before committing the database reference. A transaction checks ownership and revision again, accounts for storage, inserts the image, updates the foreign key, and increments the revision.
7. The UI reloads the current revision. This prevents a later title edit from accidentally using the revision from before the image change.

Input metadata and executable SVG content are not carried into the newly encoded JPEG. The image concurrency slot is a buffered Go channel of capacity one: sending claims the slot, deferred receiving releases it. It bounds decoding memory rather than letting many large images allocate simultaneously.

The artwork budget is 64 MiB globally, within the existing platform allowance. Its admission uses the same transaction advisory lock as upload admission, so simultaneous saves cannot each reserve the same remaining space. Old image rows stay accounted for until cleanup succeeds.

## These APIs and why they exist

| Method and endpoint                    | Purpose                                                     |
| -------------------------------------- | ----------------------------------------------------------- |
| `PUT /api/v1/channels/{id}/banner`     | Owner selects a validated banner using the current revision |
| `DELETE /api/v1/channels/{id}/banner`  | Owner restores the default banner                           |
| `PUT /api/v1/videos/{id}/thumbnail`    | Owner selects a validated thumbnail, including for a draft  |
| `DELETE /api/v1/videos/{id}/thumbnail` | Owner restores the generated video frame                    |
| `GET /api/v1/images/{id}`              | Serves currently selected artwork after visibility checks   |

A banner is public because its channel is public. A video thumbnail follows the video's privacy: public when published, otherwise accessible only to its owner. Image responses use `no-store` so taking a video offline does not leave a browser cache serving its old thumbnail. A retired image URL returns 404 immediately, even before disk cleanup.

Reconciliation removes unreferenced images after the same ten-minute grace period used for interrupted media writes. It checks both database rows and orphan files, so a crash between filesystem and database steps can be repaired later. The grace period protects an upload that has written its file but has not committed its reference yet.

## The React components and their responsibilities

| Component                 | Responsibility                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `Navigation`              | Workspace disclosure menu, outside-click/Escape dismissal, account links and real logout |
| `ThemeProvider`           | Applies the saved device preference on every route                                       |
| `AppearanceSettings`      | Changes that preference in Settings                                                      |
| `ChannelCover`            | Displays the selected image or a quiet CSS default                                       |
| `CreatorImagePicker`      | Preview, bounded upload, save/reset and local feedback for both image kinds              |
| `Studio`                  | Existing resumable upload workflow plus separate publication views and explicit deletion |
| `VideoPlayer`             | Product controls and browser media events                                                |
| `Watch` / `StudioPreview` | Connect metadata and the existing streaming engine to the player element                 |

`useState` holds what React renders. `useRef` holds the actual video element, menu element, timers, or abort controller without scheduling a render each time it changes. `useEffect` installs listeners or starts a streaming engine after DOM creation, then returns cleanup to remove listeners, cancel requests, and destroy the player. These distinctions matter: leaving old player listeners or peer engines alive would waste bandwidth after a route change.

## What the custom player changes

The HTML `<video>` element still performs decoding, timing, buffering, and audio playback. Its native `controls` attribute is removed; the new controls call `play()`, `pause()`, set `currentTime`, `volume`, and `muted`, and use the browser fullscreen API. The UI listens to media events rather than guessing playback state from button clicks.

The underlying `@peerscreen/player` package still loads HLS, verifies segment hashes, provides quality selection, collects delivery counters, and cleans up peer connections. Peer sharing still requires the viewer's opt-in. Draft previews remain authenticated and do not share with peers. A prettier control surface does not justify weakening those behaviors.

## Evidence and limits

The verification report and screenshots are in `docs/evidence/product-and-google`. The browser journeys use the production static export with a real Go API, PostgreSQL, Redis, FFmpeg processing, and disposable users. The existing local creator account and uploaded video are preserved.

The generated operator test film is excluded from the normal catalogue and watch endpoint. Isolated test scripts set `EXPOSE_OPERATOR_FIXTURE=true` to exercise the same playback code with that known source. Production configuration rejects that flag. Stored test files are retained; creator records are not changed.

This is local product functionality. Public storage, admission policy, adaptive renditions, captions, and deployment remain their own roadmap work. A browser already buffering a previously public video cannot have those bytes taken back; unpublishing blocks subsequent server requests.
