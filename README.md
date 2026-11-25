# La Chavitera 🍲

Petite appli perso façon Jow : on choisit les recettes de la semaine, la liste de courses se fait toute seule.
PWA installable sur iPhone et Android, hébergée gratuitement sur GitHub Pages, synchro entre deux téléphones via Supabase.

- **Recettes** : base Food.com (communauté, ~1M d'avis), filtrée ≥ 4,5★ et ≥ 10 avis, sans doublons
- **Tags façon Marmiton** : difficulté, coût, temps, type de plat, pays, équipement
- **Menu de la semaine** : généré selon vos goûts, remplacer / ajouter / retirer, portions par recette
- **Recherche** : par nom, ingrédient (FR ou EN), pays, avec filtres
- **Liste de courses** : fusionnée, classée par rayon, quantités ajustées aux portions, cases à cocher, placard séparé
- **Historique** : menus archivés, refaire un menu, noter les recettes
- **Recommandations** : 👍/👎 et étoiles, ingrédients exclus, équipement, curseur « mode découverte »

## Mise en route (une seule fois)

### 1. Activer GitHub Pages
Repo > **Settings > Pages > Source : GitHub Actions**.
Chaque push sur `main` déploie le site sur `https://geremc.github.io/la-chavitera/`.

### 2. Générer la base de recettes (sans rien installer)
1. Sur kaggle.com/settings/api : **Generate New Token** (ou « Create Legacy API Key » pour un kaggle.json)
2. Repo > Settings > Secrets and variables > Actions : ajouter `KAGGLE_API_TOKEN` (nouveau jeton) ou bien `KAGGLE_USERNAME` + `KAGGLE_KEY` (ancien kaggle.json)
3. Onglet **Actions > Construire les recettes > Run workflow**

Le workflow télécharge le jeu « Food.com - Recipes and Reviews » (`irkaal/foodcom-recipes-and-reviews`), construit `data/`, commit et redéploie.

> Unités : ce jeu de données ne garde que les nombres (« 2 » + « flour »). Pour récupérer les unités, renseignez
> dans le workflow un dataset Kaggle de **RecipeNLG** (champ `recipenlg_dataset`) : les lignes complètes sont retrouvées via l'ID Food.com.

En local, c'est pareil : `pip install pandas pyarrow` puis `python tools/build_data.py recipes.parquet [--recipenlg RecipeNLG_dataset.csv]`.

### 3. Synchro entre les deux téléphones (optionnel)
1. Créer un projet gratuit sur supabase.com
2. SQL Editor : coller et exécuter `supabase/schema.sql`
3. Project Settings > API : copier l'URL et la clé `anon public` dans `config.js`, puis push
4. Dans l'app : Profil > Synchro > **Créer un foyer**, puis saisir le code sur l'autre téléphone

La clé anon est publique par conception : la table n'est accessible que via une fonction qui exige le code du foyer (16 caractères aléatoires).

### 4. Installer sur iPhone
Ouvrir le site dans **Safari** > Partager > **Sur l'écran d'accueil**.
⚠️ Sur iPhone, l'app installée a son propre stockage (séparé de Safari) : saisir le code du foyer **dans l'app installée**.

## Mises à jour
Le workflow tamponne une version unique dans `sw.js` à chaque déploiement. Les téléphones récupèrent la nouvelle version
au lancement suivant (l'app vérifie à chaque retour au premier plan, et se recharge toute seule).

## Traductions
`tools/top300_to_translate.json` liste les 300 meilleures recettes à traduire. Les traductions vont dans
`tools/translations_fr.json` (`{ "id": { "n": "...", "ing": [...], "st": [...], "desc": "..." } }`) puis on relance le workflow.
Les noms d'ingrédients courants sont déjà traduits pour toutes les recettes (`tools/lexicon.py`).

## Structure
```
index.html, css/, js/        l'app (JS sans build)
sw.js, manifest.webmanifest  PWA
data/                        base générée (index + détails en 200 paquets)
tools/build_data.py          pipeline Food.com -> data/
supabase/schema.sql          synchro du foyer
```
