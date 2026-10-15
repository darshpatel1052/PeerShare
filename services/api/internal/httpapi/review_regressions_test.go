package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	pb "github.com/darshpatel1052/PeerShare/services/api/gen/peerscreen/media/v1"
	"github.com/darshpatel1052/PeerShare/services/api/internal/objectstore"
	"github.com/darshpatel1052/PeerShare/services/api/internal/store"
	"github.com/google/uuid"
)

func TestIntegrationStudioEntireLibraryPaginationAndSearch(t *testing.T) {
	f := setup(t)
	c := client()
	owner, _, _ := registerUser(t, f, c)
	channel := createChannel(t, f, c, "library-pages")
	// Metadata fixtures, deliberately identical timestamps exercise the UUID tie breaker.
	created := time.Now().UTC().Add(-time.Hour)
	for i := 0; i < 35; i++ {
		id, upload := uuid.NewString(), uuid.NewString()
		mustExec(t, f, `INSERT INTO catalog.videos(id,channel_id,title,source_kind,processing_state) VALUES($1,$2,$3,'upload','pending')`, id, channel.ID, fmt.Sprintf("Library video %02d", i))
		mustExec(t, f, `INSERT INTO catalog.upload_sessions(id,video_id,owner_id,idempotency_key,request_fingerprint,expected_bytes,state,created_at) VALUES($1,$2,$3,$4,$5,1,'aborted',$6)`, upload, id, owner.User.ID, uuid.NewString(), make([]byte, 32), created)
		if i == 0 {
			mustExec(t, f, `UPDATE catalog.videos SET title='Older published film',publication_state='published',processing_state='ready',duration_seconds=1,accepted_generation_id=$2,accepted_attempt_id=$3,manifest_key='test/master.m3u8',integrity_key='test/integrity.json',thumbnail_key='test/thumb.jpg',qualities=ARRAY[480],published_at=now() WHERE id=$1`, id, uuid.NewString(), uuid.NewString())
			mustExec(t, f, `UPDATE catalog.upload_sessions SET created_at=now()-interval '2 hours' WHERE id=$1`, upload)
		}
	}
	load := func(path string) store.UploadsPage {
		t.Helper()
		status, data, _ := request(t, c, f.Server.URL, "GET", path, nil, nil)
		if status != 200 {
			t.Fatalf("library %d %s", status, data)
		}
		var page store.UploadsPage
		if err := json.Unmarshal(data, &page); err != nil {
			t.Fatal(err)
		}
		return page
	}
	page := load("/api/v1/uploads?limit=30")
	if len(page.Items) != 30 || page.NextCursor == nil || page.Counts.All != 35 || page.Counts.Published != 1 {
		t.Fatalf("incomplete library page %+v", page)
	}
	second := load("/api/v1/uploads?limit=30&cursor=" + *page.NextCursor)
	seen := map[string]bool{}
	for _, item := range page.Items {
		seen[item.ID] = true
	}
	for _, item := range second.Items {
		if seen[item.ID] {
			t.Fatal("duplicate page item")
		}
		seen[item.ID] = true
	}
	if len(seen) != 35 || second.NextCursor != nil {
		t.Fatal("older uploads unreachable", len(seen))
	}
	published := load("/api/v1/uploads?state=published&q=Older")
	if len(published.Items) != 1 || published.Total != 1 || published.Items[0].Title != "Older published film" {
		t.Fatal("filter/search did not cover older uploads")
	}
	status, _, _ := request(t, c, f.Server.URL, "GET", "/api/v1/uploads?limit=51", nil, nil)
	if status != 400 {
		t.Fatal("invalid limit accepted")
	}
	other := client()
	registerUser(t, f, other)
	status, data, _ := request(t, other, f.Server.URL, "GET", "/api/v1/uploads?cursor="+*page.NextCursor, nil, nil)
	if status != 200 || strings.Contains(string(data), "Library video") {
		t.Fatal("cursor exposed another creator's uploads")
	}
}

