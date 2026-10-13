"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Icon } from "./ui";

export default function CreatorImagePicker({
  kind,
  path,
  revision,
  currentURL,
  custom,
  onSaved,
}: {
  kind: "banner" | "thumbnail";
  path: string;
  revision: number;
  currentURL: string;
  custom: boolean;
  onSaved: () => void | Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function save(reset = false) {
    if (!reset && !file) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(path, {
        method: reset ? "DELETE" : "PUT",
        headers: {
          "If-Match": String(revision),
          ...(!reset
            ? { "Content-Type": file!.type || "application/octet-stream" }
            : {}),
        },
        ...(!reset ? { rawBody: file! } : { body: {} }),
        timeoutMs: 30_000,
      });
      setFile(null);
      if (input.current) input.current.value = "";
      await onSaved();
      setNotice(
        reset
          ? `${kind === "banner" ? "Default banner" : "Video frame"} restored.`
          : `${kind === "banner" ? "Banner" : "Thumbnail"} saved.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Image could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`creator-image-editor ${kind}-editor`}>
      <div className="image-editor-preview">
        {preview || currentURL ? (
          <img
            src={preview || currentURL}
            alt={preview ? `New ${kind} preview` : `Current ${kind}`}
          />
        ) : (
          <div className="image-placeholder">
            <Icon name="film" />
          </div>
        )}
      </div>
      <div className="image-editor-fields">
        <label className="form-field">
          {kind === "banner" ? "Channel banner" : "Video thumbnail"}
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,.jpg,.jpeg,.png"
            disabled={busy}
            onChange={(e) => {
              const chosen = e.target.files?.[0] || null;
              setNotice("");
              setError("");
              if (chosen && chosen.size > 5 * 1024 * 1024) {
                setError("Choose an image under 5 MiB.");
                setFile(null);
                e.target.value = "";
              } else setFile(chosen);
            }}
          />
        </label>
        <small className="muted">
          JPG or PNG · up to 5 MiB.{" "}
          {kind === "banner"
            ? "Recommended: 1920 × 480."
            : "Recommended: 1280 × 720."}
        </small>
        <div className="image-editor-actions">
          <button
            type="button"
            disabled={busy || !file}
            onClick={() => void save()}
          >
            {busy
              ? "Saving…"
              : kind === "banner"
                ? "Save banner"
                : "Save thumbnail"}
          </button>
          {custom && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => void save(true)}
            >
              {kind === "banner" ? "Use default banner" : "Use video frame"}
            </button>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
      </div>
    </div>
  );
}
