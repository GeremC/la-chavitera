#!/usr/bin/env python3
"""
Traduit automatiquement en français toutes les recettes de data/ (titres, étapes,
descriptions, noms d'ingrédients inconnus du lexique), hors ligne, avec le modèle
anglais -> français d'Argos Translate (CTranslate2, tourne sur CPU).

Les traductions sont mises en cache :
    tools/translations_fr.json     { "id": { "n": ..., "st": [...], "desc": ... } }
    tools/ingredients_fr_mt.json   { "nom anglais": "nom français" }
build_data.py les fusionne ensuite. Les traductions déjà présentes (manuelles ou non)
ne sont jamais écrasées : on peut corriger une recette à la main dans translations_fr.json.

Usage :
    pip install ctranslate2 sentencepiece
    python tools/translate_fr.py [--budget-min 300] [--limit N]
Le script s'arrête proprement quand le budget de temps est écoulé et reprend là où il
en était au lancement suivant.
"""
import argparse, json, re, sys, time, urllib.request, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TR_PATH = ROOT / "tools" / "translations_fr.json"
ING_PATH = ROOT / "tools" / "ingredients_fr_mt.json"
MODEL_URL = "https://argos-net.com/v1/translate-en_fr-1_9.argosmodel"
CACHE = Path.home() / ".cache" / "chavitera-mt"

sys.path.insert(0, str(Path(__file__).parent))
from build_data import norm_ing, fr_name  # noqa: E402


def load_model():
    import ctranslate2, sentencepiece
    CACHE.mkdir(parents=True, exist_ok=True)
    pkg = CACHE / "en_fr.argosmodel"
    if not pkg.exists():
        print("Téléchargement du modèle en -> fr…")
        urllib.request.urlretrieve(MODEL_URL, pkg)
    root = next((p for p in CACHE.glob("*/") if (p / "model").is_dir()), None)
    if root is None:
        with zipfile.ZipFile(pkg) as z:
            z.extractall(CACHE)
        root = next(p for p in CACHE.glob("*/") if (p / "model").is_dir())
    tr = ctranslate2.Translator(str(root / "model"), device="cpu", compute_type="int8", inter_threads=1, intra_threads=0)
    sp = sentencepiece.SentencePieceProcessor(model_file=str(root / "sentencepiece.model"))
    return tr, sp


SENT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9(\"'])")


def split_sentences(text):
    return [s for s in SENT.split(text.strip()) if s.strip()] or [text]


class MT:
    def __init__(self):
        self.tr, self.sp = load_model()
        self.memo = {}

    def batch(self, texts):
        """Traduit une liste de phrases courtes (dédupliquées, mémorisées)."""
        todo = sorted({t for t in texts if t not in self.memo}, key=len)
        for i in range(0, len(todo), 64):
            chunk = todo[i:i + 64]
            toks = [self.sp.encode(t, out_type=str)[:250] for t in chunk]
            res = self.tr.translate_batch(toks, beam_size=2, max_batch_size=64, max_decoding_length=300)
            for t, r in zip(chunk, res):
                self.memo[t] = self.sp.decode(r.hypotheses[0]).strip()
        return [self.memo[t] for t in texts]

    def texts(self, texts):
        """Traduit des textes de plusieurs phrases."""
        parts = [split_sentences(t) for t in texts]
        flat = self.batch([s for p in parts for s in p])
        out, i = [], 0
        for p in parts:
            out.append(" ".join(flat[i:i + len(p)]))
            i += len(p)
        return out


def title_case_fr(s):
    s = s.strip().rstrip(".")
    return s[:1].upper() + s[1:] if s else s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--budget-min", type=float, default=300)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    t0 = time.time()

    index = json.loads((DATA / "index.json").read_text("utf-8"))
    names = {r["id"]: r["n"] for r in index["recipes"]}
    order = [r["id"] for r in sorted(index["recipes"], key=lambda r: -r["s"])]  # les meilleures d'abord
    details = {}
    for f in (DATA / "r").glob("*.json"):
        for k, d in json.loads(f.read_text("utf-8")).items():
            details[int(k)] = d

    trans = {int(k): v for k, v in json.loads(TR_PATH.read_text("utf-8")).items()} if TR_PATH.exists() else {}
    ing_mt = json.loads(ING_PATH.read_text("utf-8")) if ING_PATH.exists() else {}
    mt = MT()

    # 1) ingrédients absents du lexique
    unknown = sorted({norm_ing(e["n"]) for d in details.values() for e in d["ing"]
                      if not e.get("fr") and not fr_name(e["n"])} - set(ing_mt))
    if unknown:
        for en, fr in zip(unknown, mt.batch(unknown)):
            ing_mt[en] = fr.rstrip(".").lower() if en.islower() else fr.rstrip(".")
        ING_PATH.write_text(json.dumps(ing_mt, ensure_ascii=False, indent=0, sort_keys=True), "utf-8")
        print(f"  {len(unknown)} ingrédients traduits")

    # 2) recettes, par paquets, avec sauvegarde régulière
    todo = [rid for rid in order if rid in details and not trans.get(rid, {}).get("st")]
    if args.limit:
        todo = todo[:args.limit]
    print(f"  {len(todo):,} recettes à traduire ({len(trans):,} déjà en cache)")

    def save():
        TR_PATH.write_text(json.dumps({str(k): v for k, v in trans.items()}, ensure_ascii=False, separators=(",", ":")), "utf-8")

    done, last_save = 0, time.time()
    for i in range(0, len(todo), 100):
        if time.time() - t0 > args.budget_min * 60:
            print("  budget de temps écoulé, on reprendra au prochain lancement")
            break
        ids = todo[i:i + 100]
        recs = [details[r] for r in ids]
        steps = mt.texts([s for d in recs for s in (d.get("stEn") or d["st"])])
        descs = mt.texts([d.get("desc") or "" for d in recs])
        titles = mt.batch([names[r] for r in ids])
        j = 0
        for rid, d, title, desc in zip(ids, recs, titles, descs):
            n = len(d.get("stEn") or d["st"])
            e = dict(trans.get(rid, {}))
            e.setdefault("n", title_case_fr(title))
            e["st"] = steps[j:j + n]
            if d.get("desc") and not e.get("desc"):
                e["desc"] = desc
            trans[rid] = e
            j += n
        done += len(ids)
        mt.memo.clear()
        if time.time() - last_save > 120:
            save(); last_save = time.time()
            rate = done / (time.time() - t0)
            print(f"  {done:,}/{len(todo):,} ({rate:.1f} recettes/s, reste ~{(len(todo) - done) / max(rate, .01) / 60:.0f} min)", flush=True)
    save()
    left = len(todo) - done
    print(f"OK : {done:,} recettes traduites en {(time.time() - t0) / 60:.0f} min, {max(left, 0):,} restantes")


if __name__ == "__main__":
    main()
