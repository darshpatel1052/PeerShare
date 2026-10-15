package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/darshpatel1052/Peer-Screen/services/api/internal/store"
	"github.com/google/uuid"
)

// Controlled catalogue metadata exercises library visibility/search. Actual
// encoding/playback is proved separately through connected upload/browser tests.
func libraryVideo(t *testing.T, f *testApp, channelID, title string) string {
	t.Helper()
	id := uuid.NewString()
	mustExec(t, f, `INSERT INTO catalog.videos(id,channel_id,title,tags,description,source_kind,processing_state,publication_state,duration_seconds,accepted_generation_id,accepted_attempt_id,manifest_key,integrity_key,thumbnail_key,qualities,published_at) VALUES($1,$2,$3,ARRAY['cinema','journey'],'A recorded journey','upload','ready','published',60,$4,$5,'fixture/master.m3u8','fixture/integrity.json','fixture/thumbnail.jpg',ARRAY[480,720],now())`, id, channelID, title, uuid.NewString(), uuid.NewString())
	return id
}
func libraryRequest(t *testing.T, f *testApp, c *http.Client, method, path string, body any, expected int, target any, headers map[string]string) {
	t.Helper()
	status, data, _ := request(t, c, f.Server.URL, method, path, body, headers)
	if status != expected {
		t.Fatalf("%s %s: got %d, want %d: %s", method, path, status, expected, data)
	}
	if target != nil && json.Unmarshal(data, target) != nil {
		t.Fatal("invalid library response")
	}
}
func TestIntegrationSubscriptionsReplayFollowingAndSearch(t *testing.T) {
	f := setup(t)
	owner := client()
	registerUser(t, f, owner)
	channel := createChannel(t, f, owner, "library-creator")
	viewer := client()
	me, _, _ := registerUser(t, f, viewer)
	first := libraryVideo(t, f, channel.ID, "Hidden compass film")
	second := libraryVideo(t, f, channel.ID, "Second compass film")
	_ = second
	libraryRequest(t, f, client(), "POST", "/api/v1/channels/"+channel.ID+"/subscription", map[string]any{}, 401, nil, nil)
	libraryRequest(t, f, client(), "GET", "/api/v1/videos?feed=following", nil, 401, nil, nil)
	var sub store.Subscription
	for range 2 {
		libraryRequest(t, f, viewer, "POST", "/api/v1/channels/"+channel.ID+"/subscription", map[string]any{}, 200, &sub, nil)
		if !sub.Following || sub.Followers != 1 {
			t.Fatal("follow replay duplicated a pair")
		}
	}
	// Eight simultaneous equivalent follows remain one persisted relationship.
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := f.DB.SetSubscription(context.Background(), me.User.ID, channel.ID, true)
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	var page store.VideosPage
	libraryRequest(t, f, viewer, "GET", "/api/v1/videos?feed=following&q=compass&limit=1", nil, 200, &page, nil)
	if len(page.Items) != 1 || page.NextCursor == nil {
		t.Fatal("following search did not paginate")
	}
	var next store.VideosPage
	libraryRequest(t, f, viewer, "GET", "/api/v1/videos?feed=following&q=compass&limit=1&cursor="+*page.NextCursor, nil, 200, &next, nil)
	if len(next.Items) != 1 || next.Items[0].ID == page.Items[0].ID {
		t.Fatal("search cursor repeated a result")
	}
	libraryRequest(t, f, client(), "GET", "/api/v1/videos?q=cinema", nil, 200, &page, nil)
	if len(page.Items) != 2 {
		t.Fatal("tag search missed metadata")
	}
	mustExec(t, f, `UPDATE catalog.videos SET title='Revised observatory',tags=ARRAY['stars'] WHERE id=$1`, first)
	libraryRequest(t, f, client(), "GET", "/api/v1/videos?q=observatory", nil, 200, &page, nil)
	if len(page.Items) != 1 || page.Items[0].ID != first {
		t.Fatal("search trigger missed edited title")
	}
	mustExec(t, f, `UPDATE catalog.videos SET publication_state='unpublished' WHERE id=$1`, first)
	libraryRequest(t, f, client(), "GET", "/api/v1/videos?q=observatory", nil, 200, &page, nil)
	if len(page.Items) != 0 {
		t.Fatal("search exposed unpublished metadata")
	}
	libraryRequest(t, f, viewer, "DELETE", "/api/v1/channels/"+channel.ID+"/subscription", nil, 200, &sub, nil)
	libraryRequest(t, f, viewer, "DELETE", "/api/v1/channels/"+channel.ID+"/subscription", nil, 200, &sub, nil)
	if sub.Following || sub.Followers != 0 {
		t.Fatal("unfollow did not persist")
	}
	libraryRequest(t, f, viewer, "GET", "/api/v1/videos?feed=following", nil, 200, &page, nil)
	if len(page.Items) != 0 {
		t.Fatal("unfollowed channel remained in following feed")
	}
	libraryRequest(t, f, viewer, "GET", "/api/v1/videos?q="+strings.Repeat("a", 121), nil, 400, nil, nil)
	libraryRequest(t, f, viewer, "POST", "/api/v1/channels/"+channel.ID+"/subscription", map[string]any{}, 403, nil, map[string]string{"Origin": "https://invalid.example"})
}

