"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
type Resource<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "error"; error: ApiError };
export function useResource<T>(path: string | null, freshOnRetry = false) {
  const [resource, setResource] = useState<{
    path: string | null;
    state: Resource<T>;
  }>({ path: null, state: { status: "loading" } });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setResource({ path, state: { status: "loading" } });
    api<T>(path, {
      signal: controller.signal,
      ...(freshOnRetry && revision > 0
        ? { headers: { "Cache-Control": "no-cache" } }
        : {}),
    })
      .then((value) => {
        if (!controller.signal.aborted)
          setResource({ path, state: { status: "ready", value } });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setResource({
            path,
            state: {
              status: "error",
              error:
                cause instanceof ApiError
                  ? cause
                  : new ApiError(
                      0,
                      "request_failed",
                      "The request could not be completed.",
                    ),
            },
          });
      });
    return () => controller.abort();
  }, [path, revision, freshOnRetry]);
  const state: Resource<T> =
    resource.path === path ? resource.state : { status: "loading" };
  return { state, retry: () => setRevision((value) => value + 1) };
}
