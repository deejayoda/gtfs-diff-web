// Exposé à Playwright pour la validation contre l'oracle Python.
import JSZip from "jszip";
import { initDuckDB, diffAll } from "./engine.js";

let _db = null;
async function db() {
  if (!_db) _db = await initDuckDB();
  return _db;
}

async function entries(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const map = new Map();
  await Promise.all(
    Object.values(zip.files)
      .filter((f) => !f.dir)
      .map(async (f) => map.set(f.name, new Uint8Array(await f.async("arraybuffer"))))
  );
  return map;
}

// Renvoie la liste à plat des messages (tous fichiers), comme l'oracle.
window.gtfs = {
  async run(aUrl, bUrl, profile = "universal") {
    const byFile = await diffAll(await db(), await entries(aUrl), await entries(bUrl), profile);
    return Object.values(byFile).flat();
  },
};
