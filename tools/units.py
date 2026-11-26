"""Quantités lisibles : les fruits et légumes se comptent à l'unité, et un ingrédient
n'apparaît qu'une fois par recette.

Utilisé par build_data.py (à chaque construction) et par fix_units.py (sur les données
déjà publiées, sans tout reconstruire).

- « 5-6 cups yellow onions, thinly sliced » ne s'affiche plus « 1,3 L Oignons jaunes »
  mais « 5 ½ oignons jaunes », avec la note « finement émincés ».
- Deux lignes du même ingrédient (« yellow onions » + « yellow onion ») sont fusionnées,
  quantités additionnées (note « en 2 fois »).
"""
import re

# ---------------------------------------------------------------- fruits et légumes
# nom anglais (singulier) -> (grammes pour 1 pièce moyenne, ml une fois coupé, féminin ?, unité)
PRODUCE = {
    "onion": (170, 240, False, None), "shallot": (40, 40, True, None),
    "green onion": (15, 30, False, None), "scallion": (15, 30, False, None), "spring onion": (15, 30, False, None),
    "garlic": (5, 5, True, "gousse"), "garlic clove": (5, 5, True, None), "clove garlic": (5, 5, True, None),
    "leek": (150, 240, False, None), "carrot": (70, 120, True, None), "celery": (40, 120, False, "branche"),
    "celery rib": (40, 120, True, None), "celery stalk": (40, 120, True, None),
    "potato": (200, 200, True, None), "sweet potato": (200, 240, True, None), "yam": (200, 240, True, None),
    "tomato": (120, 180, True, None), "roma tomato": (60, 120, True, None), "plum tomato": (60, 120, True, None),
    "zucchini": (200, 300, True, None), "courgette": (200, 300, True, None), "eggplant": (450, 1200, True, None),
    "cucumber": (300, 360, False, None), "bell pepper": (150, 240, False, None),
    "green pepper": (150, 240, False, None), "red pepper": (150, 240, False, None),
    "yellow pepper": (150, 240, False, None), "orange pepper": (150, 240, False, None),
    "jalapeno": (15, 30, False, None), "jalapeno pepper": (15, 30, False, None), "serrano pepper": (10, 15, False, None),
    "avocado": (200, 200, False, None), "fennel": (250, 300, False, None), "fennel bulb": (250, 300, False, None),
    "turnip": (150, 240, False, None), "parsnip": (100, 160, False, None), "beet": (150, 160, True, None),
    "cabbage": (1000, 2000, False, None), "cauliflower": (600, 1000, False, None),
    "lemon": (100, 120, False, None), "lime": (70, 90, False, None), "orange": (150, 200, True, None),
    "apple": (180, 240, True, None), "pear": (180, 240, True, None), "peach": (150, 200, True, None),
    "nectarine": (150, 200, True, None), "plum": (65, 90, True, None), "apricot": (35, 50, False, None),
    "banana": (120, 120, True, None), "mango": (200, 240, True, None), "kiwi": (75, 90, False, None),
    "grapefruit": (250, 300, False, None), "pineapple": (900, 1200, False, None),
}
COLORS = r"(?:yellow|white|red|green|sweet|spanish|vidalia|purple|brown|large|medium|small|ripe|firm|baking|russet|" \
         r"yukon gold|idaho|red-skinned|new|waxy|boiling|granny smith|golden delicious|tart|fuji|gala|" \
         r"mcintosh|braeburn|bartlett|bosc|anjou|english|hothouse|seedless|navel|fresh|whole|hass|haas|" \
         r"vine-ripened|beefsteak|heirloom|italian|japanese|chinese|savoy|napa|meyer|key)"
# ce n'est plus le légume entier (jus, conserve, épice...)
NOT_WHOLE = re.compile(r"\b(juice|zest|rind|peel|sauce|paste|powder|salt|soup|puree|purée|ketchup|salsa|dried|sun-dried|"
                       r"canned|can|cans|tin|jar|jarred|frozen|flakes?|crushed red|cayenne|chipotle|pickled|relish|"
                       r"chips?|rings? mix|seasoning|mix|concentrate|nectar|preserves|jam|jelly|butter|sauce|"
                       r"applesauce|pie filling|stewed|ro-tel|rotel|instant|flakes|granules|extract|oil)\b", re.I)


