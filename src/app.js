// Interface de comparaison GTFS — vue d'ensemble + détail par table, pagination à la demande.
import JSZip from "jszip";
import { initDuckDB, openFile } from "./engine.js";
import { buildOverview } from "./overview.js";
import { getMeta } from "./gtfs_meta.js";
import { computeDrift } from "./drift.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, kids = []) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of [].concat(kids)) n.append(k);
  return n;
};
const SEV = {
  critical: ["CRITIQUE", "b-critical"], important: ["IMPORTANT", "b-important"],
  moderate: ["NOTABLE", "b-moderate"], ok: ["OK", "b-ok"],
};
const badge = (sev) => el("span", { className: "badge " + SEV[sev][1], textContent: SEV[sev][0] });
const PAGE = 50;

let db = null, entriesA = null, entriesB = null, labels = { a: "A", b: "B" };
let handle = null; // openFile courant

// ---------- sélection de fichiers ----------
function wireDrop(side) {
  const drop = $("drop" + side), input = $("file" + side), fname = $("fname" + side);
  const set = (f) => {
    input._file = f;
    fname.textContent = f ? "Fichier : " + f.name : "";
    $("prompt" + side).textContent = f ? f.name : "Glisser-déposer ou cliquer pour choisir un ZIP";
  };
  drop.addEventListener("click", () => input.click());
  input.addEventListener("change", () => set(input.files[0]));
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault(); drop.classList.remove("over");
    const f = e.dataTransfer.files[0]; if (f) { input._file = f; set(f); }
  });
  return () => input._file || input.files[0];
}
const getA = wireDrop("A"), getB = wireDrop("B");

async function entries(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const map = new Map();
  await Promise.all(Object.values(zip.files).filter((f) => !f.dir).map(async (f) =>
    map.set(f.name, new Uint8Array(await f.async("arraybuffer")))));
  return map;
}

// ---------- comparaison ----------
async function run() {
  const fa = getA(), fb = getB();
  if (!fa || !fb) { $("status").textContent = "Choisissez les deux fichiers ZIP."; return; }
  labels = { a: ($("labelA").value || "").trim() || fa.name, b: ($("labelB").value || "").trim() || fb.name };
  $("run").disabled = true;
  $("status").textContent = "Lecture des fichiers…";
  try {
    [entriesA, entriesB] = await Promise.all([entries(fa), entries(fb)]);
    const ov = buildOverview(entriesA, entriesB);
    renderOverview(ov);
    $("results").classList.remove("hidden");
    $("detail").innerHTML = "";
    $("status").innerHTML = "";
    $("status").append("Comparaison prête — ", badge(ov.globalSeverity), ` ${labels.a} → ${labels.b}`);
  } catch (e) {
    $("status").textContent = "❌ " + (e && e.message ? e.message : e);
  } finally {
    $("run").disabled = false;
  }
}

