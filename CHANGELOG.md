# Changelog

Versions de la version web (`gtfs-diff.html`). Le numéro vient de `package.json`
et s'affiche dans l'en-tête de l'outil.

## 1.1.0 — 2026-11-23

### Corrigé
- `companies.txt` (extension Pégase) est apparié par `company_id` : modifier un
  champ (ex. `company_name`) apparaît comme **modification**, plus comme
  suppression + ajout. Retour des utilisateurs.
- Colonne « Δ lignes » : le `0 %` n'est plus coloré. La couleur indique seulement
  le sens de la variation (rouge = plus de lignes dans B, bleu = moins).

### Ajouté
- Numéro de version dans l'en-tête.

## 1.0.0 — 2026-11-04

Première version diffusée, à parité avec l'outil desktop :
- fichier unique `gtfs-diff.html`, ouvert par double-clic, hors ligne ;
- vue d'ensemble, détail par table (onglets **Écarts** et **Données**, export
  Excel/CSV), analyses de dérive ;
- profils `universel` et `ZOU ! scolaire` ;
- moteur validé contre le moteur Python de référence.
