// Vue d'ensemble (volumétrie + sévérité), JS pur — calqué sur compute.py (file_stats + overview_alerts).
// Aucune dépendance DuckDB : rapide et testable hors navigateur.

// Nombre de lignes de données (hors en-tête, hors lignes entièrement vides),
// en respectant les champs entre guillemets (retours à la ligne échappés).
export function countRows(bytes) {
  if (!bytes || bytes.length === 0) return 0;
  let text = new TextDecoder("utf-8").decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let records = 0, inq = false, started = false, nonEmpty = false, header = true;
  const endRecord = () => {
    if (started) { if (header) header = false; else if (nonEmpty) records++; }
    started = false; nonEmpty = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inq) { if (c === '"') { if (text[i + 1] === '"') i++; else inq = false; } else { started = true; nonEmpty = true; } continue; }
    if (c === '"') { inq = true; started = true; nonEmpty = true; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; endRecord(); }
    else { started = true; if (c !== ",") nonEmpty = true; }
  }
  endRecord();
  return records;
}

function headers(bytes) {
  if (!bytes || bytes.length === 0) return [];
  let text = new TextDecoder("utf-8").decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const fields = []; let cur = "", inq = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inq) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inq = false; } else cur += c; }
    else if (c === '"') inq = true;
    else if (c === ",") { fields.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") break;
    else cur += c;
  }
  fields.push(cur);
  const cols = fields.map((f) => f.replace(/^﻿/, "").trim());
  return cols.length === 1 && cols[0] === "" ? [] : cols;
}

const SEV_ORDER = { critical: 0, important: 1, moderate: 2, ok: 3 };

// thresholds : { critical, important, moderate } en % (profil). Défauts = universal.
export function buildOverview(aEntries, bEntries, thresholds = { critical: 30, important: 10, moderate: 5 }) {
  const aFiles = new Set([...aEntries.keys()].filter((f) => f.endsWith(".txt")));
  const bFiles = new Set([...bEntries.keys()].filter((f) => f.endsWith(".txt")));
  const all = [...new Set([...aFiles, ...bFiles])].sort();
  const { critical: c, important: i, moderate: m } = thresholds;

  const tables = all.map((file) => {
    const inA = aFiles.has(file), inB = bFiles.has(file);
    const aRows = inA ? countRows(aEntries.get(file)) : 0;
    const bRows = inB ? countRows(bEntries.get(file)) : 0;
    const colsA = inA ? headers(aEntries.get(file)) : [];
    const colsB = inB ? headers(bEntries.get(file)) : [];
    const setA = new Set(colsA), setB = new Set(colsB);
    const addedCols = colsB.filter((x) => !setA.has(x));
    const removedCols = colsA.filter((x) => !setB.has(x));
    const colsDelta = colsB.length - colsA.length;
    const pct = aRows === 0 ? null : Math.abs(((bRows - aRows) * 100) / aRows);
    const pctSigned = aRows === 0 ? (bRows === 0 ? 0 : 100) : Math.round(((bRows - aRows) * 100) / aRows * 10) / 10;

    let severity;
    if (!inA || !inB) severity = "critical";          // fichier présent d'un seul côté
    else if (aRows === 0 && bRows === 0) severity = "ok";
    else if (aRows === 0 || bRows === 0) severity = "critical";
    else if (pct >= c) severity = "critical";
    else if (pct >= i) severity = "important";
    else if (pct >= m) severity = "moderate";
    else if (colsDelta !== 0) severity = "moderate";
    else severity = "ok";

    return { file, inA, inB, aRows, bRows, colsA, colsB, addedCols, removedCols, colsDelta, pctRowsChange: pctSigned, severity };
  });

  tables.sort((x, y) => SEV_ORDER[x.severity] - SEV_ORDER[y.severity] || Math.abs(y.bRows - y.aRows) - Math.abs(x.bRows - x.aRows));

  const common = all.filter((f) => aFiles.has(f) && bFiles.has(f));
  const addedFiles = all.filter((f) => !aFiles.has(f) && bFiles.has(f));
  const removedFiles = all.filter((f) => aFiles.has(f) && !bFiles.has(f));
  const globalSeverity = tables.reduce((s, t) => Math.min(s, SEV_ORDER[t.severity]), 3);
  const GLOBAL = ["critical", "important", "moderate", "ok"][globalSeverity];

  return { tables, common, addedFiles, removedFiles, globalSeverity: GLOBAL };
}
