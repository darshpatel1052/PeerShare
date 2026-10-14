"use client";
import Link from "next/link";
import { useAuth } from "./auth-provider";
import { Icon, LoadingState } from "./ui";

export default function MemberGate({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const auth = useAuth();
  if (auth.loading) return <LoadingState label="Loading your workspace…" />;
  if (auth.error)
    return (
      <div className="error" role="alert">
        <p>{auth.error}</p>
        <button onClick={() => void auth.reload()}>Retry account</button>
      </div>
    );
  if (!auth.me)
    return (
      <div className="page-state">
        <Icon name="bookmark" />
        <h1>{title}</h1>
        <p className="muted">{description}</p>
        <Link className="button" href="/account">
          Sign in
          <Icon name="arrow" />
        </Link>
      </div>
    );
  return children;
}
