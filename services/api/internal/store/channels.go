package store

import "context"

const channelColumns = `c.id,c.owner_id,c.handle,c.title,c.description,u.display_name,c.revision,c.created_at,c.updated_at,COALESCE(c.banner_image_id::text,'')`

func scanChannel(row interface{ Scan(...any) error }) (Channel, error) {
	var c Channel
	err := row.Scan(&c.ID, &c.OwnerID, &c.Handle, &c.Title, &c.Description, &c.OwnerDisplayName, &c.Revision, &c.CreatedAt, &c.UpdatedAt, &c.BannerImageID)
	return c, translate(err)
}

func (s *Store) Channel(ctx context.Context, id string) (Channel, error) {
	return scanChannel(s.Pool.QueryRow(ctx, "SELECT "+channelColumns+" FROM catalog.channels c JOIN catalog.users u ON u.id=c.owner_id WHERE c.id=$1", id))
}
func (s *Store) channelByOwner(ctx context.Context, ownerID string) (Channel, error) {
	return scanChannel(s.Pool.QueryRow(ctx, "SELECT "+channelColumns+" FROM catalog.channels c JOIN catalog.users u ON u.id=c.owner_id WHERE c.owner_id=$1", ownerID))
}
func (s *Store) CreateChannel(ctx context.Context, id, ownerID, handle, title, description string) (Channel, error) {
	if _, err := s.Pool.Exec(ctx, "INSERT INTO catalog.channels(id,owner_id,handle,title,description) VALUES($1,$2,$3,$4,$5)", id, ownerID, handle, title, description); err != nil {
		return Channel{}, translate(err)
	}
	return s.Channel(ctx, id)
}
func (s *Store) EditChannel(ctx context.Context, id, ownerID, title, description string, revision int64) (Channel, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Channel{}, err
	}
	defer tx.Rollback(ctx)
	var storedOwner string
	var storedRevision int64
	if err := tx.QueryRow(ctx, "SELECT owner_id,revision FROM catalog.channels WHERE id=$1 FOR UPDATE", id).Scan(&storedOwner, &storedRevision); err != nil {
		return Channel{}, translate(err)
	}
	if storedOwner != ownerID {
		return Channel{}, ErrNotOwner
	}
	if storedRevision != revision {
		return Channel{}, ErrRevisionConflict
	}
	if _, err := tx.Exec(ctx, "UPDATE catalog.channels SET title=$1,description=$2,revision=revision+1,updated_at=now() WHERE id=$3", title, description, id); err != nil {
		return Channel{}, err
	}
	channel, err := scanChannel(tx.QueryRow(ctx, "SELECT "+channelColumns+" FROM catalog.channels c JOIN catalog.users u ON u.id=c.owner_id WHERE c.id=$1", id))
	if err != nil {
		return Channel{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Channel{}, err
	}
	return channel, nil
}
