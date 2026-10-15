package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"github.com/darshpatel1052/PeerShare/services/api/internal/store"
	"github.com/google/uuid"
)

func TestIntegrationCreatorApprovalGrantExpiryAndRevocation(t *testing.T) {
	f := setup(t)
	owner := client()
	u, me := newUpload(t, f, owner, []byte("a bounded source chunk"))
	token := partToken(t, f, owner, u, 1)
	f.App.Config.Environment = "production"
	f.App.Config.CreatorApprovalRequired = true
	path := "/api/v1/uploads/" + u.ID + "/parts/presign"
	libraryRequest(t, f, owner, "POST", path, map[string]any{"numbers": []int{1}}, 403, nil, nil)
	if err := f.DB.GrantCreator(context.Background(), me.User.ID, 24); err != nil {
		t.Fatal(err)
	}
	libraryRequest(t, f, owner, "POST", path, map[string]any{"numbers": []int{1}}, 200, nil, nil)
	if err := f.DB.RevokeCreator(context.Background(), me.User.ID); err != nil {
		t.Fatal(err)
	}
	if putBytes(t, f, owner, u, 1, []byte("a bounded source chunk"), token) != 403 {
		t.Fatal("revoked creator uploaded with previous part grant")
	}
	if err := f.DB.GrantCreator(context.Background(), me.User.ID, 24); err != nil {
		t.Fatal(err)
	}
	mustExec(t, f, `UPDATE catalog.creator_access SET granted_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE user_id=$1`, me.User.ID)
	libraryRequest(t, f, owner, "POST", path, map[string]any{"numbers": []int{1}}, 403, nil, nil)
	// Revocation does not prevent cleaning up one's previously reserved upload.
	libraryRequest(t, f, owner, "DELETE", "/api/v1/uploads/"+u.ID, nil, 204, nil, nil)
	libraryRequest(t, f, owner, "GET", "/api/v1/me", nil, 200, nil, nil)
}

func TestIntegrationProductionMembersCanCreateAndUploadWithoutApproval(t *testing.T) {
	f := setup(t)
	owner := client()
	me, _, _ := registerUser(t, f, owner)
	if me.User.Role != "member" {
		t.Fatal("ordinary creator must remain a member")
	}
	f.App.Config.Environment = "production"
	channel := createChannel(t, f, owner, "open-creator")
	libraryRequest(t, f, client(), "POST", "/api/v1/channels", map[string]string{"handle": "guest-channel", "title": "Guest"}, 401, nil, nil)
	libraryRequest(t, f, owner, "GET", "/api/v1/operator/jobs", nil, 403, nil, nil)
	if allowed, err := f.DB.CreatorAllowed(context.Background(), me.User.ID); err != nil || allowed {
		t.Fatal("test creator must have no invitation grant", err)
	}
	// Completion must reach processing for a member without approval. The
	// real-transcode test separately verifies playable output and publication.
	payload := []byte("a bounded source chunk")
	checksum := sha256.Sum256(payload)
	var upload store.Upload
	body := map[string]any{"channel_id": channel.ID, "title": "Member upload", "description": "", "tags": []string{}, "size": len(payload), "part_checksums": []string{hex.EncodeToString(checksum[:])}}
	libraryRequest(t, f, owner, "POST", "/api/v1/uploads", body, 201, &upload, map[string]string{"Idempotency-Key": uuid.NewString()})
	completeBytes(t, f, owner, upload, payload)
	f.App.Config.UploadsEnabled = false
	libraryRequest(t, f, owner, "POST", "/api/v1/uploads", body, 403, nil, map[string]string{"Idempotency-Key": uuid.NewString()})
}