# noms mal traduits automatiquement (clé anglaise au singulier -> français au singulier)
FR_FIX = {
    "granny smith apple": "pomme granny smith", "tart apple": "pomme acidulée", "baking apple": "pomme à cuire",
    "golden delicious apple": "pomme golden", "red apple": "pomme rouge",
    "baking potato": "pomme de terre farineuse", "russet potato": "pomme de terre farineuse",
    "idaho potato": "pomme de terre farineuse", "boiling potato": "pomme de terre à chair ferme",
    "yukon gold potato": "pomme de terre à chair jaune", "new potato": "pomme de terre nouvelle",
    "yellow pepper": "poivron jaune", "serrano pepper": "piment serrano", "jalapeno pepper": "piment jalapeño",
    "jalapeno": "piment jalapeño", "vidalia onion": "oignon doux", "purple onion": "oignon rouge",
    "spanish onion": "oignon espagnol", "spring onion": "oignon nouveau", "plum tomato": "tomate allongée",
    "roma tomato": "tomate allongée", "napa cabbage": "chou chinois", "chinese cabbage": "chou chinois",
    "savoy cabbage": "chou de Milan", "red sweet bell pepper": "poivron rouge",
}
CANNED_FR = re.compile(r"conserve|en boîte|broyé|séché|surgelé|en poudre|jus|zeste", re.I)


def singular_en(w):
    if w.endswith("toes") or w.endswith("ches") or w.endswith("shes"):
        return w[:-2]
    if w.endswith("ies") and len(w) > 4:
        return w[:-3] + "y"
    if w.endswith("ves"):
        return w[:-3] + "f"
    if w.endswith("s") and not w.endswith("ss") and not w.endswith("us"):
        return w[:-1]
    return w


def merge_key(k):
    """« yellow onions » et « yellow onion » -> même clé."""
    ws = (k or "").lower().split()
    if not ws:
        return ""
    ws[-1] = singular_en(ws[-1])
    return " ".join(ws)


def produce_of(e):
    """Renvoie (nom, infos) si l'ingrédient est un fruit/légume compté à l'unité."""
    raw = e.get("raw") or ""
    if NOT_WHOLE.search(e.get("k") or "") or NOT_WHOLE.search(e.get("n") or ""):
        return None
    if raw and NOT_WHOLE.search(re.sub(r"\(.*?\)", "", raw.split(",")[0])):
        return None
    k = merge_key(e.get("k") or "")
    k = re.sub(r"\bcloves? (of )?", "clove ", k).strip()
    if k in PRODUCE:
        return _guard(k, e)
    # « yellow onion », « large ripe avocado », « granny smith apple »
    m = re.match(rf"^(?:{COLORS}\s+)*(.+)$", k)
    base = m.group(1) if m else k
    if base in PRODUCE:
        return _guard(base, e)
    return None


def _guard(k, e):
    """« 1/4 teaspoon red pepper » est du piment en poudre, pas un poivron."""
    if k.endswith("pepper") and k not in ("bell pepper",):
        raw = (e.get("raw") or "").lower()
        if e.get("u") in ("cc", "pincée", "trait") or (e.get("u") == "cs" and (e.get("q") or 0) <= 2) \
                or re.search(r"flake|crushed|ground|cayenne|powder|dried", raw):
            return None
    return k, PRODUCE[k]


# ---------------------------------------------------------------- français
INVARIABLE = re.compile(r"(s|x|z)$")


def _plural_word(w):
    if INVARIABLE.search(w):
        return w
    if w in ("chou", "genou", "caillou"):
        return w + "x"
    if w.endswith("eau") or w.endswith("eu"):
        return w + "x"
    if w.endswith("al") and w not in ("bal",):
        return w[:-2] + "aux"
    return w + "s"


def _singular_word(w):
    if w in ("radis", "ananas", "anis", "maïs", "pois", "jus"):
        return w
    if w.endswith("oux") or w.endswith("eaux") or w.endswith("eux"):
        return w[:-1]
    if w.endswith("aux"):
        return w[:-3] + "al"
    if w.endswith("s") and len(w) > 3:
        return w[:-1]
    return w


