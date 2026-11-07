# Make data/suburbs.json from raw/australian_postcodes.csv
# Keeps only: NSW, Delivery Area, postcodes that have rent data
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # D:\rentwise
CSV_FILE       = ROOT / "raw"  / "australian_postcodes.csv"
BENCHMARK_FILE = ROOT / "data" / "benchmark.json"
OUT_FILE       = ROOT / "data" / "suburbs.json"

# 1. postcodes that have rent data (from benchmark.json)
with open(BENCHMARK_FILE, encoding="utf-8") as f:
    rent_postcodes = {row["postcode"] for row in json.load(f)}

# 2. read the CSV and keep the rows we need
suburbs = {}
with open(CSV_FILE, encoding="utf-8-sig", newline="") as f:
    for row in csv.DictReader(f):
        if row["state"] != "NSW" or row["type"] != "Delivery Area":
            continue

        postcode = row["postcode"].zfill(4)            # 2000 -> "2000"
        if postcode not in rent_postcodes:
            continue
        if not row["Lat_precise"] or not row["Long_precise"]:
            continue

        name = row["locality"].strip()
        key = (postcode, name.upper())                 # no duplicates
        if key in suburbs:
            continue

        suburbs[key] = {
            "postcode":  postcode,
            "suburb":    name.title(),                 # "SOUTH GRANVILLE" -> "South Granville"
            "latitude":  round(float(row["Lat_precise"]), 5),
            "longitude": round(float(row["Long_precise"]), 5),
        }

# 3. save as a small JSON file
result = sorted(suburbs.values(), key=lambda r: (r["postcode"], r["suburb"]))
with open(OUT_FILE, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, separators=(",", ":"))

print(f"Saved {len(result)} suburbs in {len({r['postcode'] for r in result})} postcodes to {OUT_FILE}")
