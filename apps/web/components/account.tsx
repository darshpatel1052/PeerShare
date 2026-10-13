"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  api,
  ApiError,
  type Me,
  type Credentials,
  type Registration,
  type Channel,
  type ChannelCreate,
  type ChannelEdit,
} from "../lib/api";
import { useAuth } from "./auth-provider";
export default function Account() {
  const auth = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const channel = auth.me?.channel;
    setHandle(channel?.handle || "");
    setTitle(channel?.title || "");
    setDescription(channel?.description || "");
  }, [auth.me?.channel]);
  const report = (cause: unknown) => {
    setError(
      cause instanceof Error
        ? cause.message
        : "The request could not be completed.",
    );
    setRequestId(cause instanceof ApiError ? cause.requestId : "");
    setErrorCode(cause instanceof ApiError ? cause.code : "");
  };
  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body: Credentials | Registration =
        mode === "register"
          ? { email, password, display_name: displayName }
          : { email, password };
      const me = await api<Me>(
        mode === "register" ? "/auth/register" : "/auth/login",
        { method: "POST", body },
      );
      auth.accept(me);
      setPassword("");
      setNotice(
        mode === "register"
          ? "Your account is ready. Create your channel below."
          : "You’re signed in.",
      );
    } catch (cause) {
      report(cause);
    } finally {
      setBusy(false);
    }
  }
  async function saveChannel(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const current = auth.me?.channel;
      const body: ChannelCreate | ChannelEdit = current
        ? { title, description, revision: current.revision }
        : { handle, title, description };
      await api<Channel>(current ? `/channels/${current.id}` : "/channels", {
        method: current ? "PATCH" : "POST",
        body,
      });
      await auth.reload();
      setNotice(current ? "Channel settings saved." : "Your channel is ready.");
    } catch (cause) {
      report(cause);
    } finally {
      setBusy(false);
    }
  }
  async function logout(all = false) {
    setBusy(true);
    setError("");
    try {
      await api<void>(all ? "/auth/logout-all" : "/auth/logout", {
        method: "POST",
        body: {},
      });
      auth.accept(null);
      setMode("login");
      setEmail("");
      setPassword("");
      setNotice("You’re signed out.");
    } catch (cause) {
      report(cause);
    } finally {
      setBusy(false);
    }
  }
  const feedback = (
    <>
      {error && (
        <div role="alert" className="error" data-testid="account-error">
          <p>{error}</p>
          {requestId && <small>Reference: {requestId}</small>}
          {errorCode === "revision_conflict" && (
            <p>
              <button
                onClick={() => {
                  setError("");
                  setErrorCode("");
                  void auth.reload();
                }}
              >
                Reload channel
              </button>
            </p>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className="notice" data-testid="account-notice">
          {notice}
        </p>
      )}
    </>
  );
  if (auth.loading)
    return (
      <main id="main">
        <p role="status">Loading your account…</p>
      </main>
    );
  if (auth.error)
    return (
      <main id="main">
        <h1>Account unavailable</h1>
        <p className="error" role="alert">
          {auth.error}
        </p>
        <button onClick={() => void auth.reload()}>Retry account</button>
      </main>
    );
  if (!auth.me)
    return (
      <main id="main" className="account-page">
        <span className="eyebrow">Your video space</span>
        <h1>
          {mode === "login"
            ? "Welcome back."
            : "Start something worth sharing."}
        </h1>
        <p className="muted">
          {mode === "login"
            ? "Sign in to manage your channel."
            : "Create an account and make a home for your videos."}
        </p>
        {feedback}
        <form
          onSubmit={signIn}
          className="account-form"
          aria-label={mode === "login" ? "Sign in" : "Create account"}
        >
          {mode === "register" && (
            <label className="form-field">
              Display name
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                required
                maxLength={80}
                autoComplete="name"
              />
            </label>
          )}
          <label className="form-field">
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
              maxLength={254}
            />
          </label>
          <label className="form-field">
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={mode === "register" ? 12 : 1}
              maxLength={128}
              autoComplete={
                mode === "register" ? "new-password" : "current-password"
              }
              aria-describedby={
                mode === "register" ? "password-policy" : undefined
              }
            />
          </label>
          {mode === "register" && (
            <p id="password-policy" className="muted">
              Use at least 12 characters and at most 128 bytes.
            </p>
          )}
          <button disabled={busy} type="submit">
            {busy
              ? "Please wait…"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>
        <p className="muted">
          {mode === "login" ? "New here? " : "Already have an account? "}
          <button
            className="text-button"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError("");
            }}
          >
            {mode === "login" ? "Create an account" : "Sign in instead"}
          </button>
        </p>
        <p className="notice">
          Registration is available in this local preview. Public-demo admission
          will be configured before deployment.
        </p>
      </main>
    );
  const channel = auth.me.channel;
  return (
    <main id="main" className="account-page">
      <span className="eyebrow">Your account</span>
      <h1>Hello, {auth.me.user.display_name}.</h1>
      <p className="muted">{auth.me.user.email}</p>
      {feedback}
      <div className="section-title">
        <h2>{channel ? "Channel settings" : "Create your channel"}</h2>
        {channel && (
          <Link className="button" href={`/channel?id=${channel.id}`}>
            View your channel
          </Link>
        )}
      </div>
      <form
        onSubmit={saveChannel}
        className="account-form"
        aria-label={channel ? "Channel settings" : "Create channel"}
      >
        <label className="form-field">
          Channel handle
          <input
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            disabled={Boolean(channel)}
            required
            pattern="[a-z][a-z0-9-]{1,28}[a-z0-9]"
            minLength={3}
            maxLength={30}
            aria-describedby="handle-policy"
          />
        </label>
        <p id="handle-policy" className="muted">
          3–30 lowercase letters, numbers, or hyphens. Begin with a letter and
          end with a letter or number.
        </p>
        <label className="form-field">
          Channel title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            maxLength={100}
          />
        </label>
        <div className="form-field">
          <label htmlFor="channel-description">Description</label>
          <textarea
            id="channel-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={1000}
            rows={4}
          />
        </div>
        <button disabled={busy} type="submit">
          {busy ? "Saving…" : channel ? "Save channel" : "Create channel"}
        </button>
      </form>
      <p className="notice">
        {channel
          ? "Your channel changes are saved. Uploads and video publishing are coming in the next phase."
          : "Create your channel to get ready to publish. Uploads arrive in the next phase."}
      </p>
      <div className="session-actions">
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => void logout()}
        >
          Sign out
        </button>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => void logout(true)}
        >
          Sign out everywhere
        </button>
      </div>
    </main>
  );
}
