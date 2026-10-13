"use client";
import { useEffect, useState } from "react";

const errors: Record<string, string> = {
  google_unavailable:
    "Google sign-in is currently unavailable. Try signing in with email.",
  invalid_flow:
    "This sign-in link has expired or was already used. Please start again.",
  session_changed:
    "Your account session changed. Sign in again before connecting Google.",
  cancelled:
    "Google sign-in was cancelled. You can try again when you’re ready.",
  invalid_identity: "We couldn’t verify this Google account. Please try again.",
  google_failed: "Google sign-in could not be completed. Please try again.",
  link_required:
    "An account already uses this email. Sign in with your password, then connect Google in Settings to keep your channel.",
  registration_closed: "New accounts are not being accepted right now.",
  identity_in_use:
    "This Google account is already connected. Choose a different Google account.",
  link_failed: "Google could not be connected. Please sign in again and retry.",
};
export default function AuthFeedback() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("auth_error");
    const notice = url.searchParams.get("auth_notice");
    if (!code && !notice) return;
    setError(!!code);
    setMessage(
      code
        ? errors[code] || "Sign-in could not be completed. Please try again."
        : notice === "google_connected"
          ? "Google is connected. You can use it to sign in to this account."
          : notice === "google_signed_in"
            ? "You’re signed in with Google."
            : "",
    );
    url.searchParams.delete("auth_error");
    url.searchParams.delete("auth_notice");
    window.history.replaceState(
      window.history.state,
      "",
      url.pathname + url.search + url.hash,
    );
  }, []);
  return message ? (
    <p className={error ? "error" : "notice"} role={error ? "alert" : "status"}>
      {message}
    </p>
  ) : null;
}
