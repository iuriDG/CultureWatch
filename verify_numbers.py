"""Independent check: recompute headline numbers straight from the raw CSVs and compare them with what the
running app serves. Deliberately does NOT import cw_utils / preprocess / hospital_trends / treatment_guide:
the counting rules are re-implemented here from their definitions, so a bug in the app shows up as a mismatch.

Run with the API running (uvicorn api.main:app --port 8000):   python verify_numbers.py
Exit code 0 = every number matches, 1 = at least one mismatch."""
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent
API = "http://127.0.0.1:8000/api"
ACTIVE = ROOT / "data" / "imports" / "active"   # an applied CSV import, if any
RAW = ACTIVE if (ACTIVE / "cultures.csv").exists() else ROOT / "synthetic_microbiology_dataset"


def api(path, **params):
    q = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    with urllib.request.urlopen(f"{API}/{path}{'?' + q if q else ''}", timeout=120) as r:
        return json.load(r)


# ---------- Raw data and the rules, re-implemented from their definitions ----------
patients = pd.read_csv(RAW / "patients.csv")
cultures = pd.read_csv(RAW / "cultures.csv", parse_dates=["sample_date", "admission_date"])
isolates = pd.read_csv(RAW / "isolates.csv")
sus = pd.read_csv(RAW / "susceptibility.csv")

iso = (isolates.merge(cultures, on="culture_id").merge(patients, on="patient_id")
       .sort_values(["sample_date", "culture_id", "isolate_no"]).reset_index(drop=True))
# Surveillance year runs October-September
iso["syear"] = iso.sample_date.dt.year.where(iso.sample_date.dt.month >= 10, iso.sample_date.dt.year - 1)
# First isolate per patient, organism and specimen per surveillance year
iso["first_year"] = ~iso.duplicated(["patient_id", "organism", "specimen", "syear"])


def first_in_window(start, end):
    """First isolate per patient, organism and specimen inside [start, end] (CLSI M39 for a rolling window)."""
    w = iso[(iso.sample_date >= pd.Timestamp(start)) & (iso.sample_date <= pd.Timestamp(end))]
    return w[~w.duplicated(["patient_id", "organism", "specimen"])]


def window_12m(end):
    end = pd.Timestamp(end)
    return end - pd.Timedelta(days=364), end


def rate(d, organisms, flag):
    base = d[d.organism.isin(organisms)]
    return int(base[flag].sum()), len(base)


ESBL_BASE, MRSA_BASE = ["Escherichia coli", "Klebsiella pneumoniae"], ["Staphylococcus aureus"]
rows = []


def check(name, raw_value, app_value):
    rows.append((name, raw_value, app_value, raw_value == app_value))


latest = iso.sample_date.max()

# 1-2. Hospital, last 12 months: first isolates, ESBL and MRSA (today and in the time machine)
for as_of in [None, "2026-03-08"]:
    end = pd.Timestamp(as_of) if as_of else latest
    w = first_in_window(*window_12m(end))
    k = api("overview", window="12m", as_of=as_of)["kpis"]
    label = f"hospital 12 m to {end:%Y-%m-%d}"
    check(f"{label}: first isolates", len(w), k["first_isolates"])
    check(f"{label}: ESBL cases/n", rate(w, ESBL_BASE, "esbl"), (k["esbl"]["cases"], k["esbl"]["n"]))
    check(f"{label}: MRSA cases/n", rate(w, MRSA_BASE, "mrsa"), (k["mrsa"]["cases"], k["mrsa"]["n"]))

# 3. ICU in the time machine on 8 Mar 2026: 12-month MRSA rate and the 4-week MRSA alert
as_of = pd.Timestamp("2026-03-08")
ward = api("ward/ICU", as_of="2026-03-08")
w = first_in_window(*window_12m(as_of))
check("ICU 12 m to 2026-03-08: MRSA cases/n", rate(w[w.ward_code == "ICU"], MRSA_BASE, "mrsa"),
      (ward["twelve_months"]["rates"]["ward"]["mrsa"]["cases"], ward["twelve_months"]["rates"]["ward"]["mrsa"]["n"]))
d = iso[iso.first_year & (iso.sample_date <= as_of)]
weeks = pd.period_range(d.sample_date.min(), as_of, freq="W-SUN")
cases = d[(d.ward_code == "ICU") & (d.mrsa == 1)].sample_date.dt.to_period("W-SUN").value_counts()
weekly = cases.reindex(weeks, fill_value=0).values
ph = next(p for p in ward["four_weeks"]["phenotypes"] if p["phenotype"] == "mrsa")
check("ICU 4 weeks to 2026-03-08: MRSA cases", int(weekly[-4:].sum()), ph["observed"])
check("ICU 4 weeks to 2026-03-08: usual (52-week mean x 4)", round(weekly[-56:-4].mean() * 4, 2), round(ph["expected"], 2))
check("ICU 4 weeks to 2026-03-08: alert raised", True, ph["alert"])

