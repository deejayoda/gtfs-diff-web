// Serveur statique minimal, sans dépendance, pour tester en local (Windows/macOS/Linux).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const ROOT = process.cwd();
const PORT = process.env.PORT || 8080;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".wasm": "application/wasm", ".zip": "application/zip", ".json": "application/json",
  ".css": "text/css", ".map": "application/json", ".ico": "image/x-icon",
};

createServer(async (req, res) => {
  try {
    // On raisonne sur le chemin de l'URL (toujours des "/"), pas sur les chemins de l'OS
    let p = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (p.endsWith("/")) p += "index.html";
    const full = resolve(ROOT, "." + p); // "." + "/x" => chemin relatif à ROOT
    if (full !== ROOT && !full.startsWith(ROOT + sep)) {
      res.writeHead(403); res.end("403"); return;
    }
    const data = await readFile(full);
    res.writeHead(200, { "Content-Type": TYPES[extname(full)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("404");
  }
}).listen(PORT, () => console.log(`Serveur : http://127.0.0.1:${PORT}/`));
