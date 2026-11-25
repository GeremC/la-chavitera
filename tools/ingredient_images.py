#!/usr/bin/env python3
"""
Associe une photo à chaque ingrédient de data/ingredients.json, à partir de la banque
d'images d'ingrédients de TheMealDB (gratuite, fond transparent).

Sortie : data/ing_img.json  { "clé ingrédient": "Nom TheMealDB" }
L'appli affiche https://www.themealdb.com/images/ingredients/<Nom>-Small.png
et retombe sur une icône SVG si aucune photo n'existe.

Usage : python tools/ingredient_images.py   (aucune dépendance)
"""
import json, re, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIST_URL = "https://www.themealdb.com/api/json/v1/1/list.php?i=list"

# synonymes anglais (Food.com -> TheMealDB) quand le nom diffère vraiment
ALIAS = {
    "scallions": "spring onions", "scallion": "spring onions", "green onions": "spring onions", "green onion": "spring onions",
    "cilantro": "coriander", "fresh cilantro": "coriander", "cilantro leaves": "coriander", "garlic cloves": "garlic",
    "garlic clove": "garlic", "eggs": "egg", "egg yolks": "egg yolks", "egg whites": "egg white", "flour": "plain flour",
    "all-purpose flour": "plain flour", "powdered sugar": "icing sugar", "confectioners sugar": "icing sugar",
    "baking soda": "bicarbonate of soda", "cornstarch": "cornflour", "heavy cream": "double cream",
    "whipping cream": "double cream", "heavy whipping cream": "double cream", "half-and-half": "single cream",
    "zucchini": "courgettes", "eggplant": "aubergine", "bell pepper": "red pepper", "green bell pepper": "green pepper",
    "red bell pepper": "red pepper", "ground beef": "minced beef", "hamburger": "minced beef", "lean ground beef": "minced beef",
    "ground pork": "minced pork", "ground turkey": "turkey mince", "shrimp": "prawns", "chicken breasts": "chicken breast",
    "boneless skinless chicken breasts": "chicken breast", "chicken thighs": "chicken thighs", "vanilla": "vanilla extract",
    "pepper": "black pepper", "black pepper": "black pepper", "salt": "salt", "kosher salt": "salt", "sea salt": "sea salt",
    "oil": "vegetable oil", "canola oil": "vegetable oil", "extra virgin olive oil": "olive oil", "margarine": "butter",
    "unsalted butter": "butter", "cheddar cheese": "cheddar cheese", "sharp cheddar cheese": "cheddar cheese",
    "parmesan cheese": "parmesan", "fresh parmesan cheese": "parmesan", "mozzarella cheese": "mozzarella",
    "sour cream": "sour cream", "cream cheese": "cream cheese", "chicken broth": "chicken stock",
    "beef broth": "beef stock", "vegetable broth": "vegetable stock", "brown sugar": "brown sugar",
    "light brown sugar": "brown sugar", "dark brown sugar": "dark brown sugar", "granulated sugar": "caster sugar",
    "sugar": "sugar", "molasses": "black treacle", "red pepper flakes": "chilli powder", "cayenne pepper": "cayenne pepper",
    "chili powder": "chilli powder", "jalapeno": "jalapeno", "jalapenos": "jalapeno", "green chilies": "green chilli",
    "tomato sauce": "tomato puree", "tomato paste": "tomato puree", "diced tomatoes": "chopped tomatoes",
    "crushed tomatoes": "chopped tomatoes", "tomatoes": "tomatoes", "potatoes": "potatoes", "russet potatoes": "potatoes",
    "yukon gold potatoes": "potatoes", "sweet potatoes": "sweet potatoes", "onion": "onion", "onions": "onion",
    "yellow onion": "onion", "red onion": "red onions", "shallots": "shallots", "lemon juice": "lemon juice",
    "fresh lemon juice": "lemon juice", "lime juice": "lime", "lemon": "lemon", "lemons": "lemon", "lime": "lime",
    "limes": "lime", "lemon zest": "lemon zest", "parsley": "parsley", "fresh parsley": "parsley",
    "flat leaf parsley": "parsley", "basil": "basil", "fresh basil": "basil", "dried basil": "basil",
    "oregano": "oregano", "dried oregano": "oregano", "thyme": "thyme", "fresh thyme": "thyme", "rosemary": "rosemary",
    "milk": "milk", "whole milk": "milk", "skim milk": "milk", "buttermilk": "buttermilk", "water": "water",
    "honey": "honey", "maple syrup": "maple syrup", "soy sauce": "soy sauce", "worcestershire sauce": "worcestershire sauce",
    "dijon mustard": "dijon mustard", "mustard": "mustard", "mayonnaise": "mayonnaise", "ketchup": "tomato ketchup",
    "rice": "rice", "long grain rice": "long grain rice", "white rice": "rice", "brown rice": "brown rice",
    "spaghetti": "spaghetti", "penne pasta": "penne rigate", "elbow macaroni": "macaroni", "egg noodles": "egg noodles",
    "bacon": "bacon", "ham": "ham", "sausage": "sausages", "italian sausage": "italian fennel sausages",
    "walnuts": "walnuts", "pecans": "pecan nuts", "almonds": "almonds", "peanuts": "peanuts", "raisins": "raisins",
    "chocolate chips": "chocolate chips", "semi-sweet chocolate chips": "chocolate chips", "cocoa": "cocoa",
    "unsweetened cocoa powder": "cocoa", "cinnamon": "cinnamon", "ground cinnamon": "cinnamon", "nutmeg": "nutmeg",
    "ground cumin": "cumin", "cumin": "cumin", "paprika": "paprika", "ginger": "ginger", "fresh ginger": "ginger",
    "ground ginger": "ginger", "baking powder": "baking powder", "yeast": "yeast", "active dry yeast": "yeast",
    "white wine": "white wine", "dry white wine": "white wine", "red wine": "red wine", "celery": "celery",
    "carrots": "carrots", "carrot": "carrots", "mushrooms": "mushrooms", "fresh mushrooms": "mushrooms",
    "spinach": "spinach", "fresh spinach": "spinach", "broccoli": "broccoli", "cabbage": "cabbage",
    "corn": "sweetcorn", "frozen corn": "sweetcorn", "black beans": "black beans", "kidney beans": "kidney beans",
    "chickpeas": "chickpeas", "garbanzo beans": "chickpeas", "avocado": "avocado", "cucumber": "cucumber",
    "bread crumbs": "breadcrumbs", "dry bread crumbs": "breadcrumbs", "panko breadcrumbs": "breadcrumbs",
    "flour tortillas": "flour tortilla", "corn tortillas": "tortillas", "salsa": "salsa", "apples": "apples",
    "bananas": "banana", "banana": "banana", "strawberries": "strawberries", "blueberries": "blueberries",
    "oats": "oats", "rolled oats": "oats", "quick-cooking oats": "oats", "coconut": "desiccated coconut",
    "shredded coconut": "desiccated coconut", "coconut milk": "coconut milk", "peanut butter": "peanut butter",
    "vinegar": "white vinegar", "cider vinegar": "cider vinegar", "apple cider vinegar": "cider vinegar",
    "balsamic vinegar": "balsamic vinegar", "red wine vinegar": "red wine vinegar", "sesame oil": "sesame seed oil",
    "olive oil": "olive oil", "vegetable oil": "vegetable oil", "butter": "butter", "garlic": "garlic",
    "garlic powder": "garlic powder", "onion powder": "onion powder", "curry powder": "curry powder",
    "turmeric": "turmeric", "bay leaf": "bay leaf", "bay leaves": "bay leaves", "mint": "mint", "dill": "dill",
    "chives": "chives", "feta cheese": "feta", "ricotta cheese": "ricotta", "swiss cheese": "gruyère",
    "monterey jack cheese": "monterey jack cheese", "cottage cheese": "cottage cheese", "plain yogurt": "greek yogurt",
    "yogurt": "greek yogurt", "greek yogurt": "greek yogurt", "salmon": "salmon", "tuna": "tuna", "cod": "cod",
    "pork chops": "pork chops", "pork tenderloin": "pork", "beef": "beef", "steak": "beef", "lamb": "lamb",
    "chicken": "chicken", "turkey": "turkey", "peas": "peas", "frozen peas": "peas", "green beans": "green beans",
    "asparagus": "asparagus", "cauliflower": "cauliflower", "leeks": "leek", "pumpkin": "pumpkin",
    "pineapple": "pineapple", "orange": "orange", "orange juice": "orange", "orange zest": "orange zest",
    "cranberries": "cranberries", "dried cranberries": "cranberries", "almond extract": "almond extract",
    "powdered ginger": "ginger", "allspice": "allspice", "cloves": "cloves", "nutmeg ground": "nutmeg",
}


