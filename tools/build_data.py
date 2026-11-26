#!/usr/bin/env python3
"""
Construit la base de recettes de La Chavitera à partir du jeu de données
"Food.com - Recipes and Reviews" (Kaggle, fichier recipes.parquet ou recipes.csv).

Usage :
    pip install pandas pyarrow
    python tools/build_data.py chemin/vers/recipes.parquet [--recipenlg chemin/vers/RecipeNLG_dataset.csv]
           [--min-rating 4.5] [--min-reviews 10]

Sorties (dans data/) :
    index.json        liste légère de toutes les recettes (cartes, filtres, recos)
    r/<n>.json        détails (ingrédients, étapes) découpés en 200 paquets
    version.json      version des données (pour le cache hors ligne)
et tools/top300_to_translate.json : les 300 recettes à traduire en français.
Si tools/translations_fr.json existe, ses traductions sont fusionnées.

--recipenlg (optionnel mais conseillé) : le jeu Food.com perd les unités
("2" + "flour" au lieu de "2 cups flour"). RecipeNLG contient les lignes
complètes pour une grande partie des recettes Food.com : on les récupère via l'ID.
"""
import argparse, json, math, re, sys, hashlib, time, os
from collections import Counter, defaultdict
from fractions import Fraction
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from units import fix_ingredients, fr_step_units
from lexicon import (ING_FR, PANTRY, AISLES, CATEGORY_TYPE, TYPE_FR, CUISINES, EXPENSIVE,
                     EQUIPMENT, NAME_NOISE)

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
BUCKETS = 200

# ---------------------------------------------------------------- utilitaires
def r_vector(v, keep_na=False):
    """Convertit 'c("a", "b")' / '"a"' / array / NA en liste Python.
    keep_na=True garde les trous (None) pour rester aligné avec une autre colonne
    (indispensable pour les quantités : sinon une seule valeur manquante décale tout)."""
    if v is None:
        return []
    if isinstance(v, float) and math.isnan(v):
        return []
    if hasattr(v, "tolist") and not isinstance(v, str):
        v = v.tolist()
    if isinstance(v, (list, tuple)):
        if keep_na:
            return [None if x is None or str(x) in ("nan", "NA", "") else str(x) for x in v]
        return [str(x) for x in v if x is not None and str(x) != "nan"]
    s = str(v).strip()
    if s in ("", "NA", "character(0)", "nan"):
        return []
    if s.startswith("c(") and s.endswith(")"):
        s = s[2:-1]
    items = re.findall(r'"((?:[^"\\]|\\.)*)"|(NA)', s)
    out = []
    for quoted, na in items:
        out.append(None if na else quoted.replace('\\"', '"'))
    return out


def iso_minutes(s):
    if not isinstance(s, str):
        return None
    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?", s)
    if not m or (m.group(1) is None and m.group(2) is None):
        return None
    return int(m.group(1) or 0) * 60 + int(m.group(2) or 0)