def _fr_number(name, plural):
    """Accorde « oignon jaune » / « pomme de terre » au singulier ou au pluriel."""
    if not name:
        return name
    m = re.match(r"^(.*?)(\s+(?:de|d'|à|au|aux|en)\b.*)?$", name)
    head, tail = m.group(1), m.group(2) or ""
    f = _plural_word if plural else _singular_word
    return " ".join(f(w) if re.match(r"^[a-zà-ÿœ-]+$", w) else w for w in head.split(" ")) + tail


# notes de découpe (anglais -> participe français, accordé ensuite)
CUTS = [
    (r"very thinly sliced|thinly sliced|sliced thin|thin(?:ly)? slices?", "finement émincé"),
    (r"sliced|slices", "émincé"),
    (r"finely chopped|chopped fine", "finement haché"), (r"coarsely chopped|roughly chopped", "grossièrement haché"),
    (r"finely diced", "coupé en petits dés"), (r"diced", "coupé en dés"),
    (r"finely minced|minced", "haché finement"), (r"chopped", "haché"),
    (r"grated|shredded", "râpé"), (r"julienned|julienne", "en julienne"),
    (r"cubed|cubes|chunks", "coupé en cubes"), (r"quartered|wedges", "coupé en quartiers"),
    (r"halved", "coupé en deux"), (r"mashed", "écrasé"), (r"crushed|pressed", "écrasé"),
    (r"peeled", "pelé"), (r"seeded|deseeded", "épépiné"), (r"cored", "sans trognon"),
    (r"rings", "en rondelles"),
]


def _agree(note, fem, plural):
    """« finement émincé » -> « finement émincées » ; on n'accorde que le participe."""
    ws = note.split(" ")
    for i, w in enumerate(ws):
        if w.endswith("é"):
            ws[i] = w + ("e" if fem else "") + ("s" if plural else "")
            break
    return " ".join(ws)


def cut_notes(raw):
    low = (raw or "").lower()
    low = re.sub(r"\(about.*?\)", "", low)
    found, used = [], []
    for pat, fr in CUTS:
        for m in re.finditer(rf"\b(?:{pat})\b", low):
            if any(a < m.end() and m.start() < b for a, b in used):
                continue
            used.append((m.start(), m.end()))
            found.append((m.start(), fr))
    return [fr for _, fr in sorted(found)][:2]


WORDNUM = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "half": 0.5,
           "one half": 0.5, "a half": 0.5, "one-half": 0.5, "quarter": 0.25, "one quarter": 0.25}


def word_qty(raw):
    m = re.match(r"^\s*(one half|a half|one-half|one quarter|a|an|one|two|three|four|five|six|half)\b", (raw or "").lower())
    return WORDNUM.get(m.group(1)) if m else None


def _num(s):
    """'1 1/2 to 2' -> 1.75"""
    from fractions import Fraction
    parts = re.split(r"\s*(?:-|to)\s*", s)
    try:
        vals = [float(sum(Fraction(x) for x in p.split())) for p in parts if p.strip()]
    except (ValueError, ZeroDivisionError):
        return None
    return sum(vals) / len(vals) if vals else None


def round_count(q):
    if q < 1:
        return max(0.25, round(q * 4) / 4)
    if q < 4:
        return round(q * 2) / 2
    return float(round(q))


def to_units(e):
    """Convertit ml/g/c. à s. d'un fruit ou légume en nombre de pièces. Modifie e."""
    p = produce_of(e)
    if not p or CANNED_FR.search(e.get("fr") or ""):
        return False
    fix = FR_FIX.get(merge_key(e.get("k") or ""))
    if fix:
        e["fr"] = fix
    _, (grams, ml, fem, unit) = p
    u, q = e.get("u"), e.get("q")
    if q is None and not u:
        wq = word_qty(e.get("raw"))
        if wq:
            q = wq
    pm = re.search(r"\((?:about|approx\.?|approximately)?\s*([\d./ ]+(?:\s*(?:-|to)\s*[\d./ ]+)?)\s*(lbs?|pounds?|ounces?|oz|g|grams?|kg)\b", e.get("raw") or "", re.I)
    if q is not None and u in ("ml", "cs", "cc") and pm:
        mq = _num(pm.group(1).strip())
        if mq:
            unit_w = pm.group(2).lower()
            f = 453.6 if unit_w.startswith(("lb", "pound")) else 28.35 if unit_w.startswith(("ounce", "oz")) else 1000 if unit_w == "kg" else 1
            q, u = mq * f, "g"
    if q is not None:
        if u == "g":
            q = q / grams
        elif u == "ml":
            q = q / ml
        elif u == "cs":
            q = q * 15 / ml
        elif u == "cc":
            q = q * 5 / ml
        elif u in (None, "pièce", "gousse", "branche"):
            pass
        else:
            return False  # tranche, botte, boîte... : on garde
        e["q"] = round_count(q) if u in ("g", "ml", "cs", "cc") else q
    if unit and not (unit == "branche" and "branche" in (e.get("fr") or "")):
        if unit == "gousse" and "gousse" in (e.get("fr") or ""):
            e.pop("u", None)
        else:
            e["u"] = unit
    else:
        e.pop("u", None)
    e["_fem"] = fem
    return True


