"""Task 4: Hospital & Trends - hospital vs community, ward hotspots, trends over time, cluster alerts."""
import numpy as np
import pandas as pd
from scipy import stats
import cw_utils as cw

KEY_PAIRS = [  # clinically important organism-antibiotic pairs to monitor
    ("Escherichia coli", "CIP"), ("Escherichia coli", "CRO"), ("Escherichia coli", "TMP"),
    ("Escherichia coli", "MEC"), ("Klebsiella pneumoniae", "CRO"), ("Klebsiella pneumoniae", "CIP"),
    ("Klebsiella pneumoniae", "TZP"), ("Pseudomonas aeruginosa", "TZP"),
    ("Pseudomonas aeruginosa", "MEM"), ("Staphylococcus aureus", "FOX"),
]


def load_isolates(path=cw.PROCESSED / "isolates_joined.csv"):
    """First isolates with phenotype flags (ESBL/MRSA/VRE/CPE)."""
    iso = pd.read_csv(path, parse_dates=["sample_date"])
    return iso[iso.first_isolate].copy()


# ---------- 1. Hospital-onset vs community ----------
def compare_settings(ast, pairs=KEY_PAIRS, **filters):
    """Resistance in community (outpatients) vs hospital-onset (day 3+), with a significance test."""
    rows = []
    for org, ab in pairs:
        d = cw.apply_filters(ast, **filters)
        d = d[(d.organism == org) & (d.antibiotic_code == ab)]
        com, hosp = d[d.ward_type == "out"].resistant, d[d.hospital_onset == True].resistant
        if len(com) == 0 or len(hosp) == 0:
            continue
        table = [[com.sum(), len(com) - com.sum()], [hosp.sum(), len(hosp) - hosp.sum()]]
        p = stats.fisher_exact(table)[1]
        rows.append(dict(organism=org, antibiotic_code=ab,
                         n_community=len(com), pct_community=com.mean(),
                         n_hospital=len(hosp), pct_hospital=hosp.mean(),
                         diff_pp=(hosp.mean() - com.mean()) * 100, p_value=p))
    out = pd.DataFrame(rows, columns=["organism", "antibiotic_code", "n_community", "pct_community",
                                      "n_hospital", "pct_hospital", "diff_pp", "p_value"])
    # 30-isolate rule: hide % and test result when either group is too small
    small = (out.n_community < cw.MIN_ISOLATES) | (out.n_hospital < cw.MIN_ISOLATES)
    out.loc[small, ["pct_community", "pct_hospital", "diff_pp", "p_value"]] = np.nan
    out["significant"] = out.p_value < 0.05
    return out


def rate_change_p(k1, n1, k0, n0):
    """Two-sided Fisher's exact test: does k1/n1 differ from k0/n0? (same test as compare_settings)"""
    return float(stats.fisher_exact([[k1, n1 - k1], [k0, n0 - k0]])[1])


def above_rate_p(k, n, p0):
    """One-sided binomial test: is k/n above the reference rate p0? (same test as ward_profile)"""
    return float(stats.binomtest(int(k), int(n), p0, alternative="greater").pvalue)


