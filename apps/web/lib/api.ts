import type { components } from "@peershare/contracts";
export type OperatorJob = components["schemas"]["OperatorJob"];
export type OperatorPage = components["schemas"]["OperatorPage"];
export type AuthOptions = components["schemas"]["AuthOptions"];
export type AuthMethods = components["schemas"]["AuthMethods"];
export type OAuthRedirect = components["schemas"]["OAuthRedirect"];
export type Me = components["schemas"]["Me"];
export type Channel = components["schemas"]["Channel"];
export type Video = components["schemas"]["Video"];
export type VideoPreview = components["schemas"]["VideoPreview"];
export type VideoDetail = components["schemas"]["VideoDetail"];
export type VideosPage = components["schemas"]["VideosPage"];
export type Registration = components["schemas"]["Registration"];
export type Credentials = components["schemas"]["Credentials"];
export type ChannelCreate = components["schemas"]["ChannelCreate"];
export type ChannelEdit = components["schemas"]["ChannelEdit"];
export type CreateUpload = components["schemas"]["CreateUpload"];
export type PartGrants = components["schemas"]["PartGrants"];
export type VideoEdit = components["schemas"]["VideoEdit"];
export type Upload = components["schemas"]["Upload"];
export type Subscription = components["schemas"]["Subscription"];
export type Subscriptions = components["schemas"]["Subscriptions"];
export type Playlist = components["schemas"]["Playlist"];
export type Playlists = components["schemas"]["Playlists"];
export type PlaylistDetail = components["schemas"]["PlaylistDetail"];
export type CreatorAnalytics = components["schemas"]["CreatorAnalytics"];
export type PlaybackSession = components["schemas"]["PlaybackSession"];
export type PlaybackMetrics = components["schemas"]["PlaybackMetrics"];
export type PlaybackAck = components["schemas"]["PlaybackAck"];

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId = "",
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    rawBody?: BodyInit;
    headers?: Record<string, string>;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const signal = options.signal
    ? AbortSignal.any([
        options.signal,
        AbortSignal.timeout(options.timeoutMs ?? 10_000),
      ])
    : AbortSignal.timeout(options.timeoutMs ?? 10_000);
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method: options.method || "GET",
      credentials: "same-origin",
      signal,
      headers: {
        Accept: "application/json",
        ...(options.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
        ...options.headers,
      },
      body:
        options.rawBody ??
        (options.body === undefined ? undefined : JSON.stringify(options.body)),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(
      0,
      "network_error",
      "The service could not be reached. Please retry.",
    );
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const details = body as components["schemas"]["APIError"] | null;
    throw new ApiError(
      response.status,
      details?.code || "request_failed",
      details?.message || "The request could not be completed.",
      details?.request_id || response.headers.get("X-Request-ID") || "",
    );
  }
  if (body === null)
    throw new ApiError(
      0,
      "invalid_response",
      "The service returned an unreadable response. Please retry.",
    );
  return body as T;
}
export const fixtureChannelID = "00000000-0000-4000-8000-000000000002";
export const fixtureVideoID = "00000000-0000-4000-8000-000000000003";
export function resourceID(
  raw: string | null,
  kind: "video" | "channel" | "playlist",
) {
  if (kind === "video" && raw === "signal-garden") return fixtureVideoID;
  if (kind === "channel" && raw === "peerscreen-lab") return fixtureChannelID;
  return raw &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(raw)
    ? raw
    : null;
}
export const duration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
