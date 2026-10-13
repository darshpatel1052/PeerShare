# A practical lab: inspect the model, API and lifecycles

Use this chapter after reading the conceptual guides. The commands refer to local project resources. Keep private request/cookie files under ignored `.local`; use a password of your own for a manually created account.

## Start the product

From the repository root:

```sh
npm ci
npm run fixture
npm run web-build
npm run demo
```

The demo prepares real PostgreSQL/Redis, applies migrations/imports the fixture, builds/starts Go, and serves the export at `http://localhost:3000`. It creates random local credentials once. Go 1.27.2, Node 22.x, Docker/Compose and FFmpeg are prerequisites; the Go wrapper downloads the pinned toolchain if needed.

Visit Account, create an account/channel, reload, edit the channel and sign out/in. Open its public URL in another browser context. Expect an empty published-video list for your new channel; the generated lab video belongs to the system fixture channel, not your account.

For hot reload, stop the native demo and use `npm run dev`. For the all-container variant, stop the native processes and run `npm run compose:demo` after generating the fixture. If this machine's default Docker build bridge is unavailable, use `PEERSCREEN_BUILD_NETWORK=host npm run compose:demo`. That override applies to build-time dependency downloads, not runtime host networking.

## Use HTTP directly

Create `.local/registration.json` with this shape, replacing the sample values with a unique local email and your own long passphrase:

```json
{
  "email": "your-unique-demo@example.test",
  "display_name": "Learning creator",
  "password": "replace this with your own demo passphrase"
}
```

Then send it through the web proxy:

```sh
curl --silent --show-error --fail-with-body \
  -H 'Origin: http://localhost:3000' \
  -H 'Content-Type: application/json' \
  --cookie-jar .local/learning.cookies \
  --data-binary @.local/registration.json \
  http://localhost:3000/api/v1/auth/register

curl --silent --show-error --fail-with-body \
  --cookie .local/learning.cookies \
  http://localhost:3000/api/v1/me
```

The response contains account metadata and `channel: null`. The cookie jar contains the original session token and must stay private. The JSON body does not contain that token or password hash. Avoid `curl -v`/header dumps when preparing shareable evidence.

Create `.local/channel.json`:

```json
{
  "handle": "your-unique-learning-handle",
  "title": "My learning channel",
  "description": "Metadata saved by the Go API."
}
```

```sh
curl --silent --show-error --fail-with-body \
  -H 'Origin: http://localhost:3000' \
  -H 'Content-Type: application/json' \
  --cookie .local/learning.cookies \
  --data-binary @.local/channel.json \
  http://localhost:3000/api/v1/channels
```

Use the returned channel UUID in `GET /api/v1/channels/{id}`. To edit, PATCH that URL with title, description and the returned revision. Repeat the old revision after a successful edit and predict a 409. Changing an owner header does not change the cookie's authenticated identity.

To log out, POST `{}` to `/api/v1/auth/logout` using the same cookie jar and Origin. A later `/me` request returns 401 even if you manually replay the old token. For a lost registration response, try signing in with your original credentials rather than assuming no account was created.

## Inspect safe database facts

The administrator can inspect this project's container through its local socket without placing a database password in the command:

```sh
docker exec peerscreen-postgres-1 psql -U peerscreen_admin -d peerscreen \
  -c 'SELECT version, checksum, applied_at FROM catalog.schema_migrations;'

docker exec peerscreen-postgres-1 psql -U peerscreen_admin -d peerscreen \
  -c 'SELECT id, handle, revision, created_at FROM catalog.channels ORDER BY created_at;'
```

Do not dump session tokens/password hashes or all user emails into a shareable tutorial. To study hashing, use the isolated tests' assertions. A SHA-256 migration checksum is source-integrity metadata, not an authentication secret.

Find the foreign keys and partial feed indexes in the SQL migration. Explain why the video table points to a channel rather than storing another owner ID. Identify which publication CHECK clauses need explicit NOT NULL checks.

## Run isolated experiments

```sh
npm run contracts:check
npm run api:vet
npm run test:integration
npm run test:browser
npm run test:recovery
```

To reproduce the separate preview smoke, run `node scripts/preview-smoke.mjs development` while `npm run dev` is ready, or `node scripts/preview-smoke.mjs containers` while the complete Compose app is ready. It makes real anonymous API requests, checks accepted/rejected Origins, captures desktop/mobile screenshots, verifies HTTP playback and writes JSON under `.local/evidence`. Its mobile overflow assertion covers the account page at 390 pixels; it is not an exhaustive accessibility/browser audit.

The Go integration runner creates a separate real PostgreSQL/Redis project, uses the race detector, records JSON events and removes that disposable volume. Browser checks use their own production-server ports and the same isolated project sequentially. Do not run these independent test runners simultaneously, because they deliberately share that test project name.

The recovery script creates a throwaway account/channel, replaces the actual Go process, stops/starts PostgreSQL and Redis, and reuses the original session cookie. Its JSON record includes request/status observations and measured recovery intervals without passwords/tokens. It does not claim backup restore, multi-host failover or worker-job recovery.

## Docker concepts made concrete

An image packages code and dependencies; a container is a running instance. An image digest pins content; a moving version tag alone can select different content later. A volume preserves data independently of a container's process. A bridge network gives containers private communication and service names; `postgres:5432` inside the API container differs from the host's `127.0.0.1:55432` mapping.

The local web container publishes 3000/3001/8000 on host loopback. The private API is mapped to 18080, avoiding an unrelated application already using 8080 here; inside its container it still listens on 8080. The test API uses 8081 or 8091 and test databases use 55433/56380.

Migrate and seed are one-shot services. API startup waits for their successful completion and healthy dependencies; the web waits for API readiness. Health checks are observations, not automatic backup/repair systems. Dropping Linux capabilities and using non-root/read-only application containers narrows privileges without establishing a complete hostile-code sandbox.

## Stop without erasing your work

Stop native processes with Ctrl+C, then use `npm run stop` to stop the project's containers. It preserves the normal PostgreSQL volume. Do not use `down --volumes` on the application project as a casual reset: it deletes the database. The test runner's volume deletion is deliberately restricted to its separate disposable project.

If credentials were regenerated while reusing an initialized database volume, an ordinary restart does not reset the database password. Preserve the original private config or deliberately recover/change that project's credentials; do not delete persistent data to hide the mismatch.

## Reflection questions

Which values identify a row, which authenticate a user, and which only help diagnostics? Which state disappears on a browser/API/Redis restart, and which survives? Why can a request fail after a database commit? What does the cursor encode, and why does it still need visibility filtering? Which evidence proves a real service outage, and which only tests a simulated HTTP error in the interface?