# ---------- 2. Ward hotspots ----------
def ward_profile(iso):
    """Per ward: first isolates, hospital-onset share, ESBL %, MRSA %, VRE and CPE counts."""
    esbl_base = iso.organism.isin(["Escherichia coli", "Klebsiella pneumoniae"])
    mrsa_base = iso.organism == "Staphylococcus aureus"
    g = iso.groupby("ward_code")
    out = pd.DataFrame({
        "first_isolates": g.size(),
        "hospital_onset_share": g.hospital_onset.mean(),
        "esbl_n": iso[esbl_base].groupby("ward_code").esbl.sum(),
        "esbl_base": iso[esbl_base].groupby("ward_code").size(),
        "mrsa_n": iso[mrsa_base].groupby("ward_code").mrsa.sum(),
        "mrsa_base": iso[mrsa_base].groupby("ward_code").size(),
        "vre_n": g.vre.sum(), "cpe_n": g.cpe.sum(),
    }).fillna(0)
    out["esbl_pct"] = out.esbl_n / out.esbl_base
    out["mrsa_pct"] = out.mrsa_n / out.mrsa_base
    for ph in ["esbl", "mrsa"]:  # flag wards clearly above the hospital-wide rate
        overall = out[f"{ph}_n"].sum() / out[f"{ph}_base"].sum()
        out[f"{ph}_p_above"] = [stats.binomtest(int(k), int(n), overall, alternative="greater").pvalue if n else np.nan
                                for k, n in zip(out[f"{ph}_n"], out[f"{ph}_base"])]
        # 30-isolate rule: no % or test for wards with too few isolates in the base group
        small = out[f"{ph}_base"] < cw.MIN_ISOLATES
        out.loc[small, [f"{ph}_pct", f"{ph}_p_above"]] = np.nan
    return out.sort_values("esbl_pct", ascending=False)


# ---------- 3. Trends over time ----------
def add_quarter(df):
    return df.assign(quarter=df.sample_date.dt.to_period("Q").astype(str))


def trend_table(ast, organism, antibiotic, time_col="quarter", **filters):
    """Resistance per time step with CI, plus a Cochran-Armitage test for a linear trend."""
    d = add_quarter(cw.apply_filters(ast, **filters))
    d = d[(d.organism == organism) & (d.antibiotic_code == antibiotic)]
    t = cw.resistance_table(d, by=[time_col], min_n=1).sort_values(time_col)
    z, p = cochran_armitage(t.n_resistant.values, t.n_tested.values)
    t.attrs.update(organism=organism, antibiotic=antibiotic, z=z, p_value=p,
                   direction="increasing" if z > 0 else "decreasing")
    return t


def cochran_armitage(r, n):
    """Test whether a proportion changes linearly over ordered time steps (two-sided)."""
    r, n = np.asarray(r, float), np.asarray(n, float)
    if len(r) < 2 or n.sum() == 0:
        return 0.0, 1.0
    x = np.arange(len(r))
    p_bar = r.sum() / n.sum()
    t_stat = np.sum(x * (r - n * p_bar))
    var = p_bar * (1 - p_bar) * (np.sum(n * x**2) - np.sum(n * x) ** 2 / n.sum())
    z = t_stat / np.sqrt(var) if var > 0 else 0.0
    return z, 2 * stats.norm.sf(abs(z))


EMPIRICAL_LIMIT = 0.20  # common rule: avoid blind (empirical) use once resistance passes 20%


def quarter_mid(q):
    p = pd.Period(q, freq="Q")
    return p.start_time + (p.end_time - p.start_time) / 2


def project_trend(t, quarters, limit=EMPIRICAL_LIMIT, end=None, horizon_years=5):
    """Fit a weighted straight line to quarterly resistance (t from trend_table) and say when it crosses
    `limit`. x = position in `quarters` (all quarters in the data), each quarter weighted by its size.
    Closed-form least squares on purpose (no BLAS dependency). A date is only projected for a
    significant trend (Cochran-Armitage p < 0.05)."""
    x = np.array([quarters.index(q) for q in t.quarter], float)
    y, w = t.pct_resistant.values.astype(float), t.n_tested.values.astype(float)
    xm, ym = np.average(x, weights=w), np.average(y, weights=w)
    b = np.sum(w * (x - xm) * (y - ym)) / np.sum(w * (x - xm) ** 2) if len(x) > 1 else 0.0
    a = ym - b * xm
    _, p = cochran_armitage(t.n_resistant.values, t.n_tested.values)
    x_last = len(quarters) - 1
    now = a + b * x_last
    end = pd.Timestamp(end) if end is not None else quarter_mid(quarters[-1])
    out = dict(a=float(a), b=float(b), x_last=x_last, pct_now=float(np.clip(now, 0, 1)),
               slope_pp_per_year=float(b * 4 * 100), p_value=float(p),
               status="stable" if now < limit else "above", cross_x=None, cross_date=None, months_left=None)
    if p < 0.05 and b > 0:
        cross_x = (limit - a) / b
        when = quarter_mid(quarters[-1]) + pd.Timedelta(days=91.3 * (cross_x - x_last))
        if now >= limit:
            out.update(status="crossed", cross_x=float(cross_x) if cross_x >= 0 else None,
                       cross_date=when.date().isoformat() if cross_x >= 0 else None)
        elif (when - end).days <= 365.25 * horizon_years:
            out.update(status="crossing", cross_x=float(cross_x), cross_date=when.date().isoformat(),
                       months_left=round(max((when - end).days, 0) / 30.44, 1))
        else:
            out["status"] = "rising"
    elif p < 0.05 and b < 0:
        out["status"] = "improving"
    return out


