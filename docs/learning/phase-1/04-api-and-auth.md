# APIs, authentication and ownership

## What an API contract means

The browser and server are separate programs. The API contract states which URL/method to use, the request shape, the response shape and the outcomes a caller must handle. OpenAPI is the checked-in specification; its generated TypeScript types help the frontend compile against that specification.

Types are not runtime validation. A browser or curl can send arbitrary JSON regardless of TypeScript. Go therefore independently enforces body bounds, supported fields, identifier shapes, string policies, authentication and ownership. Contract checks and real HTTP tests complement each other; generation alone does not prove the server behaves correctly.

| Operation           | Method and path                | Access and result                                           |
| ------------------- | ------------------------------ | ----------------------------------------------------------- |
| Register            | POST `/api/v1/auth/register`   | Local registration; user + session atomically created; 201  |
| Sign in             | POST `/api/v1/auth/login`      | Generic invalid-credential failure; new session cookie; 200 |
| Sign out            | POST `/api/v1/auth/logout`     | Revoke presented token and clear cookie; repeatable; 204    |
| Sign out everywhere | POST `/api/v1/auth/logout-all` | Active session required; revoke own sessions; 204           |
| Current account     | GET `/api/v1/me`               | Active session required; user and nullable owned channel    |
| Create channel      | POST `/api/v1/channels`        | Active session; server assigns owner; 201                   |
| Read channel        | GET `/api/v1/channels/{id}`    | Public metadata; excludes owner email/internal ID           |
| Edit channel        | PATCH `/api/v1/channels/{id}`  | Owner only; expected revision; 200 or conflict              |
| Catalogue           | GET `/api/v1/videos`           | Published/nondeleted only; bounded cursor page              |
| Watch metadata      | GET `/api/v1/videos/{id}`      | Published accepted output only; playback URLs/version       |
| Process health      | GET `/health/live`             | Listener/process responds independently of dependencies     |
| Dependency health   | GET `/health/ready`            | PostgreSQL and Redis must answer; 200 or 503                |

Reads use GET. Creating an account/channel uses POST. PATCH updates selected existing metadata. Logout also uses POST because it changes server state; a link or an image GET must not revoke a session. Requests that need JSON use `Content-Type: application/json`. JSON bodies are capped at 16 KiB; unknown fields and trailing JSON values are rejected.

The contract does not yet contain implemented uploads, processing jobs, playlists or subscriptions. Add those endpoints when their state/authorization/recovery rules exist, not as empty success stubs.

## Walk through registration

1. The browser sends email, display name and password to the same-origin API route.
2. The wrapper generates a request ID/deadline and checks the mutation's Origin.
3. Redis checks the short-lived authentication budget before expensive hashing.
4. Go decodes one bounded JSON object, rejects extra fields, canonicalizes email/display name, and validates policy. Password text is not trimmed.
5. Argon2id computes an encoded password hash using a random salt, 64 MiB memory, three passes and two lanes.
6. Cryptographic randomness creates a 32-byte session token. The server separately computes its SHA-256 digest.
7. A transaction inserts the user and session digest/expiry. The uniqueness/foreign-key/check constraints protect the durable rows.
8. Only after success does the server set the HttpOnly cookie and return account JSON. Neither password hash nor session token appears in that JSON.

If the client loses the response after commit, that does not undo the account. This phase does not add a registration idempotency key: a retry may report `email_taken`, after which the user can sign in. The unique email prevents duplicate identities; it is not a general substitute for the durable idempotency protocol needed for uploads.

## Password hash versus session hash

A password can be chosen from a small guessable space. It needs a salted, intentionally expensive password hash. A random salt prevents identical passwords from having identical stored hashes and frustrates reuse of precomputed tables. Encoding the parameters lets a future version recognize the recipe used by an older hash.

An opaque session token instead contains 256 bits of random input. It is not a user ID or a readable claim document. Its high entropy makes a fast SHA-256 lookup digest appropriate. The database never needs to recover the original token; it only needs to recognize a presented token's digest.

Hashing is not encryption. Encryption is reversible with a key; these verification digests are designed for comparison. A password hash can still be attacked through guesses, and a stolen original session token can be replayed until revoked/expired. Do not log either credential or its hash.

We use the maintained Argon2 implementation in `golang.org/x/crypto` and constant-time digest comparison. The helper rejects malformed/excessive encoded parameters before doing unbounded work. A two-slot semaphore bounds concurrent password calculations. A dummy hash is verified for an unknown login email, and login errors use the same message for absent accounts and wrong passwords. Registration's explicit duplicate-email response still reveals registration status; Phase 1 is not a claim of complete account-enumeration resistance.

## Cookie sessions and revocation

The session cookie is HttpOnly, host-scoped, uses `/`, and has SameSite=Lax. HttpOnly prevents ordinary browser JavaScript from reading its value. It does not neutralize XSS: injected same-origin JavaScript could still make authenticated requests. React escapes displayed metadata; the application also needs deliberate security work as its rendering/features expand.

Local HTTP cookies cannot be marked Secure if we want the local development flow to work. Production configuration changes the name to `__Host-peerscreen_session`, sets Secure, uses `/`, omits Domain and requires HTTPS/WSS browser endpoints. Public registration is disabled until a deliberate admission policy exists.

For a protected request, middleware reads the cookie, validates its canonical 43-character base64url token, hashes it, and queries an unrevoked/unexpired session joined to its user. It places that canonical user in the request context. It never trusts `X-User-ID`, a JSON owner field or a claimed role.

