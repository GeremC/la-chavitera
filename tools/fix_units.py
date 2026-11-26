"""Applique tools/units.py aux données déjà publiées (data/), sans relancer
toute la construction Kaggle + traduction.

    python tools/fix_units.py
"""
import hashlib, json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from units import fix_ingredients, fr_step_units

DATA = Path(__file__).resolve().parent.parent / "data"


def main():
    keys = {}
    n_before = n_after = n_steps = 0
    for f in sorted((DATA / "r").glob("*.json")):
        content = json.loads(f.read_text("utf-8"))
        for rid, d in content.items():
            n_before += len(d["ing"])
            d["ing"] = fix_ingredients(d["ing"], has_units=d.get("units", True))
            n_after += len(d["ing"])
            if d.get("stEn"):  # étapes traduites : unités françaises
                new = [fr_step_units(x) for x in d["st"]]
                n_steps += sum(a != b for a, b in zip(new, d["st"]))
                d["st"] = new
            keys[int(rid)] = [e["k"] for e in d["ing"] if not e.get("p")][:10]
        f.write_text(json.dumps(content, ensure_ascii=False, separators=(",", ":")), "utf-8")
    idx = json.loads((DATA / "index.json").read_text("utf-8"))
    for r in idx["recipes"]:
        if r["id"] in keys:
            r["k"] = keys[r["id"]]
    # nouvelle version : les navigateurs rechargent les fichiers (?v=...)
    v = hashlib.md5((idx["v"] + "units-v2").encode()).hexdigest()[:10]
    idx["v"] = v
    (DATA / "index.json").write_text(json.dumps(idx, ensure_ascii=False, separators=(",", ":")), "utf-8")
    meta = json.loads((DATA / "version.json").read_text("utf-8"))
    meta["v"] = v
    (DATA / "version.json").write_text(json.dumps(meta, ensure_ascii=False), "utf-8")
    print(f"{n_before - n_after} doublons fusionnés, {n_steps} étapes converties, version {v}")


if __name__ == "__main__":
    main()
