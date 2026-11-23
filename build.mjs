import { build } from "esbuild";
import { readFileSync as _rf } from "node:fs";
const VERSION = JSON.parse(_rf("package.json", "utf8")).version;
import { mkdirSync, copyFileSync } from "node:fs";

await build({
  entryPoints: { "app.bundle": "src/app.js", "harness.bundle": "src/harness.js" },
  bundle: true,
  format: "esm",
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  outdir: "dist",
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
