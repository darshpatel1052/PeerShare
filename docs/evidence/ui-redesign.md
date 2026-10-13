# Product UI redesign: evidence and scope

The user prioritized a complete interface redesign before upload work. The checkpoint replaces the previous demo presentation with a shared graphite/lime identity, locally served typography, a branded channel cover, media-led catalogue, creator workspace and focused playback page. The old footer sentence and development banners were removed. Product controls use the existing API and real catalogue data.

[Learning notes](../learning/ui-design.md) explain the choices, CSS variables, reusable components, client state, keyboard behavior and boundaries.

## Source and environment

The baseline commit was `6e6f208252834cc6316cb68354a14d2cc5627225`. Verification ran on the subsequent working tree before the UI checkpoint commit. [Source hashes and container image IDs](ui-redesign/source.json) preserve that distinction. The existing Go API, SQL schema and media-player implementation were unchanged. Historical Phase 0/1 evidence was retained.

Local versions: Node 22.23.3, Next.js 16.4.0, React 19.3.0, TypeScript 7.0.2, Playwright 1.64.0 and Chromium 156.0.8078.4. Font files and licenses are bundled in `apps/web/public/fonts`; no runtime font-provider request is needed. The normal PostgreSQL volume and the user's existing channel were preserved throughout preview updates.

## Verification results

| Check                            | Procedure                                                                            | Observed result                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Production export                | Build the real Next.js application                                                   | All account/channel/watch/home routes exported successfully                                 |
| Formatting/types/integrity units | Run `npm run check`                                                                  | Passed; all 5 existing integrity unit cases passed                                          |
| Full production-browser suite    | Serve the export with Go and isolated PostgreSQL/Redis                               | **13 passed**, 0 skipped/unexpected/flaky; **83.798 seconds**                               |
| Design controls                  | Load fonts, search/clear, switch theme, reload, use channel tools                    | Passed; [behavior record](ui-redesign/design-behavior.json)                                 |
| Desktop/phone width              | Capture 1365×900, 390×844 and 320×700 viewports                                      | No horizontal document overflow in the captured cases                                       |
| Full local app containers        | Rebuild the web image and start the app profile                                      | PostgreSQL, Redis, API and web healthy; [image/state record](ui-redesign/source.json)       |
| Container API/playback smoke     | Readiness, anonymous identity, wrong credentials/Origin, real catalogue and playback | Passed; [request/playback observations](ui-redesign/container-smoke.json)                   |
| In-app preview                   | Inspect the actual user's channel and both themes; reopen after switching servers    | Final production channel visible with its original metadata and authenticated owner actions |

The [complete browser report](ui-redesign/browser-results.json) retains named cases, statuses, timings and attachments. The CI workflow runs the updated browser suite independently on pushed revisions; GitHub Actions is the source of truth for its remote result.

## New behavior case: exact journey

The new case uses a synthetic creator in the separate disposable test database. It does not change a real user account. Its assertions verify:

1. Manrope and Barlow Condensed are loaded through the production server.
2. A non-matching catalogue query shows the empty-search state; clearing it restores the actual published video.
3. Switching to light updates the document theme, and reloading preserves it. Switching back restores dark.
4. Registration/channel creation through the real API yields an owner-visible settings action.
5. Videos/About selection works with clicks. ArrowRight and Home change selection using the tab controls.
6. Share channel reports success after writing a canonical same-origin URL whose `id` matches the persisted channel UUID.
7. An unsaved title updates the channel appearance preview without claiming a completed database save.
8. Connection details start collapsed on the watch page.
9. The captured desktop/phone pages fit their document width.

Original cookie values, generated passwords and database/cache credentials are excluded from saved records. The clipboard read occurs inside the isolated automated browser context, not against the human user's clipboard. Search currently filters loaded videos; it does not claim backend full-text coverage.

## Existing behavior retained

The other twelve cases still exercise direct routes/reload, HTTP playback/seek/quality, media MIME/CORS, missing-resource/integrity retry, registration/login/logout, ownership rejection, stale-edit preservation and controlled HTTP-error recovery. Real peer-transfer, corruption rejection, opt-out/unmount cleanup, unavailable tracker and media-version separation also passed.

The account journey retains the same channel UUID after reload/login and advances its revision on save: [actual journey](ui-redesign/identity-journey.json). The redesigned interface does not replace server authorization with visibility of an Edit button.

[Peer measurements](ui-redesign/peer-delivery-evidence.json) and [corruption observations](ui-redesign/tamper-evidence.json) come from the same final run. Counters remain completed verified media payload, not total network traffic or billing/offload claims. Media tests explicitly open Connection details before reading counters, so collapsing the interface did not remove the existing proof.

## Visual captures

These are actual production-export screenshots. The channel named Field Notes is synthetic test data stored in real isolated PostgreSQL, not a fabricated public creator/catalogue.

- [Channel desktop](ui-redesign/channel-desktop.png), [phone](ui-redesign/channel-mobile.png), [light theme](ui-redesign/channel-light.png).
- [Explore desktop](ui-redesign/explore-desktop.png), [phone](ui-redesign/explore-mobile.png).
- [Sign-in desktop](ui-redesign/sign-in-desktop.png).
- [Watch desktop](ui-redesign/watch-desktop.png).

The test also captures workspace/sign-in/watch at phone width and the channel at 320px. Those additional images are attached to the Playwright report and reproducible under `.local/screenshots/ui-redesign/`. Desktop and mobile captures were visually inspected for hierarchy, clipping, text entry, contrast and spacing. Current coverage uses Chromium and is not an exhaustive accessibility or cross-browser certification.

## Reproduction

```sh
npm run web-build
npm run check
npm run test:browser
```

Browser tests prepare real disposable dependencies and remove their own test volume afterward. Run integration/browser/recovery runners sequentially because they share the test project name. Normal app data is separate.

For the full persistent preview after generating the fixture:

```sh
npm run compose:demo
node scripts/preview-smoke.mjs containers
```

This host requires `PEERSCREEN_BUILD_NETWORK=host npm run compose:demo` for image-download/build networking. Runtime services stay on the private Compose bridge with loopback host ports. Fonts receive `font/ttf` from the local static gateway.

## Issues found and corrected

The first full run passed twelve cases but the route-departure case had an obsolete selector. The new watch page and footer expose multiple Explore links, and the old homepage slogan was removed. The test now selects the Explore link within Main navigation and waits for the actual Explore heading. The subsequent complete 13-case run passed, including observed closure of the real peer connections.

The in-app preview briefly showed a connection-error page while native development was stopped for the container rebuild. Its old tab's error URL prevented automated reload/cleanup through that binding. A fresh tab to the known healthy localhost channel showed the final production UI and original owner identity. The container smoke independently verified the same server.

## Boundaries

No uploads, processing/publication workflow, fake engagement metrics or third-party video content were added. Publishing remains plainly unavailable where a creator would expect it. Default channel art is shared branding rather than a custom cover-upload feature. Theme preference is applied after hydration, so a completely flash-free initialization is not claimed. Peer consent/integrity and existing authentication limits remain as documented in the earlier phases. No AWS resources were provisioned.