def finish_count(e):
    """Nom au pluriel (et singulier en secours) + note de découpe accordée."""
    fem = e.pop("_fem", False)
    unit = e.get("u")
    fr = e.get("fr")
    if fr and not unit:
        pl, sg = _fr_number(fr, True), _fr_number(fr, False)
        e["fr"] = pl
        if sg != pl:
            e["fs"] = sg
    notes = cut_notes(e.get("raw"))
    if e.get("nt") and "en 2 fois" in e["nt"] and "en 2 fois" not in notes:
        notes.append("en 2 fois")
    if notes:
        if unit:  # « 3 gousses d'ail, hachées »
            fem = unit in ("gousse", "branche")
        e["nt"] = ", ".join(_agree(n, fem, True) for n in notes)
        sg = ", ".join(_agree(n, fem, False) for n in notes)
        if sg != e["nt"]:
            e["ns"] = sg
        else:
            e.pop("ns", None)


# ---------------------------------------------------------------- doublons
VOL = {"ml": 1, "cs": 15, "cc": 5}


def _fam(u):
    return "mass" if u == "g" else "vol" if u in VOL else (u or "count")


def merge_dupes(ings):
    out, seen = [], {}
    for e in ings:
        if e.get("h"):
            out.append(e)
            continue
        key = merge_key(e.get("k") or e.get("n"))
        prev = seen.get(key)
        if prev is None:
            seen[key] = e
            out.append(e)
            continue
        a, b = prev, e
        if b.get("q") is None:
            pass  # « salt and pepper » sans quantité : déjà listé
        elif a.get("q") is None:
            for f in ("q", "u"):
                if f in b: a[f] = b[f]
                else: a.pop(f, None)
        elif _fam(a.get("u")) == _fam(b.get("u")):
            fam = _fam(a.get("u"))
            if fam == "vol" and a.get("u") != b.get("u"):
                tot = a["q"] * VOL[a["u"]] + b["q"] * VOL[b["u"]]
                a["q"], a["u"] = (round(tot / 15, 3), "cs") if tot < 45 else (round(tot, 1), "ml")
            else:
                a["q"] = round(a["q"] + b["q"], 3)
            a["nt"] = "en 2 fois"
        else:
            seen[key + "#" + _fam(b.get("u"))] = b
            out.append(b)  # unités incompatibles (g et c. à s.) : on garde les deux
            continue
        if b.get("raw"):
            a["raw"] = (a.get("raw") + " + " if a.get("raw") else "") + b["raw"]
        if not b.get("p"):
            a.pop("p", None)
    return out


# ---------------------------------------------------------------- titres de section
# « Meatballs », « Sauce: », « FOR THE FILLING » sont des titres, pas des ingrédients
SECTION_WORDS = r"(?:toppings?|fillings?|sauce|dressing|cake|glaze|garnish(?:es)?|frosting|marinade|crust|icing|" \
                r"salad|dough|batter|meatballs?|dumplings?|syrup|streusel|crumb topping|optional|muffins|cookies|" \
                r"coating|rolls|scones|bottom layer|top layer|base|assembly|layer|pastry|brine|rub|spice rub|" \
                r"crumble|meringue|ganache|cheesecake|pie|biscuits|bread|vinaigrette|stuffing|broth|soup|" \
                r"to serve|for serving|garnish \(optional\)|sauce \(optional\))"


