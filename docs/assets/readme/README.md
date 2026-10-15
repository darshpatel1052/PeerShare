# README artwork and motion

PeerShare's README uses original vector artwork, actual application captures and two GIFs. Assets are committed with the repository and do not depend on a generated-banner service.

| Asset                                             | Source and purpose                                                                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `hero-light.svg`, `hero-dark.svg`                 | Custom PeerShare wordmark composition and illustrative playback routes                                                                          |
| `architecture-light.svg`, `architecture-dark.svg` | The actual logical service topology, storage ownership and deployment/tooling context                                                           |
| `benchmarks-light.svg`, `benchmarks-dark.svg`     | Catalogue figures taken from the preserved benchmark report, with workload conditions inside the image                                          |
| `peer-delivery.svg`                               | Editable animated vector source for the conceptual fragment-delivery illustration                                                               |
| `peer-delivery-static.svg`                        | Static alternative for reduced-motion readers                                                                                                   |
| `peer-delivery.gif`                               | Four-second loop rendered from the vector source; illustrates the protocol, not live traffic or measured savings                                |
| `product-tour.gif`                                | Approximately nineteen seconds captured from the actual local application: browse, search, play, inspect connection details and visit a creator |
| `studio.png`, `player.png`                        | Actual local creator and public watch pages using the editorial showcase                                                                        |
| `capture.json`                                    | Browser, viewport, source video and recording scope; no session credentials                                                                     |

Dark/light diagrams use GitHub's supported `<picture>` pattern. The main motion images provide static alternatives with `prefers-reduced-motion`. GitHub documents that SVG animation is unsupported, so the README embeds GIF for motion while keeping editable SVG sources. [GitHub image formats](https://docs.github.com/en/repositories/working-with-files/using-files/working-with-non-code-files), [theme-aware pictures](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#images).

## Regenerate

With the normal repository dependencies installed:

```sh
python3 scripts/readme-visuals.py
node scripts/readme-motion.mjs
```

The motion renderer requires the existing Playwright Chromium installation and FFmpeg. It generates ignored preview PNGs and animation frames under `.local/readme`, then writes the delivery GIF to this folder. The SVGs are self-contained: no remote fonts, scripts, trackers or embedded screenshots.

To recapture the product tour, start the populated normal local app at port 3000, then run:

```sh
node scripts/readme-motion.mjs tour
```

The tour only browses public local pages. It creates no accounts and publishes no content. Its caption strip identifies the walkthrough. It is a product recording, not a performance measurement; zero peer bytes in an anonymous single-browser recording are left unchanged. The separate conceptual animation explains peer delivery, while real measured exchanges remain in the benchmark evidence.

The Studio still was captured using an existing local editorial creator session; no credentials are embedded. The README also reuses the earlier recorded dark/mobile screenshots from `docs/evidence/phase-6/peershare-product` instead of duplicating them.
