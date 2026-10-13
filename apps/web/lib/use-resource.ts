"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
type Resource<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "error"; error: ApiError };
export function useResource<T>(path: string | null) {
  const [state, setState] = useState<Resource<T>>({ status: "loading" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setState({ status: "loading" });
    api<T>(path, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setState({ status: "ready", value });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setState({
            status: "error",
            error:
              cause instanceof ApiError
                ? cause
                : new ApiError(
                    0,
                    "request_failed",
                    "The request could not be completed.",
                  ),
          });
      });
    return () => controller.abort();
  }, [path, revision]);
  return { state, retry: () => setRevision((value) => value + 1) };
}