def expiry_watch(ast, limit=EMPIRICAL_LIMIT, end=None, **filters):
    """'Guideline expiry date' for every organism-antibiotic pair with enough data: is resistance rising
    towards the empirical-use limit, and when does the trend cross it?"""
    d = add_quarter(cw.apply_filters(ast, **filters))
    d = d[~d.intrinsic]
    quarters = sorted(d.quarter.unique())
    rows = []
    for (org, ab), g in d.groupby(["organism", "antibiotic_code"]):
        t = cw.resistance_table(g, by=["quarter"], min_n=1).sort_values("quarter")
        if len(t) < 4 or t.n_tested.sum() < 4 * cw.MIN_ISOLATES:
            continue  # too little data for a trustworthy line
        rows.append(dict(organism=org, antibiotic_code=ab, n_tested=int(t.n_tested.sum()),
                         **project_trend(t, quarters, limit, end)))
    cols = ["organism", "antibiotic_code", "n_tested", "a", "b", "x_last", "pct_now", "slope_pp_per_year",
            "p_value", "status", "cross_x", "cross_date", "months_left"]
    return pd.DataFrame(rows, columns=cols), quarters


def trend_summary(ast, pairs=KEY_PAIRS, **filters):
    rows = []
    for org, ab in pairs:
        t = trend_table(ast, org, ab, **filters)
        if len(t) < 2:
            continue  # not enough data over time for this pair with these filters
        rows.append(dict(organism=org, antibiotic_code=ab, first=t.pct_resistant.iloc[0],
                         last=t.pct_resistant.iloc[-1], z=t.attrs["z"], p_value=t.attrs["p_value"],
                         direction=t.attrs["direction"]))
    out = pd.DataFrame(rows, columns=["organism", "antibiotic_code", "first", "last", "z", "p_value", "direction"])
    out["significant"] = out.p_value < 0.05
    return out


# ---------- 4. Cluster alerts ----------
def weekly_counts(iso, phenotype):
    """New cases per ward per ISO week (first isolates with the phenotype flag)."""
    d = iso[iso[phenotype] == 1]
    weeks = pd.period_range(iso.sample_date.min(), iso.sample_date.max(), freq="W-SUN")
    d = d.assign(week=d.sample_date.dt.to_period("W-SUN"))
    counts = d.groupby(["ward_code", "week"]).size().unstack(fill_value=0)
    return counts.reindex(index=sorted(iso.ward_code.unique()), columns=weeks, fill_value=0)


def window_test(v, t, window=4, baseline=52):
    """Cases in weeks [t-window, t) vs what the `baseline` weeks before predict.
    Returns (observed, expected, p) with p = Poisson P(X >= observed)."""
    observed = v[t - window:t].sum()
    expected = v[max(t - window - baseline, 0):t - window].mean() * window
    return int(observed), float(expected), float(stats.poisson.sf(observed - 1, max(expected, 0.1)))


