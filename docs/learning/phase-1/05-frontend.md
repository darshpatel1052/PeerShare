# Browser components and live API data

The browser shows a product interface; the API enforces its rules. This chapter explains the components actually used in Phase 1 and how their lifetimes connect to the Go/database behaviour.

## What is static and what changes at runtime

The production build emits HTML/JS/CSS for `/`, `/account/`, `/channel/` and `/watch/`. A query parameter selects a resource at runtime. Arbitrary new channel UUIDs work because the browser reads `?id=…` after loading the fixed channel route; the build does not need to pre-generate every creator's page.

Client components are still prerendered during a build. Browser-only operations therefore run in effects, not while a module/server render is evaluating. The watch/channel routes wrap query-parameter consumers in Suspense for static export. Suspense supplies a loading boundary; it is not an authentication or database transaction mechanism.

The app fetches fresh product data in the browser through the local same-origin proxy. The optimized production frontend and development-mode local API settings are separate concepts: exporting optimized files does not configure public TLS, secure cookies or admission policy automatically.

## Components and state

`AuthProvider` holds the current `/me` response as display state. `Navigation` uses it to show an account link. `Account` renders sign-in/registration or the owned channel form. `VideoList` renders an API page and optional next-page action. `Channel` reads public channel metadata; `Watch` reads accepted playback configuration and owns the player lifetime.

React state changes rerender a component. Form values belong in state because typing and errors change what the user sees. Mutable player handles belong in refs: a ref keeps a value between renders without requesting another render just because an imperative object was assigned.

The auth context is a cache of an API response, not the source of authorization. Changing client state cannot grant permission: every protected server request resolves the cookie against PostgreSQL again. A copied owner ID or an edited browser role field is not a credential.

## Effects and cleanup

`useResource` starts a fetch when its path/retry revision changes. It creates an AbortController and aborts when that effect is replaced or the component leaves. This prevents a late response from an abandoned request from updating the active view. It combines the abort signal with a ten-second network budget.

The watch effect initializes HLS only when it has an accepted API record and an actual video element. Its cleanup aborts startup and destroys the player. Sharing changes recreate the player, keeping play position/play intent while resetting its delivery counters. The API's media ID, accepted generation and attempt determine its peer namespace, together with the descriptor content version.

External systems such as an HLS engine, event listeners and network connections need explicit cleanup. React removing a visible element is not proof that all peer connections were closed; the browser tests inspect actual RTCPeerConnection objects after opt-out and navigation.

`useCallback` keeps the auth reload function stable so an effect depending on it does not start another request on every provider render. It does not make a request durable or cache its result by itself.

## Shared request handling

`lib/api.ts` sends JSON with a consistent content type, includes same-origin cookies and handles cancellation/timeouts. The browser supplies Origin on mutations; application code does not invent an authenticated owner header. A 204 response has no JSON body, so logout is handled separately from normal JSON responses.

`ApiError` carries HTTP status, stable code, readable message and request ID. The page shows the readable error and a reference, while a revision-conflict code selects an explicit reload action. Checking a stable code is more reliable than matching an English sentence.

Generated OpenAPI schema types describe the expected values at compile time. Casting parsed JSON to a type does not perform runtime schema validation. Our confidence comes from server-side validation, typed server models, contract drift checks and real browser/API tests; malformed server responses still need controlled error handling.

## Loading, empty and error states

These are different product situations. Loading means a request is in progress. Empty means it succeeded but returned no published videos. Error means it could not complete. The UI uses readable messages, labelled controls, status/alert roles and deliberate retry actions.

Public reads can be retried without duplicating a mutation. Forms keep values on a failed request; they do not erase a title because a 503 arrived. A stale edit remains visible until the user chooses to reload. A successful save refreshes canonical account/channel data from the API instead of declaring success solely from local state.

The browser error-preservation test deliberately intercepts one request and injects a 503. That tests the interface's response to a failure; it is not proof of a real database outage. The separate recovery script actually stops PostgreSQL/Redis and records the backend policy.

## Forms and accessibility

Labels identify controls, and helper text describes bounded policies. Password fields use the appropriate current/new-password autocomplete hints. The description textarea uses an explicit ID and external label; this keeps its label association stable as React updates its text/value and helps test locators refer to the control reliably.

Native form bounds improve feedback but cannot replace API checks. A curl client bypasses every browser constraint. React renders metadata as text rather than injecting user HTML. Server ownership checks are still needed even if the UI only shows a user's own channel form.

## Development and production serving

`npm run dev` starts the private backend/media/tracker and a Next.js development server with development-only API/health rewrites. Development omits the export's trailing-slash policy, so API paths reach Go exactly as defined in the contract. `npm run demo` serves the exported files through the Node server and API proxy. The full Compose profile serves that same kind of production export inside a non-root web container. Shutdown terminates local tracker connections and stops Go directly instead of waiting indefinitely for a tracker callback.

Test ports differ from preview ports, and test databases have their own project/volume. Playwright is configured to send SIGTERM and allow cleanup to finish; otherwise killing the server process immediately can leave temporary containers behind. This is lifecycle management, not an arbitrary delay used as dependency readiness.

## Exercises

Find where an auth cookie is sent without JavaScript reading its value. Trace a channel save from a typed request body into a 409 response and the preserved form. Identify which useEffect cleanup closes media connections. Explain why a static export can show a newly created channel and why that does not authorize a client-side mutation.

Primary references: [React useEffect](https://react.dev/reference/react/useEffect), [useRef](https://react.dev/reference/react/useRef), [useContext](https://react.dev/reference/react/useContext), [Next.js static exports](https://nextjs.org/docs/app/guides/static-exports).
