import { build } from "esbuild";
import { mkdirSync, copyFileSync } from "node:fs";

await build({
  entryPoints: ["src/app.js"],
  bundle: true,
  format: "esm",
  outfile: "dist/app.bundle.js",
  logLevel: "info",
});

const SRC = "node_modules/@duckdb/duckdb-wasm/dist/";
const DST = "assets/duckdb/";
mkdirSync(DST, { recursive: true });
for (const f of [
  "duckdb-mvp.wasm",
  "duckdb-eh.wasm",
  "duckdb-browser-mvp.worker.js",
  "duckdb-browser-eh.worker.js",
]) copyFileSync(SRC + f, DST + f);
console.log("assets DuckDB copiés dans", DST);
