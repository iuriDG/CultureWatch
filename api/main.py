"""CultureWatch JSON API for the TypeScript UI (web/).
Thin layer on purpose: every number comes from cw_utils / antibiogram / treatment_guide / hospital_trends,
so every view shows the same numbers.
Run from the CultureWatch folder:  uvicorn api.main:app --reload --port 8000"""
import json
import re
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Literal, NamedTuple

import pandas as pd
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

import cw_utils as cw
import antibiogram as ab
import treatment_guide as tg
import hospital_trends as ht
from api import importer

app = FastAPI(title="CultureWatch API")

# Browser security headers for every response. The strict content policy is skipped on the API docs pages,
# which load their own scripts from a CDN.
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
       "connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    if not request.url.path.startswith(("/docs", "/redoc", "/openapi.json")):
        response.headers.setdefault("Content-Security-Policy", CSP)
    return response

PHENOTYPES = ["esbl", "mrsa", "vre", "cpe"]
RARE = ["cpe", "vre"]  # so rare that a single case needs infection-control action, cluster or not
PHENOTYPE_BASE = {  # organisms a phenotype % is calculated over (VRE/CPE are reported as case counts)
    "esbl": ["Escherichia coli", "Klebsiella pneumoniae"],
    "mrsa": ["Staphylococcus aureus"],
}
Window = Literal["4w", "12m"]
Setting = Literal["community", "inpatient", "hospital_onset"]


# ---------- Data (loaded once per process) ----------
class Data(NamedTuple):
    ast: pd.DataFrame      # susceptibility rows, first isolates per surveillance year (preprocess.py rule)
    iso: pd.DataFrame      # isolates, first isolates per surveillance year
    ast_all: pd.DataFrame  # every susceptibility row: rolling windows apply the first-isolate rule themselves
    iso_all: pd.DataFrame  # every isolate (also carrier history)
    wards: pd.DataFrame
    abx: pd.DataFrame


@lru_cache(maxsize=1)
def data() -> Data:
    ast_all = cw.load_ast(first_only=False)
    iso_all = ht.load_all_isolates()
    iso_all["age_group"] = pd.cut(iso_all.age_years, cw.AGE_BINS, right=False, labels=cw.AGE_LABELS)
    wards = pd.read_csv(importer.raw_dir() / "wards.csv")  # code lists follow an applied import
    abx = pd.read_csv(importer.raw_dir() / "antibiotics.csv")
    return Data(ast_all[ast_all.first_isolate].copy(), iso_all[iso_all.first_isolate].copy(), ast_all, iso_all, wards, abx)


def latest():
    return data().ast.sample_date.max()


# ---------- Time machine: the data as it looked on a given day ----------
class Snap(NamedTuple):
    ast: pd.DataFrame
    iso: pd.DataFrame
    ast_all: pd.DataFrame
    iso_all: pd.DataFrame
    latest: pd.Timestamp


@lru_cache(maxsize=6)
def _snapshot(as_of: str):
    d, end = data(), pd.Timestamp(as_of)
    # Safe to cut: the first-isolate flag only depends on earlier samples, never later ones.
    return tuple(df[df.sample_date <= end] for df in (d.ast, d.iso, d.ast_all, d.iso_all))


def snap(as_of: date | None = None) -> Snap:
    """Shared dependency. With ?as_of=YYYY-MM-DD every endpoint sees only samples up to that day,
    so rolling windows, baselines and alerts are exactly what the app would have shown then."""
    d = data()
    if as_of is None:
        return Snap(d.ast, d.iso, d.ast_all, d.iso_all, latest())
    lo, hi = d.ast.sample_date.min().date(), latest().date()
    if not lo <= as_of <= hi:
        raise HTTPException(422, f"as_of must be between {lo} and {hi}")
    return Snap(*_snapshot(as_of.isoformat()), pd.Timestamp(as_of))


def select(s: Snap, kind: Literal["ast", "iso"], f: dict) -> pd.DataFrame:
    """Rows for the filters f. In a rolling window (date_from/date_to) the first-isolate rule is applied within
    the window (CLSI M39), so each patient's organism counts once in it; otherwise it is the per-surveillance-year
    rule from preprocess.py."""
    if f.get("date_from") is not None:
        rest = {k: v for k, v in f.items() if k not in ("date_from", "date_to")}
        return cw.window_view(s.ast_all if kind == "ast" else s.iso_all, f["date_from"], f["date_to"], **rest)
    return cw.apply_filters(s.ast if kind == "ast" else s.iso, **f)


def records(df):
    """DataFrame -> list of dicts with NaN as null and ISO dates."""
    return json.loads(df.to_json(orient="records", date_format="iso"))


