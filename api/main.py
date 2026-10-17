"""CultureWatch JSON API for the TypeScript UI (web/).
Thin layer on purpose: every number comes from cw_utils / antibiogram / treatment_guide / hospital_trends,
so every view shows the same numbers.
Run from the CultureWatch folder:  uvicorn api.main:app --reload --port 8000"""
import json
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
import result_checks as rc
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


@lru_cache(maxsize=1)
def checks_all():
    """Result checks on every isolate, once per data load (rules do not depend on the date)."""
    d = data()
    ev = rc.evaluate(d.iso_all, d.ast_all)
    info = d.iso_all[["isolate_id", "patient_id", "sample_date", "ward_code", "specimen", "organism"]]
    return ev.merge(info, on="isolate_id", how="left")


@app.get("/api/checks")
def checks(window: Window | None = None, ward: str | None = None, date_from: date | None = None,
           date_to: date | None = None, s: Snap = Depends(snap)):
    """Result checks before release: per rule how many isolates were checked and flagged in the period,
    and the flagged isolates. window=None means all data up to the (time machine) date."""
    ev = checks_all()
    rng = custom_range(date_from, date_to, s)
    end = rng[1] if rng else s.latest
    ev = ev[ev.sample_date <= end]
    start = rng[0] if rng else cw.window_dates(s.latest, window)[0] if window else ev.sample_date.min()
    ev = ev[ev.sample_date >= start]
    if ward:
        ev = ev[ev.ward_code == ward]
    flagged = ev[ev.flagged].sort_values(["sample_date", "isolate_id"], ascending=[False, True])
    return dict(start=pd.Timestamp(start).date().isoformat(), end=end.date().isoformat(),
                counts=rc.category_counts(ev), rules=records(rc.summary(ev)),
                flagged=records(flagged.assign(sample_date=flagged.sample_date.dt.date.astype(str))
                                .drop(columns=["flagged"])))


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
    """One-page summary of the latest 7 days for the infection unit: new carriers, wards on alert now,
    and results needing action before release."""
    end = s.latest
    start = end - pd.Timedelta(days=6)
    f = ht.carrier_findings(data().iso_all, start, end, phenotypes=PHENOTYPES)
    f = ht.add_recent_wards(f, ward_visits()[lambda v: v.sample_date <= end])
    on_alert = []
    for ph in PHENOTYPES:
        st = ht.current_status(ht.weekly_counts(s.iso, ph))
        on_alert += [dict(r, phenotype=ph) for r in records(st[st.alert])]
    ev = checks_all()
    ev = ev[(ev.sample_date >= start) & (ev.sample_date <= end) & ev.flagged]
    return dict(start=start.date().isoformat(), end=end.date().isoformat(),
                findings=records(f.assign(sample_date=f.sample_date.dt.date.astype(str),
                                          prev_date=f.prev_date.dt.date.astype(str).where(f.prev_date.notna()))),
                alerts=on_alert, checks=rc.category_counts(ev),
                checks_flagged=records(ev.assign(sample_date=ev.sample_date.dt.date.astype(str)).drop(columns=["flagged"])))


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
    return _ward_view(code, specimen, s.latest.date().isoformat())


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
        counts = ht.weekly_counts(s_iso, ph)
        st = ht.current_status(counts).set_index("ward_code").loc[code]
        four_weeks.append(dict(phenotype=ph, observed=int(st.observed), expected=float(st.expected),
                               p_value=float(st.p_value), alert=bool(st.alert),
                               weekly=[int(x) for x in counts.loc[code].values[-26:]],
                               history=records(ht.detect_clusters(counts).query("ward_code == @code"))))
    all_counts = s_iso.assign(flag=1).pipe(ht.weekly_counts, "flag")
    st = ht.current_status(all_counts).set_index("ward_code").loc[code]
    isolates_4w = dict(observed=int(st.observed), expected=float(st.expected),
                       weekly=[int(x) for x in all_counts.loc[code].values[-26:]])
    weeks = [str(w) for w in all_counts.columns[-26:]]

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
        four_weeks=dict(weeks=weeks, isolates=isolates_4w, phenotypes=four_weeks),
        twelve_months=dict(first_isolates=len(ward_12),
                           hospital_onset_share=float(ward_12.hospital_onset.mean()) if len(ward_12) else None,
                           rates=rates_12,
                           organism_mix=records(ward_12.organism.value_counts().rename_axis("organism")
                                                .reset_index(name="n")),
                           pairs=records(pairs)),
    )


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
    for cached in (data, _snapshot, ward_visits, checks_all, _ward_view, alert_timeline):
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


# ---------- Serve the built web UI (web/dist) from the same origin, for sharing one public link ----------
# Mounted last so every /api route above takes precedence. Build it first: cd web && npm run build
WEB_DIST = Path(__file__).resolve().parent.parent / "web" / "dist"
if WEB_DIST.exists():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