def is_section(e):
    raw = (e.get("raw") or "").strip()
    if e.get("q") is not None or not raw or re.search(r"\d|\(", raw) or len(raw.split()) > 6:
        return False
    low = raw.lower().rstrip(":").strip()
    if raw.endswith(":") or re.match(r"^(?:for\s|to (?:serve|decorate|finish|garnish|assemble)\b)", low) and not re.match(r"^for (?:frying|greasing|dusting|brushing|serving)", low):
        return True
    if raw.isupper() and len(raw) > 3 and not re.search(r"\b(?:salt|pepper|oil|water|spray)\b", low):
        return True
    words = raw.rstrip(":").split()
    if len(words) == 1:  # « Sauce », « streusel »
        return bool(re.fullmatch(SECTION_WORDS + "|optional", low))
    # « Lemon Glaze », « Cream Cheese Frosting » (titre en majuscules à chaque mot)
    titled = all(w[:1].isupper() or w.lower() in ("and", "or", "of", "for", "the", "with", "&", "de") for w in words)
    return titled and bool(re.fullmatch(rf"(?:[a-z'&-]+\s+){{1,4}}{SECTION_WORDS}", low))


EGG = re.compile(r"\beggs?\b(?:\s+(?:yolks?|whites?))?$|\begg (?:yolks?|whites?)$")


def fix_ingredients(ings, has_units=True):
    """Point d'entrée : titres de section, unités pour les fruits/légumes, puis fusion des doublons."""
    for e in ings:
        if is_section(e):
            e["h"] = 1
            e.pop("p", None)
            fr = (e.get("fr") or e.get("n") or "").strip().rstrip(":").strip()
            e["fr"] = fr[:1].upper() + fr[1:].lower() if fr.isupper() else fr
        elif not e.get("u") and EGG.search(e.get("k") or "") and "substitute" not in (e.get("k") or ""):
            e["w"] = 1  # un œuf ne se coupe pas : quantité entière
            if e.get("fr"):
                pl, sg = _fr_number(e["fr"], True), _fr_number(e["fr"], False)
                e["fr"] = pl
                if sg != pl:
                    e["fs"] = sg
    counted = []
    if has_units:
        for e in ings:
            if not e.get("h") and to_units(e):
                counted.append(e)
    ings = merge_dupes(ings)
    for e in counted:
        if e in ings:
            finish_count(e)
        e.pop("_fem", None)
    # un titre suivi d'aucun ingrédient (ou d'un autre titre) ne sert à rien
    out = []
    for i, e in enumerate(ings):
        if e.get("h"):
            nxt = next((x for x in ings[i + 1:] if x.get("h") or not x.get("p")), None)
            if nxt is None or nxt.get("h"):
                continue
        out.append(e)
    return out


# ---------------------------------------------------------------- unités dans le texte des étapes
# « Ajouter 1 Tb d'huile, 2 tasses de bouillon, cuire à 350°F dans un moule de 9x13 pouces »
# -> « Ajouter 1 c. à s. d'huile, 480 ml de bouillon, cuire à 175°C dans un moule de 23x33 cm »
_N = r"(?:\d+(?:[ -]\d+/\d+)|\d+/\d+|\d+(?:[.,]\d+)?|[½¼¾⅓⅔⅛])"
_RANGE = rf"({_N}(?:\s*(?:-|–|à|to|ou|or)\s*{_N})?)"
_FRAC = {"½": "1/2", "¼": "1/4", "¾": "3/4", "⅓": "1/3", "⅔": "2/3", "⅛": "1/8"}


def _val(s):
    from fractions import Fraction
    s = s.strip()
    for k, v in _FRAC.items():
        s = s.replace(k, v)
    s = s.replace(",", ".")
    m = re.match(r"^(\d+)[ -](\d+/\d+)$", s)
    try:
        if m:
            return float(int(m.group(1)) + Fraction(m.group(2)))
        return float(Fraction(s)) if "/" in s else float(s)
    except (ValueError, ZeroDivisionError):
        return None


def _vals(rng):
    parts = re.split(r"\s*(?:–|\bà\b|\bto\b|\bou\b|\bor\b)\s*|\s+-\s*|-\s+|(?<=\d)-(?=\d+(?:[.,]\d+)?(?:\s|$))", rng.strip())
    # « 1-1/2 » est un nombre mixte, pas un intervalle
    if re.match(r"^\d+-\d+/\d+$", rng.strip()):
        parts = [rng.strip()]
    out = [_val(p) for p in parts if p]
    return out if out and all(v is not None for v in out) else None