// ---------- vue d'ensemble ----------
function renderOverview(ov) {
  const root = $("overview"); root.innerHTML = "";
  const card = el("div", { className: "card" });
  card.append(el("div", {}, [badge(ov.globalSeverity),
    el("span", { style: "margin-left:.6rem;font-weight:600", textContent: `${labels.a} → ${labels.b}` })]));

  const line = (label, val) => el("div", { className: "muted", style: "margin-top:.3rem" },
    [el("b", { className: "num", textContent: String(val) + " " }), label]);
  card.append(line("tables communes", ov.common.length));
  if (ov.addedFiles.length) card.append(el("div", { className: "muted", style: "margin-top:.3rem" },
    [el("b", { textContent: ov.addedFiles.length + " " }), `ajoutées dans ${labels.b} : `, ov.addedFiles.join(", ")]));
  if (ov.removedFiles.length) card.append(el("div", { className: "muted", style: "margin-top:.3rem" },
    [el("b", { textContent: ov.removedFiles.length + " " }), `absentes de ${labels.b} : `, ov.removedFiles.join(", ")]));
  root.append(card);

  root.append(el("h2", { textContent: "Tables les plus impactées" }));
  const tbl = el("table");
  tbl.append(el("thead", {}, el("tr", {}, [
    el("th", { textContent: "Table" }), el("th", { textContent: "Sévérité" }),
    el("th", { textContent: "Lignes A" }), el("th", { textContent: "Lignes B" }),
    el("th", { textContent: "Δ lignes" }), el("th", { textContent: "Δ col." }),
  ])));
  const body = el("tbody");
  for (const t of ov.tables) {
    const pct = t.inA && t.inB ? (t.pctRowsChange > 0 ? "+" : "") + t.pctRowsChange + " %"
      : (!t.inA ? "fichier ajouté" : "fichier absent");
    const tr = el("tr", { className: "click" }, [
      el("td", { className: "mono", textContent: t.file }),
      el("td", {}, badge(t.severity)),
      el("td", { className: "num", textContent: t.aRows.toLocaleString("fr") }),
      el("td", { className: "num", textContent: t.bRows.toLocaleString("fr") }),
      el("td", { className: "num " + (t.bRows >= t.aRows ? "delta-pos" : "delta-neg"), textContent: pct }),
      el("td", { className: "num", textContent: t.colsDelta ? (t.colsDelta > 0 ? "+" : "") + t.colsDelta : "—" }),
    ]);
    tr.addEventListener("click", () => openDetail(t.file));
    body.append(tr);
  }
  tbl.append(body); root.append(tbl);

  // ---------- analyses de dérive (à la demande) ----------
  root.append(el("h2", { textContent: "Analyses de dérive détaillées" }));
  const driftBox = el("div");
  const btn = el("button", { className: "sec", textContent: "Calculer les analyses (charge tous les fichiers)" });
  const st = el("span", { className: "muted", style: "margin-left:.6rem" });
  btn.addEventListener("click", async () => {
    btn.disabled = true; st.textContent = "Calcul en cours… (peut prendre quelques secondes sur de gros flux)";
    try {
      if (!db) db = await initDuckDB();
      const d = await computeDrift(db, entriesA, entriesB, $("profile").value);
      st.textContent = ""; renderDrift(driftBox, d);
    } catch (e) { st.textContent = "❌ " + (e && e.message ? e.message : e); btn.disabled = false; }
  });
  root.append(el("div", { style: "margin:.4rem 0" }, [btn, st]), driftBox);
}

// ---------- analyses de dérive ----------
const num = (v) => (v == null ? "—" : Number(v).toLocaleString("fr"));
const dec = (v) => (v == null ? "—" : Number(v).toLocaleString("fr", { maximumFractionDigits: 1 }));

function statTable(title, headers, rows) {
  const box = el("div", { style: "margin:.6rem 0" });
  box.append(el("div", { style: "font-weight:600;margin-bottom:.2rem" }, title));
  const t = el("table");
  t.append(el("thead", {}, el("tr", {}, headers.map((h) => el("th", { textContent: h })))));
  const b = el("tbody");
  for (const r of rows) b.append(el("tr", {}, r.map((c, i) =>
    el("td", { className: i === 0 ? "mono" : "num", textContent: String(c) }))));
  t.append(b); box.append(t); return box;
}

function deltaTable(title, rows, cols) {
  const box = el("div", { style: "margin:.8rem 0" });
  box.append(el("div", { style: "font-weight:600;margin-bottom:.2rem" },
    `${title} — ${rows.length.toLocaleString("fr")} ligne(s) impactée(s)`));
  if (!rows.length) { box.append(el("div", { className: "muted", textContent: "Aucun écart." })); return box; }
  const wrap = el("div", { style: "max-height:320px;overflow:auto;border:1px solid var(--line);border-radius:6px" });
  const t = el("table");
  t.append(el("thead", {}, el("tr", {}, ["route_id", cols[0], cols[1], "Δ"].map((h) => el("th", { textContent: h })))));
  const b = el("tbody");
  for (const r of rows.slice(0, 500)) {
    const d = r.delta;
    b.append(el("tr", {}, [
      el("td", { className: "mono", textContent: r.route_id ?? "(vide)" }),
      el("td", { className: "num", textContent: num(r[cols[0]]) }),
      el("td", { className: "num", textContent: num(r[cols[1]]) }),
      el("td", { className: "num " + (d >= 0 ? "delta-pos" : "delta-neg"), textContent: (d > 0 ? "+" : "") + num(d) }),
    ]));
  }
  t.append(b); wrap.append(t); box.append(wrap);
  if (rows.length > 500) box.append(el("div", { className: "muted", textContent: `(500 premières sur ${rows.length.toLocaleString("fr")})` }));
  return box;
}

function missingList(title, ids) {
  const box = el("div", { style: "margin:.8rem 0" });
  box.append(el("div", { style: "font-weight:600;margin-bottom:.2rem" },
    `${title} — ${ids.length}${ids.length === 200 ? "+ (plafonné à 200)" : ""}`));
  if (!ids.length) { box.append(el("div", { className: "muted", textContent: "Aucun." })); return box; }
  box.append(el("div", { className: "mono muted", style: "max-height:160px;overflow:auto", textContent: ids.join("   ") }));
  return box;
}

