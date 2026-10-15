# Operating PeerShare from the product

The operator workspace answers three everyday questions: which videos are being prepared, which jobs need attention, and how much media capacity is reserved. It shows the real processing queue across creator channels, with search, state filters and cursor pages. It refreshes every five seconds while retaining the previous successful view during a refresh.

## Permission is a database fact

The original user model already has `member`, `operator` and `system` roles. This feature uses the existing `operator` role. New registrations remain members; a browser cannot choose or promote its own role. A maintainer grants the project owner operator access through the administrator's private database connection.

The navigation uses `/me` to decide whether to show Platform operations. Every operator endpoint independently loads the session's current database role. Hiding navigation alone would not authorize an API. Removing the database role takes effect on the next request. The role does not grant access to another creator's private upload or preview endpoints.

## Data and APIs

| API                                             | Purpose                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| `GET /api/v1/operator/jobs?state=active&q=film` | Filter/search jobs across channels; return a page and queue/storage summary. |
| `POST /api/v1/operator/jobs/{id}/retry`         | Request another processing attempt, with an operator note.                   |
| `POST /api/v1/operator/jobs/{id}/cancel`        | Request cancellation, with an operator note.                                 |

The page is ordered by job creation time and UUID. State changes do not reshuffle the order, while filters still use current state. Counts describe all nondeleted jobs, not just visible rows. Storage is the sum of logical upload reservations against the 20-GiB admission budget. It includes space held for active work and is not a statement about S3 billing or disk-free space.

`catalog.operator_actions` records the acting account, job, video, action, note and timestamp. The note explains the action for a later maintainer. It stores no password, session token, OAuth token or video bytes.

## Reusing the processing model

An operator action resolves the target's actual owner and then calls the same internal Go mutation used by Studio. Retry still checks the remaining three-attempt budget and storage reservation. Cancel still becomes a coordinator command when distributed processing is enabled. The operator interface does not introduce a second encoder or a separate route around those rules.

The job mutation and audit insertion commit in one PostgreSQL transaction. If the audit insert or role check fails, the job change rolls back too. The actor comes from the authenticated session, never from JSON supplied by the browser. This keeps “who requested the action” separate from “who owns the video.”

## React components

The static `/operator/` route renders a client component inside the existing account provider. `MemberGate` handles sign-in. The server-provided role decides whether the actual workspace mounts. Account changes unmount its private state.

A native HTML dialog presents the affected video, action and note field. The browser supplies focus containment and Escape behavior. While the request is running, repeated submission is disabled. The response explains that the action was accepted; later processing state arrives through the normal coordinator/read-model path.

## Try it and trace it

As the configured operator, open Workspace → Platform operations. Search a known video or select Needs attention. Inspect a job's attempt count, stage and last update. If a retry is appropriate, add a short note and submit it. Follow the request from `operator.tsx` through the Go HTTP handler into `OperatorMutateJob`, the shared job mutation, its audit row and the media submission command.

The focused checks cover member/guest denial, another owner's private-upload denial, a real failed source retried from the browser, its audit record, exhausted-budget rejection and revoked-role behavior. These validate the workflow rather than replacing the product demonstration.