def _fmt_dec(x):
    s = (f"{x:.1f}" if x < 10 and abs(x - round(x)) > 0.05 else str(int(round(x))))
    return s.replace(".", ",")


def _metric(vals, kind):
    def one(v):
        if kind == "ml":
            ml = v * 240
            return (_fmt_dec(ml / 1000), "L") if ml >= 1000 else (str(max(5, int(round(ml / 5) * 5))), "ml")
        if kind == "qt":
            ml = v * 946
            return (_fmt_dec(ml / 1000), "L") if ml >= 1000 else (str(int(round(ml / 10) * 10)), "ml")
        if kind == "pt":
            ml = v * 473
            return (_fmt_dec(ml / 1000), "L") if ml >= 1000 else (str(int(round(ml / 10) * 10)), "ml")
        if kind == "oz":
            g = v * 28.35
            return (str(max(5, int(round(g / 5) * 5))) if g < 200 else str(int(round(g / 10) * 10))), "g"
        if kind == "lb":
            g = v * 453.6
            return (_fmt_dec(g / 1000), "kg") if g >= 1000 else (str(int(round(g / 10) * 10)), "g")
        if kind == "in":
            cm = v * 2.54
            return (_fmt_dec(round(cm * 2) / 2) if cm < 5 else str(int(round(cm)))), "cm"
    conv = [one(v) for v in vals]
    if len(conv) == 2 and conv[0][1] == conv[1][1]:
        return f"{conv[0][0]} à {conv[1][0]} {conv[0][1]}"
    return " à ".join(f"{a} {b}" for a, b in conv)


_UNITS_TXT = [
    (r"(?:(?i:tablespoons?|tbsps?|tbs|tb)|T)(?![\w'’])\.?", "cs"),
    (r"(?:(?i:teaspoons?|tsps?)|t)(?![\w'’])\.?", "cc"),
    (r"(?:de\s+)?(?i:cups?|tasses?)\b", "ml"), (r"(?i:quarts?)\b(?!\s+de\s+(?:tasse|livre))", "qt"),
    (r"(?i:pints?)\b", "pt"), (r"(?:d'|de\s+)?(?i:(?:fl\.?\s*)?(?:ounces?|onces?|oz))\b\.?", "oz"),
    (r"(?:de\s+)?(?i:pounds?|livres?|lbs?)\b\.?", "lb"), (r"(?:de\s+)?(?:(?i:inch(?:es)?|pouces?)\b|\")", "in"),
]


def fr_step_units(text):
    if not text:
        return text
    # températures : 350°F, 350 degrés F, 65°F
    def f2c(m):
        c = round((int(m.group(1)) - 32) * 5 / 9 / 5) * 5
        return f"{c}°C"
    text = re.sub(r"(\d{2,3})\s*°\s*[fF]\b", f2c, text)
    text = re.sub(r"(\d{2,3})\s*(?:degr[ée]s?|degrees?)\s*(?:F\b|Fahrenheit\b)", f2c, text)
    text = re.sub(r"(?<![\d,.])([2-5]\d{2})\s*(?:degr[ée]s?|degrees?)(?!\s*(?:C|Celsius))", f2c, text)

    # dimensions : 9x13 pouces, 8-1/2 x 4-1/2-inch
    def dims(m):
        vs = [_val(x) for x in re.split(r"\s*[x×X]\s*", m.group(1))]
        if any(v is None for v in vs):
            return m.group(0)
        return "x".join(str(int(round(v * 2.54))) for v in vs) + " cm"
    text = re.sub(rf"({_N}(?:\s*[x×X]\s*{_N}){{1,2}})\s*-?\s*(?:inch(?:es)?|pouces?|po\b|\")", dims, text)

    for pat, kind in _UNITS_TXT:
        rx = re.compile(rf"(?<![\w/]){_RANGE}\s*-?\s*{pat}")

        def rep(m, kind=kind):
            vals = _vals(m.group(1))
            if not vals:
                return m.group(0)
            if kind in ("cs", "cc"):
                return m.group(1) + (" c. à s." if kind == "cs" else " c. à c.")
            return _metric(vals, kind)
        text = rx.sub(rep, text)
    return text
