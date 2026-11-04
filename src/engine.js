// Moteur de diff GTFS pour le navigateur, porté du moteur Python (DuckDB SQL).
// Produit les mêmes messages que gtfs-diff-tool (oracle de référence).
import * as duckdb from "@duckdb/duckdb-wasm";

export const GTFS_PRIMARY_KEYS = {
  "agency.txt": ["agency_id"],
  "stops.txt": ["stop_id"],
  "routes.txt": ["route_id"],
  "trips.txt": ["trip_id"],
  "stop_times.txt": ["trip_id", "stop_sequence"],
  "calendar.txt": ["service_id"],
  "calendar_dates.txt": ["service_id", "date"],
  "shapes.txt": ["shape_id", "shape_pt_sequence"],
  "frequencies.txt": ["trip_id", "start_time"],
  "transfers.txt": ["from_stop_id", "to_stop_id", "from_route_id", "to_route_id", "from_trip_id", "to_trip_id"],
  "pathways.txt": ["pathway_id"],
  "levels.txt": ["level_id"],
  "feed_info.txt": ["feed_publisher_name"],
  "translations.txt": ["table_name", "field_name", "language", "record_id", "record_sub_id", "field_value"],
  "fare_attributes.txt": ["fare_id"],
  "areas.txt": ["area_id"],
  "networks.txt": ["network_id"],
};

export const GTFS_REQUIRED_COLUMNS = {
  "agency.txt": ["agency_name", "agency_url", "agency_timezone"],
  "stops.txt": ["stop_id", "stop_name", "stop_lat", "stop_lon"],
  "routes.txt": ["route_id", "route_short_name", "route_type"],
  "trips.txt": ["route_id", "service_id", "trip_id"],
  "stop_times.txt": ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"],
  "calendar.txt": ["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"],
  "calendar_dates.txt": ["service_id", "date", "exception_type"],
  "shapes.txt": ["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"],
  "feed_info.txt": ["feed_publisher_name", "feed_publisher_url", "feed_lang"],
};

const DUPLICATE_NOTE = "Primary key appears several times; only the last row is compared";
const MISSING_COL_NOTE = "Column required by local expectations but missing in feed";
const EMPTY_FILE_NOTE = "File present but headers are empty or unreadable (or not found in first chunk)";

const primaryKey = (f) => GTFS_PRIMARY_KEYS[f] || null;

// ---- helpers SQL (ports exacts du Python) ----
const q = (n) => '"' + n.replaceAll('"', '""') + '"';
const lit = (v) => "'" + String(v).replaceAll("'", "''") + "'";
const sqlNormId = (col) => {
  const cast = `CAST(${col} AS VARCHAR)`;
  const s1 = `regexp_replace(${cast}, '^([A-Z]{2,5}:){1,4}', '')`;
  const s2 = `regexp_replace(${s1}, '^[A-Za-z]{2,5}::[A-Za-z]{2,5}:', '')`;
  return `regexp_replace(${s2}, '^::', '')`;
};
const sqlNormStopId = (col) => `regexp_replace(${sqlNormId(col)}, 'C$', '')`;

export const PROFILES = {
  universal: {},
  zou_scolaire: { route_id: sqlNormId, stop_id: sqlNormStopId, trip_id: sqlNormId, service_id: sqlNormId },
};

function uniqueNames(headers) {
  const seen = new Map(); const out = [];
  headers.forEach((h, i) => {
    let name = h || `column${i}`;
    if (seen.has(name)) { const n = seen.get(name) + 1; seen.set(name, n); name = `${name}_${n}`; }
    else seen.set(name, 0);
    out.push(name);
  });
  return out;
}

// Première ligne d'un CSV (en-têtes), BOM et espaces retirés ; [] si vide.
function readHeader(bytes) {
  if (!bytes || bytes.length === 0) return [];
  let text = new TextDecoder("utf-8").decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const fields = []; let cur = ""; let inq = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inq) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inq = false; }
      else cur += c;
    } else if (c === '"') inq = true;
    else if (c === ",") { fields.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") break;
    else cur += c;
  }
  fields.push(cur);
  const cols = fields.map((f) => f.replace(/^﻿/, "").trim());
  return cols.length === 1 && cols[0] === "" ? [] : cols;
}

const readCsvSQL = (reg, cols) =>
  `read_csv(${lit(reg)}, header=true, auto_detect=false, columns={${cols.map((c) => `${lit(c)}: 'VARCHAR'`).join(", ")}}, ` +
  `delim=',', quote='"', escape='"', null_padding=true, ignore_errors=true, parallel=false)`;


function validationMessages(file, headers, feed) {
  const required = GTFS_REQUIRED_COLUMNS[file];
  if (!required) return [];
  const base = { category: "validation", file, feed };
  if (headers.length === 0)
    return [{ ...base, action: "empty_or_unreadable_file", target: "file", identifier: { filename: file }, note: EMPTY_FILE_NOTE }];
  return required.filter((c) => !headers.includes(c)).map((c) => ({
    ...base, action: "missing_required_column", target: "column", identifier: { column: c }, note: MISSING_COL_NOTE,
  }));
}

