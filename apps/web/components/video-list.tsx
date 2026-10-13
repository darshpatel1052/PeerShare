"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { duration, type Video, type VideosPage } from "../lib/api";
import { useResource } from "../lib/use-resource";
export default function VideoList({ channelID }: { channelID?: string }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [items, setItems] = useState<Video[]>([]);
  const params = new URLSearchParams({ limit: "12" });
  if (channelID) params.set("channel_id", channelID);
  if (cursor) params.set("cursor", cursor);
  const { state, retry } = useResource<VideosPage>(`/videos?${params}`);
  useEffect(() => {
    if (state.status === "ready")
      setItems((previous) =>
        cursor
          ? [
              ...previous,
              ...state.value.items.filter(
                (item) => !previous.some((old) => old.id === item.id),
              ),
            ]
          : state.value.items,
      );
  }, [state, cursor]);
  return (
    <section
      aria-label="Published videos"
      aria-busy={state.status === "loading"}
    >
      {state.status === "loading" && (
        <p role="status" className="muted">
          {items.length ? "Loading more videos…" : "Loading videos…"}
        </p>
      )}
      {state.status === "error" && (
        <div className="error" role="alert" data-testid="catalogue-error">
          <p>{state.error.message}</p>
          <button onClick={retry}>Retry videos</button>
        </div>
      )}
      {state.status === "ready" && items.length === 0 && (
        <p className="notice">
          No videos have been published on this channel yet.
        </p>
      )}
      <div className="video-grid">
        {items.map((item) => (
          <Link
            key={item.id}
            className="video-card"
            href={`/watch?v=${item.id}`}
          >
            <div className="poster">
              <img src={item.thumbnail_url} alt={`Preview of ${item.title}`} />
              <span className="duration">
                {duration(item.duration_seconds)}
              </span>
            </div>
            <h3>{item.title}</h3>
            <p className="muted">
              {item.channel_title}
              {item.source_kind === "fixture"
                ? " · Generated compatibility fixture"
                : ""}
            </p>
          </Link>
        ))}
      </div>
      {state.status === "ready" && state.value.next_cursor && (
        <button
          className="secondary-button"
          onClick={() => setCursor(state.value.next_cursor)}
        >
          Load more
        </button>
      )}
    </section>
  );
}