def norm(s):
    s = s.lower().replace("’", "'")
    s = re.sub(r"[^a-z0-9' -]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def singular(w):
    if w.endswith("ies"): return w[:-3] + "y"
    if w.endswith("oes"): return w[:-2]
    if w.endswith("ches") or w.endswith("shes"): return w[:-2]
    if w.endswith("s") and not w.endswith("ss"): return w[:-1]
    return w


# mots « tête » : s'ils sont retirés, l'ingrédient change de nature (apple pie spice != apple)
HEADS = {"spice", "spices", "pudding", "sauce", "butter", "mix", "juice", "extract", "oil", "paste", "seasoning",
         "vinegar", "syrup", "cake", "pie", "soup", "dressing", "powder", "jam", "jelly", "chips", "crackers",
         "cookies", "filling", "frosting", "liqueur", "wine", "milk", "cream", "yogurt", "flakes", "salt", "sugar"}
# un seul mot générique en fin de nom ne suffit pas (almond butter != butter, tuna in water != water)
WEAK_SUFFIX = {"water", "butter", "milk", "oil", "juice", "sauce", "powder", "cream", "mix", "spice", "leaves",
               "seeds", "sugar", "salt", "extract", "paste", "pepper", "peppers"}


def candidates(key):
    k = norm(re.sub(r"\b(packed )?in (water|oil|juice|syrup|brine)\b.*$", "", norm(key)))
    if k in ALIAS: yield ALIAS[k]
    yield k
    words = k.split()
    yield " ".join(singular(w) for w in words)
    # sous-expressions de droite (le nom principal est en fin) : "boneless chicken breast" -> "chicken breast"
    for i in range(1, len(words)):
        sub = words[i:]
        if sub[0] in HEADS and len(sub) == 1 and len(words) > 1 and sub[0] in WEAK_SUFFIX:
            continue
        if len(sub) == 1 and sub[0] in WEAK_SUFFIX:
            continue
        s = " ".join(sub)
        if s in ALIAS: yield ALIAS[s]
        yield s
        yield " ".join(singular(w) for w in sub)
    # sous-expressions de gauche, seulement si on ne retire pas le mot « tête »
    for i in range(len(words) - 1, 0, -1):
        if any(w in HEADS or singular(w) in HEADS for w in words[i:]):
            continue
        s = " ".join(words[:i])
        if s in ALIAS: yield ALIAS[s]
        yield s


def main():
    req = urllib.request.Request(LIST_URL, headers={"User-Agent": "la-chavitera-build"})
    meals = json.load(urllib.request.urlopen(req, timeout=30))["meals"]
    names = {}
    for m in meals:
        n = (m.get("strIngredient") or "").strip()
        if n:
            names[norm(n)] = n
            names.setdefault(" ".join(singular(w) for w in norm(n).split()), n)
    ings = json.loads((ROOT / "data" / "ingredients.json").read_text("utf-8"))
    out, miss = {}, []
    for key, _fr, count in ings:
        hit = next((names[c] for c in candidates(key) if c in names), None)
        # éviter les correspondances trop vagues sur un seul mot générique
        if hit and norm(hit) in {"sauce", "powder", "oil", "juice", "cream", "leaves", "seeds"}:
            hit = None
        if hit: out[key] = hit
        else: miss.append((count, key))
    (ROOT / "data" / "ing_img.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":"), sort_keys=True), "utf-8")
    covered = sum(c for k, _, c in ings if k in out)
    total = sum(c for _, _, c in ings)
    print(f"{len(out)}/{len(ings)} ingrédients avec photo ({covered / max(total, 1):.0%} des usages). "
          f"Sans photo (top 30) : {', '.join(k for _, k in sorted(miss, reverse=True)[:30])}")


if __name__ == "__main__":
    main()
