// Analyses de dérive portées de compute.py : deltas par ligne, arrêts manquants,
// stats stops/calendar/shapes, routes_field_diffs. Calcul DuckDB à la demande.
import { PROFILES, readHeader, uniqueNames, readCsvSQL } from "./engine.js";
import { countRows } from "./overview.js";

const sqlNormId = (col) => {
  const cast = `CAST(${col} AS VARCHAR)`;
  const s1 = `regexp_replace(${cast}, '^([A-Z]{2,5}:){1,4}', '')`;
  const s2 = `regexp_replace(${s1}, '^[A-Za-z]{2,5}::[A-Za-z]{2,5}:', '')`;
  return `regexp_replace(${s2}, '^::', '')`;
};
const sqlNormStopId = (col) => `regexp_replace(${sqlNormId(col)}, 'C$', '')`;
const vname = (f) => f.slice(0, -4).replace(/-/g, "_");
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";

async function rows(con, sql) {
  const res = await con.query(sql);
  return res.toArray().map((r) => r.toJSON());
}
const one = async (con, sql) => (await rows(con, sql))[0];

export async function computeDrift(db, aEntries, bEntries, profileName = "universal") {
  const norm = PROFILES[profileName] || {};
  const routeNorm = (c = "route_id") => (norm.route_id ? sqlNormId(c) : c);
  const stopNorm = (c = "stop_id") => (norm.stop_id ? sqlNormStopId(c) : c);
  const has = (m, f) => m.has(f);
  const common = (f) => has(aEntries, f) && has(bEntries, f);

  const con = await db.connect();
  const regs = [];
  // Même lecteur CSV que le moteur de lignes (colonnes fixes + filtre lignes vides),
  // validé contre la référence — évite les écarts de read_csv_auto (ex. 3 lignes sur shapes).
  const loadView = async (side, entries, file) => {
    const reg = `${side}__drift__${vname(file)}.csv`;
    await db.dropFile(reg).catch(() => {});
    await db.registerFileBuffer(reg, entries.get(file).slice());
    regs.push(reg);
    const cols = uniqueNames(readHeader(entries.get(file)));
    const allNull = cols.map((c) => `"${c}" IS NULL`).join(" AND ");
    await con.query(
      `CREATE OR REPLACE VIEW ${side}_${vname(file)} AS SELECT * FROM ${readCsvSQL(reg, cols)} WHERE NOT (${allNull})`
    );
  };
  const viewCols = async (v) => (await rows(con, `DESCRIBE "${v}"`)).map((r) => r.column_name);
  const selCols = (cols, wanted) => wanted.map((c) => (cols.includes(c) ? `"${c}"` : `NULL::VARCHAR AS "${c}"`)).join(", ");

  const out = {};
  try {
    // ---- routes_field_diffs + trips_by_route_delta ----
    if (common("routes.txt")) {
      await loadView("a", aEntries, "routes.txt");
      await loadView("b", bEntries, "routes.txt");
      const fields = ["agency_id", "route_short_name", "route_long_name", "route_type"];
      const ca = await viewCols("a_routes"), cb = await viewCols("b_routes");
      await con.query(`CREATE OR REPLACE VIEW a_routes_norm AS SELECT ${routeNorm()} AS route_id_norm, ${selCols(ca, fields)} FROM a_routes`);
      await con.query(`CREATE OR REPLACE VIEW b_routes_norm AS SELECT ${routeNorm()} AS route_id_norm, ${selCols(cb, fields)} FROM b_routes`);
      out.routes_field_diffs = await rows(con, `
        SELECT COALESCE(a.route_id_norm, b.route_id_norm) AS route_id,
          CASE WHEN a.route_id_norm IS NULL THEN 'missing_in_a'
               WHEN b.route_id_norm IS NULL THEN 'missing_in_b'
               WHEN (a.agency_id IS DISTINCT FROM b.agency_id) OR (a.route_short_name IS DISTINCT FROM b.route_short_name)
                 OR (a.route_long_name IS DISTINCT FROM b.route_long_name) OR (a.route_type IS DISTINCT FROM b.route_type)
               THEN 'field_diff' ELSE 'ok' END AS status,
          a.agency_id AS a_agency_id, b.agency_id AS b_agency_id,
          a.route_short_name AS a_short, b.route_short_name AS b_short,
          a.route_long_name AS a_long, b.route_long_name AS b_long,
          a.route_type AS a_type, b.route_type AS b_type
        FROM a_routes_norm a FULL OUTER JOIN b_routes_norm b USING(route_id_norm)
        ORDER BY status, route_id`);
    }
    if (common("trips.txt")) {
      await loadView("a", aEntries, "trips.txt");
      await loadView("b", bEntries, "trips.txt");
      out.trips_by_route_delta = await rows(con, `
        WITH a AS (SELECT ${routeNorm()} AS route_id_norm, COUNT(*)::BIGINT AS a_trips FROM a_trips GROUP BY 1),
             b AS (SELECT ${routeNorm()} AS route_id_norm, COUNT(*)::BIGINT AS b_trips FROM b_trips GROUP BY 1)
        SELECT COALESCE(a.route_id_norm, b.route_id_norm) AS route_id,
               COALESCE(a.a_trips, 0) AS a_trips, COALESCE(b.b_trips, 0) AS b_trips,
               COALESCE(b.b_trips, 0) - COALESCE(a.a_trips, 0) AS delta
        FROM a FULL OUTER JOIN b USING(route_id_norm)
        WHERE COALESCE(a.a_trips, 0) <> COALESCE(b.b_trips, 0)
        ORDER BY ABS(COALESCE(b.b_trips,0)-COALESCE(a.a_trips,0)) DESC, route_id`);
    }
    // ---- stop_times_by_route_delta ----
    if (common("stop_times.txt") && common("trips.txt")) {
      await loadView("a", aEntries, "stop_times.txt");
      await loadView("b", bEntries, "stop_times.txt");
      out.stop_times_by_route_delta = await rows(con, `
        WITH map_a AS (SELECT trip_id, ${routeNorm()} AS route_id_norm FROM a_trips),
             map_b AS (SELECT trip_id, ${routeNorm()} AS route_id_norm FROM b_trips),
             a AS (SELECT m.route_id_norm, COUNT(*)::BIGINT AS a_rows FROM a_stop_times st LEFT JOIN map_a m USING(trip_id) GROUP BY m.route_id_norm),
             b AS (SELECT m.route_id_norm, COUNT(*)::BIGINT AS b_rows FROM b_stop_times st LEFT JOIN map_b m USING(trip_id) GROUP BY m.route_id_norm)
        SELECT COALESCE(a.route_id_norm, b.route_id_norm) AS route_id,
               COALESCE(a.a_rows, 0) AS a_rows, COALESCE(b.b_rows, 0) AS b_rows,
               COALESCE(b.b_rows, 0) - COALESCE(a.a_rows, 0) AS delta
        FROM a FULL OUTER JOIN b USING(route_id_norm)
        WHERE COALESCE(a.a_rows, 0) <> COALESCE(b.b_rows, 0)
        ORDER BY ABS(COALESCE(b.b_rows,0)-COALESCE(a.a_rows,0)) DESC, route_id`);
    }
    // ---- stops_stats + arrêts manquants ----
    if (common("stops.txt")) {
      await loadView("a", aEntries, "stops.txt");
      await loadView("b", bEntries, "stops.txt");
      await con.query(`CREATE OR REPLACE VIEW a_stops_norm AS SELECT *, ${stopNorm()} AS stop_id_norm FROM a_stops`);
      await con.query(`CREATE OR REPLACE VIEW b_stops_norm AS SELECT *, ${stopNorm()} AS stop_id_norm FROM b_stops`);
      out.stops_stats = await one(con, `
        WITH a AS (SELECT COUNT(*)::BIGINT AS r, COUNT(DISTINCT stop_id_norm)::BIGINT AS u FROM a_stops_norm),
             b AS (SELECT COUNT(*)::BIGINT AS r, COUNT(DISTINCT stop_id_norm)::BIGINT AS u FROM b_stops_norm)
        SELECT a.r AS a_rows, b.r AS b_rows, a.u AS a_unique, b.u AS b_unique FROM a, b`);
      out.stops_missing_b_not_in_a = (await rows(con,
        `SELECT stop_id_norm AS stop_id FROM b_stops_norm EXCEPT SELECT stop_id_norm FROM a_stops_norm ORDER BY stop_id LIMIT 200`)).map((r) => r.stop_id);
      out.stops_missing_a_not_in_b = (await rows(con,
        `SELECT stop_id_norm AS stop_id FROM a_stops_norm EXCEPT SELECT stop_id_norm FROM b_stops_norm ORDER BY stop_id LIMIT 200`)).map((r) => r.stop_id);
    }
    // ---- calendar_stats (compte de lignes brut, comme header_and_rowcount) ----
    const cnt = (m, f) => (has(m, f) ? countRows(m.get(f)) : 0);
    out.calendar_stats = {
      a_calendar: cnt(aEntries, "calendar.txt"), b_calendar: cnt(bEntries, "calendar.txt"),
      a_calendar_dates: cnt(aEntries, "calendar_dates.txt"), b_calendar_dates: cnt(bEntries, "calendar_dates.txt"),
    };
    // ---- shapes_stats ----
    if (common("shapes.txt")) {
      await loadView("a", aEntries, "shapes.txt");
      await loadView("b", bEntries, "shapes.txt");
      const side = async (v) => one(con, `
        WITH c AS (SELECT shape_id, COUNT(*)::BIGINT AS n FROM ${v} GROUP BY shape_id)
        SELECT COUNT(*)::BIGINT AS unique_shapes, SUM(n)::BIGINT AS points_total,
               AVG(n)::DOUBLE AS points_mean, quantile_cont(n, 0.5)::DOUBLE AS points_median,
               quantile_cont(n, 0.95)::DOUBLE AS points_p95, MAX(n)::BIGINT AS points_max FROM c`);
      out.shapes_stats = { a: await side("a_shapes"), b: await side("b_shapes") };
    }
  } finally {
    for (const r of regs) await db.dropFile(r).catch(() => {});
    await con.close();
  }
  // DuckDB-WASM renvoie les BIGINT en BigInt JS : on convertit en Number (sérialisable).
  const fix = (v) => typeof v === "bigint" ? Number(v)
    : Array.isArray(v) ? v.map(fix)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fix(x)]))
    : v;
  return fix(out);
}
