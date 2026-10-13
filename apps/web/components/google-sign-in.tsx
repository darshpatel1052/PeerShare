"use client";
import { useState } from "react";
import { api, type AuthOptions, type OAuthRedirect } from "../lib/api";
import { useResource } from "../lib/use-resource";
import { useTheme } from "./theme-provider";

export default function GoogleSignIn({
  link = false,
  onConnected,
}: {
  link?: boolean;
  onConnected?: () => void;
}) {
  const { state, retry } = useResource<AuthOptions>("/auth/options");
  const { theme } = useTheme();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const enabled = state.status === "ready" && state.value.google_enabled;
  async function begin(event: React.FormEvent) {
    event.preventDefault();
    if (!enabled || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await api<OAuthRedirect>(
        link ? "/auth/google/link" : "/auth/google/start",
        { method: "POST", body: link ? { password } : {} },
      );
      const target = new URL(response.authorization_url);
      if (target.origin !== "https://accounts.google.com")
        throw new Error("Google sign-in could not be started. Please retry.");
      setPassword("");
      onConnected?.();
      window.location.assign(target.href);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Google sign-in could not be started.",
      );
      setBusy(false);
    }
  }
  return (
    <form
      className="google-signin"
      onSubmit={begin}
      aria-label={link ? "Connect Google" : "Google sign-in"}
    >
      {link && enabled && (
        <label className="form-field">
          Confirm your password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            maxLength={128}
            autoComplete="current-password"
          />
        </label>
      )}
      <button
        className="google-button"
        type="submit"
        aria-label="Sign in with Google"
        disabled={!enabled || busy}
      >
        <img src={`/auth/google-${theme}.png`} width={180} height={40} alt="" />
      </button>
      {busy && (
        <p className="muted" role="status">
          Opening Google…
        </p>
      )}
      {state.status === "ready" && !enabled && (
        <p className="muted google-unavailable">
          Google sign-in is currently unavailable.
        </p>
      )}
      {state.status === "error" && (
        <p className="error" role="alert">
          Sign-in options could not be loaded.{" "}
          <button type="button" className="text-button" onClick={retry}>
            Try again
          </button>
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
