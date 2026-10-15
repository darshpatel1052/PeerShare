# PeerShare's product interface

This checkpoint gives the existing application one visual identity across Explore, channels, playback, sign-in and the creator workspace. Authentication, ownership, revisions and media integrity still use the Phase 1 mechanisms. The new work changes how users see and operate those capabilities.

## Visual decisions and their purpose

The current PeerShare palette uses warm ivory surfaces and a terracotta action colour in light mode, with charcoal surfaces and a softer coral in dark mode. Different surface levels distinguish the page, panels and controls without putting every element inside a card. Accent colour identifies primary actions, selection and the brand; secondary navigation stays quieter. The light variant changes the same semantic variables rather than duplicating every component's styles.

Manrope is the interface face: labels, navigation, controls and descriptions need a consistent reading rhythm. The final product pass uses Manrope for page headings as well; Barlow Condensed remains in decorative identity compositions. Both typefaces are bundled with their original licenses and served from the app's own public assets. Font loading uses `swap`, so text can render while the font arrives. [Font sources and licenses](../../apps/web/public/fonts/README.md) are recorded beside the binaries.

The PeerShare mark combines a play shape with an incoming sharing stroke. Desktop navigation becomes a fixed side rail, while smaller screens keep a compact top navigation. Creator artwork remains the main visual content. These are code-native vectors: their shapes remain sharp across sizes and do not depend on an image-generation service. The artwork is default branding, not an uploaded creator banner.

Explore gives the actual published video the largest visual area. Its creator, duration, publication date and available qualities come from the API. There are no invented videos, views, followers, popularity rankings or disabled publishing buttons dressed up as working actions. The generated fixture retains its explicit title and provenance in its metadata; it stays out of the normal public catalogue.

## CSS variables: one decision, many components

A variable represents a semantic role such as background, foreground, separator or accent. Components ask for that role rather than choosing a new colour independently:

```css
:root {
  --surface: #191c1d;
}
:root[data-theme="light"] {
  --surface: #ffffff;
}
.settings-panel {
  background: var(--surface);
}
```

Changing the surface token updates every consumer. The foundational component rules live in `apps/web/app/globals.css`. The current product palette, layout and shared surface refinements live in `apps/web/app/product-shell.css`, imported after that foundation. Fixed dark artwork has its own bounded palette, so it stays coherent in both themes. Focus outlines use the accent and remain visible around keyboard-operated controls.

The major layouts use Grid for columns and Flexbox for aligned groups. `minmax(0, 1fr)` and `min-width: 0` allow a column to shrink without forcing the entire page wider. Long names and metadata wrap where appropriate. At narrower widths, multi-column screens stack, navigation gains a second row and less essential side content moves below the primary task. Mobile text-entry fields use 16px type. Reduced-motion preferences disable decorative animations/transitions.

## Reusable components and responsibilities

| File                           | Responsibility                                                          | Why it is shared                                                          |
| ------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `components/ui.tsx`            | Icons, screen mark, initials/avatar, default cover and loading state    | Keeps shape, stroke, naming and state presentation consistent             |
| `components/theme-toggle.tsx`  | Theme preference and light/dark switch                                  | One browser preference applies across every route                         |
| `components/navigation.tsx`    | Main navigation and account/channel destinations                        | Links reflect whether a persisted channel exists                          |
| `components/video-list.tsx`    | API-backed cards, featured layout, bounded pages and loaded-list search | Home and channel pages use the same catalogue data path                   |
| `components/channel.tsx`       | Creator identity, owner settings link, Videos/About tabs and copy link  | Public channel details remain separate from account management            |
| `components/account.tsx`       | Sign-in/registration and the creator workspace                          | Reuses the existing validated mutation and error-preservation flow        |
| `components/watch.tsx`         | Playback, opt-in sharing and connection disclosure                      | Keeps viewing primary while exposing network controls when needed         |
| `components/watch-sidebar.tsx` | Creator destination and sharing explanation                             | Uses real video/channel identity without introducing fake recommendations |

The account preview responds to the draft title/handle as the user types. It previews appearance; saving still requires the existing Go API call. A failed or conflicting request retains the form values. The owner-only settings link derives from `/me`; Go independently enforces ownership when a write arrives.

