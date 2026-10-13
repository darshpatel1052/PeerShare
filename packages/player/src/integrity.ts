export type IntegrityDescriptor = {
  schemaVersion: 1;
  mediaVersion: string;
  segments: Record<string, { sha256: string; bytes: number }>;
};

const hashPattern = /^[a-f0-9]{64}$/;
const pathPattern = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.ts$/;

export function parseDescriptor(value: unknown): IntegrityDescriptor {
  if (!value || typeof value !== "object")
    throw new Error("Invalid integrity descriptor");
  const descriptor = value as IntegrityDescriptor;
  if (
    descriptor.schemaVersion !== 1 ||
    typeof descriptor.mediaVersion !== "string" ||
    !hashPattern.test(descriptor.mediaVersion) ||
    !descriptor.segments ||
    typeof descriptor.segments !== "object" ||
    Array.isArray(descriptor.segments)
  )
    throw new Error("Unsupported integrity descriptor");
  const entries = Object.entries(descriptor.segments);
  if (entries.length === 0 || entries.length > 5000)
    throw new Error("Invalid segment count");
  const segments: IntegrityDescriptor["segments"] = Object.create(null);
  for (const [path, entry] of entries) {
    if (
      !pathPattern.test(path) ||
      !entry ||
      typeof entry !== "object" ||
      typeof entry.sha256 !== "string" ||
      !hashPattern.test(entry.sha256) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes <= 0 ||
      entry.bytes > 16 * 1024 * 1024
    )
      throw new Error("Invalid segment integrity entry");
    segments[path] = { sha256: entry.sha256, bytes: entry.bytes };
  }
  return { schemaVersion: 1, mediaVersion: descriptor.mediaVersion, segments };
}

export async function fetchDescriptor(
  url: string,
  signal?: AbortSignal,
  credentials: RequestCredentials = "omit",
) {
  const response = await fetch(url, {
    signal,
    credentials,
    redirect: "error",
  });
  if (!response.ok || !response.body)
    throw new Error("Video integrity information is unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 1024 * 1024)
        throw new Error("Integrity descriptor is too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return parseDescriptor(JSON.parse(new TextDecoder().decode(bytes)));
}

export function createSegmentValidator(
  descriptor: IntegrityDescriptor,
  descriptorUrl: string,
  onResult?: (valid: boolean) => void,
) {
  const base = new URL(".", descriptorUrl);
  return async (
    url: string,
    byteRange: { start: number; end: number } | undefined,
    data: ArrayBuffer,
  ): Promise<boolean> => {
    let valid = false;
    try {
      const segment = new URL(url);
      const path = segment.pathname.slice(base.pathname.length);
      const expected = descriptor.segments[path];
      // This recipe emits full MPEG-TS objects. Byte-range/fMP4 needs its own descriptor contract.
      if (
        !byteRange &&
        segment.origin === base.origin &&
        segment.pathname.startsWith(base.pathname) &&
        pathPattern.test(path) &&
        expected &&
        data.byteLength === expected.bytes
      ) {
        const digest = await crypto.subtle.digest("SHA-256", data);
        const actual = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        valid = actual === expected.sha256;
      }
    } catch {
      valid = false;
    }
    onResult?.(valid);
    return valid;
  };
}
