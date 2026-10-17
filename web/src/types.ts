// Shapes returned by the Python API (api/main.py). Nullable numbers are hidden by the 30-isolate rule.

export type WindowKey = '4w' | '12m'
export type Phenotype = 'esbl' | 'mrsa' | 'vre' | 'cpe'
export type Setting = 'community' | 'inpatient' | 'hospital_onset'

export interface Ward {
  ward_code: string
  ward_fi: string
  ward_en: string
  ward_type: 'in' | 'out'
  institution: string
}

export interface Antibiotic {
  antibiotic: string
  antibiotic_code: string
  antibiotic_fi: string
  class: string
  reported_for: string
}

export interface Meta {
  wards: Ward[]
  antibiotics: Antibiotic[]
  ab_order: string[]
  urine_only: string[]
  periods: string[]
  organisms: string[]
  specimens: string[]
  age_groups: string[]
  scenarios: { name: string; target: number }[]
  date_min: string
  date_max: string
  windows: Record<WindowKey, [string, string]>
  min_isolates: number
  key_pairs: { organism: string; antibiotic_code: string }[]
  /** week-ending Sundays the time machine can replay */
  replay_weeks: string[]
}

export interface Finding {
  finding_id: string
  patient_id: string
  sample_date: string
  phenotype: Phenotype
  organisms: string
  ward_code: string
  specimen: string
  hospital_onset: boolean
  sex: string
  age_years: number
  home_area: string
  status: 'new' | 'known' | 'repositive'
  prev_date: string | null
  recent_wards: string[]
}

export interface FindingsResp {
  start: string
  end: string
  history_complete: boolean
  findings: Finding[]
}

export interface StagedFile {
  table: string
  rows: number
  missing: string[]
}

export interface ImportStatus {
  source: 'original' | 'imported'
  imported: { imported_at: string; mode: 'append' | 'replace'; rows: Record<string, number>; added: Record<string, number> } | null
  staged: StagedFile[]
  can_import: boolean
  tables: string[]
  required: string[]
}

export interface ImportReport {
  mode: 'append' | 'replace'
  ok: boolean
  errors: string[]
  warnings: string[]
  tables: { table: string; rows: number; added: number }[]
  date_min: string | null
  date_max: string | null
  passed: string | null
  applied?: boolean
}

export interface TimelineAlert {
  phenotype: Phenotype
  week_end: string
  ward_code: string
  observed: number
  expected: number
  p_value: number
}

export interface Rate {
  cases: number
  n: number
  pct: number | null
  ci_low: number | null
  ci_high: number | null
}

export interface OverviewResp {
  kpis: { first_isolates: number; esbl: Rate; mrsa: Rate; vre_cases: number; cpe_cases: number }
  organism_mix: { organism: string; n: number }[]
  changes: { organism: string; antibiotic_code: string; pct_prev: number; pct_last: number; change_pp: number }[]
  change_periods: string[]
}

export interface AbCell {
  organism: string
  antibiotic_code: string
  n_tested: number
  n_resistant: number
  intrinsic: boolean
  pct_resistant: number | null
  ci_low: number | null
  ci_high: number | null
  reportable: boolean
  label: string
}

export interface AntibiogramResp {
  antibiotics: string[]
  organisms: string[]
  cells: AbCell[]
}

export interface Regimen {
  regimen: string
  n_drugs: number
  tier: number
  n_covered: number
  n_isolates: number
  coverage: number
  ci_low: number
  ci_high: number
  tier_name: string
  meets_target: boolean
  reportable: boolean
}

export interface TreatmentResp {
  scenario: string
  target: number
  n_isolates: number
  reportable: boolean
  recommended: string | null
  single: Regimen[]
  combos: Regimen[]
  organism_mix: { organism: string; share: number }[]
}

export interface SettingComparison {
  organism: string
  antibiotic_code: string
  n_community: number
  pct_community: number | null
  n_hospital: number
  pct_hospital: number | null
  diff_pp: number | null
  p_value: number | null
  significant: boolean
}

export interface WardProfileRow {
  ward_code: string
  first_isolates: number
  hospital_onset_share: number
  esbl_n: number
  esbl_base: number
  mrsa_n: number
  mrsa_base: number
  vre_n: number
  cpe_n: number
  esbl_pct: number | null
  mrsa_pct: number | null
  esbl_p_above: number | null
  mrsa_p_above: number | null
}

export interface TrendPoint {
  quarter: string
  /** position on the shared quarter axis */
  x?: number
  n_tested: number
  n_resistant: number
  pct_resistant: number
  ci_low: number
  ci_high: number
}

export type ExpiryStatus = 'crossing' | 'crossed' | 'rising' | 'above' | 'improving' | 'stable'

export interface Projection {
  a: number
  b: number
  x_last: number
  pct_now: number
  slope_pp_per_year: number
  p_value: number
  status: ExpiryStatus
  cross_x: number | null
  cross_date: string | null
  months_left: number | null
}

export interface TrendResp {
  points: TrendPoint[]
  z: number
  p_value: number
  direction: 'increasing' | 'decreasing'
  quarters: string[]
  limit: number
  projection: Projection | null
}

export interface ExpiryPair extends Projection {
  organism: string
  antibiotic_code: string
  n_tested: number
  tier: number
}