UNICODE_FRAC = {"½": "1/2", "⅓": "1/3", "⅔": "2/3", "¼": "1/4", "¾": "3/4", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8"}


def parse_qty(s):
    """'1 1/2' -> 1.5, '2-3' -> 2.5, '1/4' -> .25 ; None si illisible."""
    if s is None:
        return None
    s = str(s).strip()
    for k, v in UNICODE_FRAC.items():
        s = s.replace(k, " " + v)
    s = s.strip()
    if not s or s.upper() == "NA":
        return None
    rng = re.match(r"^([\d./ ]+)\s*(?:-|to)\s*([\d./ ]+)$", s)
    if rng:
        a, b = parse_qty(rng.group(1)), parse_qty(rng.group(2))
        return (a + b) / 2 if a and b else a or b
    try:
        return float(sum(Fraction(p) for p in s.split()))
    except (ValueError, ZeroDivisionError):
        return None


UNITS = {
    # mot -> (unité canonique, facteur, famille)
    "cup": ("ml", 240, "vol"), "cups": ("ml", 240, "vol"), "c": ("ml", 240, "vol"),
    "tablespoon": ("cs", 1, "spoon"), "tablespoons": ("cs", 1, "spoon"), "tbsp": ("cs", 1, "spoon"),
    "tbs": ("cs", 1, "spoon"), "tbsp.": ("cs", 1, "spoon"), "tb": ("cs", 1, "spoon"), "t": ("cs", 1, "spoon"),
    "teaspoon": ("cc", 1, "spoon"), "teaspoons": ("cc", 1, "spoon"), "tsp": ("cc", 1, "spoon"), "tsp.": ("cc", 1, "spoon"),
    "ounce": ("g", 28.35, "mass"), "ounces": ("g", 28.35, "mass"), "oz": ("g", 28.35, "mass"), "oz.": ("g", 28.35, "mass"),
    "pound": ("g", 453.6, "mass"), "pounds": ("g", 453.6, "mass"), "lb": ("g", 453.6, "mass"), "lbs": ("g", 453.6, "mass"),
    "lb.": ("g", 453.6, "mass"), "g": ("g", 1, "mass"), "gram": ("g", 1, "mass"), "grams": ("g", 1, "mass"),
    "kg": ("g", 1000, "mass"), "ml": ("ml", 1, "vol"), "l": ("ml", 1000, "vol"), "liter": ("ml", 1000, "vol"),
    "pint": ("ml", 473, "vol"), "pints": ("ml", 473, "vol"), "quart": ("ml", 946, "vol"), "quarts": ("ml", 946, "vol"),
    "gallon": ("ml", 3785, "vol"), "fl": ("ml", 29.6, "vol"),
    "clove": ("gousse", 1, "count"), "cloves": ("gousse", 1, "count"), "can": ("boîte", 1, "count"),
    "cans": ("boîte", 1, "count"), "package": ("paquet", 1, "count"), "packages": ("paquet", 1, "count"),
    "pkg": ("paquet", 1, "count"), "jar": ("bocal", 1, "count"), "bottle": ("bouteille", 1, "count"),
    "pinch": ("pincée", 1, "count"), "dash": ("trait", 1, "count"), "slice": ("tranche", 1, "count"),
    "slices": ("tranche", 1, "count"), "stick": ("g", 113, "mass"), "sticks": ("g", 113, "mass"),
    "bunch": ("botte", 1, "count"), "head": ("pièce", 1, "count"), "sprig": ("brin", 1, "count"),
    "sprigs": ("brin", 1, "count"), "envelope": ("sachet", 1, "count"), "packet": ("sachet", 1, "count"),
}

DESCRIPTORS = r"\b(chopped|minced|diced|sliced|fresh|freshly|large|small|medium|finely|coarsely|thinly|grated|shredded|ground|crushed|peeled|seeded|halved|softened|melted|cubed|divided|optional|to taste|beaten|cooked|uncooked|drained|rinsed|trimmed|boneless|skinless|packed|lightly|well|cut into.*|about)\b"


def norm_ing(name):
    s = (name or "").lower().strip()
    s = re.sub(r"\(.*?\)", "", s)
    s = s.split(",")[0]
    s = re.sub(r"\s+", " ", s).strip(" .-")
    return s


def ing_key(name):
    """Clé courte pour regrouper / exclure (ex: 'boneless skinless chicken breasts' -> 'chicken breasts')."""
    s = norm_ing(name)
    s = re.sub(DESCRIPTORS, "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s or norm_ing(name)


def fr_name(name):
    n = norm_ing(name)
    if n in ING_FR:
        return ING_FR[n]
    k = ing_key(name)
    if k in ING_FR:
        return ING_FR[k]
    return None


def aisle_of(name):
    n = norm_ing(name)
    for aisle, words in AISLES:
        for w in words:
            if w in n:
                return aisle
    return "Autres"


def parse_line(line):
    """'1 (8 ounce) package cream cheese, softened' -> (qty, unit, factor, family, rest)."""
    s = line.strip()
    for k, v in UNICODE_FRAC.items():
        s = s.replace(k, " " + v)
    m = re.match(r"^\s*((?:\d+\s+)?\d+(?:[./]\d+)?(?:\s*(?:-|to)\s*\d+(?:[./]\d+)?)?)\s*(.*)$", s)
    if not m:
        return None, None, 1, None, s
    q = parse_qty(m.group(1))
    rest = m.group(2)
    size = re.match(r"^\(\s*([\d./ ]+)\s*-?\s*(ounce|ounces|oz|g|ml|lb|pound)s?\.?\s*\)\s*(.*)$", rest, re.I)
    if size:
        sq = parse_qty(size.group(1)) or 1
        u, f, fam = UNITS.get(size.group(2).lower(), ("g", 1, "mass"))
        rest2 = size.group(3)
        rest2 = re.sub(r"^(can|cans|package|packages|jar|jars|bag|bags|box|boxes|container|containers|pkg)\b\.?\s*", "", rest2, flags=re.I)
        return (q or 1) * sq * f, u, 1, fam, rest2
    w = re.match(r"^([a-zA-Z.]+)\s+(.*)$", rest)
    if w and w.group(1).lower() in UNITS:
        u, f, fam = UNITS[w.group(1).lower()]
        rest = w.group(2)
        if w.group(1).lower() == "fl":
            rest = re.sub(r"^oz\.?\s*", "", rest)
        return q * f if q is not None else None, u, 1, fam, rest
    return q, None, 1, "count", rest


def f_to_c(text):
    def rep(m):
        f = int(m.group(1))
        c = round((f - 32) * 5 / 9 / 5) * 5
        return f"{c}°C"
    text = re.sub(r"(\d{3})\s*°?\s*(?:degrees?\s*)?F\b", rep, text)
    text = re.sub(r"(\d{3})\s*degrees(?!\s*C)", rep, text)
    return text


def name_norm(n):
    s = re.sub(r"[^a-z0-9 ]", " ", (n or "").lower())
    return " ".join(w for w in s.split() if w not in NAME_NOISE)


def detect_type(cat, name, keywords):
    nm = (name or "").lower()
    for t, cats in CATEGORY_TYPE.items():
        if cat in cats:
            return t
    if re.search(r"\b(soup|salad|chowder|bisque|gazpacho)\b", nm):
        return "entree"
    if re.search(r"\b(cake|cookie|cookies|brownie|brownies|pie|tart|pudding|muffin|muffins|cupcake|fudge|truffles|cheesecake|crumble|cobbler)\b", nm):
        return "dessert"
    if re.search(r"\b(dip|dressing|sauce|salsa|vinaigrette|marinade|rub)\b", nm):
        return "sauce"
    if re.search(r"\b(smoothie|lemonade|punch|cocktail|martini|margarita|latte|tea)\b", nm):
        return "boisson"
    return "plat"


def detect_cuisine(cat, name, keywords):
    hay = " ".join([cat or "", name or ""] + list(keywords)).lower()
    for label, words in CUISINES:
        for w in words:
            if re.search(r"\b" + re.escape(w), hay):
                return label
    return None


def difficulty(n_steps, n_ing, total, keywords):
    score = n_steps * 1.0 + n_ing * 0.6 + (total or 30) / 25
    kw = {k.lower() for k in keywords}
    if "easy" in kw or "beginner cook" in kw:
        score -= 4
    if score < 9:
        return 1  # très facile
    if score < 14:
        return 2  # facile
    if score < 20:
        return 3  # niveau moyen
    return 4      # difficile


def cost(ings, keywords):
    kw = {k.lower() for k in keywords}
    text = " ".join(ings).lower()
    pricey = sum(1 for w in EXPENSIVE if w in text)
    if "inexpensive" in kw and pricey == 0:
        return 1
    if pricey >= 2:
        return 3
    if pricey == 1 or len(ings) > 12:
        return 2
    return 1


def equipment(steps_text):
    t = steps_text.lower()
    return [code for code, rx in EQUIPMENT if re.search(rx, t)]


def bayes(r, n, prior=4.3, m=20):
    return (r * n + prior * m) / (n + m)


# ---------------------------------------------------------------- chargement
def load_recipes(path):
    import pandas as pd
    p = Path(path)
    if p.suffix == ".parquet":
        df = pd.read_parquet(p)
    else:
        df = pd.read_csv(p, low_memory=False)
    print(f"  {len(df):,} recettes lues dans {p.name}")
    return df


def load_recipenlg(path, wanted_ids):
    """Retourne {food.com id: [lignes d'ingrédients complètes]}."""
    import pandas as pd
    out = {}
    rx = re.compile(r"food\.com/recipe/.*?-(\d+)/?$")
    for chunk in pd.read_csv(path, usecols=["ingredients", "link"], chunksize=200_000):
        for ing, link in zip(chunk["ingredients"], chunk["link"]):
            m = rx.search(str(link))
            if not m:
                continue
            rid = int(m.group(1))
            if rid in wanted_ids:
                try:
                    out[rid] = json.loads(ing)
                except Exception:
                    pass
    print(f"  RecipeNLG : lignes complètes trouvées pour {len(out):,} recettes")
    return out


def align_qty(qty, parts):
    """Aligne les quantités sur les ingrédients. Food.com a parfois plus de quantités que
    d'ingrédients (« salt and pepper » sans quantité, ingrédients retirés...). Si les longueurs
    diffèrent, on n'affiche rien plutôt qu'une quantité fausse, sauf si seuls des trous
    (NA) en fin de liste expliquent l'écart."""
    if len(qty) == len(parts):
        return qty
    q = list(qty)
    while len(q) > len(parts) and q and q[-1] is None:
        q.pop()
    if len(q) == len(parts):
        return q
    return [None] * len(parts)


def load_mt_ingredients():
    """Noms d'ingrédients traduits automatiquement (tools/translate_fr.py), en secours du lexique."""
    p = ROOT / "tools" / "ingredients_fr_mt.json"
    return json.loads(p.read_text("utf-8")) if p.exists() else {}


# ---------------------------------------------------------------- pipeline
def build(args):
    t0 = time.time()
    df = load_recipes(args.recipes)
    col = lambda name: df[name] if name in df.columns else [None] * len(df)

    rows = []
    for (rid, name, cat, kw, qty, parts, rating, reviews, prep, cook, total, imgs, steps, serv, kcal, desc, author) in zip(
            col("RecipeId"), col("Name"), col("RecipeCategory"), col("Keywords"), col("RecipeIngredientQuantities"),
            col("RecipeIngredientParts"), col("AggregatedRating"), col("ReviewCount"), col("PrepTime"), col("CookTime"),
            col("TotalTime"), col("Images"), col("RecipeInstructions"), col("RecipeServings"), col("Calories"),
            col("Description"), col("AuthorName")):
        try:
            rating = float(rating); reviews = int(float(reviews))
        except (TypeError, ValueError):
            continue
        if math.isnan(rating) or rating < args.min_rating or reviews < args.min_reviews:
            continue
        parts_raw = r_vector(parts, keep_na=True)
        qty_raw = r_vector(qty, keep_na=True)
        if len(qty_raw) == len(parts_raw):
            pairs = [(q, p) for q, p in zip(qty_raw, parts_raw) if p]
            qty_raw, parts_l = [q for q, _ in pairs], [p for _, p in pairs]
        else:
            parts_l = [p for p in parts_raw if p]
        steps_l = [s.strip() for s in r_vector(steps) if s and s.strip()]
        if len(parts_l) < 2 or len(steps_l) < 1:
            continue
        kw_l = [k for k in r_vector(kw) if k]
        cat = str(cat) if cat is not None and str(cat) != "nan" else ""
        typ = detect_type(cat, name, kw_l)
        if typ == "boisson" and not args.keep_drinks:
            continue
        rows.append(dict(id=int(rid), name=str(name).strip(), cat=cat, kw=kw_l, qty=qty_raw, parts=parts_l,
                         rating=rating, reviews=reviews, prep=iso_minutes(prep), cook=iso_minutes(cook),
                         total=iso_minutes(total), imgs=[i for i in r_vector(imgs) if i and i.startswith("http")],
                         steps=steps_l, serv=serv, kcal=kcal, desc=desc, author=author, type=typ))
    print(f"  {len(rows):,} recettes passent le filtre (≥{args.min_rating}★, ≥{args.min_reviews} avis)")

    # --- dédoublonnage
    rows.sort(key=lambda r: -bayes(r["rating"], r["reviews"]) * math.log(r["reviews"] + 2))
    kept, by_name, sigs = [], defaultdict(list), set()
    dup = 0
    for r in rows:
        keys = frozenset(ing_key(p) for p in r["parts"])
        sig = hashlib.md5(("|".join(sorted(keys)) + f"#{len(r['steps'])}").encode()).hexdigest()
        nn = name_norm(r["name"])
        if sig in sigs:
            dup += 1; continue
        if any(len(keys & k2) / max(1, len(keys | k2)) >= 0.7 for k2 in by_name[nn]):
            dup += 1; continue
        sigs.add(sig); by_name[nn].append(keys); r["keys"] = sorted(keys); kept.append(r)
    print(f"  {dup:,} doublons retirés -> {len(kept):,} recettes uniques")

    nlg = {}
    if args.recipenlg:
        nlg = load_recipenlg(args.recipenlg, {r["id"] for r in kept})

    translations = {}
    tpath = ROOT / "tools" / "translations_fr.json"
    if tpath.exists():
        translations = {int(k): v for k, v in json.loads(tpath.read_text("utf-8")).items()}
        print(f"  {len(translations)} traductions françaises fusionnées")

    mt_ing = load_mt_ingredients()
    index, buckets, unknown_ing, qty_stats = [], defaultdict(dict), Counter(), Counter()
    for r in kept:
        rid = r["id"]
        lines = nlg.get(rid)
        ings = []
        if lines:
            # associe chaque ligne complète à un ingrédient propre de Food.com
            for line in lines:
                q, u, _, fam, rest = parse_line(line)
                low = line.lower()
                match = next((p for p in sorted(r["parts"], key=len, reverse=True) if p.lower() in low), None)
                base = match or norm_ing(re.sub(DESCRIPTORS, "", rest)) or rest
                ings.append(dict(q=q, u=u, n=base, raw=line))
        else:
            qs = align_qty(r["qty"], r["parts"])
            qty_stats["aligned" if any(q is not None for q in qs) else "none"] += 1
            for q, p in zip(qs, r["parts"]):
                ings.append(dict(q=parse_qty(q), u=None, n=p, raw=None))

        tr = translations.get(rid, {})
        tr_ing = tr.get("ing") or []
        out_ing = []
        for i, it in enumerate(ings):
            k = ing_key(it["n"])
            fr = (tr_ing[i] if i < len(tr_ing) else None) or fr_name(it["n"]) or mt_ing.get(norm_ing(it["n"]))
            if not fr:
                unknown_ing[k] += 1
            e = {"n": it["n"], "k": k, "a": aisle_of(it["n"])}
            if fr: e["fr"] = fr
            if it["q"] is not None: e["q"] = round(it["q"], 3)
            if it["u"]: e["u"] = it["u"]
            if it["raw"]: e["raw"] = it["raw"]
            if norm_ing(it["n"]) in PANTRY or k in PANTRY: e["p"] = 1
            out_ing.append(e)
        out_ing = fix_ingredients(out_ing, has_units=bool(lines))

        steps_txt = " ".join(r["steps"])
        try:
            serv = int(float(r["serv"])) if r["serv"] is not None and not math.isnan(float(r["serv"])) else None
        except (TypeError, ValueError):
            serv = None
        try:
            kcal = round(float(r["kcal"])) if r["kcal"] is not None else None
        except (TypeError, ValueError):
            kcal = None
        total = r["total"] or ((r["prep"] or 0) + (r["cook"] or 0)) or None
        cuisine = detect_cuisine(r["cat"], r["name"], r["kw"])
        img = r["imgs"][0] if r["imgs"] else None
        main_keys = [e["k"] for e in out_ing if not e.get("p")][:10]
        idx = {"id": rid, "n": r["name"], "t": r["type"], "r": round(r["rating"], 2), "rc": r["reviews"],
               "d": difficulty(len(r["steps"]), len(r["parts"]), total, r["kw"]),
               "p": cost(r["parts"], r["kw"]), "eq": equipment(steps_txt), "k": main_keys,
               "s": round(bayes(r["rating"], r["reviews"]), 3)}
        if tr.get("n") and tr["n"].strip().lower() != r["name"].strip().lower(): idx["fr"] = tr["n"]
        if total: idx["tm"] = total
        if cuisine: idx["c"] = cuisine
        if img: idx["img"] = img
        if kcal and serv: idx["kc"] = kcal
        index.append(idx)

        det = {"ing": out_ing, "st": [fr_step_units(f_to_c(s)) if tr.get("st") else f_to_c(s) for s in (tr.get("st") or r["steps"])],
               "serv": serv or 4, "prep": r["prep"], "cook": r["cook"], "kw": r["kw"][:12],
               "cat": r["cat"], "by": r["author"] if isinstance(r["author"], str) else None,
               "units": bool(lines)}
        if tr.get("st"): det["stEn"] = r["steps"]
        if isinstance(r["desc"], str) and r["desc"].strip():
            det["desc"] = tr.get("desc") or r["desc"].strip()[:400]
        buckets[rid % BUCKETS][str(rid)] = det

    print(f"  quantités : {qty_stats['aligned']:,} recettes avec quantités, {qty_stats['none']:,} sans")

    # --- écriture
    (DATA / "r").mkdir(parents=True, exist_ok=True)
    for old in (DATA / "r").glob("*.json"):
        old.unlink()
    version = hashlib.md5(json.dumps([i["id"] for i in index]).encode() + str(len(translations)).encode() + b"units-v2").hexdigest()[:10]
    meta = {"v": version, "count": len(index), "buckets": BUCKETS,
            "cuisines": sorted({i["c"] for i in index if "c" in i}), "types": TYPE_FR,
            "source": "Food.com (Kaggle : Food.com - Recipes and Reviews)", "built": time.strftime("%Y-%m-%d")}
    (DATA / "index.json").write_text(json.dumps({**meta, "recipes": index}, ensure_ascii=False, separators=(",", ":")), "utf-8")
    for b, content in buckets.items():
        (DATA / "r" / f"{b}.json").write_text(json.dumps(content, ensure_ascii=False, separators=(",", ":")), "utf-8")
    # lexique d'ingrédients pour les exclusions (recherche en français ou en anglais)
    kc, kfr = Counter(), {}
    for i in index:
        for k in i["k"]:
            kc[k] += 1
    for b in buckets.values():
        for d in b.values():
            for e in d["ing"]:
                if e.get("fr") and e["k"] not in kfr:
                    kfr[e["k"]] = e["fr"]
    ings = [[k, kfr.get(k) or ING_FR.get(k), c] for k, c in kc.most_common(1500) if c >= 2 or len(kc) < 3000]
    (DATA / "ingredients.json").write_text(json.dumps(ings, ensure_ascii=False, separators=(",", ":")), "utf-8")
    (DATA / "version.json").write_text(json.dumps(meta, ensure_ascii=False), "utf-8")

    # --- top 300 à traduire (diversifié, priorité aux plats)
    pool = sorted(index, key=lambda i: -i["s"] * math.log(i["rc"] + 2))
    quota = {"plat": 190, "entree": 45, "dessert": 45, "petit-dej": 20}
    per_cuisine, chosen = Counter(), []
    for i in pool:
        if len(chosen) >= 300: break
        if quota.get(i["t"], 0) <= 0: continue
        c = i.get("c") or "?"
        if c != "?" and per_cuisine[c] >= 25: continue
        quota[i["t"]] -= 1; per_cuisine[c] += 1; chosen.append(i["id"])
    to_tr = {}
    for rid in chosen:
        if rid in translations: continue
        d = buckets[rid % BUCKETS][str(rid)]
        n = next(i["n"] for i in index if i["id"] == rid)
        to_tr[rid] = {"n": n, "ing": [e["n"] for e in d["ing"]], "st": d["st"], "desc": d.get("desc")}
    (ROOT / "tools" / "top300_to_translate.json").write_text(json.dumps(to_tr, ensure_ascii=False, indent=1), "utf-8")
    (ROOT / "tools" / "unknown_ingredients.txt").write_text(
        "\n".join(f"{c}\t{k}" for k, c in unknown_ing.most_common(500)), "utf-8")

    size = sum(f.stat().st_size for f in DATA.rglob("*.json")) / 1e6
    print(f"OK : {len(index):,} recettes, {size:.1f} Mo, version {version}, {len(to_tr)} à traduire ({time.time()-t0:.0f}s)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("recipes")
    ap.add_argument("--recipenlg")
    ap.add_argument("--min-rating", type=float, default=4.5)
    ap.add_argument("--min-reviews", type=int, default=10)
    ap.add_argument("--keep-drinks", action="store_true")
    build(ap.parse_args())
