package store

import (
	"context"
	"time"
)

type OperatorJob struct {
	ID          string    `json:"id"`
	VideoID     string    `json:"video_id"`
	Title       string    `json:"title"`
	Channel     string    `json:"channel"`
	State       string    `json:"state"`
	Stage       string    `json:"stage"`
	Progress    int       `json:"progress"`
	Attempts    int       `json:"attempts"`
	ErrorCode   *string   `json:"error_code"`
	UpdatedAt   time.Time `json:"updated_at"`
	Publication string    `json:"publication"`
}
type OperatorSummary struct {
	Active        int   `json:"active"`
	Ready         int   `json:"ready"`
	Attention     int   `json:"attention"`
	ReservedBytes int64 `json:"reserved_bytes"`
	CapacityBytes int64 `json:"capacity_bytes"`
}
type OperatorPage struct {
	Items      []OperatorJob   `json:"items"`
	NextCursor *string         `json:"next_cursor"`
	Summary    OperatorSummary `json:"summary"`
}

func (s *Store) OperatorJobs(ctx context.Context, state, query string, cursor *Cursor) (OperatorPage, error) {
	page := OperatorPage{Items: []OperatorJob{}, Summary: OperatorSummary{CapacityBytes: StorageCeiling}}
	err := s.Pool.QueryRow(ctx, `SELECT count(*) FILTER(WHERE j.state IN('queued','running')),count(*) FILTER(WHERE j.state='ready'),count(*) FILTER(WHERE j.state IN('failed','cancelled')) FROM catalog.processing_jobs j JOIN catalog.videos v ON v.id=j.video_id WHERE v.deleted_at IS NULL`).Scan(&page.Summary.Active, &page.Summary.Ready, &page.Summary.Attention)
	if err != nil {
		return page, err
	}
	if err = s.Pool.QueryRow(ctx, `SELECT COALESCE(sum(reserved_bytes),0) FROM catalog.upload_sessions`).Scan(&page.Summary.ReservedBytes); err != nil {
		return page, err
	}
	var after, afterID any
	if cursor != nil {
		after, afterID = cursor.PublishedAt, cursor.ID
	}
	rows, err := s.Pool.Query(ctx, `SELECT j.id,j.video_id,v.title,c.title,j.state,j.stage,j.progress,j.attempt,j.error_code,j.created_at,j.updated_at,v.publication_state FROM catalog.processing_jobs j JOIN catalog.videos v ON v.id=j.video_id JOIN catalog.channels c ON c.id=v.channel_id WHERE v.deleted_at IS NULL AND ($1='all' OR ($1='active' AND j.state IN('queued','running')) OR ($1='attention' AND j.state IN('failed','cancelled')) OR j.state=$1) AND (strpos(lower(v.title),lower($2))>0 OR strpos(lower(c.title),lower($2))>0) AND ($3::timestamptz IS NULL OR (j.created_at,j.id)<($3,$4::uuid)) ORDER BY j.created_at DESC,j.id DESC LIMIT 26`, state, query, after, afterID)
	if err != nil {
		return page, err
	}
	defer rows.Close()
	var lastCreated time.Time
	for rows.Next() {
		var job OperatorJob
		var created time.Time
		if err = rows.Scan(&job.ID, &job.VideoID, &job.Title, &job.Channel, &job.State, &job.Stage, &job.Progress, &job.Attempts, &job.ErrorCode, &created, &job.UpdatedAt, &job.Publication); err != nil {
			return page, err
		}
		if len(page.Items) == 25 {
			token := EncodeCursor(Video{ID: page.Items[24].ID, PublishedAt: lastCreated})
			page.NextCursor = &token
			break
		}
		page.Items = append(page.Items, job)
		lastCreated = created
	}
	return page, rows.Err()
}

type operatorAction struct{ Actor, Note, Action string }

func (s *Store) OperatorMutateJob(ctx context.Context, actor, jobID, action, note string) error {
	var owner, video string
	err := s.Pool.QueryRow(ctx, `SELECT c.owner_id,v.id FROM catalog.processing_jobs j JOIN catalog.videos v ON v.id=j.video_id JOIN catalog.channels c ON c.id=v.channel_id JOIN catalog.users actor ON actor.id=$2 AND actor.role='operator' WHERE j.id=$1 AND v.deleted_at IS NULL`, jobID, actor).Scan(&owner, &video)
	if err != nil {
		return translate(err)
	}
	return s.mutateJob(ctx, owner, video, action == "retry", &operatorAction{actor, note, action})
}