function renderDrift(root, d) {
  root.innerHTML = "";
  // Statistiques
  if (d.stops_stats) root.append(statTable("Arrêts", ["", "Lignes", "Uniques (normalisés)"], [
    ["Source A", num(d.stops_stats.a_rows), num(d.stops_stats.a_unique)],
    ["Source B", num(d.stops_stats.b_rows), num(d.stops_stats.b_unique)]]));
  if (d.calendar_stats) root.append(statTable("Calendriers", ["", "calendar.txt", "calendar_dates.txt"], [
    ["Source A", num(d.calendar_stats.a_calendar), num(d.calendar_stats.a_calendar_dates)],
    ["Source B", num(d.calendar_stats.b_calendar), num(d.calendar_stats.b_calendar_dates)]]));
  if (d.shapes_stats) {
    const sh = (s) => [num(s.unique_shapes), num(s.points_total), dec(s.points_mean), dec(s.points_median), dec(s.points_p95), num(s.points_max)];
    root.append(statTable("Tracés (shapes)", ["", "Tracés", "Points", "Moy.", "Médiane", "p95", "Max"], [
      ["Source A", ...sh(d.shapes_stats.a)], ["Source B", ...sh(d.shapes_stats.b)]]));
  }
  // Deltas par ligne
  if (d.trips_by_route_delta) root.append(deltaTable("Trajets par ligne", d.trips_by_route_delta, ["a_trips", "b_trips"]));
  if (d.stop_times_by_route_delta) root.append(deltaTable("Horaires (stop_times) par ligne", d.stop_times_by_route_delta, ["a_rows", "b_rows"]));
  // Arrêts manquants
  if (d.stops_missing_b_not_in_a) root.append(missingList("Arrêts présents dans B mais pas A", d.stops_missing_b_not_in_a));
  if (d.stops_missing_a_not_in_b) root.append(missingList("Arrêts présents dans A mais pas B", d.stops_missing_a_not_in_b));
  // routes_field_diffs
  if (d.routes_field_diffs) {
    const rfd = d.routes_field_diffs;
    const byStatus = {};
    for (const r of rfd) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    const LBL = { ok: "identiques", field_diff: "champs modifiés", missing_in_a: "absentes de A", missing_in_b: "absentes de B" };
    const box = el("div", { style: "margin:.8rem 0" });
    box.append(el("div", { style: "font-weight:600;margin-bottom:.2rem" }, "Lignes (routes) — comparaison des champs"));
    box.append(el("div", { className: "muted" }, Object.entries(byStatus).map(([s, n]) => `${LBL[s] || s} : ${n}`).join("  ·  ")));
    const changed = rfd.filter((r) => r.status === "field_diff");
    if (changed.length) {
      const wrap = el("div", { style: "max-height:280px;overflow:auto;border:1px solid var(--line);border-radius:6px;margin-top:.4rem" });
      const t = el("table");
      t.append(el("thead", {}, el("tr", {}, ["route_id", "nom court (A→B)", "nom long (A→B)", "type (A→B)"].map((h) => el("th", { textContent: h })))));
      const b = el("tbody");
      const ch = (a, bb) => a === bb ? el("span", { className: "muted", textContent: a ?? "" }) : el("span", {}, [el("b", { textContent: (a ?? "∅") + " → " + (bb ?? "∅") })]);
      for (const r of changed.slice(0, 300)) b.append(el("tr", {}, [
        el("td", { className: "mono", textContent: r.route_id }),
        el("td", {}, ch(r.a_short, r.b_short)), el("td", {}, ch(r.a_long, r.b_long)), el("td", {}, ch(r.a_type, r.b_type))]));
      t.append(b); wrap.append(t); box.append(wrap);
    }
    root.append(box);
  }
}

// ---------- détail par table ----------
const ACTIONS = [
  { key: "delete", label: "Suppressions" },
  { key: "add", label: "Ajouts" },
  { key: "update", label: "Modifications" },
];

async function openDetail(file) {
  const root = $("detail");
  root.innerHTML = "";
  root.append(el("h2", { textContent: "📄 " + file }));
  const status = el("div", { className: "muted", textContent: "Calcul du diff…" });
  root.append(status);
  if (handle) { try { await handle.close(); } catch {} handle = null; }
  try {
    if (!db) db = await initDuckDB();
    handle = await openFile(db, entriesA, entriesB, file, $("profile").value);
    status.remove();
    renderDetail(root, handle);
    root.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    status.textContent = "❌ " + (e && e.message ? e.message : e);
  }
}

