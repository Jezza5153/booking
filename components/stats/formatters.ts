// ── Shared Formatters ──────────────────────────────────────────
export const fmtCurrency = (v: number) => `€${v.toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
export const fmtCurrencyDecimal = (v: number) => `€${v.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const fmtPct = (v: number) => `${v}%`
export const fmtCount = (v: number) => v.toLocaleString('nl-NL')
export const fmtDate = (s: string) => new Date(s).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })
export const fmtDateFull = (s: string) => new Date(s).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })
export const fmtChartLabel = (s: string) => new Date(s).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
