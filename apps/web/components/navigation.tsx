"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./auth-provider";
import { api } from "../lib/api";
import { Avatar, BrandMark, Icon } from "./ui";

export default function Navigation() {
  const auth = useAuth();
  const { me } = auth;
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setOpen(false);
    setError("");
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
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
  async function logout() {
    setBusy(true);
    try {
      await api("/auth/logout", { method: "POST", body: {} });
      auth.accept(null);
      setOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Please try signing out again.",
      );
    } finally {
      setBusy(false);
    }
  }
  const channelHref = me?.channel ? `/channel?id=${me.channel.id}` : "/account";
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" className="brand" aria-label="PeerScreen home">
          <BrandMark />
          <span>
            PeerScreen<span className="brand-period">.</span>
          </span>
        </Link>
        <nav aria-label="Main navigation" className="main-navigation">
          <Link
            href="/"
            className={pathname === "/" ? "nav-link active" : "nav-link"}
            aria-current={pathname === "/" ? "page" : undefined}
          >
            <Icon name="grid" />
            Explore
          </Link>
          <Link
            href={channelHref}
            className={
              pathname.startsWith("/channel") ? "nav-link active" : "nav-link"
            }
          >
            <Icon name="channel" />
            {me?.channel ? "Your channel" : "Create a channel"}
          </Link>
          {me?.channel && (
            <Link
              href="/studio"
              className={
                pathname.startsWith("/studio") ? "nav-link active" : "nav-link"
              }
            >
              <Icon name="film" />
              Studio
            </Link>
          )}
        </nav>
        <div className="account-nav">
          {me ? (
            <div className="profile-menu" ref={menu}>
              <button
                ref={trigger}
                className="account-link signed-in"
                aria-expanded={open}
                aria-controls="workspace-menu"
                onClick={() => setOpen((value) => !value)}
              >
                <Avatar name={me.user.display_name} />
                <span>Workspace</span>
                <Icon name="chevron" />
              </button>
              {open && (
                <div className="profile-dropdown" id="workspace-menu">
                  <div className="profile-menu-identity">
                    <strong>{me.user.display_name}</strong>
                    <small>{me.user.email}</small>
                  </div>
                  <nav
                    aria-label="Workspace menu"
                    onClick={() => setOpen(false)}
                  >
                    <Link href="/account">
                      <Icon name="channel" />
                      Channel & account
                    </Link>
                    {me.channel && (
                      <Link href="/studio">
                        <Icon name="film" />
                        Creator studio
                      </Link>
                    )}
                    <Link href="/settings">
                      <Icon name="settings" />
                      Settings
                    </Link>
                  </nav>
                  <button
                    className="profile-signout"
                    disabled={busy}
                    onClick={() => void logout()}
                  >
                    <Icon name="logout" />
                    {busy ? "Signing out…" : "Sign out"}
                  </button>
                  {error && (
                    <p className="error" role="alert">
                      {error}
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <Link href="/account" className="account-link">
              <span>Sign in</span>
              <Icon name="arrow" />
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