function renderDetail(root, h) {
  const c = h.counts;
  const meta = getMeta(h.file);

  // panneau métadonnées GTFS
  const info = el("div", { className: "card", style: "margin:.2rem 0 .8rem" });
  info.append(el("div", { style: "font-weight:600;margin-bottom:.2rem" }, meta.label));
  info.append(el("div", { className: "muted", textContent: meta.description }));
  info.append(el("div", { className: "muted", style: "margin-top:.35rem" },
    [el("b", { textContent: "Clé : " }), meta.key,
     "  ·  " + h.colsA.length + " colonnes A / " + h.colsB.length + " colonnes B"]));
  if (meta.sensitive && meta.sensitive.length)
    info.append(el("div", { className: "muted", style: "margin-top:.2rem" },
      [el("b", { textContent: "Champs sensibles : " }), meta.sensitive.join(", ")]));
  if (h.keyDiff) {
    const k = h.keyDiff;
    const parts = [el("b", { textContent: "Identifiants (" + k.key + ") : " }),
      `${k.common.toLocaleString("fr")} communs · ${k.added.toLocaleString("fr")} ajoutés (B) · ${k.removed.toLocaleString("fr")} supprimés (A)`];
    if (k.a_collisions || k.b_collisions)
      parts.push(el("span", { className: "delta-pos", style: "margin-left:.4rem",
        textContent: `· collisions A : ${k.a_collisions} / B : ${k.b_collisions} (IDs fusionnés par la normalisation)` }));
    info.append(el("div", { className: "muted", style: "margin-top:.2rem" }, parts));
  }
  info.append(el("div", { style: "margin-top:.4rem" },
    [el("span", { textContent: "💡 " }), el("span", { className: "muted", textContent: meta.interpretation })]));
  root.append(info);

  const exp = el("button", { className: "sec", textContent: "Exporter ce fichier (CSV)" });
  exp.addEventListener("click", () => exportCsv(h));
  root.append(exp);

  const tabsBar = el("div", { className: "tabs" });
  const paneRows = el("div"), paneVal = el("div");
  const tabRows = el("div", { className: "tab active", textContent: "Écarts de lignes" });
  const tabVal = el("div", { className: "tab", textContent: "Structure & validation" });
  const sel = (t, p) => { for (const x of [tabRows, tabVal]) x.classList.remove("active");
    for (const x of [paneRows, paneVal]) x.classList.add("hidden"); t.classList.add("active"); p.classList.remove("hidden"); };
  tabRows.addEventListener("click", () => sel(tabRows, paneRows));
  tabVal.addEventListener("click", () => sel(tabVal, paneVal));
  tabsBar.append(tabRows, tabVal);
  root.append(tabsBar, paneRows, paneVal);
  paneVal.classList.add("hidden");

  // onglet Écarts : pilules par action + pagination
  const avail = ACTIONS.filter((a) => (a.key !== "update" || h.pk) && c[a.key] >= 0);
  const pills = el("div", { className: "pills" });
  const listWrap = el("div");
  let current = null;
  const selectAction = (a, pill) => {
    current = a.key;
    for (const p of pills.children) p.classList.remove("active");
    pill.classList.add("active");
    renderRows(listWrap, h, a.key, 0);
  };
  const defaultIdx = Math.max(0, avail.findIndex((a) => (c[a.key] || 0) > 0));
  avail.forEach((a, i) => {
    const pill = el("div", { className: "pill", textContent: `${a.label} (${(c[a.key] || 0).toLocaleString("fr")})` });
    pill.addEventListener("click", () => selectAction(a, pill));
    pills.append(pill);
    if (i === defaultIdx) setTimeout(() => selectAction(a, pill), 0);
  });
  paneRows.append(pills, listWrap);

  // onglet Structure & validation
  renderValidation(paneVal, h);
}