# 4. Antibiogram, all time (first isolate per surveillance year)
ast_first = sus.merge(iso.loc[iso.first_year, ["isolate_id"]], on="isolate_id")
cells = {(c["organism"], c["antibiotic_code"]): c for c in api("antibiogram")["cells"]}
for org, ab in [("Escherichia coli", "AMP"), ("Escherichia coli", "TMP"), ("Klebsiella pneumoniae", "CIP"),
                ("Staphylococcus aureus", "FOX"), ("Pseudomonas aeruginosa", "TZP")]:
    x = ast_first[(ast_first.organism == org) & (ast_first.antibiotic_code == ab)]
    c = cells[(org, ab)]
    check(f"antibiogram all time: {org} {ab} resistant/tested", (int((x.result == "R").sum()), len(x)),
          (c["n_resistant"], c["n_tested"]))

# 5. Trend: E. coli trimethoprim per calendar quarter (first and last quarter)
x = ast_first[(ast_first.organism == "Escherichia coli") & (ast_first.antibiotic_code == "TMP")]
x = x.merge(iso[["isolate_id", "sample_date"]], on="isolate_id")
q = x.groupby(x.sample_date.dt.to_period("Q").astype(str)).result.agg(lambda r: (int((r == "R").sum()), len(r)))
pts = api("trend", organism="Escherichia coli", antibiotic="TMP")["points"]
for p in (pts[0], pts[-1]):
    check(f"trend E. coli TMP {p['quarter']}: resistant/tested", q[p["quarter"]], (p["n_resistant"], p["n_tested"]))

# 6. Treatment guide, bloodstream infection: piperacillin-tazobactam coverage (all time)
blood = iso[iso.first_year & (iso.specimen == "blood")]
res = sus[sus.isolate_id.isin(blood.isolate_id)].pivot_table(index="isolate_id", columns="antibiotic_code",
                                                              values="result", aggfunc="first")
res = res.reindex(blood.isolate_id)
org = blood.set_index("isolate_id").organism
tzp = res.get("TZP").copy()
tzp[org == "Staphylococcus aureus"] = res.get("FOX")[org == "Staphylococcus aureus"]  # EUCAST: from cefoxitin screen
tzp[org == "Enterococcus faecalis"] = res.get("AMP")[org == "Enterococcus faecalis"]  # EUCAST: from ampicillin
covered = int((tzp == "S").sum())                                                     # untested = not covered
t = next(r for r in api("treatment", scenario="Bloodstream infection")["single"] if r["regimen"] == "TZP")
check("treatment, bloodstream: TZP covered/isolates", (covered, len(blood)), (t["n_covered"], t["n_isolates"]))

# 7. Findings worklist, last 7 days: new / known / positive-again carriers
fs = []
for ph in ["esbl", "mrsa", "vre", "cpe"]:
    pos = iso[(iso[ph] == 1) & (iso.sample_date <= latest)].drop_duplicates(["patient_id", "sample_date"])
    prev = pos.groupby("patient_id").sample_date.shift()
    gap = (pos.sample_date - prev).dt.days
    status = pd.Series("repositive", index=pos.index).mask(gap <= 365, "known").mask(prev.isna(), "new")
    fs.append(status[pos.sample_date >= latest - pd.Timedelta(days=6)])
raw_counts = pd.concat(fs).value_counts().to_dict()
app_counts = pd.Series([f["status"] for f in api("findings", days=7)["findings"]], dtype=object).value_counts().to_dict()
check("findings last 7 days: count by carrier status", raw_counts, app_counts)

# 8. Result checks, all time: contradictions, natural-resistance violations, unconfirmed ceftriaxone resistance
w = sus.pivot_table(index="isolate_id", columns="antibiotic_code", values="result", aggfunc="first")
x = isolates.set_index("isolate_id").join(w)
sa, eckp = x[x.organism == "Staphylococcus aureus"], x[x.organism.isin(["Escherichia coli", "Klebsiella pneumoniae"])]
entc = x[x.organism.isin(["Enterococcus faecalis", "Enterococcus faecium"])]
contradictions = int(((sa.mrsa == 1) & (sa.FOX == "S")).sum() + ((sa.FOX == "R") & (sa.mrsa != 1)).sum()
                     + ((eckp.esbl == 1) & (eckp.CRO == "S")).sum()
                     + ((entc.vre == 1) & (entc.VAN == "S")).sum() + ((entc.VAN == "R") & (entc.vre != 1)).sum())
natural = int(((x.organism.isin(["Klebsiella pneumoniae", "Klebsiella oxytoca", "Citrobacter freundii"])) & (x.AMP == "S")).sum()
              + ((x.organism == "Proteus mirabilis") & (x.NIT == "S")).sum())
