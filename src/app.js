// Interface BRUTE (étapes 1+2) : deux ZIP + profil → messages JSON par fichier.
// Le moteur (engine.js) est validé contre le moteur Python sur 300 flux aléatoires.
import JSZip from "jszip";
import { initDuckDB, diffAll } from "./engine.js";

const $ = (id) => document.getElementById(id);
let db = null;

async function entries(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const map = new Map();
  await Promise.all(
    Object.values(zip.files).filter((f) => !f.dir).map(async (f) =>
      map.set(f.name, new Uint8Array(await f.async("arraybuffer")))
    )
  );
  return map;
}

const ROW = { add: "ajoutées", delete: "supprimées", update: "modifiées" };
function summarize(byFile) {
  const lines = [];
  for (const [file, msgs] of Object.entries(byFile)) {
    const c = {};
    for (const m of msgs) {
      const k = m.category === "diff" && m.target === "row" ? ROW[m.action]
        : m.category === "diff" && m.target === "file" ? `fichier ${m.action === "add" ? "ajouté" : "supprimé"}`
        : m.category === "diff" && m.target === "column" ? `colonne ${m.action === "add" ? "ajoutée" : "supprimée"}`
        : `${m.action}${m.feed ? " (" + m.feed + ")" : ""}`;
      c[k] = (c[k] || 0) + 1;
    }
    const parts = Object.entries(c).map(([k, n]) => `${n} ${k}`).join(", ");
    lines.push(`${file} — ${msgs.length} message(s)${parts ? " : " + parts : ""}`);
  }
  return lines.join("\n");
}

async function run() {
  const fa = $("a").files[0], fb = $("b").files[0];
  if (!fa || !fb) { $("out").textContent = "Choisissez deux fichiers ZIP."; return; }
  $("out").textContent = "Calcul en cours…";
  const t0 = performance.now();
  try {
    if (!db) db = await initDuckDB();
    const [ea, eb] = await Promise.all([entries(fa), entries(fb)]);
    const byFile = await diffAll(db, ea, eb, $("profile").value);
    const ms = Math.round(performance.now() - t0);
    const total = Object.values(byFile).reduce((n, a) => n + a.length, 0);

    // Échantillon borné : sur de vrais flux, tout sérialiser dépasse la taille
    // max d'une chaîne JS. Le JSON complet est disponible en téléchargement.
    const SAMPLE = 50;
    const sample = {};
    for (const [f, msgs] of Object.entries(byFile))
      sample[f] = msgs.length > SAMPLE ? msgs.slice(0, SAMPLE) : msgs;
    const truncated = total > Object.values(sample).reduce((n, a) => n + a.length, 0);

    $("out").textContent =
      `✅ ${total} message(s) en ${ms} ms — profil ${$("profile").value}\n\n` +
      `RÉSUMÉ PAR FICHIER\n${summarize(byFile)}\n\n` +
      `MESSAGES — échantillon${truncated ? ` (${SAMPLE} max par fichier ; JSON complet via le bouton)` : ""}\n` +
      JSON.stringify(sample, null, 1);
    makeDownload(byFile, total);
  } catch (e) {
    $("out").textContent = "❌ " + (e && e.message ? e.message : e);
  }
}

// Construit le JSON complet fichier par fichier (jamais une seule chaîne géante)
// et propose un téléchargement.
function makeDownload(byFile, total) {
  $("dl").style.display = total ? "inline-block" : "none";
  $("dl").onclick = () => {
    const parts = ["{\n"];
    const files = Object.entries(byFile);
    files.forEach(([f, msgs], i) => {
      parts.push(`  ${JSON.stringify(f)}: [\n`);
      msgs.forEach((m, j) => parts.push("    " + JSON.stringify(m) + (j < msgs.length - 1 ? ",\n" : "\n")));
      parts.push(i < files.length - 1 ? "  ],\n" : "  ]\n");
    });
    parts.push("}\n");
    const url = URL.createObjectURL(new Blob(parts, { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = "gtfs-diff.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
}
$("run").addEventListener("click", run);