async function renderRows(wrap, h, action, offset) {
  wrap.innerHTML = "";
  const total = h.counts[action] || 0;
  if (!total) { wrap.append(el("p", { className: "muted", textContent: "Aucun écart dans cette catégorie." })); return; }
  const pg = await h.page(action, offset, PAGE);
  const tbl = el("table");
  tbl.append(el("thead", {}, el("tr", {}, [
    el("th", { textContent: "Identifiant" }),
    el("th", { textContent: action === "update" ? "Champs modifiés (A → B)" : action === "add" ? "Valeurs" : "" }),
  ])));
  const body = el("tbody");
  for (const m of pg) {
    const idCell = el("td", { className: "mono", textContent: fmtObj(m.identifier) });
    let detail = el("td");
    if (action === "update") {
      const parts = [];
      for (const k of Object.keys(m.new_value || {}))
        parts.push(el("div", { className: "chg" }, [k + " : ", el("b", { textContent: str(m.initial_value[k]) }),
          " → ", el("b", { textContent: str(m.new_value[k]) })]));
      detail.append(...parts);
    } else if (action === "add") {
      detail = el("td", { className: "mono muted", textContent: fmtObj(m.new_value) });
    }
    body.append(el("tr", {}, [idCell, detail]));
  }
  tbl.append(body); wrap.append(tbl);

  const from = offset + 1, to = Math.min(offset + PAGE, total);
  const pager = el("div", { className: "pager" });
  const prev = el("button", { className: "sec", textContent: "◀ Précédent", disabled: offset === 0 });
  const next = el("button", { className: "sec", textContent: "Suivant ▶", disabled: to >= total });
  prev.addEventListener("click", () => renderRows(wrap, h, action, offset - PAGE));
  next.addEventListener("click", () => renderRows(wrap, h, action, offset + PAGE));
  pager.append(prev, next, el("span", { className: "muted num", textContent: `${from.toLocaleString("fr")}–${to.toLocaleString("fr")} sur ${total.toLocaleString("fr")}` }));
  wrap.append(pager);
}

function renderValidation(pane, h) {
  const c = h.counts;
  const add = (txt) => pane.append(el("div", { className: "muted", style: "margin:.25rem 0" }, txt));
  const fileMsg = h.head.find((m) => m.target === "file");
  if (fileMsg) add(`Fichier ${fileMsg.action === "add" ? "présent uniquement dans B (ajouté)" : "présent uniquement dans A (absent de B)"}.`);
  add(`Colonnes ajoutées : ${c.columns_added} · supprimées : ${c.columns_removed}`);
  const cols = h.head.filter((m) => m.target === "column");
  if (cols.length) pane.append(el("div", { className: "mono muted", style: "margin:.2rem 0 .6rem" },
    cols.map((m) => (m.action === "add" ? "+ " : "− ") + m.identifier.column).join("   ")));
  if (h.pk) add(`Clés dupliquées — A : ${c.duplicate_a} · B : ${c.duplicate_b}`);
  if (h.validation.length) {
    pane.append(el("h2", { textContent: "Colonnes obligatoires manquantes" }));
    for (const m of h.validation)
      add(`[${m.feed}] ${m.action === "empty_or_unreadable_file" ? "fichier vide ou illisible" : "colonne manquante : " + m.identifier.column}`);
  }
  // échantillon des doublons (paginable)
  for (const [action, feed] of [["duplicate_a", "a"], ["duplicate_b", "b"]]) {
    if ((c[action] || 0) > 0) {
      pane.append(el("h2", { textContent: `Clés dupliquées — flux ${feed} (${c[action].toLocaleString("fr")})` }));
      const w = el("div"); pane.append(w); renderRows(w, h, action, 0);
    }
  }
}

// ---------- utilitaires ----------
const str = (v) => (v == null ? "" : String(v));
function fmtObj(o) {
  if (!o) return "";
  return Object.entries(o).map(([k, v]) => `${k}=${str(v)}`).join(", ");
}

// export CSV par morceaux (tient les gros volumes)
async function exportCsv(h) {
  const esc = (v) => { const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const parts = ["file,category,action,target,feed,identifier,initial_value,new_value,note\n"];
  const emit = (m) => parts.push([m.file, m.category, m.action, m.target, m.feed ?? "",
    esc(m.identifier), esc(m.initial_value ?? ""), esc(m.new_value ?? ""), esc(m.note ?? "")].join(",") + "\n");
  for (const m of h.head) emit(m);
  for (const action of ["delete", "add", "update", "duplicate_a", "duplicate_b"]) {
    let off = 0;
    while (true) { const pg = await h.page(action, off, 2000); if (!pg.length) break; pg.forEach(emit); off += 2000; }
  }
  for (const m of h.validation) emit(m);
  const url = URL.createObjectURL(new Blob(parts, { type: "text/csv;charset=utf-8" }));
  const a = el("a", { href: url, download: h.file.replace(/\.txt$/, "") + "_diff.csv" });
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}

$("run").addEventListener("click", run);
