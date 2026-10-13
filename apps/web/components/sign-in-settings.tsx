"use client";
import type { AuthMethods } from "../lib/api";
import { useResource } from "../lib/use-resource";
import GoogleSignIn from "./google-sign-in";
import { Icon } from "./ui";

export default function SignInSettings() {
  const { state, retry } = useResource<AuthMethods>("/auth/methods");
  return (
    <section className="settings-panel" id="sign-in-methods">
      <div className="settings-heading">
        <div>
          <h2>Sign-in methods</h2>
          <p>Choose how you access your account.</p>
        </div>
        <Icon name="settings" />
      </div>
      {state.status === "loading" && (
        <p role="status" className="muted">
          Loading sign-in methods…
        </p>
      )}
      {state.status === "error" && (
        <div className="error" role="alert">
          <p>{state.error.message}</p>
          <button onClick={retry}>Retry sign-in methods</button>
        </div>
      )}
      {state.status === "ready" && (
        <>
          <div className="signin-method-row">
            <div>
              <strong>Email & password</strong>
              <p className="muted">
                {state.value.password
                  ? "Your password sign-in remains available."
                  : "This account signs in with Google."}
              </p>
            </div>
            <span className="method-status">
              {state.value.password ? "Active" : "Not set"}
            </span>
          </div>
          <div className="signin-method-row">
            <div>
              <strong>Google</strong>
              <p className="muted">
                {state.value.google_email ||
                  "Connect Google to sign in without typing your password."}
              </p>
            </div>
            {state.value.google_email && (
              <span className="method-status connected">
                <Icon name="check" />
                Connected
              </span>
            )}
          </div>
          {!state.value.google_email && state.value.password && (
            <>
              <p className="link-explanation muted">
                Confirm your password, then choose your Google account. Your
                channel and videos stay with this account.
              </p>
              <GoogleSignIn link />
            </>
          )}
        </>
      )}
    </section>
  );
}