export interface ExpiryResp {
  limit: number
  quarters: string[]
  as_of: string
  pairs: ExpiryPair[]
}

export interface TrendSummaryRow {
  organism: string
  antibiotic_code: string
  first: number
  last: number
  z: number
  p_value: number
  direction: string
  significant: boolean
}

export interface Alert {
  ward_code: string
  window_end: string
  observed: number
  expected: number
  p_value: number
}

export interface WardStatus extends Alert {
  alert: boolean
}

export interface AlertsResp {
  alerts: Alert[]
  status: WardStatus[]
  weeks: string[]
  counts: Record<string, number[]>
}

export interface WardPhenotypeStatus {
  phenotype: Phenotype
  observed: number
  expected: number
  p_value: number
  alert: boolean
  weekly: number[]
  history: Alert[]
}

export interface WardPair {
  organism: string
  antibiotic_code: string
  n_tested: number
  n_resistant: number
  pct_resistant: number | null
  ci_low: number
  ci_high: number
  reportable: boolean
  n_tested_prev: number | null
  pct_resistant_prev: number | null
  n_tested_all: number | null
  pct_resistant_all: number | null
  change_pp: number | null
  vs_all_pp: number | null
  p_change: number | null
  p_above: number | null
}

export interface RateTests {
  p_change: number | null
  p_above: number | null
}

export interface WardResp {
  ward: { code: string; name_en: string; name_fi: string; ward_type: 'in' | 'out'; institution: string }
  latest: string
  windows: { '4w': [string, string]; '12m': [string, string]; '12m_prev': [string, string] }
  four_weeks: {
    weeks: string[]
    isolates: { observed: number; expected: number; weekly: number[] }
    /** every culture sent from the ward, negative ones too: the denominator behind the case counts */
    samples: { observed: number; expected: number; weekly: number[] }
    phenotypes: WardPhenotypeStatus[]
  }
  twelve_months: {
    first_isolates: number
    hospital_onset_share: number | null
    rates: {
      ward: Record<'esbl' | 'mrsa', Rate>
      ward_prev: Record<'esbl' | 'mrsa', Rate>
      all_sites: Record<'esbl' | 'mrsa', Rate>
      tests: Record<'esbl' | 'mrsa', RateTests>
    }
    organism_mix: { organism: string; n: number }[]
    pairs: WardPair[]
    /** organism–antibiotic pairs that are naturally resistant (not shown as a %) */
    intrinsic: [string, string][]
  }
}

/** Front page for the whole hospital: every ward's last 4 weeks at a glance. */
export interface NowWard {
  ward_code: string
  alerts: { phenotype: Phenotype; observed: number; expected: number; p_value: number }[]
  findings: number
  new_carriers: Record<Phenotype, number>
  /** CPE and VRE findings: rare enough that a single case needs action */
  rare: { phenotype: Phenotype; status: 'new' | 'known' | 'repositive'; sample_date: string }[]
}

export interface NowResp {
  latest: string
  window: [string, string]
  wards: NowWard[]
  expiry: { organism: string; antibiotic_code: string; status: 'crossed' | 'crossing'; cross_date: string | null; months_left: number | null }[]
}

export interface SpreadResp {
  start: string
  end: string
  new_carriers: number
  moved: number
  movements: { from_ward: string; to_ward: string; phenotype: Phenotype; patients: number }[]
}

export interface HomeAreaRow { home_area: string; first_isolates: number; esbl: Rate; mrsa: Rate; vre_cases: number; cpe_cases: number }

export interface WeeklyResp {
  start: string
  end: string
  findings: Finding[]
  alerts: { ward_code: string; phenotype: Phenotype; observed: number; expected: number; p_value: number }[]
}

export type SearchResult =
  | { kind: 'pair'; organism: string; antibiotic_code: string; n: number; pct: number | null; intrinsic: boolean;
      status: 'crossing' | 'crossed' | 'rising' | null; cross_date: string | null; months_left: number | null }
  | { kind: 'organism'; organism: string; first_isolates: number; top: { antibiotic_code: string; pct: number }[] }
  | { kind: 'antibiotic'; antibiotic_code: string; top: { organism: string; pct: number }[] }
  | { kind: 'ward'; ward_code: string; first_isolates: number; mrsa: Rate; esbl: Rate; alerts: Phenotype[] }
  | { kind: 'phenotype'; phenotype: Phenotype; alert_wards: string[]; cases_4w: number }
  | { kind: 'ward_phenotype'; ward_code: string; phenotype: Phenotype; cases_4w: number; usual_4w: number; alert: boolean;
      rate: Rate | null; cases_12m: number }
  | { kind: 'ward_pair'; ward_code: string; organism: string; antibiotic_code: string; n: number; pct: number | null;
      intrinsic: boolean; pct_hospital: number | null }
  | { kind: 'ward_organism'; ward_code: string; organism: string; first_isolates: number; top: { antibiotic_code: string; pct: number }[] }
  | { kind: 'patient'; patient_id: string; samples: number; last_date: string; last_ward: string;
      findings: { phenotype: Phenotype; status: 'new' | 'known' | 'repositive'; sample_date: string; ward_code: string }[] }

export interface SearchResp {
  q: string
  as_of: string
  results: SearchResult[]
}
