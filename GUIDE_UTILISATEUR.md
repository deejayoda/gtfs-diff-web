# Guide utilisateur — Comparaison de flux GTFS

Cet outil compare **deux flux GTFS** (une source **A** et une source **B**) et met en évidence tout ce qui a changé : fichiers, colonnes, lignes ajoutées / supprimées / modifiées, et une analyse de dérive par ligne. Il existe en deux versions qui affichent **exactement les mêmes résultats** :

- **Version desktop** : l'application Windows `GTFSDiffTool.exe`.
- **Version web** : un fichier `gtfs-diff.html` qui s'ouvre dans le navigateur.

> **Confidentialité.** Dans les deux cas, la comparaison se fait **sur votre poste**. Aucun fichier n'est envoyé sur Internet.

---

## 1. Quelle version utiliser ?

| | Version desktop (.exe) | Version web (.html) |
|---|---|---|
| Installation | Aucune, mais l'exécutable peut être bloqué par l'antivirus (CrowdStrike) | Aucune |
| Lancement | Double-clic sur `GTFSDiffTool.exe` | Double-clic sur `gtfs-diff.html` |
| Fonctionne hors ligne | Oui | Oui |
| Navigateur requis | Non | Edge ou Chrome (récent) |
| Fichier à distribuer | L'exécutable | Un seul fichier HTML (~48 Mo) |

Si l'exécutable est bloqué sur votre poste, **utilisez la version web** : c'est un simple fichier à ouvrir, sans installation ni connexion.

---

## 2. Démarrer

### Version desktop
Double-cliquez sur `GTFSDiffTool.exe`. L'application s'ouvre dans sa propre fenêtre.

### Version web
1. Enregistrez le fichier `gtfs-diff.html` où vous voulez (par ex. votre bureau).
2. Double-cliquez dessus : il s'ouvre dans votre navigateur par défaut.
3. L'ouverture prend quelques secondes la première fois (l'outil se charge entièrement), puis tout est instantané.

---

## 3. Lancer une comparaison

1. **Source A** et **Source B** : pour chacune, glissez-déposez un fichier ZIP GTFS, ou cliquez pour le choisir.
2. **Libellé** (facultatif) : un nom lisible pour chaque source (sinon le nom du fichier est utilisé). Pratique pour s'y retrouver, par ex. « Pégase2 » et « SIBR ».
3. **Profil de comparaison** :
   - **🌐 Universel (standard GTFS)** : compare les identifiants tels quels, sans transformation.
   - **🚌 ZOU ! scolaire** : normalise les identifiants avant comparaison (retire les préfixes type `ZOS:` / `CFP:` et le suffixe `C` des arrêts). À utiliser pour comparer deux systèmes qui nomment les mêmes objets différemment (par ex. Pégase2/Chouette vs Pégase3/SIBR).
4. Cliquez sur **Lancer la comparaison**. Un bandeau confirme la fin du calcul et le temps écoulé.

> **Quel profil choisir ?** Si vous comparez deux exports du **même** réseau produits par **deux systèmes différents**, prenez **ZOU ! scolaire** : sans cela, des identifiants pourtant équivalents apparaîtront comme « supprimés d'un côté / ajoutés de l'autre » au lieu de « modifiés ».

---

## 4. Lire la vue d'ensemble

Une fois la comparaison lancée, la **vue d'ensemble** apparaît :

- **Badge de sévérité global** (🔴 CRITIQUE, 🟠 IMPORTANT, 🟡 NOTABLE, 🟢 OK) : le niveau le plus élevé rencontré.
- **Quatre cartes** :
  - *Tables communes* : fichiers présents dans A **et** B.
  - *Tables ajoutées* : fichiers présents seulement dans B.
  - *Tables absentes* : fichiers présents seulement dans A.
  - *Tables impactées* : fichiers communs qui présentent un écart.
- **Variations volumétriques** : pour chaque fichier, la variation du nombre de lignes (ex. `shapes.txt +13754.8 % (10 751 → 1 489 525 lignes)`).
- **Tables les plus impactées** : un tableau trié par sévérité. **Cliquez sur un nom de table** pour ouvrir son détail.

### Comprendre la sévérité
La sévérité dépend surtout de la variation du nombre de lignes :

| Niveau | Signification |
|---|---|
| 🔴 **CRITIQUE** | Variation ≥ 30 %, ou fichier présent d'un seul côté, ou fichier vide d'un côté |
| 🟠 **IMPORTANT** | Variation ≥ 10 % |
| 🟡 **NOTABLE** | Variation ≥ 5 %, ou un écart de colonnes |
| 🟢 **OK** | Pas d'écart significatif |

---

## 5. Le détail par table

