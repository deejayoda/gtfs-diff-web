# gtfs-diff-web

Comparaison de deux flux GTFS **entièrement dans le navigateur**.

Aucun serveur distant, aucun exécutable, aucune connexion sortante : la page lit
deux ZIP GTFS et calcule les écarts côté client, avec
[DuckDB-WASM](https://github.com/duckdb/duckdb-wasm) chargé en local. Pensée pour
être ouverte dans Edge ou Chrome sans rien installer sur le poste.

> Variante navigateur de l'outil Python [`gtfs-diff-tool`](https://github.com/deejayoda/gtfs-diff-tool).
> Le moteur Python de ce dépôt sert d'**oracle** : la version navigateur produit
> exactement les mêmes écarts (mêmes clés GTFS, même normalisation).

## Fonctionnalités

- **Vue d'ensemble** : sévérité, tables communes/ajoutées/absentes, volumétrie A/B,
  variation en %, écart de colonnes, tri par sévérité.
- **Détail par table** : écarts ligne à ligne (ajouts, suppressions, modifications
  champ par champ) et contrôles de structure/validation (colonnes, fichiers, clés
  dupliquées), avec pagination tenant les très gros fichiers (ex. `shapes.txt` à
  plus d'un million de lignes).
- **Profils** : `universel` (standard GTFS) et `zou_scolaire` (normalisation
  Pégase/SIBR : préfixes `ZOS:`/`CFP:`, suffixe `C` des arrêts).
- **Export CSV** du diff d'un fichier.

Le moteur est validé contre le moteur Python de référence : 300 flux aléatoires
(parité exacte des messages) et comparaison au nombre près sur des flux réels.

## Deux façons de l'utiliser

### 1. Fichier unique en double-clic (aucun serveur)

```bash
npm install
npm run standalone     # → dist-standalone/gtfs-diff.html
```

`gtfs-diff.html` est **autonome** (~47 Mo) : le code, le worker et le moteur
DuckDB-WASM y sont inlinés. On le copie où l'on veut et on l'ouvre par
**double-clic** (`file://`) dans Edge ou Chrome — pas de serveur, pas de lien
externe, tout se passe hors ligne. C'est le format à distribuer aux collègues.

### 2. Dossier hébergé en interne

```bash
npm start          # build + serveur local sur http://127.0.0.1:8080/
```

ou, pour déployer : après `npm run build`, le dossier contient `index.html`,
`dist/` et `assets/` ; il se sert depuis n'importe quel serveur web interne (en
HTTP(S)).

## Notes

- Prérequis de build : Node.js 18+.
- Les `.wasm` de DuckDB (~35 Mo) ne sont pas versionnés ; `npm run build` les copie
  depuis `node_modules`. `dist/`, `dist-standalone/` et `fixtures/` sont ignorés.
- Le fichier autonome utilise la variante *exception-handling* de DuckDB-WASM :
  navigateurs récents basés sur Chromium (Edge, Chrome). `demo/` contient deux
  petits ZIP de démonstration.