def detect_clusters(counts, window=4, baseline=52, min_cases=3, alpha=0.01):
    """Flag ward-weeks where cases in the last `window` weeks exceed what the ward's previous
    `baseline` weeks predict (Poisson upper-tail test). Simple and explainable on purpose."""
    alerts = []
    for ward, s in counts.iterrows():
        v = s.values
        for t in range(baseline + window, len(v) + 1):
            observed, expected, p = window_test(v, t, window, baseline)
            if observed >= min_cases and p < alpha:
                alerts.append(dict(ward_code=ward, week_index=t, window_end=str(s.index[t - 1]),
                                   observed=int(observed), expected=round(expected, 2), p_value=p))
    out = pd.DataFrame(alerts, columns=["ward_code", "week_index", "window_end", "observed", "expected", "p_value"])
    # keep only the first week of each run of consecutive alerts on the same ward
    is_new_run = out.groupby("ward_code").week_index.diff().ne(1)
    return out[is_new_run].drop(columns="week_index").reset_index(drop=True)


def current_status(counts, window=4, baseline=52, min_cases=3, alpha=0.01):
    """Every ward's latest `window` weeks vs its baseline, same test as detect_clusters.
    Unlike detect_clusters this returns all wards, so a ward page can show 'normal' too."""
    rows = []
    for ward, s in counts.iterrows():
        observed, expected, p = window_test(s.values, len(s), window, baseline)
        rows.append(dict(ward_code=ward, window_end=str(s.index[-1]), observed=observed,
                         expected=round(expected, 2), p_value=p, alert=observed >= min_cases and p < alpha))
    return pd.DataFrame(rows, columns=["ward_code", "window_end", "observed", "expected", "p_value", "alert"])


CARRIER_MEMORY_DAYS = 365  # contact precautions can be lifted at the earliest 12 months after the last positive


def load_all_isolates(path=cw.PROCESSED / "isolates_joined.csv"):
    """Every isolate, not just first isolates: carrier status depends on each positive sample."""
    return pd.read_csv(path, parse_dates=["sample_date"])


def carrier_findings(iso_all, start, end, phenotypes=("esbl", "mrsa", "vre", "cpe")):
    """Resistant findings sampled between start and end (one row per patient, phenotype and day), each classed
    for the infection unit's workflow:
      new        - first positive for this phenotype in the data: register as a carrier, notify ward and
                   (Finnish practice) the home municipality's hygiene nurse
      known      - previous positive within 12 months: already a known carrier, precautions should be on
      repositive - known carrier whose last positive was over 12 months ago: precautions may have been lifted.
    History before the start of the data is unknown, so early 'new' findings can be known carriers."""
    iso_all = iso_all[iso_all.sample_date <= pd.Timestamp(end)]
    rows = []
    for ph in phenotypes:
        d = (iso_all[iso_all[ph] == 1].sort_values(["sample_date", "culture_id", "isolate_no"])
             .groupby(["patient_id", "sample_date"], as_index=False)
             .agg(organisms=("organism", lambda s: ", ".join(sorted(set(s)))), ward_code=("ward_code", "first"),
                  specimen=("specimen", "first"), hospital_onset=("hospital_onset", "max"), sex=("sex", "first"),
                  age_years=("age_years", "first"), home_area=("home_area", "first")))
        d["prev_date"] = d.groupby("patient_id").sample_date.shift()
        d["phenotype"] = ph
        rows.append(d)
    out = pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()
    gap = (out.sample_date - out.prev_date).dt.days
    out["status"] = np.select([out.prev_date.isna(), gap <= CARRIER_MEMORY_DAYS], ["new", "known"], default="repositive")
    out = out[out.sample_date >= pd.Timestamp(start)]
    out["finding_id"] = out.phenotype + "-" + out.patient_id + "-" + out.sample_date.dt.strftime("%Y%m%d")
    return out.sort_values(["sample_date", "phenotype"], ascending=[False, True]).reset_index(drop=True)


def load_ward_visits(path=cw.RAW_DIR / "cultures.csv"):
    """Every culture (negative ones too): where each patient was sampled, a proxy for where they stayed,
    and how many samples each ward sent (the denominator behind its case counts)."""
    return pd.read_csv(path, usecols=["patient_id", "sample_date", "ward_code", "specimen"], parse_dates=["sample_date"])