def custom_range(date_from: date | None, date_to: date | None, s: Snap):
    """A custom date range, both days included, cut to the data the (time machine) date can see.
    None when no dates are given."""
    if date_from is None and date_to is None:
        return None
    start = pd.Timestamp(date_from) if date_from else data().ast.sample_date.min()
    end = min(pd.Timestamp(date_to), s.latest) if date_to else s.latest
    if start > end:
        raise HTTPException(422, "The start date must be on or before the end date (and the time machine date).")
    return start, end


def filter_params(period: str | None = None, specimen: str | None = None, setting: Setting | None = None,
                  ward: str | None = None, sex: Literal["F", "M"] | None = None,
                  age_group: str | None = None, window: Window | None = None,
                  date_from: date | None = None, date_to: date | None = None,
                  s: Snap = Depends(snap)) -> dict:
    """Shared query parameters. `window` is a rolling period (last 4 weeks / 12 months) ending at the latest
    sample; date_from / date_to is a custom range. The UI sends one of window, period or a custom range.
    Both windows and custom ranges count each patient's organism once within the range (see select)."""
    f = dict(period=period, specimen=specimen, setting=setting, ward=ward, sex=sex, age_group=age_group)
    if (rng := custom_range(date_from, date_to, s)) is not None:
        f["date_from"], f["date_to"] = rng
    elif window:
        f["date_from"], f["date_to"] = cw.window_dates(s.latest, window)
    return f


def without(filters, *keys):
    return {**filters, **{k: None for k in keys}}


def phenotype_rate(iso, phenotype):
    """Share of the base organisms carrying the phenotype, with the 30-isolate rule."""
    base = iso[iso.organism.isin(PHENOTYPE_BASE[phenotype])]
    k, n = int(base[phenotype].sum()), len(base)
    lo, hi = cw.wilson_ci(k, n) if n else (None, None)
    ok = n >= cw.MIN_ISOLATES
    return dict(cases=k, n=n, pct=k / n if ok else None,
                ci_low=float(lo) if ok else None, ci_high=float(hi) if ok else None)


# ---------- Endpoints ----------
@app.get("/api/meta")
def meta():
    """Everything the UI needs to build its filter controls and labels."""
    d = data()
    ast, wards, abx = d.ast, d.wards, d.abx
    end = latest()
    return dict(
        wards=records(wards),
        antibiotics=records(abx),
        ab_order=ab.AB_ORDER,
        urine_only=sorted(ab.URINE_ONLY),
        periods=sorted(ast.period.unique()),
        organisms=sorted(ast.organism.unique()),
        specimens=sorted(ast.specimen.unique()),
        age_groups=cw.AGE_LABELS,
        scenarios=[dict(name=k, target=v["target"]) for k, v in tg.SCENARIOS.items()],
        date_min=ast.sample_date.min().date().isoformat(),
        date_max=end.date().isoformat(),
        windows={w: [d.date().isoformat() for d in cw.window_dates(end, w)] for w in cw.WINDOWS},
        min_isolates=cw.MIN_ISOLATES,
        key_pairs=[dict(organism=o, antibiotic_code=a) for o, a in ht.KEY_PAIRS],
        # Time machine: week-ending Sundays from the first week with a full 52+4 week alert baseline
        replay_weeks=[d.date().isoformat() for d in pd.date_range(
            ast.sample_date.min() + pd.Timedelta(weeks=56), end, freq="W-SUN")],
    )


@lru_cache(maxsize=1)
def ward_visits():
    return ht.load_ward_visits(importer.raw_dir() / "cultures.csv")


@app.get("/api/findings")
def findings(days: int = 7, phenotype: Literal["esbl", "mrsa", "vre", "cpe"] | None = None,
             ward: str | None = None, date_from: date | None = None, date_to: date | None = None,
             s: Snap = Depends(snap)):
    """Resistant-findings worklist for the infection unit: the last `days` days up to the (time machine) date,
    each finding classed new / known / re-positive carrier. Carrier history uses every isolate, not first isolates."""
    if (rng := custom_range(date_from, date_to, s)) is not None:
        start, end = rng
    elif not 1 <= days <= 366:
        raise HTTPException(422, "days must be between 1 and 366")
    else:
        end = s.latest
        start = end - pd.Timedelta(days=days - 1)
    f = ht.carrier_findings(data().iso_all, start, end, phenotypes=[phenotype] if phenotype else PHENOTYPES)
    if ward:
        f = f[f.ward_code == ward]
    f = ht.add_recent_wards(f, ward_visits()[lambda v: v.sample_date <= end])
    data_start = data().ast.sample_date.min()
    return dict(start=start.date().isoformat(), end=end.date().isoformat(),
                history_complete=bool((start - data_start).days >= ht.CARRIER_MEMORY_DAYS),
                findings=records(f.assign(sample_date=f.sample_date.dt.date.astype(str),
                                          prev_date=f.prev_date.dt.date.astype(str).where(f.prev_date.notna()))))


