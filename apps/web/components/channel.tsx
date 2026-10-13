"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { resourceID, type Channel } from "../lib/api";
import { useResource } from "../lib/use-resource";
import { useAuth } from "./auth-provider";
import { Avatar, ChannelCover, Icon, LoadingState } from "./ui";
import VideoList from "./video-list";

export default function ChannelPage() {
  const id = resourceID(useSearchParams().get("id"), "channel");
  const { state, retry } = useResource<Channel>(id ? `/channels/${id}` : null);
  const { me } = useAuth();
  const [tab, setTab] = useState<"videos" | "about">("videos");
  const [share, setShare] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    setTab("videos");
    setShare("idle");
  }, [id]);
  async function copyChannel() {
    try {
      await navigator.clipboard.writeText(
        new URL(`/channel/?id=${id}`, window.location.origin).href,
      );
      setShare("copied");
    } catch {
      setShare("failed");
    }
  }
  if (!id || (state.status === "error" && state.error.status === 404))
    return (
      <main id="main">
        <div className="page-state">
          <Icon name="channel" />
          <h1>Channel not found</h1>
          <p className="muted">
            This channel may have moved or is no longer available.
          </p>
          <Link className="button" href="/">
            Back to explore
            <Icon name="arrow" />
          </Link>
        </div>
      </main>
    );
  if (state.status === "loading")
    return (
      <main id="main">
        <LoadingState label="Loading channel…" />
      </main>
    );
  if (state.status === "error")
    return (
      <main id="main">
        <h1>Channel unavailable</h1>
        <div role="alert" className="error">
          <p>{state.error.message}</p>
          <button onClick={retry}>Retry channel</button>
        </div>
      </main>
    );
  const channel = state.value;
  const isOwner = me?.channel?.id === channel.id;
  return (
    <main id="main" className="channel-page">
      <ChannelCover imageURL={channel.banner_url} />
      <div className="channel-identity">
        <Avatar name={channel.title} large />
        <div className="channel-heading">
          <span className="eyebrow">Creator channel</span>
          <h1>{channel.title}</h1>
          <p className="channel-meta">
            @{channel.handle}
            <span>·</span>
            {channel.owner_display_name}
          </p>
        </div>
        <div className="channel-actions">
          {isOwner ? (
            <Link className="button" href="/account">
              <Icon name="settings" />
              Edit channel
            </Link>
          ) : (
            <a
              className="button"
              href="#channel-content"
              onClick={() => setTab("videos")}
            >
              Browse videos
              <Icon name="arrow" />
            </a>
          )}
          <button className="secondary-button" onClick={copyChannel}>
            <Icon name={share === "copied" ? "check" : "share"} />
            {share === "copied" ? "Link copied" : "Share channel"}
          </button>
        </div>
      </div>
      {channel.description && (
        <p className="channel-description">{channel.description}</p>
      )}
      {share === "copied" && (
        <span className="sr-only" role="status">
          Channel link copied to clipboard.
        </span>
      )}
      {share === "failed" && (
        <p role="alert" className="muted">
          Couldn't copy the link. You can copy it from your address bar.
        </p>
      )}
      <div
        className="channel-tabs"
        role="tablist"
        aria-label="Channel sections"
        onKeyDown={(event) => {
          let next: "videos" | "about";
          if (event.key === "Home") next = "videos";
          else if (event.key === "End") next = "about";
          else if (event.key === "ArrowLeft" || event.key === "ArrowRight")
            next = tab === "videos" ? "about" : "videos";
          else return;
          event.preventDefault();
          setTab(next);
          event.currentTarget
            .querySelector<HTMLButtonElement>(`#${next}-tab`)
            ?.focus();
        }}
      >
        <button
          id="videos-tab"
          role="tab"
          aria-selected={tab === "videos"}
          aria-controls="channel-content"
          tabIndex={tab === "videos" ? 0 : -1}
          onClick={() => setTab("videos")}
        >
          <Icon name="film" />
          Videos
        </button>
        <button
          id="about-tab"
          role="tab"
          aria-selected={tab === "about"}
          aria-controls="channel-content"
          tabIndex={tab === "about" ? 0 : -1}
          onClick={() => setTab("about")}
        >
          About
        </button>
      </div>
      <section
        id="channel-content"
        className="channel-content"
        role="tabpanel"
        aria-labelledby={tab === "videos" ? "videos-tab" : "about-tab"}
      >
        {tab === "videos" ? (
          <VideoList key={id} channelID={id} owner={isOwner} />
        ) : (
          <div className="about-channel">
            <div>
              <span className="eyebrow">About the channel</span>
              <h2>{channel.title}</h2>
              <p>
                {channel.description ||
                  `A channel by ${channel.owner_display_name}.`}
              </p>
            </div>
            <dl>
              <div>
                <dt>Creator</dt>
                <dd>{channel.owner_display_name}</dd>
              </div>
              <div>
                <dt>Channel handle</dt>
                <dd>@{channel.handle}</dd>
              </div>
              <div>
                <dt>Joined</dt>
                <dd>
                  {new Intl.DateTimeFormat("en", {
                    month: "long",
                    year: "numeric",
                  }).format(new Date(channel.created_at))}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </section>
    </main>
  );
}
