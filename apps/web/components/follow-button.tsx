"use client";
import { useState } from "react";
import Link from "next/link";
import { api, type Subscription } from "../lib/api";
import { useResource } from "../lib/use-resource";
import { useAuth } from "./auth-provider";
import { Icon } from "./ui";

export default function FollowButton({
  channelID,
  owner = false,
}: {
  channelID: string;
  owner?: boolean;
}) {
  const { me, loading } = useAuth();
  return (
    <FollowControl
      key={`${channelID}:${me?.user.id ?? "guest"}`}
      channelID={channelID}
      owner={owner}
      signedIn={Boolean(me)}
      loadingAccount={loading}
    />
  );
}
function FollowControl({
  channelID,
  owner,
  signedIn,
  loadingAccount,
}: {
  channelID: string;
  owner: boolean;
  signedIn: boolean;
  loadingAccount: boolean;
}) {
  const { state, retry } = useResource<Subscription>(
    loadingAccount ? null : `/channels/${channelID}/subscription`,
  );
  const [updated, setUpdated] = useState<Subscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const value = updated ?? (state.status === "ready" ? state.value : null);
  async function change() {
    if (!value) return;
    setBusy(true);
    setError("");
    try {
      setUpdated(
        await api<Subscription>(`/channels/${channelID}/subscription`, {
          method: value.following ? "DELETE" : "POST",
          ...(value.following ? {} : { body: {} }),
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="follow-control">
      {!owner &&
        (loadingAccount ? (
          <button className="button" disabled>
            <Icon name="plus" />
            Follow
          </button>
        ) : signedIn ? (
          <button
            className={value?.following ? "secondary-button" : "button"}
            disabled={!value || busy}
            aria-pressed={value?.following ?? false}
            onClick={() => void change()}
          >
            <Icon name={value?.following ? "check" : "plus"} />
            {busy ? "Updating…" : value?.following ? "Following" : "Follow"}
          </button>
        ) : (
          <Link className="button" href="/account">
            <Icon name="plus" />
            Follow
          </Link>
        ))}
      {value && (
        <span className="follower-count">
          {value.followers.toLocaleString()}{" "}
          {value.followers === 1 ? "follower" : "followers"}
        </span>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {state.status === "error" && (
        <button
          className="text-button"
          onClick={() => {
            setUpdated(null);
            retry();
          }}
        >
          Retry channel details
        </button>
      )}
    </div>
  );
}
