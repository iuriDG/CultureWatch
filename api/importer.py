"""CSV import for the web UI: stage lab export files, validate them with preprocess.py's own checks, then rebuild
the processed tables. Nothing changes until every check passes and the user applies the import.

Two modes:
  append  - add new results (e.g. this week's lab export) to the data in use; IDs must be new
  replace - use the uploaded files as the whole dataset
The original dataset (cw.RAW_DIR) is never modified: an applied import lives in data/imports/active/,
and reset() goes back to the original."""
import contextlib
import io
import json
import shutil
from datetime import datetime
from pathlib import Path

import pandas as pd

import cw_utils as cw
import preprocess as pp

TABLES = ["patients", "cultures", "isolates", "susceptibility", "wards", "antibiotics"]
REQUIRED = list(pp.REQUIRED_COLUMNS)  # patients, cultures, isolates, susceptibility
IMPORT_DIR = cw.DATA_DIR / "imports"
STAGING = IMPORT_DIR / "staging"
ACTIVE = IMPORT_DIR / "active"
META = IMPORT_DIR / "active.json"


class ImportProblem(Exception):
    """A problem with the uploaded files themselves (not readable, wrong table, missing tables)."""


def raw_dir() -> Path:
    """Folder of the raw tables currently in use: the applied import, or the original dataset."""
    return ACTIVE if (ACTIVE / "cultures.csv").exists() else cw.RAW_DIR


def _read(path: Path, table: str) -> pd.DataFrame:
    header = set(pd.read_csv(path, nrows=0).columns)
    dates = [c for c in ("sample_date", "admission_date") if table == "cultures" and c in header]
    return pd.read_csv(path, parse_dates=dates or None)


def template(table: str) -> str:
    """Header row of a table, taken from the original dataset, as a CSV template."""
    with open(cw.RAW_DIR / f"{table}.csv", encoding="utf-8") as f:
        return f.readline()


def stage(table: str, content: bytes) -> dict:
    """Save one uploaded file for `table` and report its rows and any missing required columns."""
    if table not in TABLES:
        raise ImportProblem(f"Unknown table {table!r}; expected one of {', '.join(TABLES)}")
    STAGING.mkdir(parents=True, exist_ok=True)
    path = STAGING / f"{table}.csv"
    path.write_bytes(content)
    try:
        df = pd.read_csv(path)
    except Exception as e:
        path.unlink(missing_ok=True)
        raise ImportProblem(f"{table}: not a readable CSV file ({e})")
    missing = sorted(set(pp.REQUIRED_COLUMNS.get(table, [])) - set(df.columns))
    return dict(table=table, rows=len(df), columns=list(df.columns), missing=missing)


def staged() -> list[dict]:
    out = []
    for t in TABLES:
        p = STAGING / f"{t}.csv"
        if p.exists():
            df = pd.read_csv(p)
            out.append(dict(table=t, rows=len(df),
                            missing=sorted(set(pp.REQUIRED_COLUMNS.get(t, [])) - set(df.columns))))
    return out


def clear_staging():
    shutil.rmtree(STAGING, ignore_errors=True)


def _combined(mode: str) -> tuple[dict, dict]:
    """The tables an import would produce, and how many rows each uploaded file adds."""
    files = {t: STAGING / f"{t}.csv" for t in TABLES if (STAGING / f"{t}.csv").exists()}
    if not files:
        raise ImportProblem("No files uploaded yet.")
    if mode == "replace" and (missing := [t for t in REQUIRED if t not in files]):
        raise ImportProblem(f"Replacing all data needs every table; missing: {', '.join(missing)}")
    bad = [f"{t}: missing columns {', '.join(m)}" for t, path in files.items()
           if (m := sorted(set(pp.REQUIRED_COLUMNS.get(t, [])) - set(pd.read_csv(path, nrows=0).columns)))]
    if bad:
        raise ImportProblem("\n".join(bad))
    current = pp.load_raw(raw_dir())
    tables, added = {}, {}
    for t in TABLES:
        new = _read(files[t], t) if t in files else None
        old = current.get(t)
        added[t] = 0 if new is None else len(new)
        if new is None:
            tables[t] = old
        elif mode == "replace" or old is None:
            tables[t] = new
        else:
            tables[t] = pd.concat([old, new], ignore_index=True)
    return tables, added


def check(mode: str) -> tuple[dict, dict | None]:
    """Run the pipeline's own validation on what the import would produce. Changes nothing."""
    report = dict(mode=mode, ok=False, errors=[], warnings=[], tables=[], date_min=None, date_max=None)
    try:
        tables, added = _combined(mode)
    except ImportProblem as e:
        report["errors"] = str(e).splitlines()
        return report, None
    report["tables"] = [dict(table=t, rows=len(df), added=added[t]) for t, df in tables.items() if df is not None]
    sample = tables["cultures"].get("sample_date")
    if sample is not None and pd.api.types.is_datetime64_any_dtype(sample) and sample.notna().any():
        report["date_min"], report["date_max"] = sample.min().date().isoformat(), sample.max().date().isoformat()
    out = io.StringIO()
    try:
        with contextlib.redirect_stdout(out):
            pp.validate(tables)
        report["ok"] = True
    except pp.DataValidationError as e:
        report["errors"] = [ln.strip() for ln in str(e).splitlines()
                            if ln.strip() and not ln.startswith("Data validation failed")]
    lines = [ln.strip() for ln in out.getvalue().splitlines() if ln.strip()]
    report["warnings"] = [ln.replace("WARNING: ", "") for ln in lines if ln.startswith("WARNING")]
    report["passed"] = next((ln for ln in lines if "checks passed" in ln), None)
    return report, (tables if report["ok"] else None)


def apply(mode: str) -> dict:
    """Check, then make the imported tables the data in use and rebuild the processed tables."""
    report, tables = check(mode)
    if not report["ok"]:
        return report
    tmp = IMPORT_DIR / "active_new"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    for t, df in tables.items():
        if df is not None:
            df.to_csv(tmp / f"{t}.csv", index=False)
    iso, ast = pp.build(tables)
    pp.save(iso, ast)
    shutil.rmtree(ACTIVE, ignore_errors=True)
    tmp.rename(ACTIVE)
    META.write_text(json.dumps(dict(imported_at=datetime.now().isoformat(timespec="seconds"), mode=mode,
                                   rows={r["table"]: r["rows"] for r in report["tables"]},
                                   added={r["table"]: r["added"] for r in report["tables"]})), encoding="utf-8")
    clear_staging()
    report["applied"] = True
    return report


def reset():
    """Go back to the original dataset and rebuild the processed tables from it."""
    tables = pp.load_raw(cw.RAW_DIR)
    with contextlib.redirect_stdout(io.StringIO()):
        pp.validate(tables)
    iso, ast = pp.build(tables)
    pp.save(iso, ast)
    shutil.rmtree(ACTIVE, ignore_errors=True)
    META.unlink(missing_ok=True)


def status() -> dict:
    meta = json.loads(META.read_text(encoding="utf-8")) if META.exists() and raw_dir() == ACTIVE else None
    return dict(source="imported" if meta else "original", imported=meta, staged=staged())