@app.get("/api/spread")
def spread(window: Literal["4w", "12m", "all"] = "12m", phenotype: Literal["esbl", "mrsa", "vre", "cpe"] | None = None,
           date_from: date | None = None, date_to: date | None = None, s: Snap = Depends(snap)):
    """Where new carriers had been in the 30 days before their finding: ward-to-ward movements in the period
    (a rolling window, or a custom date range)."""
    if (rng := custom_range(date_from, date_to, s)) is not None:
        start, end = rng
    else:
        end = s.latest
        start = cw.window_dates(end, window)[0] if window != "all" else data().iso_all.sample_date.min()
    f = ht.carrier_findings(data().iso_all, start, end, phenotypes=[phenotype] if phenotype else PHENOTYPES)
    f = ht.add_recent_wards(f, ward_visits()[lambda v: v.sample_date <= end])
    new = f[f.status == "new"]
    return dict(start=pd.Timestamp(start).date().isoformat(), end=end.date().isoformat(),
                new_carriers=int(new.patient_id.nunique()),
                moved=int(new[new.recent_wards.str.len() > 0].patient_id.nunique()),
                movements=records(ht.carrier_movements(f)))


@app.get("/api/home-areas")
def home_areas(f: dict = Depends(filter_params), s: Snap = Depends(snap)):
    """Resistance by the patient's home area (first isolates), with the 30-isolate rule."""
    iso = select(s, "iso", f)
    out = []
    for area, g in iso.groupby("home_area"):
        out.append(dict(home_area=area, first_isolates=len(g), esbl=phenotype_rate(g, "esbl"),
                        mrsa=phenotype_rate(g, "mrsa"), vre_cases=int(g.vre.sum()), cpe_cases=int(g.cpe.sum())))
    return dict(areas=sorted(out, key=lambda r: -r["first_isolates"]))


@app.get("/api/weekly")
def weekly(s: Snap = Depends(snap)):
    """One-page summary of the latest 7 days for the infection unit: new carriers and wards on alert now."""
    end = s.latest
    start = end - pd.Timedelta(days=6)
    f = ht.carrier_findings(data().iso_all, start, end, phenotypes=PHENOTYPES)
    f = ht.add_recent_wards(f, ward_visits()[lambda v: v.sample_date <= end])
    on_alert = []
    for ph in PHENOTYPES:
        st = ht.current_status(ht.weekly_counts(s.iso, ph))
        on_alert += [dict(r, phenotype=ph) for r in records(st[st.alert])]
    return dict(start=start.date().isoformat(), end=end.date().isoformat(),
                findings=records(f.assign(sample_date=f.sample_date.dt.date.astype(str),
                                          prev_date=f.prev_date.dt.date.astype(str).where(f.prev_date.notna()))),
                alerts=on_alert)


@app.get("/api/alert-timeline")
@lru_cache(maxsize=1)
def alert_timeline():
    """Every cluster alert ever raised (all phenotypes, all wards), for the time machine's markers.
    Uses all data on purpose: the timeline is the answer key the replay walks through."""
    iso = data().iso
    rows = []
    for ph in PHENOTYPES:
        a = ht.detect_clusters(ht.weekly_counts(iso, ph))
        rows += [dict(phenotype=ph, week_end=r.window_end[11:21], ward_code=r.ward_code, observed=int(r.observed),
                      expected=float(r.expected), p_value=float(r.p_value)) for r in a.itertuples()]
    return sorted(rows, key=lambda r: r["week_end"])


@app.get("/api/overview")
def overview(f: dict = Depends(filter_params), s: Snap = Depends(snap)):
    ast = s.ast
    f_iso = select(s, "iso", f)
    kpis = dict(first_isolates=len(f_iso), esbl=phenotype_rate(f_iso, "esbl"), mrsa=phenotype_rate(f_iso, "mrsa"),
                vre_cases=int(f_iso.vre.sum()), cpe_cases=int(f_iso.cpe.sum()))
    mix = f_iso.organism.value_counts().rename_axis("organism").reset_index(name="n")

    # Biggest changes: same pairs and rules as hospital_trends.py, previous vs latest surveillance year
    by_year = cw.resistance_table(cw.apply_filters(ast, **without(f, "period", "date_from", "date_to")),
                                  by=["period", "organism", "antibiotic_code"])
    years = sorted(by_year.period.unique())
    changes = []
    if len(years) >= 2:
        prev, last = years[-2], years[-1]
        wide = (by_year[by_year.reportable & by_year.period.isin([prev, last])]
                .pivot_table(index=["organism", "antibiotic_code"], columns="period", values="pct_resistant")
                .dropna())
        if {prev, last} <= set(wide.columns) and len(wide):
            wide = wide.rename(columns={prev: "pct_prev", last: "pct_last"})
            wide["change_pp"] = (wide.pct_last - wide.pct_prev) * 100
            top = wide.reindex(wide.change_pp.abs().sort_values(ascending=False).index).head(8)
            changes = records(top.reset_index())
    return dict(kpis=kpis, organism_mix=records(mix), changes=changes,
                change_periods=years[-2:] if len(years) >= 2 else [])


