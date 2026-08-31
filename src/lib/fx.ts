import type { FxRates } from './types'

/**
 * Frankfurter (ECB) client. No API key, which is the whole reason to pick it —
 * a static bundle cannot hide a secret. See PLAN.md §7.
 *
 * The `/v1` prefix is mandatory on this host: the bare paths that worked on the
 * older api.frankfurter.app return 404 here.
 */
const API = 'https://api.frankfurter.dev/v1'

const RATES_KEY = 'nwc:v1:fxrates'
const CURRENCIES_KEY = 'nwc:v1:currencies'

export interface RateResult {
  rates: FxRates
  /** The date ECB actually priced. Differs from the request across weekends and holidays. */
  date: string
  source: 'frankfurter' | 'manual'
}

/**
 * The 30 ECB currencies, verified against /v1/currencies. Used when the network
 * is unavailable so the editor still opens — the picker must never be empty.
 */
export const FALLBACK_CURRENCIES: Record<string, string> = {
  AUD: 'Australian Dollar', BRL: 'Brazilian Real', CAD: 'Canadian Dollar',
  CHF: 'Swiss Franc', CNY: 'Chinese Renminbi Yuan', CZK: 'Czech Koruna',
  DKK: 'Danish Krone', EUR: 'Euro', GBP: 'British Pound', HKD: 'Hong Kong Dollar',
  HUF: 'Hungarian Forint', IDR: 'Indonesian Rupiah', ILS: 'Israeli New Shekel',
  INR: 'Indian Rupee', ISK: 'Icelandic Króna', JPY: 'Japanese Yen',
  KRW: 'South Korean Won', MXN: 'Mexican Peso', MYR: 'Malaysian Ringgit',
  NOK: 'Norwegian Krone', NZD: 'New Zealand Dollar', PHP: 'Philippine Peso',
  PLN: 'Polish Złoty', RON: 'Romanian Leu', SEK: 'Swedish Krona',
  SGD: 'Singapore Dollar', THB: 'Thai Baht', TRY: 'Turkish Lira',
  USD: 'United States Dollar', ZAR: 'South African Rand',
}

function readLocal<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null // private mode, quota, corrupt JSON — all non-fatal here
  }
}

function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* cache is an optimisation, never a requirement */
  }
}

/**
 * Fetch rates for a date (or the latest close).
 *
 * Rates are public reference data, so they live in localStorage and outlive the
 * tab — unlike the balances, which are session-scoped (PLAN.md §6).
 *
 * @throws on network failure or a non-200. Callers must catch and offer manual
 * entry: losing a yearly snapshot because someone else's server was down is not
 * an acceptable failure mode.
 */
export async function fetchRates(base: string, date?: string): Promise<RateResult> {
  const path = date ?? 'latest'
  const res = await fetch(`${API}/${path}?base=${encodeURIComponent(base)}`)
  if (!res.ok) throw new Error(`Frankfurter ${res.status} for ${path}`)

  const body = (await res.json()) as { base: string; date: string; rates: FxRates }
  const result: RateResult = { rates: body.rates, date: body.date, source: 'frankfurter' }

  // Only the live table is worth keeping; historical dates are immutable and
  // already frozen into whichever snapshot asked for them.
  if (!date) writeLocal(RATES_KEY, { base, ...result })
  return result
}

/** Last successfully fetched live rates, for prefilling manual entry when the API is down. */
export function cachedRates(base: string): RateResult | null {
  const c = readLocal<RateResult & { base: string }>(RATES_KEY)
  return c && c.base === base ? { rates: c.rates, date: c.date, source: c.source } : null
}

/**
 * Currency code -> name for the picker. Falls back through localStorage to the
 * hardcoded table, so this never rejects and never returns an empty list.
 */
export async function fetchCurrencies(): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${API}/currencies`)
    if (!res.ok) throw new Error(String(res.status))
    const body = (await res.json()) as Record<string, string>
    writeLocal(CURRENCIES_KEY, body)
    return body
  } catch {
    return readLocal<Record<string, string>>(CURRENCIES_KEY) ?? FALLBACK_CURRENCIES
  }
}

/**
 * Order the picker: base first, then any currency already used in history —
 * including one the API has since retired, like BGN after Bulgaria joined the
 * euro — then everything else alphabetically.
 */
export function orderCurrencies(
  available: Record<string, string>,
  base: string,
  legacy: string[] = [],
): { code: string; name: string; retired: boolean }[] {
  const seen = new Set<string>()
  const out: { code: string; name: string; retired: boolean }[] = []

  const push = (code: string) => {
    if (seen.has(code)) return
    seen.add(code)
    const name = available[code]
    out.push({ code, name: name ?? FALLBACK_CURRENCIES[code] ?? code, retired: !name })
  }

  push(base)
  legacy.forEach(push)
  Object.keys(available).sort().forEach(push)
  return out
}