Logout updates revocation in PostgreSQL and clears the browser cookie. Replaying the old cookie fails on the next database lookup. Expiry is likewise checked server-side even if a browser still presents an old value. Two API instances use the same durable sessions; there is no process-local identity map to synchronize.

Session rows surviving a fresh API object are one test. Restarting an actual process/database is a different recovery experiment and is recorded separately in the evidence. Do not treat those as interchangeable results.

## Origin checks and CSRF

Browsers attach cookies automatically, which creates a cross-site request-forgery risk if another site can cause a state-changing request. This API requires an exact configured Origin on every mutation, including login/registration/logout. SameSite is an additional cookie boundary, not the only check. Bodies must use JSON where specified, and no mutation is implemented as GET.

The local frontend proxy keeps application requests on one browser origin. We do not enable wildcard credentialed CORS. The browser's Origin is forwarded to the API for validation, while spoofable identity/forwarding headers are removed. A non-browser client can set an Origin header; Origin is a browser CSRF boundary, not authentication, and cannot replace session/ownership checks.

When using curl manually, include `Origin: http://localhost:3000`, the JSON Content-Type and a cookie jar. Replace example credentials yourself; never paste generated private database/cache credentials into shared logs.

## Ownership and revision conflicts

Suppose Alice's session owns channel C. Bob knows C's public UUID and sends a PATCH with `X-User-ID: alice`. Middleware resolves Bob from his real cookie. The transaction locks C, compares its stored owner to Bob's canonical ID, and returns 403 without writing. The integration test exercises this exact spoofing attempt.

Suppose Alice loads revision 1 in two forms. Form A succeeds and returns revision 2. Form B submits expected revision 1 and receives 409 `revision_conflict`. The interface must preserve the entered values and offer a reload; silently resubmitting against a new revision would recreate the overwrite problem.

An unsuccessful API request must not make the UI assume no durable work happened. Unique channel ownership bounds duplicate creation; the account can reload `/me` to discover an existing channel after an ambiguous response.

## Errors, retries and diagnostics

Responses include `code`, a readable `message`, and `request_id`. The same request ID is returned in a header and logged with method, matched route pattern, status and duration. Request bodies, cookies, hashes, query strings and connection URLs are not logged.

| Status    | Caller meaning                                                    |
| --------- | ----------------------------------------------------------------- |
| 400       | Malformed/unsupported JSON, identifier, limit or cursor           |
| 401       | Sign-in required, expired/revoked session, or invalid credentials |
| 403       | Origin, registration policy or ownership denied                   |
| 404       | Resource unavailable to this public endpoint                      |
| 409       | Unique-resource conflict or stale revision                        |
| 413 / 415 | Body too large / JSON content type required                       |
| 422       | Well-formed fields violate product policy                         |
| 429       | Shared authentication budget exhausted; obey Retry-After          |
| 503       | Required dependency/operation unavailable; retry deliberately     |

Browser retries are user-controlled for mutations. Reads can offer a safe retry button. Future upload/job mutations require stable idempotency keys and persisted results to reconcile ambiguous outcomes.

## Redis counters and their limits

The Lua script increments a hashed client-address key and sets its expiry on the first increment atomically. Two API clients share one budget. Setting expiry in a separate command would leave a crash window between increment and expiry. Reapplying expiry on every hit would unintentionally keep extending the window.

This is a window beginning with the first request, not a sliding-window or token-bucket algorithm. It counts attempted registration/login requests before validation. Redis uses noeviction: an exhausted cache returns an error, and authentication fails closed rather than silently admitting unlimited password work.

The current API uses the actual TCP remote address, ignoring client forwarding headers. Behind the local proxy this becomes a gateway-wide bucket. It is deliberately conservative, and is not a completed production per-client proxy-address policy. Phase 5's trusted gateway topology must define how to derive descriptors without accepting spoofed headers.

Redis counters are disposable; losing them resets a short-lived limit window. Users, sessions and ownership remain in PostgreSQL. Public metadata can still be read from PostgreSQL if Redis becomes unavailable, while authentication admission returns a controlled error and readiness reports the dependency failure.

## Contract generation and frontend use

`packages/contracts/generate.mjs` parses OpenAPI into TypeScript and formats a deterministic checked-in result. The check mode compares freshly generated text with the committed types, catching drift. The generator currently declares a TypeScript 5 peer dependency, so its workspace pins 5.9.3. The application compiler remains 7.0.2. This keeps the installation compatible without `--force` or ignored peer requirements.

The frontend imports the generated schema types and uses a small shared fetch layer for credentials, JSON, timeouts and structured errors. Static export runs at build time, but user/catalogue data is fetched after the page loads in the browser. Secrets never belong in `NEXT_PUBLIC_*` variables because those values enter the browser bundle.

## Exercises

Explain why SHA-256 alone is inappropriate for passwords but appropriate for random session lookup. Replay a logged-out test cookie. Attempt Bob's edit with Alice's claimed header. Submit a stale revision. Stop the test Redis and predict which public/protected operations still work. Compare the generated type with the server's runtime validation and name a malformed request TypeScript cannot prevent from curl.

Primary references: [Argon2 implementation](https://pkg.go.dev/golang.org/x/crypto/argon2), [Go HTTP cookies](https://pkg.go.dev/net/http#Cookie), [Redis scripting](https://redis.io/docs/latest/develop/programmability/eval-intro/), [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html).
