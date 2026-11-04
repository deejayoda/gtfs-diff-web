import * as duckdb from "@duckdb/duckdb-wasm";
import JSZip from "jszip";

const D = new URL("./assets/duckdb/", location.href).href;
const out = document.getElementById("result");
const show = (o) => (out.textContent = JSON.stringify(o, null, 2));
const PK = { "stop_times.txt": ["trip_id", "stop_sequence"] };

async function initDuckDB() {
  const bundles = {
    mvp: { mainModule: D + "duckdb-mvp.wasm", mainWorker: D + "duckdb-browser-mvp.worker.js" },
    eh:  { mainModule: D + "duckdb-eh.wasm",  mainWorker: D + "duckdb-browser-eh.worker.js" },
  };
  const b = await duckdb.selectBundle(bundles);
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), new Worker(b.mainWorker));
  await db.instantiate(b.mainModule, b.pthreadWorker);
  return db;
}
async function csvFromZip(bytes, name) {
  const f = (await JSZip.loadAsync(bytes)).file(name);
  return f ? await f.async("uint8array") : null;
}
async function loadSide(db, con, side, bytes, file) {
  const csv = await csvFromZip(bytes, file);
  if (!csv) return 0;
  const v = `${side}_${file.replace(".txt", "")}`;
  await db.registerFileBuffer(`${v}.csv`, csv);
  await con.query(`CREATE TABLE ${v} AS SELECT * FROM read_csv_auto('${v}.csv', ALL_VARCHAR=true, header=true)`);
  return Number((await con.query(`SELECT count(*)::INT n FROM ${v}`)).get(0).n);
}
async function diffCounts(con, file) {
  const [k1, k2] = PK[file];
  const a = `a_${file.replace(".txt", "")}`, b = `b_${file.replace(".txt", "")}`;
  const r = await con.query(`
    WITH ka AS (SELECT DISTINCT ${k1},${k2} FROM ${a}), kb AS (SELECT DISTINCT ${k1},${k2} FROM ${b})
    SELECT (SELECT count(*) FROM (SELECT * FROM ka EXCEPT SELECT * FROM kb)) supprimes,
           (SELECT count(*) FROM (SELECT * FROM kb EXCEPT SELECT * FROM ka)) ajoutes,
           (SELECT count(*) FROM ${a} a JOIN ${b} b USING(${k1},${k2})
              WHERE a.stop_id IS DISTINCT FROM b.stop_id OR a.arrival_time IS DISTINCT FROM b.arrival_time
                 OR a.departure_time IS DISTINCT FROM b.departure_time) modifies`);
  const x = r.get(0);
  return { supprimes: Number(x.supprimes), ajoutes: Number(x.ajoutes), modifies: Number(x.modifies) };
}
(async () => {
  try {
    const t0 = performance.now();
    const [za, zb] = await Promise.all([fetch("./demo/a.zip").then(r=>r.arrayBuffer()), fetch("./demo/b.zip").then(r=>r.arrayBuffer())]);
    const db = await initDuckDB(); const con = await db.connect();
    const file = "stop_times.txt";
    const na = await loadSide(db, con, "a", new Uint8Array(za), file);
    const nb = await loadSide(db, con, "b", new Uint8Array(zb), file);
    show({ ok: true, duckdb: (await con.query("SELECT version() v")).get(0).v,
           file, lignes_A: na, lignes_B: nb, ecarts: await diffCounts(con, file),
           ms: Math.round(performance.now() - t0) });
  } catch (e) { show({ ok: false, error: String((e && e.stack) || e) }); }
})();