func TestIntegrationSearchMergesChannelAndTextMatchesWithoutDuplicates(t *testing.T) {
	f := setup(t)
	owner := client()
	registerUser(t, f, owner)
	channel := createChannel(t, f, owner, "compass-workshop")
	mustExec(t, f, `UPDATE catalog.channels SET title='Compass Workshop' WHERE id=$1`, channel.ID)
	both := libraryVideo(t, f, channel.ID, "Compass navigation")
	channelOnly := libraryVideo(t, f, channel.ID, "River navigation")
	hidden := libraryVideo(t, f, channel.ID, "Compass private cut")
	mustExec(t, f, `UPDATE catalog.videos SET publication_state='unpublished' WHERE id=$1`, hidden)
	fixture := libraryVideo(t, f, channel.ID, "Compass fixture")
	mustExec(t, f, `UPDATE catalog.videos SET source_kind='fixture' WHERE id=$1`, fixture)
	f.App.Config.ExposeOperatorFixture = false
	otherOwner := client()
	registerUser(t, f, otherOwner)
	other := createChannel(t, f, otherOwner, "river-workshop")
	textOnly := libraryVideo(t, f, other.ID, "Compass film")
	seen := map[string]bool{}
	path := "/api/v1/videos?q=compass&limit=1"
	for range 4 {
		var page store.VideosPage
		libraryRequest(t, f, client(), "GET", path, nil, 200, &page, nil)
		for _, v := range page.Items {
			if seen[v.ID] {
				t.Fatal("a video matching both branches appeared twice")
			}
			seen[v.ID] = true
		}
		if page.NextCursor == nil {
			break
		}
		path = "/api/v1/videos?q=compass&limit=1&cursor=" + *page.NextCursor
	}
	if len(seen) != 3 || !seen[both] || !seen[channelOnly] || !seen[textOnly] {
		t.Fatalf("search lost a match or exposed a hidden video: %v", seen)
	}
	var page store.VideosPage
	libraryRequest(t, f, client(), "GET", "/api/v1/videos?q=compass&channel_id="+channel.ID, nil, 200, &page, nil)
	if len(page.Items) != 2 {
		t.Fatal("channel filter did not apply to both search branches")
	}
	viewer := client()
	registerUser(t, f, viewer)
	libraryRequest(t, f, viewer, "POST", "/api/v1/channels/"+other.ID+"/subscription", map[string]any{}, 200, nil, nil)
	libraryRequest(t, f, viewer, "GET", "/api/v1/videos?q=compass&feed=following", nil, 200, &page, nil)
	if len(page.Items) != 1 || page.Items[0].ID != textOnly {
		t.Fatal("following filter did not apply to both search branches")
	}
	libraryRequest(t, f, client(), "GET", "/api/v1/videos?q=unmatched-9zz", nil, 200, &page, nil)
	if len(page.Items) != 0 {
		t.Fatal("absent term returned a video")
	}
}
func TestIntegrationPlaylistsOwnershipVisibilityOrderAndReplay(t *testing.T) {
	f := setup(t)
	owner := client()
	me, _, _ := registerUser(t, f, owner)
	channel := createChannel(t, f, owner, "playlist-creator")
	first := libraryVideo(t, f, channel.ID, "Compass film")
	second := libraryVideo(t, f, channel.ID, "River film")
	outsider := client()
	registerUser(t, f, outsider)
	key := uuid.NewString()
	body := map[string]any{"title": "Weekend films", "visibility": "private"}
	headers := map[string]string{"Idempotency-Key": key}
	var p store.Playlist
	libraryRequest(t, f, owner, "POST", "/api/v1/playlists", body, 201, &p, headers)
	var replay store.Playlist
	libraryRequest(t, f, owner, "POST", "/api/v1/playlists", body, 201, &replay, headers)
	if replay.ID != p.ID {
		t.Fatal("create replay minted another playlist")
	}
	libraryRequest(t, f, owner, "POST", "/api/v1/playlists", map[string]any{"title": "Other title", "visibility": "private"}, 409, nil, headers)
	path := "/api/v1/playlists/" + p.ID
	libraryRequest(t, f, client(), "GET", path, nil, 404, nil, nil)
	libraryRequest(t, f, outsider, "GET", path, nil, 404, nil, nil)
	libraryRequest(t, f, outsider, "PATCH", path, map[string]any{"title": "Stolen", "visibility": "public", "revision": 1}, 404, nil, nil)
	var detail store.PlaylistDetail
	libraryRequest(t, f, owner, "POST", path+"/items", map[string]any{"video_id": first, "revision": p.Revision}, 200, &detail, nil)
	libraryRequest(t, f, owner, "POST", path+"/items", map[string]any{"video_id": first, "revision": detail.Playlist.Revision}, 200, &detail, nil)
	if len(detail.Items) != 1 || detail.Playlist.Revision != 2 {
		t.Fatal("duplicate add changed the playlist")
	}
	libraryRequest(t, f, owner, "POST", path+"/items", map[string]any{"video_id": second, "revision": detail.Playlist.Revision}, 200, &detail, nil)
	revision := detail.Playlist.Revision
	libraryRequest(t, f, owner, "PUT", path+"/order", map[string]any{"video_ids": []string{second, second}, "revision": revision}, 409, nil, nil)
	libraryRequest(t, f, owner, "GET", path, nil, 200, &detail, nil)
	if detail.Items[0].VideoID != first || detail.Playlist.Revision != revision {
		t.Fatal("invalid order partially mutated rows")
	}
	libraryRequest(t, f, owner, "PUT", path+"/order", map[string]any{"video_ids": []string{second, first}, "revision": revision}, 200, &detail, nil)
	if detail.Items[0].VideoID != second || detail.Items[0].Position != 0 || detail.Items[1].Position != 1 {
		t.Fatal("order did not commit atomically")
	}
	libraryRequest(t, f, owner, "PATCH", path, map[string]any{"title": "Stale rename", "visibility": "private", "revision": revision}, 409, nil, nil)
	libraryRequest(t, f, owner, "PATCH", path, map[string]any{"title": "Weekend films", "visibility": "public", "revision": detail.Playlist.Revision}, 200, &detail, nil)
	libraryRequest(t, f, client(), "GET", path, nil, 200, &detail, nil)
	if detail.IsOwner || len(detail.Items) != 2 || detail.Items[0].Video.ThumbnailURL == "" {
		t.Fatal("public playlist contract incorrect")
	}
	mustExec(t, f, `UPDATE catalog.videos SET publication_state='unpublished' WHERE id=$1`, second)
	libraryRequest(t, f, client(), "GET", path, nil, 200, &detail, nil)
	if len(detail.Items) != 1 || detail.Items[0].VideoID != first || detail.Items[0].Position != 0 {
		t.Fatal("public playlist exposed unavailable item")
	}
	libraryRequest(t, f, owner, "GET", path, nil, 200, &detail, nil)
	if len(detail.Items) != 2 || detail.Items[0].Video != nil || !detail.IsOwner {
		t.Fatal("owner could not identify unavailable item for removal")
	}
	libraryRequest(t, f, owner, "DELETE", path+"/items/"+second, map[string]any{"revision": detail.Playlist.Revision}, 200, &detail, nil)
	if len(detail.Items) != 1 || detail.Items[0].Position != 0 {
		t.Fatal("removal did not close ordering gap")
	}
	libraryRequest(t, f, owner, "DELETE", path, map[string]any{"revision": detail.Playlist.Revision}, 204, nil, nil)
	libraryRequest(t, f, client(), "GET", path, nil, 404, nil, nil)
	// Deleted request keys cannot resurrect a playlist through an old retry.
	libraryRequest(t, f, owner, "POST", "/api/v1/playlists", body, 409, nil, headers)
	var count int
	if err := f.DB.Pool.QueryRow(context.Background(), `SELECT count(*) FROM catalog.playlists WHERE owner_id=$1`, me.User.ID).Scan(&count); err != nil || count != 0 {
		t.Fatal("deleted playlist resurrected")
	}
}
func TestIntegrationConcurrentPlaylistCreationAndRevision(t *testing.T) {
	f := setup(t)
	owner := client()
	me, _, _ := registerUser(t, f, owner)
	id := uuid.NewString()
	var wg sync.WaitGroup
	results := make(chan store.Playlist, 8)
	errs := make(chan error, 8)
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p, err := f.DB.CreatePlaylist(context.Background(), me.User.ID, id, "Concurrent library", "private")
			results <- p
			errs <- err
		}()
	}
	wg.Wait()
	close(results)
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	var p store.Playlist
	for result := range results {
		if p.ID != "" && p.ID != result.ID {
			t.Fatal("concurrent create duplicated playlist")
		}
		p = result
	}
	statuses := make(chan error, 2)
	for _, title := range []string{"First rename", "Second rename"} {
		wg.Add(1)
		go func(title string) {
			defer wg.Done()
			statuses <- f.DB.MutatePlaylist(context.Background(), p.ID, me.User.ID, store.PlaylistMutation{Action: "edit", Title: title, Visibility: "private", Revision: 1}, false)
		}(title)
	}
	wg.Wait()
	close(statuses)
	success, conflicts := 0, 0
	for err := range statuses {
		if err == nil {
			success++
		} else if err == store.ErrRevisionConflict {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflicts != 1 {
		t.Fatal("revision lock did not select one winner")
	}
}
