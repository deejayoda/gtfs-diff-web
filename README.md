# gtfs-diff-web

Comparaison de deux flux GTFS **entièrement dans le navigateur** — preuve de concept.

Aucun serveur, aucun exécutable, aucune connexion sortante quand on compare des
fichiers : la page lit deux ZIP GTFS et calcule les écarts côté client, avec
[DuckDB-WASM](https://github.com/duckdb/duckdb-wasm) chargé en local. Pensée pour
être déposée sur un partage interne ou un serveur web interne et ouverte dans
Edge ou Chrome, sans rien installer sur le poste.

> Variante navigateur de l'outil Python [`gtfs-diff-tool`](https://github.com/deejayoda/gtfs-diff-tool).
> Le moteur Python de ce dépôt sert d'**oracle** : la version navigateur doit
> produire exactement les mêmes écarts (mêmes clés GTFS, même normalisation).

## État

Preuve de concept validée : diff ligne à ligne de `stop_times.txt` (ajouts,
suppressions, modifications par `trip_id` + `stop_sequence`). Sur un jeu de test,
les résultats sont identiques à ceux du moteur Python.

À faire : les autres fichiers GTFS, les profils de normalisation (ZOU scolaire),
la vue d'ensemble, l'export, l'interface.

## Lancer en local

Prérequis : Node.js 18+.

```bash
npm install
npm start          # build + serveur sur http://127.0.0.1:8080/
```

ou séparément :

```bash
npm run build      # regroupe le JS (esbuild) et copie les assets DuckDB
npm run serve      # sert le dossier
```

Les fichiers `.wasm` de DuckDB (~35 Mo) ne sont pas versionnés : `npm run build`
les copie depuis `node_modules`. Le dossier `demo/` contient deux petits ZIP de
démonstration.

## Déploiement interne

Après `npm run build`, le dossier contient tout le nécessaire (`index.html`,
`dist/`, `assets/`). Il se sert depuis n'importe quel serveur web interne. À
servir en HTTP(S) : les web workers de DuckDB ne fonctionnent pas en ouvrant le
fichier en `file://`.