@app.get("/api/antibiogram")
def antibiogram(f: dict = Depends(filter_params), s: Snap = Depends(snap)):
    t = cw.resistance_table(select(s, "ast", f))
    t["pct_resistant"] = t.pct_resistant.where(t.reportable)
    t[["ci_low", "ci_high"]] = t[["ci_low", "ci_high"]].where(t.reportable, axis=0)
    cols = [a for a in ab.AB_ORDER if a in set(t.antibiotic_code)]
    orgs = t.groupby("organism").n_tested.max().sort_values(ascending=False).index.tolist()
    return dict(antibiotics=cols, organisms=orgs, cells=records(t))


@app.get("/api/treatment")
def treatment(scenario: str, target: float | None = None, f: dict = Depends(filter_params),
              s: Snap = Depends(snap)):
    """Coverage per regimen for a preset scenario, or scenario='custom' to use the shared filters."""
    preset = tg.SCENARIOS.get(scenario)
    if preset is None and scenario != "custom":
        raise HTTPException(404, f"Unknown scenario {scenario!r}")
    target = target if target is not None else (preset["target"] if preset else 0.85)
    rows = select(s, "ast", preset["filters"] if preset else f)
    cov = tg.coverage_table(rows, target=target)
    n = int(cov.n_isolates.iloc[0]) if len(cov) else 0
    mix = tg.organism_mix(rows).rename_axis("organism").reset_index()
    pick = tg.recommend(cov) if n >= cw.MIN_ISOLATES else None
    return dict(scenario=scenario, target=target, n_isolates=n, reportable=n >= cw.MIN_ISOLATES,
                recommended=pick, single=records(cov[cov.n_drugs == 1]),
                combos=records(cov[cov.n_drugs == 2].head(10)), organism_mix=records(mix))


@app.get("/api/hospital-vs-community")
def hospital_vs_community(f: dict = Depends(filter_params), s: Snap = Depends(snap)):
    return records(ht.compare_settings(select(s, "ast", without(f, "setting"))))


@app.get("/api/ward-profile")
def ward_profile(f: dict = Depends(filter_params), s: Snap = Depends(snap)):
    wp = ht.ward_profile(select(s, "iso", without(f, "ward", "setting")))
    return records(wp.reset_index())


@app.get("/api/trend")
def trend(organism: str, antibiotic: str, f: dict = Depends(filter_params), s: Snap = Depends(snap)):
    """Quarterly resistance for one pair. Time filters are ignored: this view shows all time."""
    f = without(f, "period", "date_from", "date_to")
    t = ht.trend_table(s.ast, organism, antibiotic, **f)
    quarters = sorted(ht.add_quarter(cw.apply_filters(s.ast, **f)).quarter.unique())
    t["x"] = [quarters.index(q) for q in t.quarter]  # position on the shared quarter axis
    projection = ht.project_trend(t, quarters, end=s.latest) if len(t) >= 2 else None
    return dict(points=records(t), z=float(t.attrs["z"]), p_value=float(t.attrs["p_value"]),
                direction=t.attrs["direction"], quarters=quarters, limit=ht.EMPIRICAL_LIMIT, projection=projection)


@app.get("/api/expiry")
def expiry(f: dict = Depends(filter_params), s: Snap = Depends(snap)):
    """Guideline expiry watch: pairs whose resistance is rising towards or past the 20% empirical-use limit,
    with the projected crossing date. Time filters are ignored (the trend uses every quarter)."""
    w, quarters = ht.expiry_watch(s.ast, end=s.latest, **without(f, "period", "date_from", "date_to"))
    order = {"crossing": 0, "crossed": 1, "rising": 2, "above": 3, "improving": 4, "stable": 5}
    w = w.assign(_o=w.status.map(order), tier=w.antibiotic_code.map(tg.TIERS).fillna(2).astype(int))
    w = w.sort_values(["_o", "months_left", "p_value"]).drop(columns="_o")
    return dict(limit=ht.EMPIRICAL_LIMIT, quarters=quarters, as_of=s.latest.date().isoformat(), pairs=records(w))


