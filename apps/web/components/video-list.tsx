"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { duration, type Video, type VideosPage } from "../lib/api";
import { useResource } from "../lib/use-resource";
import { useAuth } from "./auth-provider";
import { Avatar, Icon, LoadingState } from "./ui";
import { PlayerIcon } from "./player-icon";

export function VideoCard({
  item,
  featured = false,
}: {
  item: Video;
  featured?: boolean;
}) {
  return (
    <article className={featured ? "featured-video" : "video-card"}>
      <Link
        className="poster"
        href={`/watch?v=${item.id}`}
        aria-label={`Watch ${item.title}`}
      >
        <img
          src={item.thumbnail_url}
          alt={`Preview of ${item.title}`}
          loading={featured ? "eager" : "lazy"}
          decoding="async"
        />
        <span className="poster-play" aria-hidden="true">
          <PlayerIcon name="play" />
        </span>
        <span className="duration">{duration(item.duration_seconds)}</span>
      </Link>
      <div className={featured ? "featured-info" : "video-info"}>
        <h3>
          <Link href={`/watch?v=${item.id}`}>{item.title}</Link>
        </h3>
        <Link className="card-creator" href={`/channel?id=${item.channel_id}`}>
          <Avatar name={item.channel_title} />
          <span>
            {item.channel_title}
            <small>@{item.channel_handle}</small>
          </span>
        </Link>
        {featured && <p className="featured-description">{item.description}</p>}
        <div className="video-card-meta">
          <time dateTime={item.published_at}>
            {new Intl.DateTimeFormat("en", {
              month: "short",
              day: "numeric",
              year: "numeric",
            }).format(new Date(item.published_at))}
          </time>
          {item.qualities.some((quality) => quality >= 720) && (
            <span className="quality-tag">HD</span>
          )}
        </div>
        {featured && item.tags.length > 0 && (
          <div className="video-tags">
            {item.tags.slice(0, 3).map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        )}
        {featured && (
          <Link className="button featured-watch" href={`/watch?v=${item.id}`}>
            <PlayerIcon name="play" />
            Watch video
            <Icon name="arrow" />
          </Link>
        )}
      </div>
    </article>
  );
}
export default function VideoList({
  channelID,
  featured = false,
  owner = false,
  following = false,
}: {
  channelID?: string;
  featured?: boolean;
  owner?: boolean;
  following?: boolean;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [collection, setCollection] = useState<{
    scope: string;
    items: Video[];
  }>({ scope: "", items: [] });
  const [query, setQuery] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const scope = `${channelID ?? "all"}:${following}:${search}`;
  const items = collection.scope === scope ? collection.items : [];
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setCursor(null);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  const { me } = useAuth();
  const params = new URLSearchParams({ limit: "12" });
  if (channelID) params.set("channel_id", channelID);
  if (cursor) params.set("cursor", cursor);
  if (search) params.set("q", search);
  if (following) params.set("feed", "following");
  const { state, retry } = useResource<VideosPage>(`/videos?${params}`);
  useEffect(() => {
    if (state.status !== "ready") return;
    if (!search && !cursor)
      setTopics(
        [...new Set(state.value.items.flatMap((item) => item.tags))]
          .filter((tag) => tag !== "showcase")
          .slice(0, 7),
      );
    setCollection((previous) => {
      const old = previous.scope === scope ? previous.items : [];
      return {
        scope,
        items: cursor
          ? [
              ...old,
              ...state.value.items.filter(
                (item) => !old.some((value) => value.id === item.id),
              ),
            ]
          : state.value.items,
      };
    });
  }, [state, cursor, scope]);
  const matches = items;
  const spotlight = featured && !search;
  const channels = items
    .filter(
      (item, index) =>
        items.findIndex((video) => video.channel_id === item.channel_id) ===
        index,
    )
    .slice(0, 4);
  return (
    <section
      className="catalogue"
      aria-label="Published videos"
      aria-busy={state.status === "loading"}
    >
      {(featured || following) && (
        <div className="explore-heading">
          <div>
            <span className="page-kicker">
              {following ? "Your subscriptions" : "Find your next watch"}
            </span>
            <h1>{following ? "Following" : "Explore"}</h1>
            <p className="muted">
              {following
                ? "The latest from channels you follow."
                : "Discover the latest from creators."}
            </p>
          </div>
          <Link
            className="secondary-button"
            href={me?.channel ? `/channel?id=${me.channel.id}` : "/account"}
          >
            {me?.channel ? "Your channel" : "Create a channel"}
            <Icon name="arrow" />
          </Link>
        </div>
      )}
      <>
        <div className="catalogue-toolbar">
          <div className="catalogue-label">
            <Icon name="film" />
            <span>
              {query
                ? "Search results"
                : following
                  ? "Following"
                  : channelID
                    ? "All videos"
                    : "Latest videos"}
            </span>
          </div>
          <div className="catalogue-search">
            <Icon name="search" />
            <input
              aria-label="Search videos"
              maxLength={120}
              placeholder="Search videos"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                className="icon-button"
                aria-label="Clear video search"
                onClick={() => setQuery("")}
              >
                <Icon name="close" />
              </button>
            )}
          </div>
        </div>
      </>
      {(featured || following) && topics.length > 0 && (
        <nav className="topic-tabs" aria-label="Browse video topics">
          <button
            className={!query ? "selected" : ""}
            aria-pressed={!query}
            onClick={() => setQuery("")}
          >
            All videos
          </button>
          {topics.map((topic) => (
            <button
              key={topic}
              aria-pressed={query === topic}
              className={query === topic ? "selected" : ""}
              onClick={() => setQuery(topic)}
            >
              {topic}
            </button>
          ))}
        </nav>
      )}
      <div className={spotlight ? "discovery-layout" : ""}>
        <div className="discovery-feed">
          {state.status === "loading" &&
            (items.length ? (
              <LoadingState label="Loading more videos…" />
            ) : (
              <div
                className="catalogue-skeleton"
                role="status"
                aria-label="Loading videos"
              >
                <div className="skeleton-poster" />
                <div className="skeleton-line" />
                <div className="skeleton-line short" />
                <span className="sr-only">Loading videos…</span>
              </div>
            ))}
          {state.status === "error" && (
            <div className="error" role="alert" data-testid="catalogue-error">
              <p>{state.error.message}</p>
              <button onClick={retry}>Retry videos</button>
            </div>
          )}
          {state.status === "ready" && items.length === 0 && !search && (
            <div className="empty-channel">
              <div className="empty-frame">
                <Icon name="film" />
                <span className="empty-frame-corner" />
              </div>
              <h2>No videos yet</h2>
              <p className="muted">
                {channelID
                  ? "No videos have been published on this channel yet."
                  : following
                    ? "Follow channels to see their latest videos here."
                    : "There are no published videos to explore yet."}
              </p>
              {owner && (
                <p className="empty-hint">
                  Publish your first video from Studio.
                </p>
              )}
              <Link className="secondary-button" href={owner ? "/studio" : "/"}>
                {owner ? "Upload a video" : "Back to explore"}
                <Icon name="arrow" />
              </Link>
            </div>
          )}
          {search && state.status === "ready" && matches.length === 0 && (
            <div className="search-empty">
              <Icon name="search" />
              <h2>No matching videos</h2>
              <p className="muted">Try a different title, creator or tag.</p>
              <button className="text-button" onClick={() => setQuery("")}>
                Clear search
              </button>
            </div>
          )}
          {spotlight && matches[0] && <VideoCard item={matches[0]} featured />}
          <div className="video-grid">
            {(spotlight ? matches.slice(1) : matches).map((item) => (
              <VideoCard key={item.id} item={item} />
            ))}
          </div>
          {state.status === "ready" && state.value.next_cursor && (
            <button
              className="secondary-button"
              onClick={() => setCursor(state.value.next_cursor)}
            >
              Load more
              <Icon name="arrow" />
            </button>
          )}
        </div>
        {spotlight && (
          <aside
            className="discovery-aside"
            aria-label="Discover channels and your library"
          >
            {channels.length > 0 && (
              <section className="discovery-panel">
                <div className="section-heading">
                  <h2>Channels</h2>
                  <Icon name="channel" />
                </div>
                <p className="muted">Meet the creators behind these videos.</p>
                <div className="discovery-channels">
                  {channels.map((channel) => (
                    <Link
                      key={channel.channel_id}
                      href={`/channel?id=${channel.channel_id}`}
                    >
                      <Avatar name={channel.channel_title} />
                      <span>
                        <strong>{channel.channel_title}</strong>
                        <small>@{channel.channel_handle}</small>
                      </span>
                      <Icon name="arrow" />
                    </Link>
                  ))}
                </div>
              </section>
            )}
            <section className="library-invitation">
              <span className="invitation-icon">
                <Icon name="bookmark" />
              </span>
              <h2>Make room for your favorites.</h2>
              <p>
                Keep videos in playlists and find the latest from channels you
                follow.
              </p>
              <Link className="secondary-button" href="/library">
                Open your library
                <Icon name="arrow" />
              </Link>
            </section>
            {me?.channel && (
              <Link className="creator-shortcut" href="/studio">
                <Icon name="plus" />
                <span>
                  <strong>Share your next video</strong>
                  <small>Open Creator studio</small>
                </span>
                <Icon name="arrow" />
              </Link>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
