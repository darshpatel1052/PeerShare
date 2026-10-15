-- Synthetic metadata only. Run only in the dedicated peerscreen_benchmark DB.
DO $$ BEGIN IF current_database()<>'peerscreen_benchmark' THEN RAISE EXCEPTION 'Benchmark database required'; END IF; END $$;
BEGIN;
SET LOCAL statement_timeout='180s';
INSERT INTO catalog.users(id,email,display_name,password_hash)
 SELECT md5('benchmark:user:'||g)::uuid,'benchmark-'||g||'@example.test','Synthetic member '||g,NULL
 FROM generate_series(1,10000) g ON CONFLICT DO NOTHING;
INSERT INTO catalog.channels(id,owner_id,handle,title,description)
 SELECT md5('benchmark:channel:'||g)::uuid,md5('benchmark:user:'||g)::uuid,'benchmark-channel-'||g,
 (ARRAY['Go','PostgreSQL','Video','WebRTC','Design','Queues','Networking','Uploads','Caching','Tracing','Playlists','Performance'])[1+g%12]||' workshop '||g,
 'Synthetic channel in an isolated load-test database. Not a public creator.'
 FROM generate_series(1,1000) g ON CONFLICT DO NOTHING;
INSERT INTO catalog.videos(id,channel_id,title,description,tags,source_kind,processing_state,publication_state,duration_seconds,accepted_generation_id,accepted_attempt_id,manifest_key,integrity_key,thumbnail_key,qualities,published_at,created_at)
 SELECT md5('benchmark:video:'||g)::uuid,
 md5('benchmark:channel:'||(CASE WHEN g%10<7 THEN 1+g%50 ELSE 1+((g/10)*7+g%10)%1000 END))::uuid,
 (ARRAY['Go','PostgreSQL','Video','WebRTC','Design','Queues','Networking','Uploads','Caching','Tracing','Playlists','Performance'])[1+g%12]||': '||
 (ARRAY['A practical introduction','Behind the implementation','A visual workshop','Common patterns','From first principles','Design decisions','A detailed walkthrough'])[1+g%7]||' — '||g,
 repeat('Synthetic metadata record for query load testing. This record has no playable source. ',2+g%6),
 ARRAY[(ARRAY['go','postgresql','video','webrtc','design','queues','networking','uploads','caching','tracing','playlists','performance'])[1+g%12],'synthetic','benchmark'],
 'upload','ready','published',30+g%570,md5('benchmark:generation:'||g)::uuid,md5('benchmark:attempt:'||g)::uuid,
 'benchmark/metadata-only/'||g||'/master.m3u8','benchmark/metadata-only/'||g||'/integrity.json','benchmark/metadata-only/'||g||'/thumbnail.jpg',ARRAY[480,720],
 timestamptz '2026-10-01 00:00:00+00'+g*interval '1 second',timestamptz '2026-09-01 00:00:00+00'+g*interval '1 second'
 FROM generate_series(1,100000) g ON CONFLICT DO NOTHING;
INSERT INTO catalog.subscriptions(user_id,channel_id)
 SELECT md5('benchmark:user:'||u)::uuid,md5('benchmark:channel:'||(1+(u*31+c*17)%1000))::uuid
 FROM generate_series(1,10000) u CROSS JOIN generate_series(1,10) c ON CONFLICT DO NOTHING;
INSERT INTO catalog.playlists(id,owner_id,title,visibility)
 SELECT md5('benchmark:playlist:'||g)::uuid,md5('benchmark:user:'||g)::uuid,'Synthetic collection '||g,'private'
 FROM generate_series(1,10000) g ON CONFLICT DO NOTHING;
INSERT INTO catalog.playlist_items(playlist_id,video_id,position)
 SELECT md5('benchmark:playlist:'||u)::uuid,md5('benchmark:video:'||(1+(u*37+n*101)%100000))::uuid,n
 FROM generate_series(1,10000) u CROSS JOIN generate_series(0,9) n ON CONFLICT (playlist_id,video_id) DO NOTHING;
INSERT INTO catalog.playback_sessions(id,video_id,generation_id,attempt_id,token_hash,last_sequence,latest_metrics,measurement_mode)
 SELECT md5('benchmark:playback:'||g)::uuid,md5('benchmark:video:'||(1+g%10000))::uuid,
 md5('benchmark:generation:'||(1+g%10000))::uuid,md5('benchmark:attempt:'||(1+g%10000))::uuid,
 decode(md5('benchmark:capability:'||g)||md5('benchmark:capability:'||g),'hex'),1,
 jsonb_build_object('played_ms',30000,'http_bytes',1000000,'peer_bytes',250000,'uploaded_bytes',100000,'verified_segments',8,'rejected_segments',0,'rebuffer_ms',0,'rebuffer_count',0,'quality',480,'peer_sharing',true,'startup_ms',400),
 'verified_hls'
 FROM generate_series(1,20000) g ON CONFLICT DO NOTHING;
COMMIT;
ANALYZE catalog.users;
ANALYZE catalog.channels;
ANALYZE catalog.videos;
ANALYZE catalog.subscriptions;
ANALYZE catalog.playlists;
ANALYZE catalog.playlist_items;
ANALYZE catalog.playback_sessions;
SELECT json_build_object('syntheticUsers',(SELECT count(*) FROM catalog.users),'channels',(SELECT count(*) FROM catalog.channels),'activeChannels',(SELECT count(DISTINCT channel_id) FROM catalog.videos),'metadataVideos',(SELECT count(*) FROM catalog.videos),'subscriptions',(SELECT count(*) FROM catalog.subscriptions),'playlists',(SELECT count(*) FROM catalog.playlists),'playlistItems',(SELECT count(*) FROM catalog.playlist_items),'syntheticPlaybackRows',(SELECT count(*) FROM catalog.playback_sessions),'databaseBytes',pg_database_size(current_database()));