@app.get("/api/trend-summary")
def trend_summary(f: dict = Depends(filter_params), s: Snap = Depends(snap)):
    return records(ht.trend_summary(s.ast, **without(f, "period", "date_from", "date_to")))


@app.get("/api/alerts")
def alerts(phenotype: Literal["esbl", "mrsa", "vre", "cpe"] = "mrsa", specimen: str | None = None,
           s: Snap = Depends(snap)):
    """Cluster alerts over all wards and dates (only the specimen filter applies), plus weekly counts."""
    iso = s.iso
    counts = ht.weekly_counts(cw.apply_filters(iso, specimen=specimen), phenotype)
    return dict(alerts=records(ht.detect_clusters(counts)),
                status=records(ht.current_status(counts)),
                weeks=[str(w) for w in counts.columns],
                counts={w: [int(x) for x in row] for w, row in counts.iterrows()})


@app.get("/api/ward/{code}")
def ward_view(code: str, specimen: str | None = None, s: Snap = Depends(snap)):
    """Own-ward page: last 4 weeks vs the ward's normal, rolling 12 months vs the year before and vs all sites."""
    if code not in set(data().wards.ward_code):
        raise HTTPException(404, f"Unknown ward {code!r}")
    return _ward_view(code, specimen or None, s.latest.date().isoformat())


def _with_ward(counts, code):
    """Weekly counts with a row for `code` even when the ward has no isolates of this specimen type (all zeros),
    e.g. a health centre and blood cultures: the page then shows zeros instead of failing."""
    return counts if code in counts.index else counts.reindex([*counts.index, code], fill_value=0)


@lru_cache(maxsize=512)
def _ward_view(code: str, specimen: str | None, as_of: str):
    """Cached per ward, specimen and date: the replay revisits the same weeks. Cleared when data is imported."""
    s = snap(date.fromisoformat(as_of)) if as_of != latest().date().isoformat() else snap()
    wards = data().wards
    end = s.latest
    w12, prev12 = cw.window_dates(end, "12m"), cw.window_dates(end, "12m", offset=1)
    w4 = cw.window_dates(end, "4w")

    # --- Last 4 weeks: new cases per phenotype vs this ward's previous 52 weeks (same test as alerts)
    s_iso = cw.apply_filters(s.iso, specimen=specimen)  # alert counts: first isolates per year (new cases)
    four_weeks = []
    for ph in PHENOTYPES:
        counts = _with_ward(ht.weekly_counts(s_iso, ph), code)
        st = ht.current_status(counts).set_index("ward_code").loc[code]
        four_weeks.append(dict(phenotype=ph, observed=int(st.observed), expected=float(st.expected),
                               p_value=float(st.p_value), alert=bool(st.alert),
                               weekly=[int(x) for x in counts.loc[code].values[-26:]],
                               history=records(ht.detect_clusters(counts).query("ward_code == @code"))))
    all_counts = _with_ward(s_iso.assign(flag=1).pipe(ht.weekly_counts, "flag"), code)
    st = ht.current_status(all_counts).set_index("ward_code").loc[code]
    isolates_4w = dict(observed=int(st.observed), expected=float(st.expected),
                       weekly=[int(x) for x in all_counts.loc[code].values[-26:]])
    weeks = [str(w) for w in all_counts.columns[-26:]]
    # Samples sent (every culture, negative ones too) on the same weeks and test: more testing finds more cases
    vis = ward_visits()
    vis = vis[(vis.ward_code == code) & (vis.sample_date <= end) & ((vis.specimen == specimen) if specimen else True)]
    sent = vis.sample_date.dt.to_period("W-SUN").value_counts().reindex(all_counts.columns, fill_value=0)
    observed, expected, _ = ht.window_test(sent.values, len(sent))
    samples_4w = dict(observed=observed, expected=expected, weekly=[int(x) for x in sent.values[-26:]])

    # --- Rolling 12 months: phenotype rates and ward antibiogram, vs previous 12 months and vs all sites
    def rates(df):
        return {ph: phenotype_rate(df, ph) for ph in PHENOTYPE_BASE}

    ward_12 = cw.window_view(s.iso_all, *w12, specimen=specimen, ward=code)
    rates_12 = dict(ward=rates(ward_12),
                    ward_prev=rates(cw.window_view(s.iso_all, *prev12, specimen=specimen, ward=code)),
                    all_sites=rates(cw.window_view(s.iso_all, *w12, specimen=specimen)))
    # Annual anomaly tests (only where both sides pass the 30-isolate rule):
    # p_change = ward vs its previous 12 months, p_above = ward above the all-sites rate
    tests = {}
    for ph in PHENOTYPE_BASE:
        c, p, a = rates_12["ward"][ph], rates_12["ward_prev"][ph], rates_12["all_sites"][ph]
        tests[ph] = dict(
            p_change=ht.rate_change_p(c["cases"], c["n"], p["cases"], p["n"]) if c["pct"] is not None and p["pct"] is not None else None,
            p_above=ht.above_rate_p(c["cases"], c["n"], a["cases"] / a["n"]) if c["pct"] is not None and a["pct"] is not None else None)
    rates_12["tests"] = tests

    def rt(**kw):
        return cw.resistance_table(select(s, "ast", dict(specimen=specimen, **kw))).set_index(
            ["organism", "antibiotic_code"])

    cur, prev = rt(ward=code, date_from=w12[0], date_to=w12[1]), rt(ward=code, date_from=prev12[0], date_to=prev12[1])
    all_sites = rt(date_from=w12[0], date_to=w12[1])
    cols = ["n_tested", "n_resistant", "pct_resistant", "reportable"]
    pairs = cur[~cur.intrinsic][cols + ["ci_low", "ci_high"]].join(
        prev[cols].add_suffix("_prev")).join(all_sites[cols].add_suffix("_all"))
    for col in ["", "_prev", "_all"]:
        pairs[f"pct_resistant{col}"] = pairs[f"pct_resistant{col}"].where(pairs[f"reportable{col}"] == True)
    pairs["change_pp"] = (pairs.pct_resistant - pairs.pct_resistant_prev) * 100
    pairs["vs_all_pp"] = (pairs.pct_resistant - pairs.pct_resistant_all) * 100
    pairs["p_change"] = [ht.rate_change_p(r.n_resistant, r.n_tested, r.n_resistant_prev, r.n_tested_prev)
                         if pd.notna(r.change_pp) else None for r in pairs.itertuples()]
    pairs["p_above"] = [ht.above_rate_p(r.n_resistant, r.n_tested, r.pct_resistant_all)
                        if pd.notna(r.vs_all_pp) else None for r in pairs.itertuples()]
    pairs = pairs.sort_values("n_tested", ascending=False).reset_index()

    info = wards.set_index("ward_code").loc[code]
    return dict(
        ward=dict(code=code, name_en=info.ward_en, name_fi=info.ward_fi, ward_type=info.ward_type,
                  institution=info.institution),
        latest=end.date().isoformat(),
        windows={"4w": [d.date().isoformat() for d in w4], "12m": [d.date().isoformat() for d in w12],
                 "12m_prev": [d.date().isoformat() for d in prev12]},
        four_weeks=dict(weeks=weeks, isolates=isolates_4w, samples=samples_4w, phenotypes=four_weeks),
        twelve_months=dict(first_isolates=len(ward_12),
                           hospital_onset_share=float(ward_12.hospital_onset.mean()) if len(ward_12) else None,
                           rates=rates_12,
                           organism_mix=records(ward_12.organism.value_counts().rename_axis("organism")
                                                .reset_index(name="n")),
                           pairs=records(pairs),
                           intrinsic=[list(ix) for ix in cur[cur.intrinsic].index]),
    )


