import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  parseDescriptor,
  createSegmentValidator,
} from "../../packages/player/src/integrity.ts";

const bytes = new TextEncoder().encode("real segment bytes").buffer;
const hash = createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
const descriptor = {
  schemaVersion: 1,
  mediaVersion: "a".repeat(64),
  segments: {
    "360p/segment-000.ts": { sha256: hash, bytes: bytes.byteLength },
  },
};
const url = "https://media.example/accepted/attempt/integrity.json";
const segment = "https://media.example/accepted/attempt/360p/segment-000.ts";

test("accepts exact bytes and signed URL query variation", async () => {
  const validate = createSegmentValidator(parseDescriptor(descriptor), url);
  assert.equal(await validate(segment, undefined, bytes), true);
  assert.equal(
    await validate(segment + "?signature=new", undefined, bytes),
    true,
  );
});
test("rejects a changed byte even when the length matches", async () => {
  const corrupted = new Uint8Array(bytes.slice(0));
  corrupted[0] ^= 1;
  assert.equal(
    await createSegmentValidator(parseDescriptor(descriptor), url)(
      segment,
      undefined,
      corrupted.buffer,
    ),
    false,
  );
});
test("rejects truncated segments, unknown keys, another origin and another generation", async () => {
  const validate = createSegmentValidator(parseDescriptor(descriptor), url);
  for (const candidate of [
    segment.replace("media.example", "evil.example"),
    segment.replace("attempt", "older"),
    segment.replace("000.ts", "001.ts"),
    segment.replace("360p", "480p"),
  ])
    assert.equal(await validate(candidate, undefined, bytes), false);
  assert.equal(await validate(segment, undefined, bytes.slice(0, -1)), false);
});
test("fails closed for unsupported byte ranges and malformed URLs", async () => {
  const validate = createSegmentValidator(parseDescriptor(descriptor), url);
  assert.equal(await validate(segment, { start: 0, end: 3 }, bytes), false);
  assert.equal(await validate("not-a-url", undefined, bytes), false);
});
test("rejects malformed, unbounded and traversal descriptor entries", () => {
  for (const value of [
    null,
    {},
    { ...descriptor, schemaVersion: 2 },
    { ...descriptor, mediaVersion: "short" },
    { ...descriptor, segments: {} },
    { ...descriptor, segments: [] },
    {
      ...descriptor,
      segments: { "../segment.ts": { sha256: hash, bytes: 4 } },
    },
    {
      ...descriptor,
      segments: { "360p/segment-000.ts": { sha256: "bad", bytes: 4 } },
    },
    {
      ...descriptor,
      segments: { "360p/segment-000.ts": { sha256: hash, bytes: 0 } },
    },
    {
      ...descriptor,
      segments: {
        "360p/segment-000.ts": { sha256: hash, bytes: 16 * 1024 * 1024 + 1 },
      },
    },
  ])
    assert.throws(() => parseDescriptor(value));
});
