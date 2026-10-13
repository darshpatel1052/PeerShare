"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./auth-provider";
import { Avatar, BrandMark, Icon } from "./ui";
import ThemeToggle from "./theme-toggle";

export default function Navigation() {
  const { me } = useAuth();
  const pathname = usePathname();
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
              <Icon name="grid" />
              Studio
            </Link>
          )}
        </nav>
        <div className="account-nav">
          <ThemeToggle />
          <span className="header-divider" />
          <Link
            href="/account"
            className={me ? "account-link signed-in" : "account-link"}
          >
            {me ? (
              <>
                <Avatar name={me.user.display_name} />
                <span>Workspace</span>
              </>
            ) : (
              <>
                <span>Sign in</span>
                <Icon name="arrow" />
              </>
            )}
          </Link>
        </div>
      </div>
    </header>
  );
}