function headMessages(file, inA, inB, colsA, colsB) {
  const msgs = [];
  if (inA !== inB)
    msgs.push({ category: "diff", file, action: inB ? "add" : "delete", target: "file", identifier: { filename: file } });
  if (inB) {
    const setA = new Set(colsA), setB = new Set(colsB);
    for (const c of [...colsB].filter((x) => !setA.has(x)).sort())
      msgs.push({ category: "diff", file, action: "add", target: "column", identifier: { column: c } });
    for (const c of [...colsA].filter((x) => !setB.has(x)).sort())
      msgs.push({ category: "diff", file, action: "delete", target: "column", identifier: { column: c } });
  }
  return msgs;
}

async function exec(con, sql) {
  try { return await con.query(sql); }
  catch (e) { e.message = e.message + "\n--SQL--\n" + sql; throw e; }
}

async function rows(con, sql) {
  const res = await exec(con, sql);
  return res.toArray().map((r) => r.toJSON());
}

async function loadSide(db, con, table, reg, bytes, headers, keyExprs, nKeys, normalizers) {
  if (!bytes || headers.length === 0) {
    const keys = Array.from({ length: nKeys }, (_, i) => `''::VARCHAR AS __k${i}`).join(", ");
    await exec(con, `CREATE TEMP TABLE ${table} AS SELECT ${keys ? keys + ", " : ""}0::BIGINT AS __rn WHERE false`);
    return [];
  }
  const cols = uniqueNames(headers);
  await db.dropFile(reg).catch(() => {});
  await db.registerFileBuffer(reg, bytes);
  const proj = cols.map((c) => `COALESCE(${normalizers[c] ? normalizers[c](q(c)) : q(c)}, '') AS ${q(c)}`).join(", ");
  const allNull = cols.map((c) => `${q(c)} IS NULL`).join(" AND ");
  await con.query(
    `CREATE TEMP TABLE ${table}_raw AS SELECT ${proj}, row_number() OVER () AS __rn ` +
    `FROM (SELECT * FROM ${readCsvSQL(reg, cols)} WHERE NOT (${allNull}))`
  );
  const ke = keyExprs(cols);
  const keys = ke.map((e, i) => `${e} AS __k${i}`).join(", ");
  await exec(con, `CREATE TEMP TABLE ${table} AS SELECT *${keys ? ", " + keys : ""} FROM ${table}_raw`);
  await exec(con, `DROP TABLE ${table}_raw`);
  return cols;
}

// Les objets JSON (identifier / initial_value / new_value) sont assemblés en JS
// à partir de colonnes brutes : ce build DuckDB-WASM n'expose pas json_object/to_json
// de façon fiable (« function signature mismatch »).
const diffMsg = (file, action, identifier, initial, nv) => {
  const m = { category: "diff", file, action, target: "row", identifier };
  if (initial !== undefined) m.initial_value = initial;
  if (nv !== undefined) m.new_value = nv;
  return m;
};

