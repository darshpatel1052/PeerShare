-- Creator artwork is mutable; accepted playback generations remain immutable.
CREATE TABLE catalog.creator_images (
    id uuid PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES catalog.users(id) ON DELETE CASCADE,
    byte_length integer NOT NULL CHECK (byte_length BETWEEN 1 AND 1048576),
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE catalog.channels ADD COLUMN banner_image_id uuid REFERENCES catalog.creator_images(id);
ALTER TABLE catalog.videos ADD COLUMN thumbnail_image_id uuid REFERENCES catalog.creator_images(id);
CREATE INDEX creator_images_created_idx ON catalog.creator_images(created_at);
