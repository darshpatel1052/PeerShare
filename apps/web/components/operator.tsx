"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, type OperatorPage, type OperatorJob } from "../lib/api";
import { useResource } from "../lib/use-resource";
import { useAuth } from "./auth-provider";
import MemberGate from "./member-gate";
import { Icon, LoadingState } from "./ui";

export default function Operator() {
  const { me } = useAuth();
  return (
    <main id="main" className="operator-page">
      <MemberGate
        title="Platform operations"
        description="Sign in with your operator account."
      >
        {me?.user.role === "operator" ? (
          <OperatorContents key={me.user.id} />
        ) : (
          <section className="page-state">
            <Icon name="lock" />
            <h1>Operator access required</h1>
            <p className="muted">
              This workspace is available to platform operators.
            </p>
            <Link className="button" href="/">
              Explore videos
            </Link>
          </section>
        )}
      </MemberGate>
    </main>
  );
}
function OperatorContents() {
  const [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState("");
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const params = new URLSearchParams({ state: filter, q: search });
  const cursor = cursors.at(-1);
  if (cursor) params.set("cursor", cursor);
  return (
    <>
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">Platform operations</span>
          <h1>Keep things moving.</h1>
          <p>Processing jobs and storage across PeerShare.</p>
        </div>
        <span className="operator-access">
          <Icon name="lock" />
          Operator access
        </span>
      </div>
      <div className="operator-toolbar">
        <div
          className="library-filters"
          role="group"
          aria-label="Processing job filters"
        >
          {[
            ["all", "All jobs"],
            ["active", "Processing"],
            ["attention", "Needs attention"],
            ["ready", "Ready"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={filter === value ? "selected" : ""}
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value);
                setCursors([null]);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <form
          className="studio-search"
          role="search"
          aria-label="Search processing jobs"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(query.trim());
            setCursors([null]);
          }}
        >
          <input
            aria-label="Search jobs"
            placeholder="Search videos or channels"
            value={query}
            maxLength={100}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button className="secondary-button">
            <Icon name="search" />
            Search
          </button>
        </form>
      </div>
      <JobBoard
        key={params.toString()}
        path={`/operator/jobs?${params}`}
        page={cursors.length}
        onPrevious={
          cursors.length > 1
            ? () => setCursors((value) => value.slice(0, -1))
            : undefined
        }
        onNext={(value) => setCursors((old) => [...old, value])}
      />
    </>
  );
}
function JobBoard({
  path,
  page,
  onPrevious,
  onNext,
}: {
  path: string;
  page: number;
  onPrevious?: () => void;
  onNext: (cursor: string) => void;
}) {
  const { state, retry } = useResource<OperatorPage>(path);
  const previous = useRef<OperatorPage | undefined>(undefined);
  if (state.status === "ready") previous.current = state.value;
  if (
    state.status === "error" &&
    (state.error.status === 403 || state.error.status === 401)
  )
    previous.current = undefined;
  const data = previous.current;
  const [selected, setSelected] = useState<{
      job: OperatorJob;
      action: "retry" | "cancel";
    } | null>(null),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (selected) dialog.current?.showModal();
  }, [selected]);
  const reload = useRef(retry);
  reload.current = retry;
  useEffect(() => {
    const timer = setInterval(() => reload.current(), 5000);
    return () => clearInterval(timer);
  }, []);
  async function perform(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await api(`/operator/jobs/${selected.job.id}/${selected.action}`, {
        method: "POST",
        body: { note: note.trim() },
      });
      setNotice(
        selected.action === "retry"
          ? "Video queued for processing."
          : "Cancellation requested.",
      );
      setSelected(null);
      setNote("");
      retry();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "This action could not be completed.",
      );
    } finally {
      setBusy(false);
    }
  }
  const gib = (bytes: number) => (bytes / 1024 ** 3).toFixed(2);
  return (
    <>
      {state.status === "error" && (
        <div className="error" role="alert">
          <p>{state.error.message}</p>
          <button onClick={retry}>Refresh jobs</button>
        </div>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {!data ? (
        state.status === "loading" ? (
          <LoadingState label="Loading processing jobs…" />
        ) : null
      ) : (
        <>
          <div className="operator-summary">
            <article>
              <Icon name="film" />
              <span>Processing</span>
              <strong>{data.summary.active}</strong>
            </article>
            <article>
              <Icon name="check" />
              <span>Ready</span>
              <strong>{data.summary.ready}</strong>
            </article>
            <article>
              <Icon name="signal" />
              <span>Needs attention</span>
              <strong>{data.summary.attention}</strong>
            </article>
            <article>
              <Icon name="list" />
              <span>Storage reserved</span>
              <strong>
                {gib(data.summary.reserved_bytes)}
                <small> / {gib(data.summary.capacity_bytes)} GiB</small>
              </strong>
              <meter
                min={0}
                max={data.summary.capacity_bytes}
                value={data.summary.reserved_bytes}
                aria-label="Logical storage reserved"
              />
            </article>
          </div>
          <div className="section-heading">
            <div>
              <h2>Processing queue</h2>
              <p className="muted">
                Updates every five seconds. Storage includes space held for
                in-flight work.
              </p>
            </div>
            <button
              className="secondary-button"
              disabled={state.status === "loading"}
              onClick={retry}
            >
              Refresh
            </button>
          </div>
          <div className="operator-jobs">
            {data.items.length === 0 ? (
              <div className="studio-empty">
                <Icon name="check" />
                <h3>No matching jobs</h3>
                <p className="muted">
                  Change the filter or search to see more.
                </p>
              </div>
            ) : (
              data.items.map((job) => (
                <article key={job.id} className="operator-job">
                  <div>
                    <span className="eyebrow">{job.channel}</span>
                    <h3>{job.title}</h3>
                    <small className="muted">
                      {job.publication} · Attempt {job.attempts} of 3 · Updated{" "}
                      {new Date(job.updated_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </small>
                    {job.error_code && (
                      <p className="operator-error-code">
                        {job.error_code.replaceAll("_", " ")}
                      </p>
                    )}
                  </div>
                  <div className="operator-job-state">
                    <span className={`state-pill state-${job.state}`}>
                      {job.state === "queued"
                        ? "Queued"
                        : job.state === "running"
                          ? "Processing"
                          : job.state === "ready"
                            ? "Ready"
                            : job.state === "failed"
                              ? "Failed"
                              : "Cancelled"}
                    </span>
                    {job.state === "running" && (
                      <progress
                        max={100}
                        value={job.progress}
                        aria-label={`${job.title} processing progress`}
                      />
                    )}
                  </div>
                  <div className="operator-job-actions">
                    {(job.state === "failed" || job.state === "cancelled") &&
                      job.attempts < 3 && (
                        <button
                          className="secondary-button"
                          onClick={() => {
                            setSelected({ job, action: "retry" });
                            setNote("");
                            setError("");
                          }}
                        >
                          Retry processing
                        </button>
                      )}
                    {(job.state === "queued" || job.state === "running") && (
                      <button
                        className="text-button"
                        onClick={() => {
                          setSelected({ job, action: "cancel" });
                          setNote("");
                          setError("");
                        }}
                      >
                        Cancel processing
                      </button>
                    )}
                    {job.publication === "published" && (
                      <Link
                        href={`/watch?v=${job.video_id}`}
                        className="text-button"
                      >
                        Watch video <Icon name="arrow" />
                      </Link>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
          <nav className="studio-pagination" aria-label="Processing job pages">
            <button
              className="secondary-button"
              disabled={!onPrevious}
              onClick={onPrevious}
            >
              Previous page
            </button>
            <span className="muted">Page {page}</span>
            <button
              className="secondary-button"
              disabled={!data.next_cursor}
              onClick={() => {
                if (data.next_cursor) onNext(data.next_cursor);
              }}
            >
              Next page
            </button>
          </nav>
        </>
      )}
      {selected && (
        <dialog
          ref={dialog}
          className="operator-action-dialog"
          aria-labelledby="operator-action-title"
          onCancel={(event) => {
            if (busy) event.preventDefault();
            else setSelected(null);
          }}
        >
          <form onSubmit={(event) => void perform(event)}>
            <span className="eyebrow">Operator action</span>
            <h2 id="operator-action-title">
              {selected.action === "retry"
                ? "Retry processing?"
                : "Cancel processing?"}
            </h2>
            <p>{selected.job.title}</p>
            <p className="muted">
              {selected.action === "retry"
                ? "The video will return to the processing queue within its remaining attempt budget."
                : "The current processing attempt will stop. The source stays available for a later retry."}
            </p>
            <label htmlFor="operator-note">Operator note</label>
            <textarea
              autoFocus
              id="operator-note"
              required
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add the reason for this action"
              disabled={busy}
            />
            <small className="muted">
              Your account, action and note are recorded with this job.
            </small>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="operator-dialog-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => setSelected(null)}
              >
                Go back
              </button>
              <button disabled={busy || !note.trim()}>
                {busy
                  ? "Saving…"
                  : selected.action === "retry"
                    ? "Queue retry"
                    : "Confirm cancellation"}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </>
  );
}
