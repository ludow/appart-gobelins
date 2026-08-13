# 🏠 Appart Gobelins

Petite application web (vanilla JS, sans build) pour gérer la liste d'achats et
le brainstorming d'emménagement. L'app est hébergée sur GitHub Pages (ce repo,
public) ; les données vivent dans le fichier `data.json` d'un **second repo
privé** (`appart-gobelins-data`), lu et écrit via l'API GitHub. Ainsi la liste
n'est visible par personne d'autre, tout en restant sur le plan gratuit.

## Fonctionnalités

- Articles classés par pièce (chambre, bureau, salon, cuisine, sdb, dressing/cagibi, divers)
- Trois statuts : 💡 idée (brainstorming) → 🛒 à acheter → ✅ acheté
- Plusieurs liens/options d'achat par article, avec sélection du choix préféré (⭐) et prix
- Champ « infos pratiques » libre (dimensions, puissance, dB…)
- Recherche + filtres par statut et par pièce
- Cache local (`localStorage`) : l'app s'ouvre instantanément, la sync se fait en arrière-plan
- Fusion automatique en cas de modifications croisées Mac / téléphone (la plus récente gagne, article par article)

## Mise en route

### 1. Les deux repos

1. **`appart-gobelins`** (public) : ce dossier, publié via
   **Settings → Pages → Build and deployment** : *Source* = « Deploy from a
   branch », *Branch* = `main`, dossier `/ (root)`.
   L'app est disponible sur `https://<owner>.github.io/appart-gobelins/`.
2. **`appart-gobelins-data`** (privé) : contient uniquement `data.json`.

### 2. Créer le token de synchronisation

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. *Repository access* : « Only select repositories » → `appart-gobelins-data` uniquement.
3. *Permissions → Repository permissions → Contents* : **Read and write**. Rien d'autre.
4. Expiration : au choix (90 jours max conseillé ; il faudra le recréer ensuite).

### 3. Configurer chaque appareil

Sur le **premier appareil** (le Mac, plus simple) : ouvrir l'app → ⚙️ →
renseigner propriétaire / repo de données (`appart-gobelins-data`) / branche
(`main`), coller le token → « Tester la connexion » → Enregistrer.

Pour le **téléphone** : ⚙️ → « Copier le lien de config » sur le Mac, s'envoyer
le lien (AirDrop, message…) et l'ouvrir une fois sur le téléphone : l'app se
configure toute seule et nettoie l'URL. ⚠️ Ce lien contient le token — ne pas
le partager ni le poster.

Ensuite, plus aucune action : ouvrir l'URL suffit, la sync est automatique.
Le token ne quitte jamais l'appareil (stocké en `localStorage`).

Sur le téléphone : « Ajouter à l'écran d'accueil » pour l'utiliser comme une app.

## Notes

- L'app (ce repo public) ne contient aucune donnée : sans token, elle affiche
  une liste vide. La liste réelle n'existe que dans le repo privé.
- L'indicateur ● en haut à droite montre l'état de sync : gris = non configuré,
  vert = synchronisé, orange = modifications en attente, rouge = erreur (cliquer pour réessayer).
- Chaque enregistrement crée un commit sur `data.json` : l'historique de la liste
  est simplement l'historique git du repo de données.
- Les pièces se modifient en éditant le tableau `rooms` de `data.json`.

## Développement local

```bash
npx serve -l 8000
```

puis ouvrir <http://localhost:8000>. Sans token configuré, l'app fonctionne en
local pur (localStorage).
