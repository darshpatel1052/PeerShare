"use client";
import Link from "next/link";
import AuthFeedback from "./auth-feedback";
import SignInSettings from "./sign-in-settings";
import AppearanceSettings from "./appearance-settings";
import { useAuth } from "./auth-provider";
import { Avatar, Icon } from "./ui";

export default function Settings() {
  const { me } = useAuth();
  return (
    <main id="main" className="settings-page page-shell">
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">Your preferences</span>
          <h1>Settings</h1>
          <p>Appearance and sign-in preferences.</p>
        </div>
      </div>
      <AuthFeedback />
      <div className="preferences-layout">
        <aside className="preferences-nav">
          <a href="#appearance">
            <Icon name="sun" />
            Appearance
          </a>
          {me && (
            <a href="#sign-in-methods">
              <Icon name="settings" />
              Sign-in methods
            </a>
          )}
          <Link href="/account">
            <Icon name="channel" />
            {me ? "Channel & account" : "Sign in"}
          </Link>
        </aside>
        <div className="preferences-content">
          <AppearanceSettings />
          {me && <SignInSettings />}
          {me && (
            <section className="settings-panel settings-profile">
              <Avatar name={me.user.display_name} />
              <div>
                <strong>{me.user.display_name}</strong>
                <p className="muted">{me.user.email}</p>
              </div>
              <Link className="secondary-button" href="/account">
                Manage account
                <Icon name="arrow" />
              </Link>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
