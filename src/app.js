// Interface GTFS Drift Dashboard — calquée sur l'application desktop.
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { initDuckDB, openFile } from "./engine.js";
import { buildOverview } from "./overview.js";
import { getMeta } from "./gtfs_meta.js";
import { computeDrift } from "./drift.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, kids = []) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of [].concat(kids)) if (k != null) n.append(k);
  return n;
};
const SEV = { critical: ["CRITIQUE", "critical"], important: ["IMPORTANT", "important"], moderate: ["NOTABLE", "moderate"], ok: ["OK", "ok"] };
const sevBadge = (s) => el("span", { className: "badge b-" + SEV[s][1] }, [el("span", { className: "dot d-" + SEV[s][1] }), SEV[s][0]]);
const num = (v) => (v == null ? "—" : Number(v).toLocaleString("fr"));
const dec = (v) => (v == null ? "—" : Number(v).toLocaleString("fr", { maximumFractionDigits: 1 }));

let db = null, entriesA = null, entriesB = null, labels = { a: "A", b: "B" };
let handle = null, drift = null, ov = null;

// ---------- sélection de fichiers ----------
function wireDrop(side) {
  const drop = $("drop" + side), input = $("file" + side);
  const set = (f) => {
    input._file = f;
    $("fname" + side).textContent = f ? "Fichier sélectionné : " + f.name : "";
    $("prompt" + side).textContent = f ? f.name : "Glisser-déposer ou choisir un fichier";
  };
  drop.addEventListener("click", () => input.click());
  input.addEventListener("change", () => set(input.files[0]));
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) { input._file = f; set(f); } });
  return () => input._file || input.files[0];
}
const getA = wireDrop("A"), getB = wireDrop("B");

async function entries(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const map = new Map();
  await Promise.all(Object.values(zip.files).filter((f) => !f.dir).map(async (f) => map.set(f.name, new Uint8Array(await f.async("arraybuffer")))));
  return map;
}

// ---------- comparaison ----------
async function run() {
  const fa = getA(), fb = getB();
  if (!fa || !fb) { $("status").innerHTML = ""; $("status").append(el("div", { className: "statusbox", textContent: "⚠️ Choisissez les deux fichiers ZIP." })); return; }
  labels = { a: ($("labelA").value || "").trim() || fa.name.replace(/\.zip$/i, ""), b: ($("labelB").value || "").trim() || fb.name.replace(/\.zip$/i, "") };
  $("run").disabled = true;
  $("status").innerHTML = ""; $("status").append(el("div", { className: "statusbox", textContent: "⏳ Lecture des fichiers et comparaison…" }));
  const t0 = performance.now();
  try {
    [entriesA, entriesB] = await Promise.all([entries(fa), entries(fb)]);
    drift = null; handle = null;
    ov = buildOverview(entriesA, entriesB);
    renderOverview(ov);
    renderDetailShell(ov);
    const ms = ((performance.now() - t0) / 1000).toFixed(1);
    $("status").innerHTML = "";
    $("status").append(el("div", { className: "statusbox" }, [
      "✅ Comparaison terminée en " + ms + " s : " + labels.a + " → " + labels.b + "  |  Profil : " + $("profile").selectedOptions[0].text]));
    $("overview").classList.remove("hidden"); $("detailPanel").classList.remove("hidden");
  } catch (e) {
    $("status").innerHTML = ""; $("status").append(el("div", { className: "statusbox", textContent: "❌ " + (e && e.message ? e.message : e) }));
  } finally { $("run").disabled = false; }
}