def add_recent_wards(findings, visits, days=30):
    """Other wards each patient was sampled on in the `days` before the finding: a lead for infection control
    on where carriage may have been picked up or passed on (the line-list 'movement' column)."""
    v = visits.merge(findings[["finding_id", "patient_id", "sample_date", "ward_code"]], on="patient_id", suffixes=("", "_f"))
    v = v[(v.sample_date < v.sample_date_f) & (v.sample_date >= v.sample_date_f - pd.Timedelta(days=days))
          & (v.ward_code != v.ward_code_f)]
    recent = v.sort_values("sample_date").groupby("finding_id").ward_code.agg(lambda s: list(dict.fromkeys(s)))
    return findings.assign(recent_wards=[recent.get(i, []) for i in findings.finding_id])


def carrier_movements(findings):
    """Ward-to-ward movements of new carriers: one row per (ward the patient was sampled on in the 30 days
    before, ward of the finding, phenotype) with the number of patients. Needs add_recent_wards first.
    A lead for where carriage may have been picked up, not proof of transmission."""
    new = findings[findings.status == "new"]
    rows = [(prev, r.ward_code, r.phenotype, r.patient_id, bool(r.hospital_onset))
            for r in new.itertuples() for prev in r.recent_wards]
    moves = pd.DataFrame(rows, columns=["from_ward", "to_ward", "phenotype", "patient_id", "hospital_onset"])
    if moves.empty:
        return moves.assign(patients=pd.Series(dtype=int))[["from_ward", "to_ward", "phenotype", "patients"]]
    return (moves.groupby(["from_ward", "to_ward", "phenotype"]).patient_id.nunique()
            .reset_index(name="patients").sort_values("patients", ascending=False, kind="stable"))


def plant_outbreak(iso, ward, phenotype, organism, start, weeks=3, cases=6, seed=0):
    """TEST ONLY: add fake cases to check that detect_clusters catches a known outbreak."""
    rng = np.random.default_rng(seed)
    days = pd.Timestamp(start) + pd.to_timedelta(rng.integers(0, weeks * 7, cases), unit="D")
    template = iso[(iso.ward_code == ward) & (iso.organism == organism)].iloc[0]
    fake = pd.DataFrame([template] * cases).assign(sample_date=days.values, **{phenotype: 1})
    fake["isolate_id"] = [f"FAKE-{i}" for i in range(cases)]
    return pd.concat([iso, fake], ignore_index=True)


if __name__ == "__main__":
    out = cw.OUTPUT_DIR; out.mkdir(parents=True, exist_ok=True)
    ast, iso = cw.load_ast(), load_isolates()
    pd.set_option("display.width", 160)

    print("=== 1. Hospital-onset vs community (urine)")
    s = compare_settings(ast, specimen="urine"); s.to_csv(out / "hospital_vs_community.csv", index=False)
    print(s.round(3).to_string(index=False))

    print("\n=== 2. Ward profile")
    w = ward_profile(iso); w.to_csv(out / "ward_profile.csv")
    print(w[["first_isolates", "hospital_onset_share", "esbl_pct", "esbl_p_above",
             "mrsa_pct", "mrsa_p_above", "vre_n", "cpe_n"]].round(3).to_string())

    print("\n=== 3. Trends (quarterly, all specimens)")
    t = trend_summary(ast); t.to_csv(out / "trends.csv", index=False)
    print(t.round(3).to_string(index=False))

    print("\n=== 4. Cluster alerts (real data)")
    for ph in ["esbl", "mrsa"]:
        a = detect_clusters(weekly_counts(iso, ph)); a.to_csv(out / f"alerts_{ph}.csv", index=False)
        print(ph.upper(), "alerts:", len(a)); print(a.to_string(index=False) if len(a) else "  none")

    print("\n=== 4b. Detector test with a planted MRSA outbreak (Surgery, 6 cases in 3 weeks)")
    test = plant_outbreak(iso, "SURG", "mrsa", "Staphylococcus aureus", "2025-03-03")
    a = detect_clusters(weekly_counts(test, "mrsa"))
    print(a.to_string(index=False) if len(a) else "  not detected")