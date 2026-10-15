CREATE TABLE catalog.operator_actions (
 id uuid PRIMARY KEY,
 actor_id uuid NOT NULL REFERENCES catalog.users(id),
 job_id uuid NOT NULL REFERENCES catalog.processing_jobs(id),
 video_id uuid NOT NULL REFERENCES catalog.videos(id),
 action text NOT NULL CHECK(action IN ('retry','cancel')),
 note text NOT NULL CHECK(char_length(note) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operator_actions_job_idx ON catalog.operator_actions(job_id,created_at DESC);
CREATE INDEX processing_jobs_operator_page_idx ON catalog.processing_jobs(created_at DESC,id DESC);
