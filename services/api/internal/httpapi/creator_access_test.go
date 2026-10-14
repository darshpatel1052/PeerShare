package httpapi

import (
	"context"
	"testing"
)

func TestIntegrationCreatorApprovalGrantExpiryAndRevocation(t *testing.T) {
	f := setup(t)
	owner := client()
	u, me := newUpload(t, f, owner, []byte("a bounded source chunk"))
	token := partToken(t, f, owner, u, 1)
	f.App.Config.Environment = "production"
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
