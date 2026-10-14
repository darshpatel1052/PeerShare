# Build and understand the viewer experience

Start by using the product: sign in, follow a creator, save two videos, reorder their playlist and choose Play playlist. This chapter maps those actions to the code. The data model and API methods are explained in [the library chapter](01-library-and-search.md).

## Components have jobs

| File under `apps/web/`          | What it does                                             | Why it is separate                                   |
| ------------------------------- | -------------------------------------------------------- | ---------------------------------------------------- |
| `components/navigation.tsx`     | Explore, Following, Library and the Workspace menu       | One navigation model across routes                   |
| `components/follow-button.tsx`  | Load and change the viewer/channel relationship          | Reusable on channels and watch pages                 |
| `components/following.tsx`      | Account gate plus following-scoped catalogue             | Reuses catalogue presentation and search             |
| `components/video-list.tsx`     | Debounced server search and cursor results               | Keeps fetching, pagination and empty states together |
| `components/library.tsx`        | Owned playlists, followed channels and playlist creation | Viewer collections have their own screen             |
| `components/save-video.tsx`     | Choose an owned playlist from the watch page             | The player does not need playlist mutation logic     |
| `components/playlist.tsx`       | Read, edit, reorder, remove and share a collection       | One revision-aware collection editor                 |
| `components/playlist-queue.tsx` | Current video and upcoming visible videos                | Queue presentation stays independent of playback     |
| `components/watch.tsx`          | Compose player, creator, Save and queue; advance on end  | One page coordinates the separate features           |
| `components/analytics.tsx`      | Render actual creator totals and video comparisons       | Calculation/permission stays in Go                   |
| `lib/playback-capture.ts`       | Observe media and report a logical watch visit           | Reconnecting the player does not reset watch totals  |

## React state, effects and resource identity

`useState` holds information that changes what a component renders: typed search text, edit fields, button state and loaded collections. `useRef` holds a mutable object that should survive renders without causing a new render: player handles, video elements, resume position and the capture object. An effect connects React to an external system and returns cleanup to disconnect it.

The watch effect creates a player and destroys it on a video change, sharing change or unmount. An `AbortController` prevents an old initialization callback from acting after its connection was replaced. A separate capture effect has the lifetime of the accepted video metadata. These lifetimes express the actual product: the viewer can reconnect delivery while continuing the same watch visit.

`useResource` remembers the path associated with its state. When the path changes, it presents loading instead of briefly reusing the previous resource as the new one. This matters for both search and navigation: a result for one video/query belongs to that identity. Search also scopes its collected pages by channel, following choice and normalized query.

The search input remains mounted while fetching and when there are zero results. A loading state can replace result cards without removing the control the viewer is using. The same principle applies to a failed player: an existing sharing choice remains editable so opt-out always works.

## Search is a server feature

Typing changes `query` immediately. A 250 ms debounce sets the submitted `search` value and resets the cursor. `URLSearchParams` builds a correctly encoded request. PostgreSQL applies text/creator search, visibility and the Following filter **before** pagination. The browser does not filter only the twelve cards already downloaded.

The implementation matches normalized words/phrases in titles, tags and descriptions, plus a literal creator-name/handle match. It does not implement spelling correction or arbitrary prefixes. An empty result is useful feedback, not a reason to hide the input. A separate full-text service is unnecessary for this local catalogue.

## Forms and requests express user intent

A playlist starts private. Creation retains one request UUID and its normalized input until the server outcome is known. If a response disappears, retrying the same body/key resolves that original request instead of creating another playlist. If the viewer changes the form after an ambiguous response, **Check previous request** resolves the original operation first. This is visible form state rather than hidden automatic duplication.

Edits use the playlist revision. A stale edit produces a conflict and preserves the form; the user can reload the server version and decide what to apply. Move Up/Down sends the complete video-ID ordering, which Go validates and commits atomically. A playlist cannot grant access to an unpublished video. Owners can see and remove an unavailable slot; public viewers receive only currently visible entries.

The thumbnail review fix follows the same identity rule. A response for video A merges into an editor only while its selected upload ID is still A. Switching to B does not prevent A's save from succeeding; it prevents A's callback from changing B's preview or revision. Reload-details uses that check too.

## URLs and playlist playback

The frontend exports fixed pages with client-fetched API data. `/playlist?id=UUID` identifies a collection. `/watch?v=UUID&playlist=UUID&autoplay=1` identifies both the video and queue context. The installed Next.js static-export model does not render arbitrary user UUID paths on demand, so query parameters provide direct links and reloads with the fixed export. Query-reading client pages use Suspense.

Play playlist selects the first available entry. The watch page listens to the video element's actual `ended` event and navigates to the next visible entry. It attempts playback once for the new video and handles a browser's blocked-autoplay rejection. Queue context survives the URL transition. Removing or unpublishing an item changes what the next playlist read can expose.

## Product styling and feedback

The new screens share existing CSS variables, local typography, buttons, avatars and SVG icons. Playlist covers use actual video artwork when available; empty collections use a neutral icon. Analytics uses real empty states, an accessible table and compact delivery comparison. Desktop and mobile layouts use the same content model, rather than separate data flows. Appearance remains inside Workspace Settings.

Keep implementation details in expandable diagnostics or the learning guide. Normal actions should use words like Follow, Save, Play playlist and Edit details. The user should not need to understand a generation ID to watch a film.

## Hands-on exercises

1. **Follow:** create a second account in another browser profile. Follow your creator and inspect the GET/POST subscription requests. Find the composite primary key in migration 0007. Explain why clicking Follow twice cannot create two relationships.
2. **Search:** publish two videos with different titles/tags. Search for the older one. Change the request's page limit in your developer tools and observe that the result still comes from the server. Trace `video-list.tsx` through `SearchVideos` to its SQL filter.
3. **Playlist:** create a private list, save both videos, reorder them and reload. Change it to public and open the link in a guest profile. Find the parent row lock and revision check in `MutatePlaylist`. Explain why order and privacy are database concerns as well as UI controls.
4. **Playback:** choose Play playlist. Find the `ended` listener in `watch.tsx`; follow the URL change and effect cleanup. Add a temporary console message locally if helpful, then remove it before committing.
5. **Analytics:** watch one of your films, pause, and compare its creator totals with the downloaded playback report. Identify `StartupMS *int64` in Go and explain the difference between zero and unknown.
6. **Make a small feature:** add a description field to playlists as an exercise. First model its length/default in a **new migration**, then update Go input/output types, OpenAPI, generated TypeScript and the edit form. Do not change a migration already applied to your database. Verify saving, reload and public reading, then make a checkpoint commit.

For each feature, be able to answer: what state does the browser own, what rule does Go enforce, what relationship does SQL store, and what happens after a reload? Those answers demonstrate hands-on engineering better than reciting a list of failure tests.