@app.get("/api/now")
def now(s: Snap = Depends(snap)):
    """Front page for the whole hospital: every ward's last 4 weeks at a glance (cluster alerts, new carriers,
    any CPE or VRE finding) and the first-line antibiotics past the 20% limit."""
    return _now(s.latest.date().isoformat())


@lru_cache(maxsize=64)
def _now(as_of: str):
    s = snap(date.fromisoformat(as_of)) if as_of != latest().date().isoformat() else snap()
    end = s.latest
    start = cw.window_dates(end, "4w")[0]
    status = {ph: ht.current_status(ht.weekly_counts(s.iso, ph)).set_index("ward_code") for ph in PHENOTYPES}
    f = ht.carrier_findings(data().iso_all, start, end, phenotypes=PHENOTYPES)
    wards = []
    for code in data().wards.ward_code:
        alerts = [dict(phenotype=ph, observed=int(st.observed), expected=float(st.expected), p_value=float(st.p_value))
                  for ph in PHENOTYPES if code in status[ph].index
                  for st in [status[ph].loc[code]] if st.alert]
        fw = f[f.ward_code == code]
        wards.append(dict(ward_code=code, alerts=alerts, findings=len(fw),
                          new_carriers={ph: int(((fw.phenotype == ph) & (fw.status == "new")).sum()) for ph in PHENOTYPES},
                          rare=[dict(phenotype=r.phenotype, status=r.status, sample_date=r.sample_date.date().isoformat())
                                for r in fw[fw.phenotype.isin(RARE)].itertuples()]))
    exp, _ = ht.expiry_watch(s.ast, end=end)
    exp = exp[exp.status.isin(["crossed", "crossing"])].sort_values(["status", "months_left"])
    return dict(latest=end.date().isoformat(), window=[start.date().isoformat(), end.date().isoformat()],
                wards=wards, expiry=records(exp[["organism", "antibiotic_code", "status", "cross_date", "months_left"]]))


