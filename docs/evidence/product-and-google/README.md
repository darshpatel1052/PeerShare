# Product and Google identity verification

Recorded 14 October 2026. Read the [product implementation guide](../../learning/product-and-google/01-product-experience.md) and [Google identity/setup guide](../../learning/product-and-google/02-google-sign-in.md) alongside this report.

## Environments and what the evidence means

Browser tests use the production Next.js static export on port 3100, the real Go API, isolated PostgreSQL/Redis, local FFmpeg processing, and Chromium. Go integration tests run against a separate disposable database/cache with the race detector enabled. Their cleanup removes only `peerscreen-test` resources. The normal application's accounts, media volumes, and uploaded source are retained.

Google tests use a disposable local OAuth token endpoint and JWKS endpoint. Tokens contain real RSA signatures; the application calls the maintained OIDC verifier. This verifies cryptographic and database behavior without substituting a fake successful login. No real Google credentials were configured at the original checkpoint. Browser tests explicitly distinguish controlled availability responses from actual provider authentication.

The configuration follow-up now loads the creator's credentials from the ignored `.local/local.env` file. The normal API reports Google enabled and the account page's Google button is enabled. **A real Google login remains unverified:** automatic approval review blocked initiating external authentication without authorization for a Google account. The follow-up record contains only configuration booleans and public callback information, not credential values.

## Product behavior verified

| Behavior                     | Evidence and implication                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Workspace menu and Settings  | Browser opens Settings from Workspace, dismisses the menu with Escape, and finds no header theme control                       |
| Appearance persistence       | Light/Dark selection survives reload; every route uses the global provider                                                     |
| Creator banner               | Real JPG upload, visible image on channel, persisted revision and API recreation, owner denial for another account             |
| Thumbnail                    | Real upload from Studio; private before publish; selected URL used as the public player's poster; hidden again after unpublish |
| Draft organization           | Publish removes the record from Drafts; unpublish appears under Unpublished and leaves Drafts empty                            |
| Draft deletion               | Confirmation removes the record from Studio immediately; subsequent ownership queries do not return it                         |
| Custom controls              | Native controls are disabled; play/pause, seek, keyboard shortcuts, volume/mute, fullscreen, and phone seek work               |
| Existing playback guarantees | Five peer/browser scenarios still verify real transfer, corrupted-byte rejection, HTTP fallback, swarm separation and cleanup  |
| Normal product data          | Generated operator media is absent from the normal catalogue and watch endpoint; isolated playback tests can opt in            |

Image tests additionally reject SVG, oversized compressed bodies, images above six million pixels, cross-origin writes, stale revisions, and other-owner changes. They verify JPEG normalization, visibility after resetting an image, physical cleanup of retired files, and release of artwork accounting.

## Google identity behavior verified

| Behavior                                                    | Why it matters                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Successful signed login                                     | Creates a local user without a synthetic password and issues the existing session    |
| Stable subject, changed provider email                      | Retains the local user ID, primary email, and channel ownership                      |
| Existing account email collision                            | Requires explicit connection; does not merge accounts by email                       |
| Password-confirmed connection                               | Keeps the original channel and user, with both password and Google methods available |
| Identity already owned elsewhere                            | Refuses reassignment to another PeerScreen account                                   |
| Revoked pending connection session                          | Fails when the password-confirmed session was logged out/revoked                     |
| Wrong signature / issuer / audience / nonce                 | Rejects the token before creating a local identity or session                        |
| Expired or future-issued token                              | Rejects invalid validity timing                                                      |
| Unverified email / empty subject / invalid authorized party | Rejects incomplete or unsuitable identity claims                                     |
| Missing ID token / failed token exchange                    | Gives a recoverable result without leaking provider errors                           |
| Missing browser cookie / expired state / cancellation       | Does not exchange a code for an unbound or invalid flow                              |
| Callback replay                                             | A consumed flow cannot be used again                                                 |
| Eight concurrent flow consumers                             | Exactly one consumes the database record                                             |
| Eight concurrent admissions of one subject                  | Produces one user and one provider identity                                          |
| Registration disabled                                       | Existing connected accounts can sign in; new Google accounts remain blocked          |
| Logout everywhere                                           | Revokes Google-created PeerScreen sessions through the existing mechanism            |
| Logging                                                     | State, nonce, access token and client secret values are absent from request logs     |

## Files to inspect

- `product-browser-checkpoint.json` records the first product checkpoint's affected rerun and its earlier failures honestly.
- `product-go-checkpoint.json` records backend checks at that checkpoint.
- `final-browser.json` lists every final browser scenario and result.
- `final-go.json` lists named Go results, including security subcases, without credentials or token contents.
- `source-fingerprints.json` binds those final results to the relevant source files through SHA-256 hashes.
- `local-preservation.json` records read-only checks of the original channel/video after rebuilding the normal application, plus an actual custom-control playback check.
- `google-configuration-fix.json` records the shared-file credential fix, enabled normal runtime, cleared test runtime, eight passing unit tests, and the boundary on live Google verification.
- PNG screenshots show desktop/mobile channel, workspace, player and Settings layouts using disposable test creators. The real local creator's email and credentials are not included in these screenshots.

Formatting, TypeScript checking, the five segment-integrity unit tests, contract generation comparison, Go vet, and production frontend builds passed. The containerized local application rebuilt successfully and its health checks passed.

## Checkpoint history

The creator UI/artwork checkpoint is `5734627`. Its [GitHub Actions run](https://github.com/darshpatel1052/Peer-Screen/actions/runs/38451510528) passed, including database integration, production browser testing, metadata recovery and actual interrupted-media recovery. Final Google changes are committed as the next checkpoint; the final response links its resulting CI run.

The first full product browser run had 15 passes and two failures: a successful banner save lost its feedback while an account refresh replaced the form, and an old deletion assertion expected retired empty-state wording. The refresh was fixed to retain the component, the assertion was updated, and the affected journeys passed. A later full suite passed all 19 scenarios. Final catalogue/privacy changes and the explicit custom-poster assertion are also covered by the final rerun.

## Remaining boundary

This evidence covers the local implementation, the signed-provider integration fixture, and local credential loading. The creator has supplied OAuth credentials; live Google still needs an authorized real consent/sign-in check. Public HTTPS deployment, public admission policy, account recovery, and future media renditions remain separate roadmap work.
