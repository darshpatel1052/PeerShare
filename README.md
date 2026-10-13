# PeerScreen

A video publishing application with opt-in peer-assisted delivery and reliable HTTP fallback. The project is being implemented in verified milestones from the [project brief](docs/project-brief.md).

**Milestone 0 is complete for local Chromium compatibility.** The production frontend plays real HLS, transfers verified media through opted-in peers, and recovers through HTTP. Accounts, uploads, distributed processing and AWS deployment are subsequent phases. The visible video is a generated test fixture.

## Prerequisites

- Node.js 22.18+ (22.x), npm 10+
- FFmpeg / FFprobe with libx264 and AAC (verified locally with 6.1.1)
- Chromium installed through Playwright for browser checks

## Local commands

```sh
npm ci
npm run fixture
npm run web-build
npm run demo
```

Open `http://localhost:3000`. The demo serves the production export and a local compatible tracker. Stop it before using `npm run dev`, which starts the media origin, tracker and frontend with hot reload.

```sh
npx playwright install chromium --only-shell
npm run check
npm run test:browser
```

See [progress](docs/progress.md) and the [brief](docs/project-brief.md) for scope and next steps. Checkpoint commits are created after meaningful validated changes.

## Try peer delivery

Open the same watch video in three separate browser profiles/windows, choose 360p, and enable **Help share this video** in each. An incognito profile plus a normal profile provide separate contexts; multiple incognito windows can share a context. Overlapping playback and cached segments improve the chance of sharing. The details panel shows verified received media bytes by source and uploaded peer payload separately. Peers and network conditions can prevent sharing; HTTP stays available.

Sharing starts off. Opting in spends upload bandwidth and exposes network addresses to connected peers. Turning it off closes peer connections and keeps HTTP playback. The proof uses loopback networking, a local tracker and no external STUN. Public deployment requires HTTPS/WSS, network testing and the controls in the brief.

## Evidence and decisions

- [Milestone 0 results and raw evidence](docs/evidence/milestone-0.md)
- [Static hosting, validation, event semantics and browser limits](docs/adr/0001-static-export-and-verified-peer-delivery.md)
- [Dependency audit finding](docs/progress.md#dependency-finding)

To reproduce the separate-origin check, build with `NEXT_PUBLIC_MEDIA_BASE_URL=http://localhost:3001/fixture/` and run the browser suite. Rebuild without the variable to return to the default same-origin export. The demo serves both media routes. CI creates a production export, generates its own fixture, and runs the full browser checks.
