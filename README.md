# 🏠 Appart Gobelins

Petite application web (vanilla JS, sans build) pour gérer la liste d'achats et
le brainstorming d'emménagement. Hébergée sur GitHub Pages, synchronisée entre
appareils via l'API GitHub : les données vivent dans le fichier
[`data.json`](data.json) de ce repo.

## Fonctionnalités

- Articles classés par pièce (chambre, bureau, salon, cuisine, sdb, dressing/cagibi, divers)
- Trois statuts : 💡 idée (brainstorming) → 🛒 à acheter → ✅ acheté
- Plusieurs liens/options d'achat par article, avec sélection du choix préféré (⭐) et prix
- Champ « infos pratiques » libre (dimensions, puissance, dB…)
- Recherche + filtres par statut et par pièce
- Cache local (`localStorage`) : l'app s'ouvre instantanément, la sync se fait en arrière-plan
- Fusion automatique en cas de modifications croisées Mac / téléphone (la plus récente gagne, article par article)

## Mise en route

### 1. Publier sur GitHub Pages

1. Pousser ce dossier dans un repo GitHub (public pour Pages gratuit).
2. Sur GitHub : **Settings → Pages → Build and deployment** :
   *Source* = « Deploy from a branch », *Branch* = `main`, dossier `/ (root)`.
3. L'app est disponible sur `https://<owner>.github.io/<repo>/`.

### 2. Créer le token de synchronisation

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. *Repository access* : « Only select repositories » → ce repo uniquement.
3. *Permissions → Repository permissions → Contents* : **Read and write**. Rien d'autre.
4. Expiration : au choix (90 jours max conseillé ; il faudra le recréer ensuite).

### 3. Configurer chaque appareil

Sur le Mac **et** sur le téléphone : ouvrir l'app → ⚙️ → renseigner
propriétaire / repo / branche, coller le token → « Tester la connexion » →
Enregistrer. Le token ne quitte jamais l'appareil (stocké en `localStorage`).

Sur le téléphone : « Ajouter à l'écran d'accueil » pour l'utiliser comme une app.

## Notes

- ⚠️ Le repo étant public, `data.json` (la liste d'achats) l'est aussi. Rien de
  sensible n'y est stocké, mais ne pas y mettre d'adresse, de budget global, etc.
  (Alternative : repo privé + GitHub Pro, ou déplacer les données vers un gist secret.)
- L'indicateur ● en haut à droite montre l'état de sync : gris = non configuré,
  vert = synchronisé, orange = modifications en attente, rouge = erreur (cliquer pour réessayer).
- Chaque enregistrement crée un commit sur `data.json` : l'historique de la liste
  est simplement l'historique git.
- Les pièces se modifient en éditant le tableau `rooms` de `data.json`.

## Développement local

```bash
python3 -m http.server 8000
```

puis ouvrir <http://localhost:8000>. Sans token configuré, l'app fonctionne en
local pur (localStorage).
