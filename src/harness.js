// Exposé à Playwright pour la validation contre l'oracle Python et la vérif croisée openFile.
import JSZip from "jszip";
import { initDuckDB, diffAll, diffFile, openFile } from "./engine.js";

let _db = null;
async function db() { if (!_db) _db = await initDuckDB(); return _db; }

async function entries(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const map = new Map();
  await Promise.all(Object.values(zip.files).filter((f) => !f.dir).map(async (f) =>
    map.set(f.name, new Uint8Array(await f.async("arraybuffer")))));
  return map;
}

function canon(msgs) {
  const j = (v) => (v == null ? "" : JSON.stringify(v, Object.keys(v).sort ? undefined : undefined));
  const stable = (v) => (v == null ? null : JSON.stringify(sortKeys(v)));
  function sortKeys(o) {
    if (Array.isArray(o)) return o.map(sortKeys);
    if (o && typeof o === "object") return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])]));
    return o;
  }
  const c = new Map();
  for (const m of msgs) {
    const key = [m.category, m.action, m.target, m.feed ?? null, stable(m.identifier), stable(m.initial_value ?? null), stable(m.new_value ?? null)].join("\u0001");
    c.set(key, (c.get(key) || 0) + 1);
  }
  return c;
}
function sameMultiset(a, b) {
  const ca = canon(a), cb = canon(b);
  if (ca.size !== cb.size) return false;
  for (const [k, n] of ca) if (cb.get(k) !== n) return false;
  return true;
}

async function diffOne(d, aE, bE, file, profile) {
  const con = await d.connect();
  await con.query("SET preserve_insertion_order=true");
  try {
    const { PROFILES } = await import("./engine.js");
    return await diffFile(d, con, file, aE.get(file) || null, bE.get(file) || null, PROFILES[profile] || {});
  } finally { await con.close(); }
}

window.gtfs = {
  // validation oracle : liste à plat de tous les messages (tous fichiers)
  async run(aUrl, bUrl, profile = "universal") {
    const byFile = await diffAll(await db(), await entries(aUrl), await entries(bUrl), profile);
    return Object.values(byFile).flat();
  },
  // vérif croisée openFile vs diffFile pour un seul fichier
  async openCheck(aUrl, bUrl, file, profile = "universal") {
    const d = await db(), aE = await entries(aUrl), bE = await entries(bUrl);
    const ref = await diffOne(d, aE, bE, file, profile);
    const h = await openFile(d, aE, bE, file, profile);
    const all = [...h.head];
    for (const action of ["delete", "add", "update", "duplicate_a", "duplicate_b"]) {
      let off = 0;
      while (true) {
        const pg = await h.page(action, off, 1000);
        if (!pg.length) break;
        all.push(...pg); off += 1000;
      }
    }
    all.push(...h.validation);
    const counts = h.counts;
    await h.close();
    return { file, match: sameMultiset(ref, all), nRef: ref.length, nOpen: all.length, counts };
  },
};