// ---------- vue d'ensemble ----------
function renderOverview(ov) {
  const root = $("overview"); root.innerHTML = "";
  root.append(el("div", { style: "display:flex;align-items:center;gap:.6rem;margin-bottom:.6rem" },
    [sevBadge(ov.globalSeverity), el("span", { style: "font-weight:700;font-size:1.05rem" }, labels.a + " → " + labels.b)]));

  const stat = (n, cls, label, files) => {
    const c = el("div", { className: "stat" }, [el("div", { className: "n " + cls, textContent: num(n) }), el("div", { className: "l", textContent: label })]);
    if (files && files.length) c.append(el("div", { className: "f " + cls, textContent: files.join(", ") }));
    return c;
  };
  root.append(el("div", { className: "stats" }, [
    stat(ov.common.length, "n-blue", "Tables communes"),
    stat(ov.addedFiles.length, "n-green", "Tables ajoutées dans " + labels.b, ov.addedFiles),
    stat(ov.removedFiles.length, "n-red", "Tables absentes de " + labels.b, ov.removedFiles),
    stat(ov.tables.filter((t) => t.inA && t.inB && t.severity !== "ok").length, "n-orange", "Tables impactées"),
  ]));

  // variations volumétriques
  const vol = ov.tables.filter((t) => t.severity !== "ok" && t.inA && t.inB);
  if (vol.length) {
    root.append(el("h3", { textContent: "⚠ Variations volumétriques" }));
    const box = el("div", { className: "vol" });
    for (const t of vol) box.append(el("div", { className: "row " + t.severity },
      `• ${t.file} ${t.pctRowsChange > 0 ? "+" : ""}${t.pctRowsChange} % (${num(t.aRows)} → ${num(t.bRows)} lignes)`));
    root.append(box);
  }

  // tables les plus impactées
  root.append(el("h3", { textContent: "Tables les plus impactées", style: "margin-top:1rem" }));
  const t = el("table");
  t.append(el("thead", {}, el("tr", {}, ["Table (cliquer pour ouvrir)", "Sévérité", "Δ lignes", "Δ colonnes"].map((h, i) => el("th", { className: i >= 2 ? "num" : "", textContent: h })))));
  const b = el("tbody");
  for (const r of ov.tables) {
    const pct = r.inA && r.inB ? (r.pctRowsChange > 0 ? "+" : "") + r.pctRowsChange + " %" : (!r.inA ? "fichier ajouté" : "fichier absent");
    const link = el("a", { className: "link mono", textContent: r.file });
    link.addEventListener("click", () => selectTable(r.file));
    const tr = el("tr", { className: r.severity !== "ok" ? r.severity : "" }, [
      el("td", {}, link), el("td", {}, sevBadge(r.severity)),
      el("td", { className: "num " + (r.bRows >= r.aRows ? "delta-pos" : "delta-neg"), textContent: pct }),
      el("td", { className: "num", textContent: r.colsDelta ? (r.colsDelta > 0 ? "+" : "") + r.colsDelta : "—" }),
    ]);
    b.append(tr);
  }
  t.append(b); root.append(el("div", { className: "scroll" }, t));
}

// ---------- détail par table ----------
const ANALYSES = [
  ["trips_by_route_delta", "Trajets par ligne (Δ)"], ["stop_times_by_route_delta", "Horaires par ligne (Δ)"],
  ["routes_field_diffs", "Lignes — champs modifiés"], ["stops_missing_b_not_in_a", "Arrêts B absents de A"],
  ["stops_missing_a_not_in_b", "Arrêts A absents de B"], ["stops_stats", "Stats arrêts"],
  ["calendar_stats", "Stats calendriers"], ["shapes_stats", "Stats tracés"],
];

function renderDetailShell(ov) {
  const root = $("detailPanel"); root.innerHTML = "";
  root.append(el("h2", { textContent: "Détail par table" }));
  root.append(el("label", { textContent: "Table" }));
  const sel = el("select", { id: "tableSel", style: "max-width:520px" });
  const files = ov.tables.map((t) => t.file);
  const g1 = el("optgroup", { label: "Fichiers GTFS" });
  for (const f of files) g1.append(el("option", { value: "file:" + f, textContent: f }));
  const g2 = el("optgroup", { label: "Analyses de dérive" });
  for (const [k, lbl] of ANALYSES) g2.append(el("option", { value: "an:" + k, textContent: lbl }));
  sel.append(g1, g2);
  sel.addEventListener("change", () => {
    const v = sel.value;
    if (v.startsWith("file:")) openDetail(v.slice(5));
    else renderAnalysis(v.slice(3));
  });
  root.append(sel);
  root.append(el("div", { id: "detailBody", style: "margin-top:.8rem" }));
  // défaut : table la plus impactée
  const first = ov.tables.find((t) => t.severity !== "ok") || ov.tables[0];
  if (first) { sel.value = "file:" + first.file; openDetail(first.file); }
}

