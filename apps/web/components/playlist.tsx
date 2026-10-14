"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  api,
  ApiError,
  duration,
  resourceID,
  type PlaylistDetail,
} from "../lib/api";
import { useResource } from "../lib/use-resource";
import { useAuth } from "./auth-provider";
import { Icon, LoadingState } from "./ui";

export default function PlaylistPage() {
  const id = resourceID(useSearchParams().get("id"), "playlist");
  const { me, loading } = useAuth();
  return (
    <main id="main" className="playlist-page">
      {id ? (
        <PlaylistContents
          key={`${id}:${me?.user.id ?? "guest"}`}
          id={id}
          accountLoading={loading}
        />
      ) : (
        <Unavailable />
      )}
    </main>
  );
}
function Unavailable() {
  return (
    <div className="page-state">
      <Icon name="list" />
      <h1>Playlist unavailable</h1>
      <p className="muted">This playlist is private or no longer available.</p>
      <Link className="button" href="/library">
        Your library
        <Icon name="arrow" />
      </Link>
    </div>
  );
}
function PlaylistContents({
  id,
  accountLoading,
}: {
  id: string;
  accountLoading: boolean;
}) {
  const router = useRouter();
  const resource = useResource<PlaylistDetail>(
    accountLoading ? null : `/playlists/${id}`,
  );
  const [updated, setUpdated] = useState<PlaylistDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const detail =
    updated ??
    (resource.state.status === "ready" ? resource.state.value : null);
  useEffect(() => {
    if (detail && !editing) {
      setTitle(detail.playlist.title);
      setVisibility(detail.playlist.visibility);
    }
  }, [detail, editing]);
  async function mutate(path: string, method: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      setUpdated(await api<PlaylistDetail>(path, { method, body }));
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Please retry your change.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (
      !detail ||
      !window.confirm(
        `Delete “${detail.playlist.title}”? Saved videos will remain available on their channels.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(`/playlists/${id}`, {
        method: "DELETE",
        body: { revision: detail.playlist.revision },
      });
      router.push("/library");
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404)
        router.push("/library");
      else
        setError(
          cause instanceof Error ? cause.message : "Please retry deletion.",
        );
    } finally {
      setBusy(false);
    }
  }
  async function move(index: number, direction: number) {
    if (!detail) return;
    const ids = detail.items.map((item) => item.video_id);
    [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
    await mutate(`/playlists/${id}/order`, "PUT", {
      revision: detail.playlist.revision,
      video_ids: ids,
    });
  }
  if (resource.state.status === "error" && resource.state.error.status === 404)
    return <Unavailable />;
  if (!detail) {
    if (resource.state.status === "error")
      return (
        <div className="error" role="alert">
          <p>{resource.state.error.message}</p>
          <button onClick={resource.retry}>Retry playlist</button>
        </div>
      );
    return <LoadingState label="Loading playlist…" />;
  }
  const first = detail.items.find((item) => item.video)?.video;
  return (
    <>
      <div className="watch-breadcrumb">
        <Link href="/library">Library</Link>
        <span>/</span>
        <span>Playlist</span>
      </div>
      <header className="playlist-heading">
        <div className="playlist-cover">
          {first ? (
            <img src={first.thumbnail_url} alt="" />
          ) : (
            <Icon name="list" />
          )}
        </div>
        <div>
          <span className="visibility-badge">
            <Icon
              name={detail.playlist.visibility === "private" ? "lock" : "share"}
            />
            {detail.playlist.visibility === "private"
              ? "Private playlist"
              : "Public playlist"}
          </span>
          <h1>{detail.playlist.title}</h1>
          <p className="muted">
            {detail.items.length}{" "}
            {detail.items.length === 1 ? "video" : "videos"}
          </p>
          <div className="playlist-heading-actions">
            {first && (
              <Link
                className="button"
                href={`/watch?v=${first.id}&playlist=${id}&autoplay=1`}
              >
                <Icon name="play" />
                Play playlist
              </Link>
            )}
            {detail.is_owner && (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => setEditing((value) => !value)}
              >
                Edit playlist
                <Icon name="settings" />
              </button>
            )}
            {detail.playlist.visibility === "public" && (
              <button
                className="secondary-button"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(
                      new URL(`/playlist/?id=${id}`, window.location.origin)
                        .href,
                    )
                    .then(() => setCopied(true))
                    .catch(() =>
                      setError(
                        "Couldn't copy the link. You can copy it from your address bar.",
                      ),
                    );
                }}
              >
                <Icon name={copied ? "check" : "share"} />
                {copied ? "Link copied" : "Share playlist"}
              </button>
            )}
          </div>
        </div>
      </header>
      {editing && detail.is_owner && (
        <form
          className="playlist-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            void mutate(`/playlists/${id}`, "PATCH", {
              title: title.trim(),
              visibility,
              revision: detail.playlist.revision,
            }).then((saved) => {
              if (saved) setEditing(false);
            });
          }}
        >
          <div className="form-field">
            <label htmlFor="playlist-title">Playlist name</label>
            <input
              id="playlist-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={100}
              disabled={busy}
            />
          </div>
          <div className="form-field">
            <label htmlFor="playlist-visibility">Visibility</label>
            <select
              id="playlist-visibility"
              value={visibility}
              onChange={(event) =>
                setVisibility(event.target.value as "private" | "public")
              }
              disabled={busy}
            >
              <option value="private">Private · only you</option>
              <option value="public">Public · anyone with the link</option>
            </select>
          </div>
          <div className="playlist-edit-actions">
            <button className="button" disabled={busy || !title.trim()}>
              {busy ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              className="text-button danger"
              disabled={busy}
              onClick={() => void remove()}
            >
              <Icon name="trash" />
              Delete playlist
            </button>
          </div>
        </form>
      )}
      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
          <button
            onClick={() => {
              setUpdated(null);
              resource.retry();
            }}
          >
            Reload playlist
          </button>
        </div>
      )}
      {!detail.items.length && (
        <div className="library-empty">
          <Icon name="bookmark" />
          <h2>No videos in this playlist</h2>
          <p className="muted">
            Save videos from their watch pages to add them here.
          </p>
          <Link className="secondary-button" href="/">
            Explore videos
            <Icon name="arrow" />
          </Link>
        </div>
      )}
      <ol className="playlist-items">
        {detail.items.map((item, index) => (
          <li key={item.video_id} className="playlist-item">
            <span className="playlist-position">{index + 1}</span>
            {item.video ? (
              <Link
                className="playlist-video"
                href={`/watch?v=${item.video.id}&playlist=${id}`}
              >
                <img src={item.video.thumbnail_url} alt="" />
                <div>
                  <h3>{item.video.title}</h3>
                  <p className="muted">
                    {item.video.channel_title}
                    <span>·</span>
                    {duration(item.video.duration_seconds)}
                  </p>
                </div>
              </Link>
            ) : (
              <div className="playlist-video unavailable">
                <div className="unavailable-poster">
                  <Icon name="film" />
                </div>
                <div>
                  <h3>Video unavailable</h3>
                  <p className="muted">
                    This video is private or has been removed.
                  </p>
                </div>
              </div>
            )}
            {detail.is_owner && (
              <div className="playlist-item-actions">
                <button
                  className="icon-button"
                  aria-label={`Move ${item.video?.title ?? "unavailable video"} up`}
                  disabled={busy || index === 0}
                  onClick={() => void move(index, -1)}
                >
                  <Icon name="up" />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Move ${item.video?.title ?? "unavailable video"} down`}
                  disabled={busy || index === detail.items.length - 1}
                  onClick={() => void move(index, 1)}
                >
                  <Icon name="down" />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Remove ${item.video?.title ?? "unavailable video"} from playlist`}
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      `/playlists/${id}/items/${item.video_id}`,
                      "DELETE",
                      { revision: detail.playlist.revision },
                    )
                  }
                >
                  <Icon name="close" />
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}