async function diffFile(db, con, file, bytesA, bytesB, normalizers) {
  const inA = !!bytesA, inB = !!bytesB;
  const headA = inA ? readHeader(bytesA) : [];
  const headB = inB ? readHeader(bytesB) : [];
  const pk = primaryKey(file);
  for (const t of ["ta", "tb", "ta_d", "tb_d"]) await exec(con, `DROP TABLE IF EXISTS ${t}`);

  const out = [];
  let colsA = [], colsB = [];
  if (inB) {
    let keyExprs, nKeys;
    if (pk) { keyExprs = (cols) => pk.map((k) => (cols.includes(k) ? q(k) : "''")); nKeys = pk.length; }
    else { keyExprs = () => []; nKeys = 0; }
    const safe = file.replace(/[^A-Za-z0-9]/g, "_");
    colsA = await loadSide(db, con, "ta", `a__${safe}.csv`, inA ? bytesA : null, headA, keyExprs, nKeys, normalizers);
    colsB = await loadSide(db, con, "tb", `b__${safe}.csv`, bytesB, headB, keyExprs, nKeys, normalizers);
    const identFromKeys = (r) => Object.fromEntries(pk.map((k, i) => [k, r["k" + i]]));

    if (pk) {
      const kcols = pk.map((_, i) => `__k${i}`);
      const kSel = (t) => pk.map((_, i) => `${t}.__k${i} AS "k${i}"`).join(", ");
      const joinOn = kcols.map((k) => `a.${k} = b.${k}`).join(" AND ");
      const byKeys = kcols.join(", ");
      for (const [side, feed] of [["ta", "a"], ["tb", "b"]]) {
        const dup = await rows(con,
          `SELECT ${pk.map((_, i) => `__k${i} AS "k${i}"`).join(", ")} ` +
          `FROM ${side} GROUP BY ${byKeys} HAVING COUNT(*) > 1`);
        for (const r of dup)
          out.push({ category: "validation", file, action: "duplicate_key", target: "row",
                     feed, identifier: identFromKeys(r), note: DUPLICATE_NOTE });
      }
      for (const side of ["ta", "tb"])
        await exec(con, `CREATE TEMP TABLE ${side}_d AS SELECT * FROM ${side} QUALIFY row_number() OVER (PARTITION BY ${byKeys} ORDER BY __rn DESC) = 1`);

      const del = await rows(con,
        `SELECT ${kSel("a")} FROM ta_d a WHERE NOT EXISTS (SELECT 1 FROM tb_d b WHERE ${joinOn})`);
      for (const r of del) out.push(diffMsg(file, "delete", identFromKeys(r)));

      const addSel = colsB.map((c, i) => `b.${q(c)} AS "v${i}"`).join(", ");
      const add = await rows(con,
        `SELECT ${kSel("b")}${colsB.length ? ", " + addSel : ""} FROM tb_d b ` +
        `WHERE NOT EXISTS (SELECT 1 FROM ta_d a WHERE ${joinOn})`);
      for (const r of add) {
        const nv = Object.fromEntries(colsB.map((c, i) => [c, r["v" + i]]));
        out.push(diffMsg(file, "add", identFromKeys(r), undefined, nv));
      }

      if (colsB.length) {
        const aExpr = (c) => (colsA.includes(c) ? `a.${q(c)}` : "''");
        const cmpSel = colsB.map((c, i) => `${aExpr(c)} AS "a${i}", b.${q(c)} AS "b${i}"`).join(", ");
        const where = colsB.map((c) => `${aExpr(c)} <> b.${q(c)}`).join(" OR ");
        const upd = await rows(con,
          `SELECT ${kSel("a")}, ${cmpSel} FROM ta_d a JOIN tb_d b ON ${joinOn} WHERE ${where}`);
        for (const r of upd) {
          const initial = {}, nv = {};
          colsB.forEach((c, i) => { if (r["a" + i] !== r["b" + i]) { initial[c] = r["a" + i]; nv[c] = r["b" + i]; } });
          if (Object.keys(nv).length)
            out.push(diffMsg(file, "update", identFromKeys(r), initial, nv));
        }
      }
    } else {
      // Fichier sans clé connue : ligne entière, dédupliquée (SET de lignes distinctes).
      const sameCols = colsA.length > 0 && colsA.length === colsB.length && colsA.every((c) => colsB.includes(c));
      const sortedA = [...colsA].sort(), sortedB = [...colsB].sort();
      const distinct = (side, other, cols) => {
        const sel = cols.map((c) => q(c)).join(", ");
        return `SELECT DISTINCT ${sel} FROM ${side}` + (other ? ` EXCEPT SELECT ${sel} FROM ${other}` : "");
      };
      const rowObj = (cols) => (r) => Object.fromEntries(cols.map((c) => [c, r[c]]));
      if (colsA.length) {
        const del = await rows(con, distinct("ta", sameCols ? "tb" : null, sortedA));
        for (const r of del) out.push(diffMsg(file, "delete", rowObj(sortedA)(r)));
      }
      if (colsB.length) {
        const add = await rows(con, distinct("tb", sameCols ? "ta" : null, sortedB));
        for (const r of add) { const o = rowObj(sortedB)(r); out.push(diffMsg(file, "add", o, undefined, o)); }
      }
    }
  }
  const head = headMessages(file, inA, inB, headA, headB);
  const val = [...(inA ? validationMessages(file, headA, "a") : []), ...(inB ? validationMessages(file, headB, "b") : [])];
  return [...head, ...out, ...val];
}

export async function initDuckDB(assetDir) {
  const D = new URL(assetDir || "./assets/duckdb/", location.href).href;
  const bundles = {
    mvp: { mainModule: D + "duckdb-mvp.wasm", mainWorker: D + "duckdb-browser-mvp.worker.js" },
    eh: { mainModule: D + "duckdb-eh.wasm", mainWorker: D + "duckdb-browser-eh.worker.js" },
  };
  const b = await duckdb.selectBundle(bundles);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), new Worker(b.mainWorker));
  await db.instantiate(b.mainModule, b.pthreadWorker);
  return db;
}

// aEntries / bEntries : Map<nomFichier, Uint8Array>. Renvoie les messages par fichier.
export async function diffAll(db, aEntries, bEntries, profileName = "universal") {
  const normalizers = PROFILES[profileName] || {};
  const con = await db.connect();
  try {
    await con.query("SET preserve_insertion_order=true");
    const files = [...new Set([...aEntries.keys(), ...bEntries.keys()])].filter((f) => f.endsWith(".txt")).sort();
    const byFile = {};
    for (const f of files)
      byFile[f] = await diffFile(db, con, f, aEntries.get(f) || null, bEntries.get(f) || null, normalizers);
    return byFile;
  } finally {
    await con.close();
  }
}
