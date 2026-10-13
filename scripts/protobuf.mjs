import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { runGo } from "./go.mjs";

const bin = resolve(".local/bin");
await mkdir(bin, { recursive: true });
const plugins = [
  ["protoc-gen-go", "google.golang.org/protobuf/cmd/protoc-gen-go"],
  ["protoc-gen-go-grpc", "google.golang.org/grpc/cmd/protoc-gen-go-grpc"],
];
for (const [name, source] of plugins)
  await runGo(["build", "-o", resolve(bin, name), source]);
await runGo([
  "run",
  "./cmd/protogen",
  resolve("proto"),
  resolve("services/api/gen"),
  ...plugins.map(([name]) => resolve(bin, name)),
  ...(process.argv.includes("--check") ? ["--check"] : []),
]);
