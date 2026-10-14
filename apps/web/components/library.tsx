"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import {
  api,
  type Playlist,
  type Playlists,
  type Subscriptions,
} from "../lib/api";
import { useResource } from "../lib/use-resource";
import { useAuth } from "./auth-provider";
import MemberGate from "./member-gate";
import { Avatar, Icon, LoadingState } from "./ui";

export default function Library() {
  const { me } = useAuth();
  return (
    <main id="main" className="viewer-library">
      <MemberGate
        title="Your library"
        description="Sign in to save videos and follow channels."
      >
        <LibraryContents key={me?.user.id} />
      </MemberGate>
    </main>
  );
}
function LibraryContents() {
  const playlists = useResource<Playlists>("/playlists");
  const channels = useResource<Subscriptions>("/subscriptions");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<{
    key: string;
    title: string;
    visibility: string;
  } | null>(null);
  async function resolvePrevious() {
    setBusy(true);
    setError("");
    try {
      const request = pending.current;
      if (request)
        await api<Playlist>("/playlists", {
          method: "POST",
          body: { title: request.title, visibility: request.visibility },
          headers: { "Idempotency-Key": request.key },
        });
      pending.current = null;
      playlists.retry();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn't check your previous request. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    setError("");
    const body = { title: title.trim(), visibility };
    if (
      pending.current &&
      (pending.current.title !== body.title ||
        pending.current.visibility !== body.visibility)
    ) {
      setError(
        "Your previous request may have succeeded. Retry it or refresh your playlists before starting another.",
      );
      return;
    }
    pending.current ??= { key: crypto.randomUUID(), ...body };
    setBusy(true);
    try {
      await api<Playlist>("/playlists", {
        method: "POST",
        body,
        headers: { "Idempotency-Key": pending.current.key },
      });
      pending.current = null;
      setTitle("");
      setCreating(false);
      playlists.retry();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn't create your playlist. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="explore-heading">
        <div>
          <h1>
            Library<span className="accent-dot">.</span>
          </h1>
          <p className="muted">
            Your playlists and favorite channels, together.
          </p>
        </div>
        <button
          className="button"
          onClick={() => setCreating((value) => !value)}
          aria-expanded={creating}
        >
          <Icon name="plus" />
          New playlist
        </button>
      </div>
      {creating && (
        <form
          className="playlist-create-form"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <div className="form-field">
            <label htmlFor="new-playlist-title">Playlist name</label>
            <input
              id="new-playlist-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={100}
              placeholder="Give your collection a name"
              disabled={busy}
            />
          </div>
          <div className="form-field">
            <label htmlFor="new-playlist-visibility">Visibility</label>
            <select
              id="new-playlist-visibility"
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
          <button className="button" disabled={busy || !title.trim()}>
            {busy ? "Creating…" : "Create playlist"}
          </button>
          {error && (
            <div className="error" role="alert">
              <p>{error}</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void resolvePrevious()}
              >
                Check previous request
              </button>
            </div>
          )}
        </form>
      )}
      <section aria-labelledby="playlists-heading">
        <div className="section-heading">
          <h2 id="playlists-heading">Playlists</h2>
          {playlists.state.status === "ready" && (
            <span className="muted">
              {playlists.state.value.items.length} collections
            </span>
          )}
        </div>
        {playlists.state.status === "loading" && (
          <LoadingState label="Loading playlists…" />
        )}
        {playlists.state.status === "error" && (
          <div className="error" role="alert">
            <p>{playlists.state.error.message}</p>
            <button onClick={playlists.retry}>Retry playlists</button>
          </div>
        )}
        {playlists.state.status === "ready" &&
          (playlists.state.value.items.length ? (
            <div className="playlist-grid">
              {playlists.state.value.items.map((playlist) => (
                <Link
                  key={playlist.id}
                  className="playlist-card"
                  href={`/playlist?id=${playlist.id}`}
                >
                  <div className="playlist-art">
                    <Icon name="list" />
                    <span>{playlist.item_count}</span>
                  </div>
                  <div className="playlist-card-body">
                    <span className="visibility-badge">
                      <Icon
                        name={
                          playlist.visibility === "private" ? "lock" : "share"
                        }
                      />
                      {playlist.visibility === "private" ? "Private" : "Public"}
                    </span>
                    <h3>{playlist.title}</h3>
                    <p className="muted">
                      {playlist.item_count}{" "}
                      {playlist.item_count === 1 ? "video" : "videos"}
                      <Icon name="arrow" />
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="library-empty">
              <Icon name="bookmark" />
              <h3>No playlists yet</h3>
              <p className="muted">
                Create a playlist to save videos for later.
              </p>
              <button
                className="secondary-button"
                onClick={() => setCreating(true)}
              >
                Create your first playlist
                <Icon name="plus" />
              </button>
            </div>
          ))}
      </section>
      <section className="followed-channels" aria-labelledby="followed-heading">
        <div className="section-heading">
          <h2 id="followed-heading">Channels you follow</h2>
          <Link className="text-button" href="/following">
            View latest videos
            <Icon name="arrow" />
          </Link>
        </div>
        {channels.state.status === "loading" && (
          <LoadingState label="Loading channels…" />
        )}
        {channels.state.status === "error" && (
          <div className="error" role="alert">
            <p>{channels.state.error.message}</p>
            <button onClick={channels.retry}>Retry followed channels</button>
          </div>
        )}
        {channels.state.status === "ready" &&
          (channels.state.value.items.length ? (
            <div className="followed-grid">
              {channels.state.value.items.map((channel) => (
                <Link
                  key={channel.id}
                  className="followed-card"
                  href={`/channel?id=${channel.id}`}
                >
                  <Avatar name={channel.title} large />
                  <div>
                    <strong>{channel.title}</strong>
                    <span className="muted">@{channel.handle}</span>
                  </div>
                  <Icon name="arrow" />
                </Link>
              ))}
            </div>
          ) : (
            <div className="library-empty compact">
              <h3>No followed channels yet</h3>
              <p className="muted">
                Find a creator you enjoy and follow their channel.
              </p>
              <Link className="secondary-button" href="/">
                Explore videos
                <Icon name="arrow" />
              </Link>
            </div>
          ))}
      </section>
    </>
  );
}