# ---------- CSV import (lab exports) ----------
LOCAL = {"127.0.0.1", "::1", "localhost"}
MAX_UPLOAD = 200 * 1024 * 1024  # bytes per uploaded file


def local_only(request: Request):
    """Changing data is only allowed from the app itself, on the computer running CultureWatch:
    - never through the public tunnel (cloudflared adds a cf-connecting-ip header to every public request);
    - only from a loopback address, sent to a localhost host name (blocks DNS-rebinding web pages);
    - only with the app's own X-CultureWatch header: other web sites cannot add it without a CORS preflight,
      which this API never grants (blocks cross-site request forgery from any open browser tab)."""
    client = request.client.host if request.client else ""
    host = (request.headers.get("host") or "").rsplit(":", 1)[0].strip("[]")
    if (request.headers.get("cf-connecting-ip") or client not in LOCAL or host not in LOCAL
            or request.headers.get("x-culturewatch") != "1"):
        raise HTTPException(403, "Import is only available on the computer running CultureWatch.")


def reload_data():
    for cached in (data, _snapshot, ward_visits, _ward_view, alert_timeline, _search_index, _now):
        cached.cache_clear()


@app.get("/api/import/status")
def import_status(request: Request):
    try:
        local_only(request)
        can_import = True
    except HTTPException:
        can_import = False
    return {**importer.status(), "can_import": can_import, "tables": importer.TABLES, "required": importer.REQUIRED}


