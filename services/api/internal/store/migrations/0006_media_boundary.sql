-- processing_jobs remains the catalogue's read model; independent leases live in media.jobs.
ALTER TABLE catalog.processing_jobs
 ADD COLUMN distributed boolean NOT NULL DEFAULT false,
 ADD COLUMN media_version bigint NOT NULL DEFAULT 0 CHECK(media_version>=0);
CREATE TABLE catalog.media_submissions (
 job_id uuid PRIMARY KEY REFERENCES catalog.processing_jobs(id),
 owner_id uuid NOT NULL,
 video_id uuid NOT NULL,
 generation_id uuid NOT NULL,
 source_key text NOT NULL,
 source_bytes bigint NOT NULL CHECK(source_bytes BETWEEN 1 AND 262144000),
 source_sha256 bytea NOT NULL CHECK(octet_length(source_sha256)=32),
 recipe_version text NOT NULL,
 prior_attempts integer NOT NULL DEFAULT 0 CHECK(prior_attempts BETWEEN 0 AND 3),
 submitted_at timestamptz,
 command text NOT NULL DEFAULT '' CHECK(command IN('','retry','cancel')),
 command_id uuid,
 command_sent_at timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 failures integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE catalog.media_event_inbox (
 event_id uuid PRIMARY KEY, job_id uuid NOT NULL, media_version bigint NOT NULL CHECK(media_version>0),
 applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE catalog.media_quarantine (
 topic text NOT NULL, partition_id integer NOT NULL, record_offset bigint NOT NULL,
 content_sha256 bytea NOT NULL CHECK(octet_length(content_sha256)=32), reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(topic,partition_id,record_offset)
);
-- Preserve completed media. Only unfinished, fully identified sources enter the new pipeline.
INSERT INTO catalog.media_submissions(job_id,owner_id,video_id,generation_id,source_key,source_bytes,source_sha256,recipe_version,prior_attempts)
 SELECT j.id,u.owner_id,j.video_id,j.generation_id,v.source_key,v.source_bytes,u.source_sha256,'h264-aac-hls-v2',j.attempt
 FROM catalog.processing_jobs j JOIN catalog.videos v ON v.id=j.video_id JOIN catalog.upload_sessions u ON u.video_id=j.video_id
 WHERE j.state IN('queued','running') AND v.deleted_at IS NULL AND u.source_sha256 IS NOT NULL;
UPDATE catalog.processing_jobs SET distributed=true,state='queued',stage='queued',progress=0,worker_id=NULL,lease_expires_at=NULL
 WHERE id IN(SELECT job_id FROM catalog.media_submissions);