function selectTable(file) {
  const sel = $("tableSel"); if (sel) sel.value = "file:" + file;
  $("detailPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  openDetail(file);
}

async function openDetail(file) {
  const body = $("detailBody"); body.innerHTML = "";
  body.append(el("div", { className: "muted", textContent: "Calcul du diff… (le premier affichage d'une grosse table peut prendre un moment)" }));
  if (handle) { try { await handle.close(); } catch {} handle = null; }
  try {
    if (!db) db = await initDuckDB();
    handle = await openFile(db, entriesA, entriesB, file, $("profile").value);
    renderDetail(body, handle);
  } catch (e) { body.innerHTML = ""; body.append(el("div", { className: "statusbox", textContent: "❌ " + (e && e.message ? e.message : e) })); }
}

function renderDetail(body, h) {
  body.innerHTML = "";
  const meta = getMeta(h.file);
  // carte métadonnées
  const card = el("div", { className: "metacard" });
  card.append(el("div", { style: "font-weight:700;font-size:1.05rem" }, [h.file, el("span", { className: "chip", textContent: meta.label })]));
  card.append(el("div", { className: "muted", style: "margin-top:.3rem", textContent: meta.description }));
  card.append(el("div", { className: "kv" }, [el("b", { textContent: "Clé : " }), el("span", { className: "mono chip", textContent: meta.key }),
    meta.sensitive && meta.sensitive.length ? el("span", {}, [el("b", { textContent: "   Champs sensibles : " }), el("span", { className: "mono", textContent: meta.sensitive.join(", ") })]) : null]));
  const t = ov.tables.find((x) => x.file === h.file) || {};
  card.append(el("div", { className: "kv muted" }, [
    `${labels.a} : ${num(t.aRows)} lignes   ${labels.b} : ${num(t.bRows)} lignes   `,
    t.inA && t.inB ? el("b", { className: t.bRows >= t.aRows ? "delta-pos" : "delta-neg", textContent: (t.pctRowsChange > 0 ? "+" : "") + t.pctRowsChange + " %" }) : el("b", { textContent: t.inA ? "fichier absent de B" : "fichier ajouté" })]));
  if (h.keyDiff) {
    const k = h.keyDiff;
    const line = [el("b", { textContent: "Identifiants : " }), `${num(k.common)} communs · ${num(k.added)} ajoutés (B) · ${num(k.removed)} supprimés (A)`];
    if (k.a_collisions || k.b_collisions) line.push(el("span", { className: "delta-pos", textContent: `   collisions A:${k.a_collisions} / B:${k.b_collisions}` }));
    card.append(el("div", { className: "kv muted" }, line));
  }
  const cols = h.head.filter((m) => m.target === "column");
  if (cols.length) card.append(el("div", { className: "kv", style: "color:var(--crit-fg)" },
    cols.map((m) => (m.action === "add" ? "+ " : "− ") + "Colonne " + (m.action === "add" ? "ajoutée dans B" : "absente dans B") + " : " + m.identifier.column).join("   ")));
  card.append(el("div", { className: "interp" }, [el("b", { textContent: "💡 Interprétation  " }), meta.interpretation]));
  body.append(card);

  // onglets
  const tabs = el("div", { className: "tabs" });
  const paneE = el("div"), paneD = el("div", { className: "hidden" });
  const tE = el("div", { className: "tab active", textContent: "Écarts" });
  const tD = el("div", { className: "tab", textContent: "Données" });
  tE.addEventListener("click", () => { tE.classList.add("active"); tD.classList.remove("active"); paneE.classList.remove("hidden"); paneD.classList.add("hidden"); });
  tD.addEventListener("click", () => { tD.classList.add("active"); tE.classList.remove("active"); paneD.classList.remove("hidden"); paneE.classList.add("hidden"); if (!paneD._init) { paneD._init = 1; renderData(paneD, h); } });
  tabs.append(tE, tD); body.append(tabs, paneE, paneD);
  renderEcarts(paneE, h);
}

// ---------- onglet Écarts ----------
const TYPE_OPTS = [["Tous", null], ["Ajout", ["Ajout"]], ["Suppression", ["Suppression"]], ["Modification", ["Modification"]],
  ["Clés dupliquées", ["Clé dupliquée"]], ["Validation (colonnes/fichiers)", ["Colonne manquante", "Fichier vide"]]];

function renderEcarts(pane, h) {
  pane.innerHTML = "";
  pane.append(el("div", { className: "muted", style: "margin-top:.6rem", textContent:
    "Lignes ajoutées, supprimées ou modifiées (champ par champ), appariées par la clé GTFS avec la normalisation du profil." }));
  let types = null, source = null, offset = 0;
  const bar = el("div", { className: "toolbar" });
  const typeSel = el("select");
  TYPE_OPTS.forEach(([lbl], i) => typeSel.append(el("option", { value: i, textContent: lbl })));
  const srcSel = el("select");
  [["Les deux sources", ""], [labels.a, "a"], [labels.b, "b"]].forEach(([lbl, v]) => srcSel.append(el("option", { value: v, textContent: lbl })));
  const xlsBtn = el("button", { className: "btn-sec", textContent: "⬇ Excel" });
  const csvBtn = el("button", { className: "btn-sec", textContent: "⬇ CSV" });
  bar.append(el("div", { className: "fld" }, [el("label", { textContent: "Type" }), typeSel]),
    el("div", { className: "fld" }, [el("label", { textContent: "Source" }), srcSel]),
    el("div", { className: "fld sm", style: "display:flex;gap:8px" }, [xlsBtn, csvBtn]));
  pane.append(bar);
  const summary = el("div", { style: "font-weight:600;margin:.3rem 0" });
  const tableWrap = el("div"); const pagerWrap = el("div");
  pane.append(summary, tableWrap, pagerWrap);

  const c = h.counts;
  const load = async () => {
    const { total, rows } = await h.messagesPage({ types, source }, offset, 100);
    summary.textContent = `${h.file} : ${num(c.byType.Ajout || 0)} ajout(s), ${num(c.byType.Suppression || 0)} suppression(s), ${num(c.byType.Modification || 0)} modification(s) — ${num(total)} résultat(s) pour ce filtre`;
    tableWrap.innerHTML = ""; pagerWrap.innerHTML = "";
    const t = el("table");
    t.append(el("thead", {}, el("tr", {}, ["Type", "Niveau", "Source", "Clé", "Valeur A", "Valeur B", "Note"].map((x) => el("th", { textContent: x })))));
    const b = el("tbody");
    const cls = (ty) => ty === "Suppression" ? "critical" : ty === "Ajout" ? "" : ty === "Modification" ? "moderate" : "";
    for (const r of rows) b.append(el("tr", { className: cls(r.type) }, [
      el("td", { textContent: r.type }), el("td", { textContent: r.niveau }), el("td", { textContent: r.source ? (r.source === "a" ? labels.a : labels.b) : "" }),
      el("td", { className: "mono pre", textContent: r.cle || "" }), el("td", { className: "mono pre", textContent: r.valeur_a || "" }),
      el("td", { className: "mono pre", textContent: r.valeur_b || "" }), el("td", { className: "muted", textContent: r.note || "" })]));
    t.append(b); tableWrap.append(el("div", { className: "scroll" }, t));
    pagerWrap.append(pager(total, offset, 100, (o) => { offset = o; load(); }));
  };
  typeSel.addEventListener("change", () => { types = TYPE_OPTS[+typeSel.value][1]; offset = 0; load(); });
  srcSel.addEventListener("change", () => { source = srcSel.value || null; offset = 0; load(); });
  xlsBtn.addEventListener("click", () => exportMessages(h, { types, source }, "xlsx"));
  csvBtn.addEventListener("click", () => exportMessages(h, { types, source }, "csv"));
  load();
}

// ---------- onglet Données ----------
function renderData(pane, h) {
  pane.innerHTML = "";
  let side = h.inA ? "a" : "b", pageSize = 100, offset = 0;
  let q = null, col = null, val = null, sortCol = null, dir = "asc";
  const top = el("div", { className: "toolbar" });
  const srcRadio = el("div", {}, [el("label", { textContent: "Source affichée" }),
    el("div", {}, [labels.a, labels.b].map((lbl, i) => {
      const id = "ds" + i;
      const r = el("input", { type: "radio", name: "dside", id, value: i === 0 ? "a" : "b", checked: (i === 0) === (side === "a") });
      r.addEventListener("change", () => { side = r.value; offset = 0; load(); });
      return el("span", { style: "margin-right:1rem" }, [r, " ", el("label", { htmlFor: id, style: "display:inline", textContent: " " + lbl })]);
    }))]);
  const sizeSel = el("select");
  [50, 100, 200].forEach((n) => sizeSel.append(el("option", { value: n, textContent: n, selected: n === 100 })));
  sizeSel.addEventListener("change", () => { pageSize = +sizeSel.value; offset = 0; load(); });
  top.append(srcRadio, el("div", { className: "fld sm" }, [el("label", { textContent: "Lignes/page" }), sizeSel]));
  pane.append(top);

  const fb = el("div", { className: "filterbar" });
  const gInput = el("input", { type: "text", placeholder: "Rechercher dans toutes les colonnes…", style: "min-width:220px" });
  const colSel = el("select", { style: "min-width:150px" });
  const valInput = el("input", { type: "text", placeholder: "Valeur…", style: "min-width:140px" });
  const sortSel = el("select", { style: "min-width:150px" });
  const dirSel = el("select"); dirSel.append(el("option", { value: "asc", textContent: "↑ Croissant" }), el("option", { value: "desc", textContent: "↓ Décroissant" }));
  const apply = el("button", { className: "btn-sec", textContent: "Appliquer" });
  const reset = el("button", { className: "btn-sec", textContent: "Réinitialiser" });
  const fillCols = () => {
    const cols = side === "a" ? h.colsA : h.colsB;
    colSel.innerHTML = ""; sortSel.innerHTML = "";
    colSel.append(el("option", { value: "", textContent: "Colonne…" }));
    sortSel.append(el("option", { value: "", textContent: "Colonne…" }));
    for (const c of cols) { colSel.append(el("option", { value: c, textContent: c })); sortSel.append(el("option", { value: c, textContent: c })); }
  };
  fb.append(el("span", { textContent: "🔍" }), gInput, el("span", { className: "muted", textContent: "Colonne" }), colSel, valInput,
    el("span", { className: "muted", textContent: "Trier par" }), sortSel, dirSel, apply, reset);
  pane.append(fb);
  const info = el("div", { style: "margin:.4rem 0" }); const tableWrap = el("div"); const pagerWrap = el("div");
  pane.append(pagerWrap, info, tableWrap);

  apply.addEventListener("click", () => { q = gInput.value.trim() || null; col = colSel.value || null; val = valInput.value.trim() || null; sortCol = sortSel.value || null; dir = dirSel.value; offset = 0; load(); });
  reset.addEventListener("click", () => { gInput.value = ""; valInput.value = ""; colSel.value = ""; sortSel.value = ""; dirSel.value = "asc"; q = col = val = sortCol = null; dir = "asc"; offset = 0; load(); });

  const load = async () => {
    fillCols();
    const { total, cols, rows } = await h.dataPage(side, { q, col, val, sortCol, dir }, offset, pageSize);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    info.innerHTML = ""; info.append(el("span", {}, [el("span", { className: "badge b-ok" }, [el("span", { className: "dot d-ok" }), "OK"]),
      ` ${h.file} — ${side === "a" ? labels.a : labels.b} — ${rows.length} lignes affichées`]));
    tableWrap.innerHTML = "";
    const t = el("table");
    t.append(el("thead", {}, el("tr", {}, cols.map((c) => el("th", { textContent: c })))));
    const b = el("tbody");
    for (const r of rows) b.append(el("tr", {}, cols.map((c) => el("td", { className: "mono", textContent: r[c] == null ? "" : String(r[c]) }))));
    t.append(b); tableWrap.append(el("div", { className: "scroll" }, t));
    pagerWrap.innerHTML = "";
    pagerWrap.append(pager(total, offset, pageSize, (o) => { offset = o; load(); }, `Page ${Math.floor(offset / pageSize) + 1} / ${num(pages)} — lignes ${num(offset + 1)} à ${num(Math.min(offset + pageSize, total))} / ${num(total)} total`));
  };
  load();
}

// ---------- analyses de dérive (depuis le sélecteur de table) ----------
async function ensureDrift() {
  if (drift) return drift;
  if (!db) db = await initDuckDB();
  drift = await computeDrift(db, entriesA, entriesB, $("profile").value);
  return drift;
}
async function renderAnalysis(name) {
  const body = $("detailBody"); body.innerHTML = "";
  body.append(el("div", { className: "muted", textContent: "Calcul des analyses… (charge tous les fichiers)" }));
  try {
    const d = await ensureDrift();
    body.innerHTML = "";
    const LBL = ANALYSES.find(([k]) => k === name)[1];
    body.append(el("h3", { textContent: LBL }));
    const data = d[name];
    if (name === "stops_stats") body.append(kvTable(["", "Lignes", "Uniques (normalisés)"], [[labels.a, num(data.a_rows), num(data.a_unique)], [labels.b, num(data.b_rows), num(data.b_unique)]]));
    else if (name === "calendar_stats") body.append(kvTable(["", "calendar.txt", "calendar_dates.txt"], [[labels.a, num(data.a_calendar), num(data.a_calendar_dates)], [labels.b, num(data.b_calendar), num(data.b_calendar_dates)]]));
    else if (name === "shapes_stats") { const sh = (s) => [num(s.unique_shapes), num(s.points_total), dec(s.points_mean), dec(s.points_median), dec(s.points_p95), num(s.points_max)]; body.append(kvTable(["", "Tracés", "Points", "Moy.", "Médiane", "p95", "Max"], [[labels.a, ...sh(data.a)], [labels.b, ...sh(data.b)]])); }
    else if (name.startsWith("stops_missing")) { body.append(el("div", { className: "muted", textContent: `${data.length}${data.length === 200 ? "+ (plafonné à 200)" : ""} arrêt(s)` })); body.append(el("div", { className: "mono muted scroll", style: "padding:.6rem", textContent: data.join("   ") || "Aucun" })); }
    else if (name === "routes_field_diffs") renderGrid(body, data, ["route_id", "status", "a_short", "b_short", "a_long", "b_long", "a_type", "b_type"]);
    else renderGrid(body, data, Object.keys(data[0] || { route_id: "", a: "", b: "", delta: "" }));
  } catch (e) { body.innerHTML = ""; body.append(el("div", { className: "statusbox", textContent: "❌ " + (e && e.message ? e.message : e) })); }
}
function kvTable(headers, rows) {
  const t = el("table"); t.append(el("thead", {}, el("tr", {}, headers.map((h) => el("th", { textContent: h })))));
  const b = el("tbody"); for (const r of rows) b.append(el("tr", {}, r.map((c, i) => el("td", { className: i ? "num" : "", textContent: String(c) })))); t.append(b);
  return el("div", { className: "scroll", style: "margin:.5rem 0" }, t);
}
function renderGrid(root, arr, cols) {
  root.append(el("div", { className: "muted", textContent: `${num(arr.length)} ligne(s)` }));
  const t = el("table"); t.append(el("thead", {}, el("tr", {}, cols.map((c) => el("th", { textContent: c })))));
  const b = el("tbody");
  for (const r of arr.slice(0, 1000)) b.append(el("tr", {}, cols.map((c) => {
    let v = r[c]; if (c === "delta" && typeof v === "number") return el("td", { className: "num " + (v >= 0 ? "delta-pos" : "delta-neg"), textContent: (v > 0 ? "+" : "") + num(v) });
    return el("td", { className: typeof v === "number" ? "num" : "mono", textContent: v == null ? "" : String(v) });
  })));
  t.append(b); root.append(el("div", { className: "scroll" }, t));
  if (arr.length > 1000) root.append(el("div", { className: "muted", textContent: `(1000 premières sur ${num(arr.length)})` }));
}

// ---------- pagination ----------
function pager(total, offset, size, go, label) {
  const from = total ? offset + 1 : 0, to = Math.min(offset + size, total);
  const prev = el("button", { className: "btn-sec", textContent: "◀ Préc", disabled: offset === 0 });
  const next = el("button", { className: "btn-sec", textContent: "Suiv ▶", disabled: to >= total });
  prev.addEventListener("click", () => go(offset - size));
  next.addEventListener("click", () => go(offset + size));
  const gi = el("input", { type: "number", min: 1, placeholder: "n°" });
  const okb = el("button", { className: "btn-sec", textContent: "OK" });
  okb.addEventListener("click", () => { const p = parseInt(gi.value, 10); if (p >= 1) go((p - 1) * size); });
  return el("div", { className: "pager" }, [prev, el("span", { className: "muted", textContent: label || `${num(from)}–${num(to)} sur ${num(total)}` }), next,
    el("span", { className: "muted", textContent: "Aller à la page" }), gi, okb]);
}

// ---------- exports ----------
const COLS_MSG = ["Type", "Niveau", "Source", "Clé", "Valeur A", "Valeur B", "Note"];
async function exportMessages(h, filter, fmt) {
  const limit = 5000, all = [];
  let off = 0;
  const cap = fmt === "xlsx" ? 200000 : Infinity;
  while (true) {
    const { total, rows } = await h.messagesPage(filter, off, limit);
    for (const r of rows) all.push([r.type, r.niveau, r.source ? (r.source === "a" ? labels.a : labels.b) : "", r.cle || "", r.valeur_a || "", r.valeur_b || "", r.note || ""]);
    off += limit;
    if (off >= total || all.length >= cap) break;
  }
  if (fmt === "xlsx") {
    const ws = XLSX.utils.aoa_to_sheet([COLS_MSG, ...all]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Écarts");
    XLSX.writeFile(wb, h.file.replace(/\.txt$/, "") + "_ecarts.xlsx");
  } else {
    download(csv([COLS_MSG, ...all]), h.file.replace(/\.txt$/, "") + "_ecarts.csv");
  }
}
function csv(rows) {
  const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}
function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = el("a", { href: url, download: name }); a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}

$("run").addEventListener("click", run);
