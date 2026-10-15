# From working screens to a usable product

This pass refines the real publishing/viewing application. It uses the existing catalogue, ownership rules, upload API, processing pipeline, sessions and creator artwork. It adds no invented popularity numbers, decorative feature switches or synthetic content to the normal database.

## Layout, hierarchy and typography

Explore separates its feed from a quieter discovery column. The video is the primary content; channel links and the library sit beside it on desktop and below it on phones. The channel list is deduplicated from the videos actually loaded in this feed. It is not a platform-wide recommendation engine. Search uses the existing server-side query and cursor API; search results return to a straightforward grid rather than promoting the first match as a featured film.

The previous large condensed headings became smaller Manrope headings. This face already serves interface text, so the page hierarchy now comes from weight, size and spacing rather than a second display style. Barlow remains available for existing decorative identity compositions. Fonts remain locally hosted with their licenses.

The graphite palette has a subtle green undertone, warm text and a single lime action colour. Shared CSS variables still drive dark/light surfaces, separators and focus outlines. Thumbnails now retain the creator's original colour instead of a saturation/brightness filter. Their 16:9 boxes reserve space before loading. Only the lead thumbnail loads eagerly; ordinary cards use native lazy loading and asynchronous image decoding.

Publication dates come from `Video.published_at`. The HD badge appears only when a processed rendition is at least 720p. The card no longer displays decorative “On screen” / “Latest release” labels or a separate chip for every rendition. All available qualities remain selectable in the player. The skeleton represents a pending request, with reduced-motion support and a screen-reader status; it never represents a pretend video.

## A file picker that belongs to the upload flow

`Studio` keeps the chosen `File` in React state. A native file input supports the device picker and keyboard access. Dropping a file calls the same selection function; the drop zone shows the filename and actual size. The browser can check the filename and declared length early, while Go/FFprobe remain responsible for validating the real source.

A drop does not initiate a network request. The creator can review the title, description and tags, then choose **Start upload**. The existing upload path hashes chunks, creates a persisted upload session, obtains short-lived part permissions and sends bounded batches. No file bytes enter localStorage. Leaving the page pauses the transfer; resuming requires the original file so stored chunk hashes can be reconciled.

The three summary cards filter the recent upload collection into Published, Drafts and Unpublished. They derive counts from the same records as the library filters. Studio currently loads the latest 30 upload sessions; these are recent-list counts, not lifetime channel totals. Distinct accessible names distinguish summary shortcuts from the filter controls.

## Preservation and verification

Before upgrading the normal containers, the implementation recorded the original published video's manifest, integrity descriptor, thumbnail and channel banner hashes, plus available authentication methods. After the upgrade every hash matched, the channel/video IDs remained present and Google remained enabled. These checks read the ordinary public endpoints; no private credentials appear in the public evidence.

The existing production-browser suite exercised identity, Google availability/linking, settings, search, subscriptions, playlists, analytics, uploads, media controls and actual peer delivery. The first run passed 24/25 cases. Its one failure exposed duplicate accessible names between new Studio shortcuts and the existing filters. After giving the shortcuts distinct names, the actual upload/preview/publish/quality/unpublish/delete journey passed again. There was no need to rerun the unrelated failure matrix.

The in-app-browser walkthrough also opened the normal user's original video and exercised Play/Pause through the preserved media path. Desktop screenshots use that original channel/video. The mobile screenshots use the explicitly generated fixture in the isolated browser environment; they do not represent extra normal catalogue content.

## Read and change the code yourself

- `apps/web/components/video-list.tsx`: trace a `Video` from the typed API result into its card, date, channel links and responsive discovery layout.
- `apps/web/components/studio.tsx`: follow a file-selection event into React state, then follow **Start upload** into chunk hashing and the API. Explain why a drag event alone must not submit the form.
- `apps/web/app/globals.css`: change one semantic token and inspect both themes. Then follow the two-column discovery grid through its tablet/phone breakpoints.
- `apps/web/components/video-player.tsx`: inspect the existing media-element events behind Play, Pause, Seek, Volume and Fullscreen. Styling does not replace the video element's state.

Try the interface with a keyboard, then with a narrow viewport. Compare a request's loading state, an empty response and a failed response: those represent different facts and need different actions.

The final visual pass also keeps the processing-state badge on one line on phones, uses the correct singular/plural video label, and updates the completion notice when the submitted video becomes ready. A successful transfer and a prepared video are different states; the notice now reflects that distinction. The publishing journey passed again with the normal operator profile running after its Prometheus/test-RPC port collision was corrected.