func TestIntegrationDelayedCancelPreservesNewRetry(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	u, me := newUpload(t, f, client(), []byte("source"))
	job, generation, oldCommand, newCommand := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	mustExec(t, f, `INSERT INTO catalog.processing_jobs(id,video_id,generation_id,state,distributed,media_version) VALUES($1,$2,$3,'cancelled',true,1)`, job, u.VideoID, generation)
	mustExec(t, f, `INSERT INTO catalog.media_submissions(job_id,owner_id,video_id,generation_id,source_key,source_bytes,source_sha256,recipe_version,prior_attempts,submitted_at,command,command_id) VALUES($1,$2,$3,$4,$5,6,$6,'h264-aac-hls-v2',0,now(),'retry',$7)`, job, me.User.ID, u.VideoID, generation, "sources/"+u.VideoID+".mp4", make([]byte, 32), newCommand)
	mustExec(t, f, `UPDATE catalog.processing_jobs SET state='queued' WHERE id=$1`, job)
	snapshot := &pb.JobSnapshot{Spec: &pb.JobSpec{JobId: job, VideoId: u.VideoID, GenerationId: generation}, Version: 2, EventId: uuid.NewString(), State: "cancelled", Stage: "cancelled"}
	if err := f.DB.ApplyMediaSnapshot(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	pending, err := f.DB.PendingMediaSubmissions(ctx)
	if err != nil || len(pending) != 1 || pending[0].CommandID != newCommand || pending[0].Command != "retry" {
		t.Fatal("old cancellation erased pending retry", err)
	}
	current, err := f.DB.Upload(ctx, me.User.ID, u.ID)
	if err != nil || current.ProcessingState != "pending" {
		t.Fatal("old cancellation hid queued retry", err)
	}
	if err = f.DB.MediaSubmissionSent(ctx, job, oldCommand); err != nil {
		t.Fatal(err)
	}
	pending, _ = f.DB.PendingMediaSubmissions(ctx)
	if len(pending) != 1 {
		t.Fatal("previous request acknowledged newer retry")
	}
	snapshot.Version = 3
	snapshot.EventId = uuid.NewString()
	snapshot.State = "failed"
	snapshot.Stage = "failed"
	if err = f.DB.ApplyMediaSnapshot(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	if err = f.DB.ApplyMediaSnapshot(ctx, snapshot, newCommand); err != nil {
		t.Fatal(err)
	}
	pending, _ = f.DB.PendingMediaSubmissions(ctx)
	if len(pending) != 0 {
		t.Fatal("matching retry acknowledgement did not resolve request")
	}
	if err = f.DB.ApplyMediaSnapshot(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	current, err = f.DB.Upload(ctx, me.User.ID, u.ID)
	if err != nil || current.ProcessingState != "failed" {
		t.Fatal("fast terminal retry remained queued after acknowledgement", err)
	}
	// A second cancel must survive both the first cancel's late event and the
	// already-in-flight retry acknowledgement.
	cancelID := uuid.NewString()
	mustExec(t, f, `UPDATE catalog.media_submissions SET command='cancel',command_id=$2,command_sent_at=NULL WHERE job_id=$1`, job, cancelID)
	snapshot.Version = 4
	snapshot.EventId = uuid.NewString()
	snapshot.State = "cancelled"
	snapshot.Stage = "cancelled"
	if err = f.DB.ApplyMediaSnapshot(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	snapshot.Version = 5
	snapshot.EventId = uuid.NewString()
	snapshot.State = "queued"
	snapshot.Stage = "queued"
	if err = f.DB.ApplyMediaSnapshot(ctx, snapshot, newCommand); err != nil {
		t.Fatal(err)
	}
	pending, _ = f.DB.PendingMediaSubmissions(ctx)
	if len(pending) != 1 || pending[0].CommandID != cancelID {
		t.Fatal("late first cancel/retry consumed the second cancel")
	}
	snapshot.Version = 6
	snapshot.EventId = uuid.NewString()
	snapshot.State = "cancel_requested"
	snapshot.Stage = "cancelled"
	if err = f.DB.ApplyMediaSnapshot(ctx, snapshot, cancelID); err != nil {
		t.Fatal(err)
	}
	snapshot.Version = 7
	snapshot.EventId = uuid.NewString()
	snapshot.State = "cancelled"
	if err = f.DB.ApplyMediaSnapshot(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	var command string
	if err = f.DB.Pool.QueryRow(ctx, "SELECT command FROM catalog.media_submissions WHERE job_id=$1", job).Scan(&command); err != nil || command != "" {
		t.Fatal("acknowledged terminal cancellation was not retired", err)
	}

}

func TestIntegrationRemoteSweepMustFinishBeforeQuotaSettlement(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	u, _ := newUpload(t, f, client(), []byte("source"))
	mustExec(t, f, `UPDATE catalog.upload_sessions SET state='completed',parts_cleaned=true WHERE id=$1`, u.ID)
	mustExec(t, f, `INSERT INTO catalog.processing_jobs(id,video_id,state,updated_at) VALUES($1,$2,'failed',now()-interval '2 hours')`, uuid.NewString(), u.VideoID)
	key := "images/" + uuid.NewString() + ".jpg"
	failDelete, failPage := true, true
	deletes := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/xml")
		if r.Method == "DELETE" {
			deletes++
			if failDelete {
				w.WriteHeader(503)
				fmt.Fprint(w, "<Error><Code>ServiceUnavailable</Code></Error>")
				return
			}
			w.WriteHeader(204)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/originals") {
			fmt.Fprint(w, "<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>")
			return
		}
		if r.URL.Query().Get("continuation-token") == "page2" {
			if failPage {
				w.WriteHeader(503)
				fmt.Fprint(w, "<Error><Code>ServiceUnavailable</Code></Error>")
				return
			}
			fmt.Fprint(w, "<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>")
			return
		}
		fmt.Fprintf(w, "<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>page2</NextContinuationToken><Contents><Key>%s</Key><LastModified>%s</LastModified><Size>1</Size></Contents></ListBucketResult>", key, time.Now().Add(-3*time.Hour).UTC().Format(time.RFC3339))
	}))
	defer server.Close()
	client := s3.New(s3.Options{Region: "us-east-1", BaseEndpoint: aws.String(server.URL), UsePathStyle: true, RetryMaxAttempts: 1, Credentials: aws.CredentialsProviderFunc(func(context.Context) (aws.Credentials, error) {
		return aws.Credentials{AccessKeyID: "test", SecretAccessKey: "test"}, nil
	})})
	f.App.Objects = &objectstore.Remote{Client: client, Originals: "originals", Processed: "processed"}
	var before int64
	if err := f.DB.Pool.QueryRow(ctx, "SELECT reserved_bytes FROM catalog.upload_sessions WHERE id=$1", u.ID).Scan(&before); err != nil {
		t.Fatal(err)
	}
	for round := 0; round < 4; round++ {
		f.App.objectSweepAt = time.Time{}
		if round == 1 {
			failDelete = false
		}
		if round == 3 {
			failPage = false
		}
		f.App.reconcileMedia(ctx)
		var reserved int64
		if err := f.DB.Pool.QueryRow(ctx, "SELECT reserved_bytes FROM catalog.upload_sessions WHERE id=$1", u.ID).Scan(&reserved); err != nil {
			t.Fatal(err)
		}
		if round < 3 && reserved != before {
			t.Fatalf("quota released before remote cleanup finished at round %d", round)
		}
		if round == 3 && reserved != u.ExpectedBytes {
			t.Fatalf("confirmed cleanup did not settle quota: %d", reserved)
		}
	}
	if deletes != 2 {
		t.Fatal("failed deletion was skipped or successful page repeated", deletes)
	}
}

func TestIntegrationOperatorWorkspacePermissionsAndAuditedActions(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	owner := client()
	u, _ := newUpload(t, f, owner, []byte("operator-source"))
	operator := client()
	me, _, _ := registerUser(t, f, operator)
	mustExec(t, f, "UPDATE catalog.users SET role='operator' WHERE id=$1", me.User.ID)
	job := uuid.NewString()
	mustExec(t, f, `INSERT INTO catalog.processing_jobs(id,video_id,state,attempt) VALUES($1,$2,'failed',1)`, job, u.VideoID)
	for _, check := range []struct {
		c    *http.Client
		want int
	}{{client(), 401}, {owner, 403}, {operator, 200}} {
		status, _, _ := request(t, check.c, f.Server.URL, "GET", "/api/v1/operator/jobs", nil, nil)
		if status != check.want {
			t.Fatal("operator authorization", status, check.want)
		}
	}
	status, _, _ := request(t, operator, f.Server.URL, "GET", "/api/v1/uploads/"+u.ID, nil, nil)
	if status != 404 {
		t.Fatal("operator role bypassed private owner upload access")
	}
	for _, action := range []string{"retry", "cancel"} {
		status, data, _ := request(t, operator, f.Server.URL, "POST", "/api/v1/operator/jobs/"+job+"/"+action, map[string]string{"note": "Maintainer requested " + action}, nil)
		if status != 200 {
			t.Fatalf("operator %s: %d %s", action, status, data)
		}
	}
	var audits int
	if err := f.DB.Pool.QueryRow(ctx, "SELECT count(*) FROM catalog.operator_actions WHERE job_id=$1 AND actor_id=$2", job, me.User.ID).Scan(&audits); err != nil || audits != 2 {
		t.Fatal("operator actions were not audited", audits, err)
	}
	mustExec(t, f, "UPDATE catalog.processing_jobs SET state='failed',attempt=3 WHERE id=$1", job)
	status, _, _ = request(t, operator, f.Server.URL, "POST", "/api/v1/operator/jobs/"+job+"/retry", map[string]string{"note": "Check exhausted budget"}, nil)
	if status != 409 {
		t.Fatal("operator bypassed attempt budget", status)
	}
	mustExec(t, f, "UPDATE catalog.users SET role='member' WHERE id=$1", me.User.ID)
	status, _, _ = request(t, operator, f.Server.URL, "GET", "/api/v1/operator/jobs", nil, nil)
	if status != 403 {
		t.Fatal("revoked role retained operator access")
	}
}
