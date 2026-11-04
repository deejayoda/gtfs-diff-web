// Génère un HTML tout-en-un (gtfs-diff.html) : app + worker + wasm DuckDB inlinés,
// pour un usage par double-clic (file://), sans serveur ni fichier externe.
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const DST = "dist-standalone/";
mkdirSync(DST, { recursive: true });

// 1) bundle de l'app en IIFE (script classique, pas de module → OK en file://)
const res = await build({
  entryPoints: ["src/app.js"],
  bundle: true, format: "iife", write: false, logLevel: "info",
});
const appCode = res.outputFiles[0].text;

// 2) assets DuckDB (variante eh uniquement : navigateurs récents Kisio)
const A = "node_modules/@duckdb/duckdb-wasm/dist/";
const wasmB64 = readFileSync(A + "duckdb-eh.wasm").toString("base64");
const workerB64 = readFileSync(A + "duckdb-browser-eh.worker.js").toString("base64");

// 3) markup + styles repris de index.html (sans le <script module>)
const page = readFileSync("index.html", "utf8")
  .replace(/<script type="module"[^>]*><\/script>\s*/, "");

const boot = `
<script>
(function () {
  var bytes = function (b64) { var s = atob(b64), a = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; };
  var worker = new Blob([bytes(${JSON.stringify(workerB64)})], { type: "text/javascript" });
  globalThis.__GTFS_BUNDLE__ = {
    mainModule: "data:application/wasm;base64,${wasmB64}",
    mainWorker: URL.createObjectURL(worker),
  };
})();
</script>
<script>
${appCode}
</script>`;

const html = page.replace("</body>", boot + "\n</body>");
writeFileSync(DST + "gtfs-diff.html", html);
const mb = (html.length / 1048576).toFixed(0);
console.log(`dist-standalone/gtfs-diff.html écrit (${mb} Mo)`);
