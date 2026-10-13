import { readFile, writeFile } from "node:fs/promises";
import openapiTS, { astToString, COMMENT_HEADER } from "openapi-typescript";
import { format } from "prettier";

const ast = await openapiTS(
  new URL("../../contracts/openapi/catalog-v1.yaml", import.meta.url),
);
const generated = await format(COMMENT_HEADER + astToString(ast), {
  parser: "typescript",
});
const target = new URL("./src/schema.ts", import.meta.url);
if (process.argv.includes("--check")) {
  const actual = await readFile(target, "utf8");
  if (actual !== generated)
    throw new Error(
      "API types differ from OpenAPI. Run npm run contracts:generate.",
    );
  console.log("API types match the checked-in contract.");
} else {
  await writeFile(target, generated);
  console.log("Generated frontend API types.");
}
