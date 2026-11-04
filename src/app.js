// Interface de comparaison GTFS — vue d'ensemble + détail par table, pagination à la demande.
import JSZip from "jszip";
import { initDuckDB, openFile } from "./engine.js";
import { buildOverview } from "./overview.js";

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
  const info = el("div", { className: "muted", style: "margin:.2rem 0 .6rem" });
  info.textContent = `Clé : ${h.pk ? h.pk.join(" + ") : "ligne entière (pas de clé GTFS)"} · `
    + `${h.colsA.length} colonnes A / ${h.colsB.length} colonnes B`;
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
