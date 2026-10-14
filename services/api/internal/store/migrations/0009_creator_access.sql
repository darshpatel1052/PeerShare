-- Deployment approval is independent of account identity and channel ownership.
CREATE TABLE catalog.creator_access (
    user_id uuid PRIMARY KEY REFERENCES catalog.users(id) ON DELETE CASCADE,
    granted_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL CHECK (expires_at > granted_at)
);
