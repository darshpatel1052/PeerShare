# PeerScreen

A video publishing application with opt-in peer-assisted delivery and reliable HTTP fallback. The project is being implemented in verified milestones from the [project brief](docs/project-brief.md).

**Current work: milestone 0, media compatibility.** Accounts, upload, distributed processing and AWS deployment are subsequent phases. The visible video is a generated test fixture.

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