Sélectionnez une table (dans le menu **Table**, ou en cliquant sur une ligne de la vue d'ensemble). Vous obtenez :

- Une **carte descriptive** : nom et rôle du fichier, **clé** GTFS, **champs sensibles**, volumétrie A/B, écart de colonnes, et un encadré **💡 Interprétation** qui explique ce qu'un écart signifie pour ce fichier.
- Le bloc **Identifiants** (pour les fichiers à clé simple) : nombre d'IDs communs, ajoutés (B), supprimés (A), et éventuellement des **collisions** (voir §8).
- Deux onglets : **Écarts** et **Données**.

### Onglet « Écarts »
La liste des différences ligne à ligne, appariées par la **clé GTFS** :

- Colonnes : **Type** (Ajout / Suppression / Modification…), **Niveau** (Ligne / Colonne / Fichier), **Source** (A ou B pour les contrôles), **Clé**, **Valeur A**, **Valeur B**, **Note**.
- **Filtres** : par **Type** et par **Source**.
- **Export** : boutons **Excel** et **CSV** (l'export respecte les filtres en cours).
- **Pagination** en bas (Précédent / Suivant / aller à une page).

Une **modification** signifie que la ligne existe des deux côtés (même clé) mais qu'un ou plusieurs champs ont changé : seuls les champs modifiés sont affichés, avec l'ancienne (A) et la nouvelle (B) valeur.

### Onglet « Données »
Le contenu **brut** d'un fichier, tel quel :

- **Source affichée** : basculez entre A et B.
- **Recherche globale**, filtre par **colonne**, **tri** croissant/décroissant.
- **Lignes par page** et pagination (aller à une page).

---

## 6. Les analyses de dérive

Dans le menu **Table**, le groupe **Analyses de dérive** donne des vues synthétiques :

- **Trajets par ligne** : combien de trajets (`trips`) chaque ligne gagne ou perd entre A et B.
- **Horaires par ligne** : idem pour les `stop_times`.
- **Arrêts présents d'un seul côté** : les arrêts de A absents de B, et inversement.
- **Stats arrêts / calendriers / tracés** : volumétrie et statistiques (nombre de points de tracé, moyenne, médiane, etc.).
- **Lignes — champs modifiés** : les lignes (`routes`) dont un champ a changé (nom, type…).

---

## 7. Comment les lignes sont appariées

- Les lignes sont rapprochées par la **clé primaire de la spécification GTFS** (ex. `stop_times.txt` : `trip_id` + `stop_sequence`). Un changement de `stop_id` à une séquence donnée est donc une **modification**, pas une suppression + un ajout.
- Les fichiers **sans clé connue** sont comparés **ligne entière** (ajouts / suppressions uniquement).
- Une **clé présente plusieurs fois** dans un fichier est signalée (« clé dupliquée ») ; seule la dernière occurrence est comparée.

---

## 8. Cas ZOU : normalisation et collisions

Quand vous comparez deux systèmes (ex. **Pégase2/Chouette** en A et **Pégase3/SIBR** en B) :

- Les identifiants n'ont pas la même forme (`ZOS:1007457` d'un côté, un identifiant différent de l'autre). Le profil **ZOU ! scolaire** retire les préfixes/suffixes pour rapprocher ce qui est comparable.
- Une **collision** apparaît quand la normalisation fait correspondre **plusieurs identifiants bruts distincts** à un même identifiant normalisé. C'est un signal utile : il indique que deux objets différents deviennent indistinguables une fois normalisés (à vérifier au cas par cas).
- Si, même après normalisation, presque tout apparaît en « ajouté / supprimé » sans « modifié », c'est généralement que les **deux flux ne décrivent pas le même périmètre**, ou que leurs **systèmes d'identifiants sont incompatibles** (aucune normalisation ne peut alors les rapprocher).

---

## 9. Questions fréquentes

**Rien ne part sur Internet ?**
Non. Tout le calcul se fait sur votre poste, hors ligne.

**La version web met du temps à s'ouvrir / à afficher une grosse table.**
C'est normal : le fichier embarque tout le moteur de calcul, et certains fichiers (ex. `shapes.txt`, plusieurs millions de lignes) sont volumineux. Le premier affichage peut prendre quelques secondes ; ensuite c'est fluide. L'affichage est paginé, jamais chargé d'un seul bloc.

**Quel navigateur pour la version web ?**
Edge ou Chrome récents. (Non testé sur Firefox.)

**L'exécutable est bloqué par l'antivirus.**
Utilisez la version web : c'est un simple fichier HTML, sans lien externe. La validation de l'exécutable reste du ressort de votre équipe sécurité.

**Les deux versions donnent-elles les mêmes chiffres ?**
Oui. Le moteur de la version web a été vérifié pour produire exactement les mêmes résultats que la version desktop.

---

*Outil interne — Comparaison de flux GTFS · Région Sud / ZOU !*
