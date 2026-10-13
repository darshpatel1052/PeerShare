"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Avatar, BrandMark, ChannelCover, Icon, LoadingState } from "./ui";
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
import CreatorImagePicker from "./creator-image-picker";
import GoogleSignIn from "./google-sign-in";
import AuthFeedback from "./auth-feedback";
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
  }, [
    auth.me?.channel?.id,
    auth.me?.channel?.handle,
    auth.me?.channel?.title,
    auth.me?.channel?.description,
  ]);
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
        <LoadingState label="Loading your account…" />
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
      <main id="main" className="auth-page">
        <aside className="auth-identity">
          <div className="auth-brand">
            <BrandMark />
            PeerScreen
          </div>
          <div className="auth-display">
            YOUR
            <br />
            OWN
            <br />
            <span>SCREEN.</span>
          </div>
          <div className="auth-art" aria-hidden="true">
            <ChannelCover compact />
          </div>
          <p>Your channel starts here.</p>
          <Link href="/">
            Explore videos
            <Icon name="arrow" />
          </Link>
        </aside>
        <section className="auth-card">
          <span className="eyebrow">
            {mode === "login" ? "Your workspace" : "Join PeerScreen"}
          </span>
          <h1>{mode === "login" ? "Welcome back." : "Create your account."}</h1>
          <p className="muted">
            {mode === "login"
              ? "Sign in to your account and channel."
              : "Set up your profile. Make a space of your own."}
          </p>
          <AuthFeedback />
          {feedback}
          <GoogleSignIn />
          <div className="auth-divider">
            <span>or use email</span>
          </div>
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
          <p className="auth-switch">
            {mode === "login"
              ? "New to PeerScreen? "
              : "Already have an account? "}
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
        </section>
      </main>
    );
  const channel = auth.me.channel;
  return (
    <main id="main" className="workspace-page">
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">Creator workspace</span>
          <h1>Your workspace</h1>
          <p className="muted">Manage your channel and account.</p>
        </div>
        {channel && (
          <Link className="secondary-button" href={`/channel?id=${channel.id}`}>
            View your channel
            <Icon name="arrow" />
          </Link>
        )}
      </div>
      <div className="workspace-grid">
        <aside className="workspace-sidebar">
          <Avatar name={auth.me.user.display_name} large />
          <h2>{auth.me.user.display_name}</h2>
          <p>{auth.me.user.email}</p>
          <nav aria-label="Workspace sections">
            <a className="active" href="#channel-settings">
              <Icon name="channel" />
              Channel settings
            </a>
            <Link href="/settings">
              <Icon name="sun" />
              Appearance & settings
            </Link>
            <a href="#account-sessions">
              <Icon name="settings" />
              Account & sessions
            </a>
          </nav>
          <Link className="workspace-back" href="/">
            Back to explore
            <Icon name="arrow" />
          </Link>
        </aside>
        <div className="workspace-content">
          <AuthFeedback />
          {feedback}
          <section className="settings-panel" id="channel-settings">
            <div className="settings-heading">
              <div>
                <h2>{channel ? "Channel settings" : "Create your channel"}</h2>
                <p className="muted">
                  Make it easy for people to recognize you.
                </p>
              </div>
              <Icon name="channel" />
            </div>
            <div className="channel-preview">
              <ChannelCover
                compact
                imageURL={auth.me?.channel?.banner_url || ""}
              />
              <div>
                <Avatar name={title || auth.me.user.display_name} />
                <span>
                  <strong>{title || "Your channel name"}</strong>
                  <small>@{handle || "your-handle"}</small>
                </span>
              </div>
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
                3–30 lowercase letters, numbers, or hyphens. Begin with a letter
                and end with a letter or number.
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
            {channel && (
              <CreatorImagePicker
                kind="banner"
                path={`/channels/${channel.id}/banner`}
                revision={channel.revision}
                currentURL={channel.banner_url || ""}
                custom={!!channel.banner_url}
                onSaved={async () => auth.accept(await api<Me>("/me"))}
              />
            )}
            <p className="publishing-note">
              <Icon name="film" />
              <Link href="/studio">Manage videos in Studio</Link>
            </p>
          </section>
          <section
            className="settings-panel session-panel"
            id="account-sessions"
          >
            <div className="settings-heading">
              <div>
                <h2>Account & sessions</h2>
                <p className="muted">Signed in as {auth.me.user.email}.</p>
              </div>
              <Icon name="settings" />
            </div>
            <div className="session-actions">
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void logout()}
              >
                <Icon name="logout" />
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
          </section>
        </div>
      </div>
    </main>
  );
}
