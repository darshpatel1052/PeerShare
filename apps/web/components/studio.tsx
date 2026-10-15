"use client";
import Link from "next/link";
import { useCallback, useEffect, useState, useRef } from "react";
import {
  api,
  ApiError,
  type Upload,
  type PartGrants,
  type CreateUpload,
} from "../lib/api";
import { useAuth } from "./auth-provider";
import StudioPreview from "./studio-preview";
import CreatorImagePicker from "./creator-image-picker";
import { Icon, LoadingState } from "./ui";

const CHUNK = 8 * 1024 * 1024;
const MAX_SOURCE = 250 * 1024 * 1024;
type Page = { items: Upload[] };

export default function Studio() {
  const auth = useAuth();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [phase, setPhase] = useState("");
  const transfer = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<Upload | null>(null);
  const [deleting, setDeleting] = useState("");
  const [filter, setFilter] = useState<
    "all" | "draft" | "published" | "unpublished"
  >("all");
  const [preview, setPreview] = useState("");
  useEffect(() => () => transfer.current?.abort(), []);
  const [busyID, setBusyID] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [bytesSent, setBytesSent] = useState(0);

  const refresh = useCallback(async () => {
    const page = await api<Page>("/uploads");
    setUploads(page.items);
  }, []);
  useEffect(() => {
    if (!auth.me) return;
    let active = true;
    const load = () =>
      refresh().catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Uploads could not be loaded.",
          );
      });
    void load();
    const timer = window.setInterval(() => void load(), 2500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [auth.me, refresh]);

  function selectFile(chosen: File | null) {
    if (busyID) return;
    setDragging(false);
    setError("");
    if (
      chosen &&
      (!chosen.name.toLowerCase().endsWith(".mp4") ||
        chosen.size < 1 ||
        chosen.size > MAX_SOURCE)
    ) {
      setError("Choose an MP4 up to 250 MiB.");
      return;
    }
    setFile(chosen);
  }

  function report(cause: unknown) {
    if (transfer.current?.signal.aborted) {
      setNotice("Upload paused. Pick up where you left off when you’re ready.");
      return;
    }
    setError(
      cause instanceof ApiError
        ? cause.message
        : cause instanceof Error
          ? cause.message
          : "The upload could not be completed.",
    );
  }

  async function chunkChecksums(chosen: File, signal: AbortSignal) {
    const hashes: string[] = [];
    for (let start = 0; start < chosen.size; start += CHUNK) {
      signal.throwIfAborted();
      const digest = await crypto.subtle.digest(
        "SHA-256",
        await chosen.slice(start, start + CHUNK).arrayBuffer(),
      );
      hashes.push(
        Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join(""),
      );
    }
    return hashes;
  }
  async function sendFile(
    initial: Upload,
    chosen: File,
    signal: AbortSignal,
    hashes?: string[],
  ) {
    const upload = await api<Upload>(`/uploads/${initial.id}`, { signal });
    if (chosen.size !== upload.expected_bytes)
      throw new Error("Choose the original MP4 to resume this upload.");
    setBusyID(upload.id);
    setPhase("Preparing upload");
    const checksums = hashes ?? (await chunkChecksums(chosen, signal));
    if (
      upload.part_checksums.length &&
      upload.part_checksums.some((h, i) => h !== checksums[i])
    )
      throw new Error(
        "This file does not match the original upload. Choose the original MP4.",
      );
    for (const part of upload.parts) {
      if (checksums[part.number - 1] !== part.sha256)
        throw new Error(
          "This file does not match the stored chunks. Choose the original MP4.",
        );
    }
    const present = new Set(upload.parts.map((part) => part.number));
    const missing = Array.from(
      { length: Math.ceil(chosen.size / CHUNK) },
      (_, i) => i + 1,
    ).filter((n) => !present.has(n));
    let sent = upload.parts.reduce((sum, part) => sum + part.bytes, 0);
    setBytesSent(sent);
    setPhase("Uploading video");
    // Each small batch grants at most three short-lived permissions. File bytes never enter localStorage.
    for (let offset = 0; offset < missing.length; offset += 3) {
      const grants = await api<PartGrants>(
        `/uploads/${upload.id}/parts/presign`,
        {
          method: "POST",
          body: { numbers: missing.slice(offset, offset + 3) },
          signal,
        },
      );
      const results = await Promise.allSettled(
        grants.parts.map(async (grant) => {
          const start = (grant.number - 1) * CHUNK;
          const blob = chosen.slice(start, start + grant.bytes);
          await api(`/uploads/${upload.id}/parts/${grant.number}`, {
            method: "PUT",
            rawBody: blob,
            headers: {
              "Content-Type": "application/octet-stream",
              "Upload-Token": grant.token,
            },
            timeoutMs: 120_000,
            signal,
          });
          sent += blob.size;
          setBytesSent(sent);
        }),
      );
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    }
    setPhase("Finishing upload");
    await api(`/uploads/${upload.id}/complete`, {
      method: "POST",
      timeoutMs: 120_000,
      signal,
    });
    setNotice(
      "Upload complete. Your video is being prepared and stays private until you publish.",
    );
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
    setTitle("");
    setDescription("");
    setTags("");
    await refresh();
  }
  async function begin(event: React.FormEvent) {
    event.preventDefault();
    if (!file || !auth.me?.channel || busyID) return;
    if (
      file.size < 1 ||
      file.size > MAX_SOURCE ||
      !file.name.toLowerCase().endsWith(".mp4")
    ) {
      setError("Choose an MP4 between 1 byte and 250 MiB.");
      return;
    }
    const chosen = file;
    const controller = new AbortController();
    transfer.current = controller;
    setBusyID("preparing");
    setError("");
    setNotice("");
    setPhase("Preparing upload");
    setBytesSent(0);
    const storageKey = `peerscreen:upload-setup:${auth.me.user.id}`;
    try {
      const checksums = await chunkChecksums(chosen, controller.signal);
      const body: CreateUpload = {
        channel_id: auth.me.channel.id,
        title,
        description,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        size: chosen.size,
        part_checksums: checksums,
      };
      let key = crypto.randomUUID();
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
        if (saved?.body === JSON.stringify(body)) key = saved.key;
        localStorage.setItem(
          storageKey,
          JSON.stringify({ key, body: JSON.stringify(body) }),
        );
      } catch {}
      const upload = await api<Upload>("/uploads", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body,
        signal: controller.signal,
      });
      try {
        localStorage.removeItem(storageKey);
      } catch {}
      await sendFile(upload, chosen, controller.signal, checksums);
    } catch (cause) {
      report(cause);
      await refresh().catch(() => {});
    } finally {
      setBusyID("");
      setPhase("");
      transfer.current = null;
    }
  }
  async function resume(upload: Upload) {
    if (!file) {
      setError("Choose the original MP4 again to resume this upload.");
      return;
    }
    const controller = new AbortController();
    transfer.current = controller;
    setBusyID(upload.id);
    setError("");
    setNotice("");
    setBytesSent(0);
    try {
      await sendFile(upload, file, controller.signal);
    } catch (cause) {
      report(cause);
      await refresh().catch(() => {});
    } finally {
      setBusyID("");
      setPhase("");
      transfer.current = null;
    }
  }
  async function action(upload: Upload, kind: "retry" | "cancel" | "delete") {
    setBusyID(upload.id);
    setError("");
    setNotice("");
    try {
      await api(
        `/videos/${upload.video_id}${kind === "delete" ? "" : `/processing/${kind}`}`,
        { method: kind === "delete" ? "DELETE" : "POST" },
      );
      setNotice(
        kind === "delete"
          ? "Video deleted."
          : kind === "retry"
            ? "We’re preparing your video again."
            : "Processing cancelled.",
      );
      setDeleting("");
      setPreview("");
      await refresh();
    } catch (cause) {
      report(cause);
    } finally {
      setBusyID("");
    }
  }
  async function saveDetails(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setBusyID(editing.id);
    setError("");
    try {
      await api(`/videos/${editing.video_id}`, {
        method: "PATCH",
        body: {
          title: editing.title,
          description: editing.description,
          tags: editing.tags.map((t) => t.trim()).filter(Boolean),
          revision: editing.revision,
        },
      });
      setEditing(null);
      setNotice("Video details saved.");
      await refresh();
    } catch (cause) {
      report(cause);
    } finally {
      setBusyID("");
    }
  }

  async function changePublication(upload: Upload) {
    setBusyID(upload.id);
    setError("");
    try {
      await api(
        `/videos/${upload.video_id}/${upload.publication_state === "published" ? "unpublish" : "publish"}`,
        { method: "POST" },
      );
      setNotice(
        upload.publication_state === "published"
          ? "Video unpublished from your channel."
          : "Video published. It is now visible on your channel.",
      );
      await refresh();
    } catch (cause) {
      report(cause);
    } finally {
      setBusyID("");
    }
  }

  async function abort(upload: Upload) {
    setBusyID(upload.id);
    setError("");
    try {
      await api(`/uploads/${upload.id}`, { method: "DELETE" });
      setNotice("Upload cancelled.");
      await refresh();
    } catch (cause) {
      report(cause);
    } finally {
      setBusyID("");
    }
  }

  if (auth.loading)
    return (
      <main id="main">
        <LoadingState label="Loading creator workspace…" />
      </main>
    );
  if (!auth.me)
    return (
      <main id="main" className="page-shell studio-page">
        <section className="settings-panel">
          <span className="eyebrow">Creator studio</span>
          <h1>Sign in to upload.</h1>
          <p>Your uploads and drafts are private to your account.</p>
          <Link className="button" href="/account">
            Open your workspace
          </Link>
        </section>
      </main>
    );
  if (!auth.me.channel)
    return (
      <main id="main" className="page-shell studio-page">
        <section className="settings-panel">
          <span className="eyebrow">Creator studio</span>
          <h1>Create a channel first.</h1>
          <p>
            Uploads belong to a channel so viewers can find your published
            videos.
          </p>
          <Link className="button" href="/account">
            Set up your channel
          </Link>
        </section>
      </main>
    );

  return (
    <main id="main" className="page-shell studio-page">
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">
            Creator studio · {auth.me.channel.handle}
          </span>
          <h1>Your videos.</h1>
          <p>Upload, edit, and publish to your channel.</p>
        </div>
        <Link
          className="secondary-button"
          href={`/channel?id=${auth.me.channel.id}`}
        >
          View channel <Icon name="arrow" />
        </Link>
      </div>
      {(error || notice) && (
        <div
          className={error ? "error" : "notice"}
          role={error ? "alert" : "status"}
        >
          {error || notice}
        </div>
      )}
      <div className="studio-overview" aria-label="Recent upload summary">
        {(
          [
            ["Published", "published", "channel"],
            ["Drafts", "draft", "film"],
            ["Unpublished", "unpublished", "lock"],
          ] as const
        ).map(([label, state, icon]) => (
          <button
            type="button"
            className="studio-summary"
            key={state}
            aria-pressed={filter === state}
            aria-label={
              state === "draft" ? "Show drafts" : `Show ${state} videos`
            }
            onClick={() => setFilter(state)}
          >
            <span>
              <Icon name={icon} />
              {label}
            </span>
            <strong>
              {
                uploads.filter((upload) => upload.publication_state === state)
                  .length
              }
            </strong>
            <Icon name="arrow" />
          </button>
        ))}
      </div>
      <div className="studio-layout">
        <section className="settings-panel studio-upload-panel">
          <div className="settings-heading">
            <div>
              <h2>Upload a video</h2>
              <p>MP4 · up to 250 MiB · 10 minutes max</p>
            </div>
            <Icon name="film" />
          </div>
          <form className="account-form" onSubmit={begin}>
            <div
              className={`upload-dropzone${dragging ? " is-dragging" : ""}${file ? " has-file" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                if (!busyID) setDragging(true);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node))
                  setDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (!busyID) selectFile(event.dataTransfer.files[0] || null);
              }}
            >
              <span className="dropzone-icon">
                <Icon name={file ? "check" : "upload"} />
              </span>
              <strong>{file ? file.name : "Drop your video here"}</strong>
              <span>
                {file
                  ? `${(file.size / 1024 / 1024).toFixed(1)} MiB · MP4`
                  : "or choose a file from your device"}
              </span>
              <input
                type="file"
                ref={fileInput}
                accept="video/mp4,.mp4"
                aria-label="MP4 file"
                className="sr-only"
                disabled={!!busyID}
                onChange={(event) =>
                  selectFile(event.target.files?.[0] || null)
                }
              />
              <button
                type="button"
                className="secondary-button"
                disabled={!!busyID}
                onClick={() => fileInput.current?.click()}
              >
                {file ? "Change file" : "Choose file"}
              </button>
            </div>
            <small className="upload-resume-note">
              Progress is saved. To resume later, choose the original file
              again.
            </small>

            <label className="form-field">
              Video title
              <input
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Give your video a clear title"
              />
            </label>
            <label className="form-field">
              Description
              <textarea
                maxLength={5000}
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What should viewers know?"
              />
            </label>
            <label className="form-field">
              Tags
              <input
                value={tags}
                maxLength={330}
                onChange={(e) => setTags(e.target.value)}
                placeholder="Up to 10 tags, separated by commas"
              />
            </label>
            {phase && (
              <div className="upload-progress" role="status">
                <div>
                  <span>{phase}</span>
                  <span>
                    {Math.min(
                      100,
                      Math.round(
                        (bytesSent / Math.max(file?.size || 0, 1)) * 100,
                      ),
                    )}
                    %
                  </span>
                </div>
                <progress max={file?.size || 1} value={bytesSent} />
              </div>
            )}
            <button type="submit" disabled={!file || !title.trim() || !!busyID}>
              {phase ? `${phase}…` : "Start upload"}
              <Icon name="arrow" />
            </button>
            {phase && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => transfer.current?.abort()}
              >
                Pause upload
              </button>
            )}
          </form>
        </section>
        <section className="studio-library">
          <div className="settings-heading">
            <div>
              <h2>Video library</h2>
              <p>Keep track of what’s live and what’s next.</p>
            </div>
            <span className="eyebrow">{uploads.length} VIDEOS</span>
          </div>
          <div
            className="library-filters"
            role="group"
            aria-label="Video library filters"
          >
            {(["all", "draft", "published", "unpublished"] as const).map(
              (value) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  className={filter === value ? "selected" : ""}
                  onClick={() => setFilter(value)}
                >
                  {value === "all"
                    ? "All videos"
                    : value === "draft"
                      ? "Drafts"
                      : value === "published"
                        ? "Published"
                        : "Unpublished"}
                  <span>
                    {
                      uploads.filter(
                        (upload) =>
                          value === "all" || upload.publication_state === value,
                      ).length
                    }
                  </span>
                </button>
              ),
            )}
          </div>
          {uploads.filter(
            (upload) => filter === "all" || upload.publication_state === filter,
          ).length === 0 ? (
            <div className="studio-empty">
              <Icon name="film" />
              <h3>
                {filter === "all"
                  ? "Your next video starts here"
                  : filter === "draft"
                    ? "No drafts"
                    : filter === "published"
                      ? "No published videos"
                      : "No unpublished videos"}
              </h3>
              <p>
                {filter === "all"
                  ? "Upload a video to get started."
                  : filter === "draft"
                    ? "New uploads stay here until you publish."
                    : filter === "published"
                      ? "Videos you publish will appear on your channel."
                      : "Videos you take off your channel will appear here."}
              </p>
            </div>
          ) : (
            uploads
              .filter(
                (upload) =>
                  filter === "all" || upload.publication_state === filter,
              )
              .map((upload) => (
                <article className="upload-card" key={upload.id}>
                  {upload.thumbnail_url && (
                    <img
                      className="library-thumbnail"
                      src={upload.thumbnail_url}
                      alt={`Thumbnail for ${upload.title}`}
                    />
                  )}
                  <div className="upload-card-head">
                    <div>
                      <span className="eyebrow">
                        {upload.publication_state === "published"
                          ? "Published"
                          : upload.publication_state === "unpublished"
                            ? "Unpublished"
                            : "Draft"}
                      </span>
                      <h3>{upload.title}</h3>
                    </div>
                    <span
                      className={`state-pill state-${upload.processing_state}`}
                    >
                      {upload.processing_state === "ready"
                        ? "Ready"
                        : upload.processing_state === "processing"
                          ? "Preparing"
                          : upload.processing_state === "pending"
                            ? "Pending"
                            : upload.processing_state === "failed"
                              ? "Needs attention"
                              : "Cancelled"}
                    </span>
                  </div>
                  <p className="muted">
                    {upload.processing_state === "processing"
                      ? "Preparing your video…"
                      : upload.state === "open"
                        ? `Upload ${Math.round((upload.parts.reduce((sum, part) => sum + part.bytes, 0) / upload.expected_bytes) * 100)}% complete`
                        : upload.state === "expired"
                          ? "Upload expired. Start again with your source file."
                          : upload.state === "aborted"
                            ? "Upload cancelled."
                            : upload.processing_state === "ready"
                              ? upload.publication_state === "published"
                                ? "Live on your channel"
                                : upload.publication_state === "unpublished"
                                  ? "Hidden from your channel"
                                  : "Ready to publish"
                              : upload.processing_stage}
                  </p>
                  {upload.processing_state === "processing" && (
                    <progress
                      max={100}
                      value={upload.progress}
                      aria-label="Processing progress"
                    />
                  )}
                  {upload.error_code && (
                    <p className="error">
                      {upload.error_code === "unsupported_media"
                        ? "This source is not a supported MP4 video. Choose a video up to 10 minutes, 3840 × 2160 and at least 144 pixels high."
                        : upload.error_code === "source_corrupt"
                          ? "The source failed its integrity check. Delete this draft and upload the original file again."
                          : `We couldn’t prepare this video. Retry processing or upload it again.`}
                    </p>
                  )}
                  <div className="upload-actions">
                    {upload.state === "open" && (
                      <>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={!!busyID}
                          onClick={() => void resume(upload)}
                        >
                          Resume with selected file
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          disabled={!!busyID}
                          onClick={() => void abort(upload)}
                        >
                          Cancel upload
                        </button>
                      </>
                    )}
                    {upload.processing_state === "ready" && (
                      <>
                        <button
                          type="button"
                          disabled={!!busyID}
                          onClick={() => void changePublication(upload)}
                        >
                          {upload.publication_state === "published"
                            ? "Unpublish"
                            : "Publish video"}
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={!!busyID}
                          onClick={() =>
                            setPreview(
                              preview === upload.video_id
                                ? ""
                                : upload.video_id,
                            )
                          }
                        >
                          {preview === upload.video_id
                            ? "Close preview"
                            : "Preview video"}
                        </button>
                        {upload.publication_state === "published" && (
                          <Link
                            className="secondary-button"
                            href={`/watch?v=${upload.video_id}`}
                          >
                            Watch video
                          </Link>
                        )}
                      </>
                    )}
                    {upload.state === "completed" &&
                      (upload.processing_state === "pending" ||
                        upload.processing_state === "processing") && (
                        <button
                          className="text-button"
                          disabled={!!busyID}
                          onClick={() => void action(upload, "cancel")}
                        >
                          Cancel processing
                        </button>
                      )}
                    {upload.state === "completed" &&
                      (upload.processing_state === "failed" ||
                        upload.processing_state === "cancelled") && (
                        <button
                          className="secondary-button"
                          disabled={!!busyID}
                          onClick={() => void action(upload, "retry")}
                        >
                          Retry processing
                        </button>
                      )}
                    <button
                      className="text-button"
                      disabled={!!busyID}
                      onClick={() => setEditing({ ...upload })}
                    >
                      Edit details
                    </button>
                    <button
                      className="text-button"
                      disabled={!!busyID}
                      onClick={() => setDeleting(upload.id)}
                    >
                      {upload.publication_state === "draft"
                        ? "Delete draft"
                        : "Delete video"}
                    </button>
                  </div>
                  {deleting === upload.id && (
                    <div
                      className="delete-confirmation"
                      role="group"
                      aria-label="Confirm deletion"
                    >
                      <p>
                        Delete this video and its source? This cannot be undone.
                      </p>
                      <button
                        disabled={!!busyID}
                        onClick={() => void action(upload, "delete")}
                      >
                        Confirm delete
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() => setDeleting("")}
                      >
                        Keep video
                      </button>
                    </div>
                  )}
                  {editing?.id === upload.id && (
                    <div className="video-edit-panel">
                      <CreatorImagePicker
                        kind="thumbnail"
                        path={`/videos/${upload.video_id}/thumbnail`}
                        revision={editing.revision}
                        currentURL={editing.thumbnail_url}
                        custom={editing.has_custom_thumbnail}
                        onSaved={async () => {
                          const updated = await api<Upload>(
                            `/uploads/${upload.id}`,
                          );
                          setEditing((current) =>
                            current?.id === upload.id
                              ? {
                                  ...current,
                                  revision: updated.revision,
                                  thumbnail_url: updated.thumbnail_url,
                                  has_custom_thumbnail:
                                    updated.has_custom_thumbnail,
                                }
                              : current,
                          );
                          await refresh();
                        }}
                      />
                      <form
                        className="account-form video-edit"
                        onSubmit={saveDetails}
                      >
                        <label className="form-field">
                          Edit video title
                          <input
                            required
                            maxLength={200}
                            value={editing.title}
                            onChange={(e) =>
                              setEditing({ ...editing, title: e.target.value })
                            }
                          />
                        </label>
                        <label className="form-field">
                          Edit description
                          <textarea
                            maxLength={5000}
                            value={editing.description}
                            onChange={(e) =>
                              setEditing({
                                ...editing,
                                description: e.target.value,
                              })
                            }
                          />
                        </label>
                        <label className="form-field">
                          Edit tags
                          <input
                            value={editing.tags.join(", ")}
                            onChange={(e) =>
                              setEditing({
                                ...editing,
                                tags: e.target.value.split(","),
                              })
                            }
                          />
                        </label>
                        <div className="upload-actions">
                          <button disabled={!!busyID}>
                            Save video details
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => setEditing(null)}
                          >
                            Discard changes
                          </button>
                          <button
                            type="button"
                            className="text-button"
                            onClick={async () => {
                              try {
                                const current = await api<Upload>(
                                  `/uploads/${upload.id}`,
                                );
                                setEditing((selected) =>
                                  selected?.id === upload.id
                                    ? current
                                    : selected,
                                );
                                setError("");
                              } catch (cause) {
                                report(cause);
                              }
                            }}
                          >
                            Reload saved details
                          </button>
                        </div>
                      </form>
                    </div>
                  )}
                  {preview === upload.video_id && (
                    <StudioPreview videoID={upload.video_id} />
                  )}
                </article>
              ))
          )}
        </section>
      </div>
    </main>
  );
}
