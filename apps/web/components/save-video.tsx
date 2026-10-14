"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, type PlaylistDetail, type Playlists } from "../lib/api";
import { useResource } from "../lib/use-resource";
import { useAuth } from "./auth-provider";
import { Icon, LoadingState } from "./ui";

export default function SaveVideo({ videoID }: { videoID: string }) {
  const { me, loading } = useAuth();
  return (
    <SaveControl
      key={`${videoID}:${me?.user.id ?? "guest"}`}
      videoID={videoID}
      signedIn={Boolean(me)}
      loadingAccount={loading}
    />
  );
}
function SaveControl({
  videoID,
  signedIn,
  loadingAccount,
}: {
  videoID: string;
  signedIn: boolean;
  loadingAccount: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{ id: string; title: string } | null>(
    null,
  );
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLSelectElement>(null);
  const { state, retry } = useResource<Playlists>(
    open && signedIn ? "/playlists" : null,
  );
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  useEffect(() => {
    if (open && state.status === "ready") picker.current?.focus();
  }, [open, state]);
  async function save() {
    if (state.status !== "ready") return;
    const playlist = state.value.items.find((value) => value.id === selected);
    if (!playlist) return;
    setBusy(true);
    setError("");
    try {
      await api<PlaylistDetail>(`/playlists/${selected}/items`, {
        method: "POST",
        body: { video_id: videoID, revision: playlist.revision },
      });
      setSaved({ id: playlist.id, title: playlist.title });
      setOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn't save this video. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (loadingAccount)
    return (
      <button className="secondary-button" disabled>
        <Icon name="bookmark" />
        Save
      </button>
    );
  if (!signedIn)
    return (
      <Link className="secondary-button" href="/account">
        <Icon name="bookmark" />
        Sign in to save
      </Link>
    );
  return (
    <div className="save-control" ref={root}>
      <button
        className="secondary-button"
        ref={trigger}
        aria-expanded={open}
        disabled={loadingAccount}
        onClick={() => {
          setOpen((value) => !value);
          setError("");
        }}
      >
        <Icon name={saved ? "check" : "bookmark"} />
        {saved ? "Saved" : "Save"}
      </button>
      {saved && (
        <span className="saved-feedback" role="status">
          Saved to <Link href={`/playlist?id=${saved.id}`}>{saved.title}</Link>
        </span>
      )}
      {open && (
        <div className="save-popover" role="dialog" aria-label="Save video">
          <h3>Save to a playlist</h3>
          {state.status === "loading" && (
            <LoadingState label="Loading playlists…" />
          )}
          {state.status === "error" && (
            <div className="error" role="alert">
              <p>{state.error.message}</p>
              <button onClick={retry}>Retry playlists</button>
            </div>
          )}
          {state.status === "ready" &&
            (state.value.items.length ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <label className="sr-only" htmlFor="save-playlist">
                  Choose playlist
                </label>
                <select
                  ref={picker}
                  id="save-playlist"
                  value={selected}
                  onChange={(event) => setSelected(event.target.value)}
                  disabled={busy}
                >
                  <option value="">Choose a playlist</option>
                  {state.value.items.map((playlist) => (
                    <option key={playlist.id} value={playlist.id}>
                      {playlist.title} · {playlist.visibility}
                    </option>
                  ))}
                </select>
                <button className="button" disabled={busy || !selected}>
                  {busy ? "Saving…" : "Save video"}
                </button>
              </form>
            ) : (
              <>
                <p className="muted">
                  Create a playlist in your library, then save this video.
                </p>
                <Link className="button" href="/library">
                  Create a playlist
                  <Icon name="plus" />
                </Link>
              </>
            ))}
          {error && (
            <div className="error" role="alert">
              <p>{error}</p>
              <button onClick={retry}>Reload playlists</button>
            </div>
          )}
          <Link className="text-button" href="/library">
            Your library
            <Icon name="arrow" />
          </Link>
        </div>
      )}
    </div>
  );
}