unconfirmed = int(((eckp.CRO == "R") & (eckp.esbl != 1) & (eckp.cpe != 1)).sum())
c = api("checks")["counts"]
check("result checks all time: contradictions", contradictions, c["contradiction"])
check("result checks all time: natural-resistance violations", natural, c["impossible"])
check("result checks all time: ceftriaxone-R without ESBL/CPE (confirm)", unconfirmed,
      next(r["flagged"] for r in api("checks")["rules"] if r["rule"] == "esc_r_unconfirmed"))

# 9. Spread between wards, last 12 months: new carriers, how many had been on another ward in the 30 days
#    before (any culture counts as a stay), and every ward-to-ward movement with its patient count
start12, end12 = window_12m(latest)
new_rows = []
for ph in ["esbl", "mrsa", "vre", "cpe"]:
    pos = iso[(iso[ph] == 1) & (iso.sample_date <= latest)].drop_duplicates(["patient_id", "sample_date"])
    first_pos = pos[pos.groupby("patient_id").sample_date.shift().isna()]
    first_pos = first_pos[first_pos.sample_date >= start12]
    new_rows.append(first_pos.assign(phenotype=ph)[["patient_id", "sample_date", "ward_code", "phenotype"]])
new = pd.concat(new_rows)
v = cultures[["patient_id", "sample_date", "ward_code"]].merge(new, on="patient_id", suffixes=("", "_f"))
v = v[(v.sample_date < v.sample_date_f) & (v.sample_date >= v.sample_date_f - pd.Timedelta(days=30))
      & (v.ward_code != v.ward_code_f)]
raw_moves = sorted((f, t, ph, int(n)) for (f, t, ph), n in
                   v.groupby(["ward_code", "ward_code_f", "phenotype"]).patient_id.nunique().items())
sp = api("spread", window="12m")
check("spread 12 m: new carriers", new.patient_id.nunique(), sp["new_carriers"])
check("spread 12 m: were on another ward first", v.patient_id.nunique(), sp["moved"])
check("spread 12 m: every movement (from, to, type, patients)", raw_moves,
      sorted((m["from_ward"], m["to_ward"], m["phenotype"], m["patients"]) for m in sp["movements"]))

# 10. Resistance by home area, last 12 months (first isolates in the window)
w12 = first_in_window(start12, end12)
areas = {a["home_area"]: a for a in api("home-areas", window="12m")["areas"]}
for area, g in sorted(w12.groupby("home_area"), key=lambda kv: -len(kv[1]))[:2]:
    check(f"home area {area}, 12 m: first isolates", len(g), areas[area]["first_isolates"])
    check(f"home area {area}, 12 m: ESBL cases/n", rate(g, ESBL_BASE, "esbl"),
          (areas[area]["esbl"]["cases"], areas[area]["esbl"]["n"]))

# 11. Weekly summary: the same 7-day findings as the worklist, and results flagged in those 7 days
wk = api("weekly")
check("weekly summary: findings by carrier status", raw_counts,
      pd.Series([f["status"] for f in wk["findings"]], dtype=object).value_counts().to_dict())
week_ids = set(iso.loc[iso.sample_date >= latest - pd.Timedelta(days=6), "isolate_id"])
x_week = x[x.index.isin(week_ids)]
sa_w, eckp_w = x_week[x_week.organism == "Staphylococcus aureus"], x_week[x_week.organism.isin(ESBL_BASE)]
check("weekly summary: ceftriaxone-R without ESBL/CPE (confirm)",
      int(((eckp_w.CRO == "R") & (eckp_w.esbl != 1) & (eckp_w.cpe != 1)).sum()), wk["checks"]["confirm"])

# Custom date range (date filter): each patient's organism counts once within the chosen dates
for start, end in [("2026-01-01", "2026-03-31"), ("2024-10-01", "2025-09-30")]:
    w = first_in_window(start, end)
    k = api("overview", date_from=start, date_to=end)["kpis"]
    check(f"custom dates {start} to {end}: first isolates", len(w), k["first_isolates"])
    check(f"custom dates {start} to {end}: MRSA cases/n", rate(w, MRSA_BASE, "mrsa"), (k["mrsa"]["cases"], k["mrsa"]["n"]))

# ---------- Report ----------
width = max(len(r[0]) for r in rows)
print(f"Data checked: {RAW.relative_to(ROOT)}\n")
for name, raw_value, app_value, ok in rows:
    print(f"{'OK  ' if ok else 'FAIL'} {name:<{width}}  raw={raw_value}  app={app_value}")
failed = sum(not r[3] for r in rows)
print(f"\n{len(rows) - failed}/{len(rows)} numbers match the raw data.")
sys.exit(1 if failed else 0)
