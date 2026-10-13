ALTER TABLE catalog.users ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE catalog.external_identities (
    issuer text NOT NULL,
    subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 255),
    user_id uuid NOT NULL REFERENCES catalog.users(id) ON DELETE CASCADE,
    provider_email text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (issuer, subject),
    UNIQUE (user_id, issuer)
);

CREATE TABLE catalog.oauth_flows (
    state_hash bytea PRIMARY KEY CHECK (octet_length(state_hash)=32),
    browser_hash bytea NOT NULL CHECK (octet_length(browser_hash)=32),
    nonce text NOT NULL,
    code_verifier text NOT NULL,
    purpose text NOT NULL CHECK (purpose IN ('signin','link')),
    user_id uuid REFERENCES catalog.users(id) ON DELETE CASCADE,
    session_hash bytea,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
    CHECK ((purpose='signin' AND user_id IS NULL AND session_hash IS NULL) OR
           (purpose='link' AND user_id IS NOT NULL AND session_hash IS NOT NULL AND octet_length(session_hash)=32))
);
CREATE INDEX oauth_flows_expiry_idx ON catalog.oauth_flows(expires_at);