@app.get("/api/import/template/{table}")
def import_template(table: str):
    if table not in importer.TABLES:
        raise HTTPException(404, f"Unknown table {table!r}")
    return Response(importer.template(table), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{table}.csv"'})


@app.put("/api/import/staging/{table}", dependencies=[Depends(local_only)])
async def import_stage(table: str, request: Request):
    """Upload one CSV file (the request body) as `table`."""
    body = await request.body()
    if len(body) > MAX_UPLOAD:
        raise HTTPException(413, f"File too large (max {MAX_UPLOAD // 2**20} MB).")
    try:
        return importer.stage(table, body)
    except importer.ImportProblem as e:
        raise HTTPException(422, str(e))


@app.delete("/api/import/staging", dependencies=[Depends(local_only)])
def import_clear():
    importer.clear_staging()
    return importer.status()


@app.post("/api/import/check", dependencies=[Depends(local_only)])
def import_check(mode: Literal["append", "replace"] = "append"):
    return importer.check(mode)[0]


@app.post("/api/import/apply", dependencies=[Depends(local_only)])
def import_apply(mode: Literal["append", "replace"] = "append"):
    report = importer.apply(mode)
    if report.get("applied"):
        reload_data()
    return report


@app.post("/api/import/reset", dependencies=[Depends(local_only)])
def import_reset():
    importer.reset()
    reload_data()
    return importer.status()


# ---------- Quick search: instant answers for a ward, bacterium, antibiotic, resistance type or patient ----------
@lru_cache(maxsize=4)
def _search_index(as_of: str):
    """Everything the quick search answers from, built once per (time machine) date with the same functions as
    the views: last-12-month resistance per pair and per ward, current 4-week alerts, guideline expiry."""
    d = data()
    s = snap(None if as_of == latest().date().isoformat() else date.fromisoformat(as_of))
    w12 = cw.window_dates(s.latest, "12m")
    pairs = cw.resistance_table(cw.window_view(s.ast_all, *w12)).set_index(["organism", "antibiotic_code"])
    iso12 = cw.window_view(s.iso_all, *w12)
    wards = {}
    for code in d.wards.ward_code:
        wi = iso12[iso12.ward_code == code]
        wards[code] = dict(first_isolates=len(wi), mrsa=phenotype_rate(wi, "mrsa"), esbl=phenotype_rate(wi, "esbl"), alerts=[])
    phenotypes = {}
    for ph in PHENOTYPES:
        st = ht.current_status(ht.weekly_counts(s.iso, ph))
        on = st[st.alert].ward_code.tolist()
        for code in on:
            wards[code]["alerts"].append(ph)
        phenotypes[ph] = dict(alert_wards=on, cases_4w=int(st.observed.sum()))
    exp, _ = ht.expiry_watch(s.ast, end=s.latest)
    expiry = exp.set_index(["organism", "antibiotic_code"])
    organisms = iso12.organism.value_counts()
    return dict(s=s, pairs=pairs, wards=wards, phenotypes=phenotypes, expiry=expiry, organisms=organisms)


def _norm(text: str) -> str:
    return re.sub(r"[^0-9a-zåäö]+", " ", str(text).lower()).strip()


def _pair_answer(ix, org, ab_code):
    row = ix["pairs"].loc[(org, ab_code)] if (org, ab_code) in ix["pairs"].index else None
    out = dict(kind="pair", organism=org, antibiotic_code=ab_code, n=0, pct=None, intrinsic=False, status=None,
               cross_date=None, months_left=None)
    if row is not None:
        out.update(n=int(row.n_tested), intrinsic=bool(row.intrinsic),
                   pct=float(row.pct_resistant) if row.reportable else None)
    if (org, ab_code) in ix["expiry"].index:
        e = ix["expiry"].loc[(org, ab_code)]
        if e.status in ("crossing", "crossed", "rising"):
            out.update(status=e.status, cross_date=e.cross_date if isinstance(e.cross_date, str) else None,
                       months_left=float(e.months_left) if pd.notna(e.months_left) else None)
    return out


def _top_resistance(ix, organism=None, antibiotic=None, k=2):
    t = ix["pairs"].reset_index()
    t = t[t.reportable & ~t.intrinsic]
    t = t[t.organism == organism] if organism else t[t.antibiotic_code == antibiotic]
    t = t.sort_values("pct_resistant", ascending=False).head(k)
    return [dict(organism=r.organism, antibiotic_code=r.antibiotic_code, pct=float(r.pct_resistant)) for r in t.itertuples()]


@app.get("/api/search")
def search(q: str, s: Snap = Depends(snap)):
    """Match a free-text query to wards, bacteria, antibiotics, resistance types, patients and answer each
    straight away (same numbers as the views; follows the time machine)."""
    q = q[:100]
    tokens = [t for t in _norm(q).split() if len(t) >= 2]
    ix = _search_index(s.latest.date().isoformat())
    d = data()
    results = []

    # Patient ID: P003612, p3612
    if (m := re.search(r"\bp\s?0*(\d{1,6})\b", q.lower())):
        pid = f"P{int(m.group(1)):06d}"
        visits = ward_visits()
        v = visits[(visits.patient_id == pid) & (visits.sample_date <= s.latest)].sort_values("sample_date")
        if len(v):
            mine = d.iso_all[(d.iso_all.patient_id == pid) & (d.iso_all.sample_date <= s.latest)]
            f = ht.carrier_findings(mine, mine.sample_date.min() if len(mine) else s.latest, s.latest) if len(mine) else mine
            last = v.iloc[-1]
            results.append(dict(kind="patient", patient_id=pid, samples=len(v), last_date=last.sample_date.date().isoformat(),
                                last_ward=last.ward_code,
                                findings=[dict(phenotype=r.phenotype, status=r.status, sample_date=r.sample_date.date().isoformat(),
                                               ward_code=r.ward_code) for r in f.head(3).itertuples()] if len(f) else []))

    def score(names):
        """How many query words match the start of a word in any of the names (or a whole short code)."""
        words = [w for n in names if n for w in _norm(n).split()]
        return sum(1 for t in tokens if any(w == t or (len(t) >= 3 and w.startswith(t)) for w in words))

    def best(scored, k):
        scored = sorted(scored, key=lambda x: -x[0])
        return [key for sc, key in scored if sc and sc == scored[0][0]][:k] if scored and scored[0][0] else []

    orgs = best([(score([o]), o) for o in ix["organisms"].index], 2)
    abx = best([(score([a.antibiotic_code, a.antibiotic, a.antibiotic_fi]), a.antibiotic_code) for a in d.abx.itertuples()], 2)

    if orgs and abx:
        results += [_pair_answer(ix, o, a) for o in orgs for a in abx][:3]
    elif orgs:
        results += [dict(kind="organism", organism=o, first_isolates=int(ix["organisms"].get(o, 0)),
                         top=_top_resistance(ix, organism=o)) for o in orgs]
    elif abx:
        results += [dict(kind="antibiotic", antibiotic_code=a, top=_top_resistance(ix, antibiotic=a)) for a in abx]

    for code in best([(score([w.ward_code, w.ward_en, w.ward_fi]), w.ward_code) for w in d.wards.itertuples()], 3):
        results.append(dict(kind="ward", ward_code=code, **ix["wards"][code]))

    for ph in PHENOTYPES:
        if ph in tokens:
            results.append(dict(kind="phenotype", phenotype=ph, **ix["phenotypes"][ph]))

    return dict(q=q, as_of=s.latest.date().isoformat(), results=results[:7])


# ---------- Serve the built web UI (web/dist) from the same origin, for sharing one public link ----------
# Mounted last so every /api route above takes precedence. Build it first: cd web && npm run build
WEB_DIST = Path(__file__).resolve().parent.parent / "web" / "dist"
if WEB_DIST.exists():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
