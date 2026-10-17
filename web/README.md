# CultureWatch web app

**A website that shows hospital staff which bacteria on their ward are becoming hard to treat, and warns them early.**

Some bacteria learn to survive antibiotics. When that happens, the usual medicine stops working. The hospital lab already tests every sample for this, but the results sit in big tables. This app turns those results into a few clear answers: *Is something unusual happening on my ward right now? Is it getting worse this year? Which medicine still works?*

> All data is made up (synthetic). It shows how the tool works, not the situation in a real hospital.

---

## What you can do

The tabs are grouped by who uses them. Infection control and Analysis have smaller sub-tabs underneath.

| Tab | What it tells you |
|---|---|
| **Start page** | Before you choose a ward: the **whole hospital right now**. Every ward's last 4 weeks at a glance (unusual clusters, any CPE or VRE case, new carriers), wards with something going on first, then pick your ward. |
| **My ward** | Opens on your own ward, most important first: **Right now** (anything unusual in the last 4 weeks, any CPE or VRE case, which patients have resistant bacteria, how many samples were sent); **Which antibiotics work here** (a colour grid for the ward's commonest bacteria); **Getting worse?** (worse than last year, or than the rest of the hospital?); then the details. |
| **Infection control → Right now** | The same whole-hospital view as the start page, for the infection unit's first check of the day. |
| **Infection control → Findings** | Every new resistant bacterium found: whether the patient is a **new or known carrier**, picked up in hospital or not, and where they were before. Search by patient, ward or organism. |
| **Infection control → Alerts** | Every ward at once: which wards have more cases than normal right now, and every alert in the past. |
| **Infection control → Spread** | Where new carriers had been in the 30 days before their finding, as a flow chart: wards on the left, the ward where they were found on the right, wider band = more patients. Each ward has its own colour; point at a ward or band to highlight it. |
| **Infection control → Weekly summary** | The last 7 days on one printable page: wards on alert and new resistant findings. |
| **Analysis → Hospital** | The big picture: totals, ward "hotspots", resistance by the patient's home area, hospital vs outpatient resistance. |
| **Analysis → Antibiogram** | A colour table: for each bacterium and each antibiotic, how often the antibiotic **fails**, in the six colour bands Europe uses on its resistance maps (green = rarely, dark red = half the time or more). **Bold** = over 20%. Click a cell to see its trend. Print it as a one-page PDF. |
| **Analysis → Treatment guide** | Pick an infection type (e.g. bladder infection in a woman): which antibiotic would have worked for most past patients. |
| **Analysis → Trends** | Is resistance rising over time? The chart is first; below it the **guideline expiry date**: when a common antibiotic crosses the 20% line where doctors stop starting it before the test result. |
| **Import** (top right) | Upload new lab results as CSV files (e.g. this week's export from the lab system). The files are checked with the same rules as the data pipeline; nothing changes unless every check passes. You can always go back to the original data. |
| **Methods** (top right) | Every rule and calculation, written out, and how a resistant finding is handled. |

**Extras in the top bar**

- **Quick search:** type a ward, a bacterium, an antibiotic, MRSA/ESBL/VRE/CPE or a patient ID (or press `/`). The answer appears in the list straight away, for example *"E. coli + trimethoprim: 20.1% resistant, over the 20% limit since Jan 2026"*. Press Enter to open the full view.
- **Copy link:** every view has its own address, filters included. Copy it, bookmark it or send it, and it opens the same view again.
- **Historical replay:** rewind to any week and press Play. The whole app shows what it *would have shown* on that day. It opens 3 weeks before your ward's latest alert, and **Play** pauses by itself when the alert fires. Try it with the Intensive care unit as your ward: it stops on 8 Mar 2026, at the MRSA cluster.
- **Custom dates:** next to *Last 4 weeks*, *Last 12 months* and so on, choose **Custom dates** and pick any From and To day.
- **FI / EN:** the whole app works in Finnish and English.
- **Logo:** back to the start page.

**Built for real volumes:** every table shows 25 rows per page, and sorting and search work across all rows. Extra filters (setting, ward, sex, age) sit behind **More filters**. The layout works on phones.

---

## How it works

```
 Lab results (CSV files)
        │
        ▼
 Python pipeline         cleans the data and applies the counting rules
        │
        ▼
 Python API (api/)       answers questions like "ICU, last 4 weeks?" with numbers
        │
        ▼
 This web app (web/)     draws those numbers as pages, tables and charts
```

The web app **never calculates anything itself**. Every number comes from the same Python code the rest of the team uses, so all views always agree.

### How the warnings are decided

- **Alert (last 4 weeks):** we count a ward's cases of a resistant bacterium in the last 4 weeks and compare them with that ward's normal level over the previous year. If it is clearly more than normal (at least 3 cases, and very unlikely to be chance), it is an alert.
- **Signal (last 12 months):** a resistance rate that has clearly gone **up since last year**, or is clearly **higher than the rest of the hospital**.
- **Guideline expiry:** we draw a trend line through resistance over time and see when it crosses **20%**.
- **New vs known carrier:** *new* = first time this patient has this bacterium; *known* = found before within 12 months; *positive again* = found before, but over 12 months ago.
- **CPE and VRE:** so rare that **one case** is already serious, so every case shows on the front pages, even without a cluster.
- **Samples taken:** next to the alerts, how many samples the ward sent compared with usual. If a ward suddenly tests more, it finds more.

"Clearly" means a standard statistics test says it's unlikely to be random. The Methods tab names each test.

---

## Words you will see

| Word | Meaning |
|---|---|
| **Resistant** | The antibiotic did not kill the bacterium. |
| **MRSA, ESBL, VRE, CPE** | Types of bacteria that resist important antibiotics. Hospitals track these closely. |
| **Carrier** | A patient who has one of those bacteria (even without being ill). |
| **First isolate** | We count each patient's bacterium once per year, so a patient tested ten times doesn't count ten times. |
| **n<30** | Fewer than 30 results, too few for a reliable percentage, so we don't show one. |
| **Hospital-onset** | The sample was taken on day 3 or later of a hospital stay, so the bacterium may have been picked up in hospital. |

---

## Run it

You need the Python environment from the main [README](../README.md) and [Node.js](https://nodejs.org).

```bash
python run_pipeline.py                     # once: prepares the data
python -m uvicorn api.main:app --port 8000 # terminal 1: the API
cd web && npm install && npm run dev       # terminal 2: the web app
```

Open http://localhost:5173. To share it on phones, see *Share it on phones* in the main README. Before a demo, run the **Historical replay** once (Intensive care unit, then Play) so the replayed weeks are remembered and play fast.

**Try the import (real data only):** `python make_demo_batch.py` cuts the real dataset at a date: `data/demo_batch/base/` holds everything before 23 Feb 2026 and `data/demo_batch/batch/` the real two weeks up to 8 Mar 2026, when the ICU MRSA cluster appears. On the **Import** tab, first *Replace all data* with the four `base` files, then *Add new results* with the three `batch` files: the ICU alert fires, exactly as in the real data. *Restore original dataset* brings back the full data. Import only works on the computer running the app, never through the public link.

**Check the numbers:** with the API running, `python verify_numbers.py` recomputes the headline numbers straight from the raw CSV files with its own, separate code and compares them with what the app shows (prints OK/FAIL per number; 42/42 today, including the start page, spread, home areas and the weekly summary).

---

## Security

The web app needs no API keys or passwords. Through the public share link people can only look: importing or restoring data only works from the app on the computer running it. See *Security and privacy* in the [main README](../README.md#security-and-privacy).

---

## Where things are

```
web/
├── src/App.tsx          top bar, grouped tabs, language, historical replay
├── src/views/           one file per tab (NowView, WardView, FindingsView, SpreadView, WeeklyView, ...)
├── src/hashParams.ts    the address of each view (route + filters), for links and bookmarks
├── src/components/      reusable parts: charts, colour grid, paged tables, filters, replay bar, QR dialog
├── src/strings.ts       every piece of text, in English and Finnish
├── src/format.ts        how numbers and dates are written in each language
└── src/api.ts           how the app asks the API for data
```