## Theme state and browser storage

React state updates the icon and accessible button name. An effect reads the saved preference after the component mounts, because `localStorage` exists in the browser rather than during static export. The toggle writes `peershare-theme` (and reads an existing `peerscreen-theme` preference during migration) and changes `document.documentElement.dataset.theme`; CSS selects the corresponding tokens. Storage failures are caught so browsing still works when persistence is unavailable.

This storage value is an appearance preference. Authentication continues to use the HttpOnly cookie and PostgreSQL session lookup; no session token or password was added to browser storage. A persisted light preference is applied after hydration, so this implementation does not claim a completely flash-free theme initialization.

## Working controls and honest scope

Search now runs on the Go API before cursor pagination, across titles, creators and tags. The browser sends a debounced query and replaces the collection when its scope changes. This supersedes the original loaded-page browser filter.

The Videos/About tabs expose selection and a labelled panel. Arrow keys switch tabs; Home/End move to the first/last tab. Only the selected tab participates in the normal Tab order. Share channel copies a canonical public channel URL containing its UUID; an explicit success state follows a completed clipboard write, and failure gives an address-bar fallback. The copy action sends no message to another person.

Connection statistics are collapsed initially. The viewer can open them, inspect the existing byte/peer measurements and still use the sharing control independently. Automated media tests now open the disclosure explicitly before reading its counters. The opt-in checkbox retains its label, default-off behaviour and cleanup/integrity mechanisms.

Development banners, phase commentary, the old footer sentence and the preview explanation panel were removed from product navigation and pages. Publishing availability remains stated plainly where a creator would otherwise expect an upload action. Actual creator-authored metadata and the fixture's honest provenance stay in the data model.

## How the redesign is checked

The new production-browser case verifies font loading, search/clear, theme persistence after reload, owner navigation, keyboard/click tabs, canonical clipboard output, live title preview, collapsed connection details and page width at desktop/phone sizes. Screenshots cover Explore, channel, workspace, playback and sign-in. Its creator is synthetic and exists only in the separate disposable test database.

The existing account, ownership, conflict, HTTP playback, integrity and real peer-delivery cases run with the new interface as well. The [UI evidence report](../evidence/ui-redesign.md) records actual totals, captures and boundaries. Tests and visual inspection complement each other: width assertions catch overflow, while screenshots reveal hierarchy, contrast and spacing. The current checks use Chromium; they do not certify all browsers or an exhaustive accessibility audit.

## Exercises

Change a semantic colour in one place and list the components affected. Explain why an avatar can be rendered on both server and client, while theme persistence needs a client component. Follow an unsaved channel title from the input into the preview and then through the save request. Use a keyboard to move from Videos to About and back. Finally, inspect why the account settings link and the Go ownership check are separate responsibilities.

See the [Phase 6 product pass](phase-6/01-product-finish.md) for the current layout and upload controls.

## Current product components

`Navigation` adapts between the desktop side rail and mobile top navigation. Its account menu exposes settings and the operator workspace only when the current server-provided role allows it. A hidden link is convenience; the Go endpoints independently authorize every operator request.

`VideoList` uses debounced server search and cursor pagination. Topic controls use real tags from the initial returned catalogue; they do not invent popularity or engagement. `WatchSidebar` loads published videos from the current channel for the next-watch list. Public channel data and private playlist data use separate requests and ownership boundaries.

Studio now requests a page from the full server-filtered collection. Its publication totals come from SQL, rather than counting the current 30 rows. Stable creation-time/UUID cursors keep older videos reachable. The editor stays separate from periodically refreshed list metadata, preserving unsaved work. Completing a new upload opens Drafts on the first page with search cleared.

`Operator` shows actual processing jobs, queue states and reserved storage. The existing persisted `operator` user role controls access. Retry and cancel use the same Go job mutation code as creator actions; an audit row with actor, action and note commits in that transaction. A native dialog supplies keyboard focus containment and Escape behavior for confirmations. The screen refreshes every five seconds and retains its last successful result while a refresh is in flight.

The design pass uses semantic CSS tokens across buttons, forms, cards, playlists, settings, creator analytics and playback. Artwork is updated through the same revision-checked image API used by creators. Legacy storage/session identifiers stay compatible with existing users and videos.
