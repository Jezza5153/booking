import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { ArrowLeft, Download, RefreshCw, ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Info } from 'lucide-react'
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Line, ComposedChart } from 'recharts'
import { API_BASE_URL } from '../api'
import type { DayStats, PrevDayStats, HeatmapCell, TableUtil, Comparison, Summary, ExtraStats, RevenueData, Tab, ChartMetric, DatePreset, DashboardState } from './stats/types'
import { ACCENT, SERVICE_HOURS, METRIC_DEFINITIONS } from './stats/types'
import { fmtCurrency, fmtCurrencyDecimal, fmtPct, fmtDate, fmtDateFull, fmtChartLabel } from './stats/formatters'
import { MetricTooltip } from './stats/MetricTooltip'
import { MetricDrawer } from './stats/MetricDrawer'
import { LoadingSkeleton, ErrorState, EmptyState } from './stats/LoadingStates'

// ── Date Helpers ───────────────────────────────────────────────
function getPresetRange(p: DatePreset): { from: string; to: string } {
    const now = new Date()
    const fmt = (d: Date) => d.toISOString().split('T')[0]
    const startOfWeek = (d: Date) => { const r = new Date(d); r.setDate(r.getDate() - ((r.getDay() + 6) % 7)); return r }
    switch (p) {
        case '7d': { const f = new Date(now); f.setDate(f.getDate() - 7); return { from: fmt(f), to: fmt(now) } }
        case '30d': { const f = new Date(now); f.setDate(f.getDate() - 30); return { from: fmt(f), to: fmt(now) } }
        case 'week': { const s = startOfWeek(now); const e = new Date(s); e.setDate(e.getDate() + 6); return { from: fmt(s), to: fmt(e) } }
        case 'prev_week': { const s = startOfWeek(now); s.setDate(s.getDate() - 7); const e = new Date(s); e.setDate(e.getDate() + 6); return { from: fmt(s), to: fmt(e) } }
        case 'month': { const s = new Date(now.getFullYear(), now.getMonth(), 1); const e = new Date(now.getFullYear(), now.getMonth() + 1, 0); return { from: fmt(s), to: fmt(e) } }
        case 'prev_month': { const s = new Date(now.getFullYear(), now.getMonth() - 1, 1); const e = new Date(now.getFullYear(), now.getMonth(), 0); return { from: fmt(s), to: fmt(e) } }
    }
}
function detectPreset(range: { from: string; to: string }): DatePreset | null {
    for (const p of ['7d', '30d', 'week', 'prev_week', 'month', 'prev_month'] as DatePreset[]) {
        const r = getPresetRange(p)
        if (r.from === range.from && r.to === range.to) return p
    }
    return null
}

// ── Delta Badge ────────────────────────────────────────────────
const Delta = ({ value, invert }: { value?: number; invert?: boolean }) => {
    if (value === undefined || value === 0) return null
    const good = invert ? value < 0 : value > 0
    return (
        <span className={`inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded ${good ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {good ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {value > 0 ? '+' : ''}{value}%
        </span>
    )
}

// ── Main Component ─────────────────────────────────────────────
interface BookingStatsProps { restaurantId: string; onBack: () => void }
export const BookingStats: React.FC<BookingStatsProps> = ({ restaurantId, onBack }) => {
    // ── State ──
    const [tab, setTab] = useState<Tab>('overzicht')
    const [dateRange, setDateRange] = useState(() => getPresetRange('30d'))
    const [stats, setStats] = useState<DayStats[]>([])
    const [prevDaily, setPrevDaily] = useState<PrevDayStats[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)
    const [comparison, setComparison] = useState<Comparison>({ bookings: 0, couverts: 0, walkins: 0, no_shows: 0, cancellations: 0, revenue: 0 })
    const [heatmap, setHeatmap] = useState<HeatmapCell[]>([])
    const [tableUtil, setTableUtil] = useState<TableUtil[]>([])
    const [repeatRate, setRepeatRate] = useState(0)
    const [revenueData, setRevenueData] = useState<RevenueData>({ total: 0, avg_per_couvert: 0 })
    const [extraStats, setExtraStats] = useState<ExtraStats>({ avgPartySize: 0, busiestDay: null, peakHours: [], activeDays: 0 })
    const [chartMetric, setChartMetric] = useState<ChartMetric>('couverts')
    const [selectedDay, setSelectedDay] = useState<DayStats | null>(null)
    const [selectedMetric, setSelectedMetric] = useState<any>(null)
    const [editingRevenue, setEditingRevenue] = useState<string | null>(null)
    const [revenueInput, setRevenueInput] = useState('')
    const [sortCol, setSortCol] = useState('date')
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
    const token = localStorage.getItem('events_token')

    const activePreset = useMemo(() => detectPreset(dateRange), [dateRange])

    // ── Fetch ──
    const fetchStats = useCallback(async () => {
        setLoading(true); setError(false)
        try {
            const params = new URLSearchParams({ restaurantId, from: dateRange.from, to: dateRange.to })
            const res = await fetch(`${API_BASE_URL}/api/admin/stats?${params}`, { headers: { 'Authorization': `Bearer ${token}` } })
            if (!res.ok) throw new Error('Failed')
            const data = await res.json()

            const today = new Date().toISOString().split('T')[0]
            const from = new Date(dateRange.from), to = new Date(dateRange.to)
            const days: DayStats[] = []
            for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
                const ds = d.toISOString().split('T')[0]
                if (ds > today) continue // Guard: exclude future dates
                const row = (data.daily || []).find((r: any) => r.date === ds)
                days.push({
                    date: ds, bookings: parseInt(row?.bookings) || 0, couverts: parseInt(row?.couverts) || 0,
                    walkins: parseInt(row?.walkins) || 0, noShows: parseInt(row?.no_shows) || 0,
                    cancellations: parseInt(row?.cancellations) || 0, arrived: parseInt(row?.arrived) || 0,
                    revenue: row?.revenue ?? null, revenueNotes: row?.revenue_notes ?? null
                })
            }
            setStats(days)
            setPrevDaily(data.prev_daily || [])
            setComparison(data.comparison || { bookings: 0, couverts: 0, walkins: 0, no_shows: 0, cancellations: 0, revenue: 0 })
            setHeatmap(data.heatmap || [])
            setTableUtil(data.table_utilization || [])
            setRepeatRate(data.repeat_rate || 0)
            setRevenueData(data.revenue || { total: 0, avg_per_couvert: 0 })
            setExtraStats({ avgPartySize: data.avg_party_size || 0, busiestDay: data.busiest_day || null, peakHours: data.peak_hours || [], activeDays: data.active_days || 0 })
            setLastUpdated(new Date())
        } catch (e) { console.error('Stats fetch error:', e); setError(true); setStats([]) }
        finally { setLoading(false) }
    }, [dateRange, restaurantId, token])

    useEffect(() => { fetchStats() }, [fetchStats])

    // ── Derived ──
    const totalSeats = useMemo(() => tableUtil.reduce((s, t) => s + t.seats, 0), [tableUtil])
    const summary = useMemo((): Summary => {
        const b = stats.reduce((s, d) => s + d.bookings, 0)
        const c = stats.reduce((s, d) => s + d.couverts, 0)
        const rev = stats.reduce((s, d) => s + (d.revenue || 0), 0)
        const activeDays = stats.filter(d => d.bookings > 0).length
        const occupancy = totalSeats > 0 && activeDays > 0 ? Math.round((c / (totalSeats * activeDays)) * 100) : 0
        const revpash = totalSeats > 0 && activeDays > 0 ? Math.round(rev / (totalSeats * activeDays * SERVICE_HOURS) * 100) / 100 : 0
        return {
            bookings: b, couverts: c, revenue: rev,
            avgPerDay: activeDays > 0 ? Math.round(c / activeDays) : 0,
            walkins: stats.reduce((s, d) => s + d.walkins, 0),
            noShows: stats.reduce((s, d) => s + d.noShows, 0),
            cancellations: stats.reduce((s, d) => s + d.cancellations, 0),
            noShowRate: b > 0 ? Math.round(stats.reduce((s, d) => s + d.noShows, 0) / b * 100) : 0,
            cancRate: b > 0 ? Math.round(stats.reduce((s, d) => s + d.cancellations, 0) / b * 100) : 0,
            occupancy, revpash, activeDays
        }
    }, [stats, totalSeats])

    // ── Chart data with comparison overlay ──
    const chartData = useMemo(() => {
        return stats.map((d, i) => {
            const prevDay = prevDaily[i]
            return {
                label: fmtChartLabel(d.date), date: d.date,
                couverts: d.couverts, bookings: d.bookings, revenue: d.revenue || 0,
                prevCouverts: prevDay?.couverts ?? null,
                prevBookings: prevDay?.bookings ?? null,
            }
        })
    }, [stats, prevDaily])

    // ── Sorted table ──
    const sortedStats = useMemo(() => {
        const copy = [...stats]
        copy.sort((a, b) => {
            let va: any = a[sortCol as keyof DayStats] ?? 0, vb: any = b[sortCol as keyof DayStats] ?? 0
            if (sortCol === 'avgSpend') { va = a.revenue && a.couverts ? a.revenue / a.couverts : 0; vb = b.revenue && b.couverts ? b.revenue / b.couverts : 0 }
            return sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1)
        })
        return copy
    }, [stats, sortCol, sortDir])

    // ── Handlers ──
    const handleSort = (col: string) => {
        if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
        else { setSortCol(col); setSortDir('desc') }
    }
    const applyPreset = (p: DatePreset) => setDateRange(getPresetRange(p))
    const navigatePeriod = (dir: number) => {
        const diff = Math.round((new Date(dateRange.to).getTime() - new Date(dateRange.from).getTime()) / 86400000) + 1
        const f = new Date(dateRange.from); f.setDate(f.getDate() + dir * diff)
        const t = new Date(dateRange.to); t.setDate(t.getDate() + dir * diff)
        setDateRange({ from: f.toISOString().split('T')[0], to: t.toISOString().split('T')[0] })
    }
    const saveRevenue = async (date: string, amount: string) => {
        try {
            await fetch(`${API_BASE_URL}/api/admin/daily-revenue`, {
                method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ restaurantId, date, revenue: parseFloat(amount) || 0 })
            })
            setEditingRevenue(null); fetchStats()
        } catch (e) { console.error('Revenue save failed:', e) }
    }
    const exportCSV = () => {
        const a = document.createElement('a')
        a.href = `${API_BASE_URL}/api/admin/stats/export?restaurantId=${restaurantId}&from=${dateRange.from}&to=${dateRange.to}`
        a.download = `statistieken_${dateRange.from}_${dateRange.to}.csv`
        a.click()
    }

    // KPI click → open metric detail drawer
    const openKpiDetail = (key: string, label: string, value: string | number, delta?: number, explanation?: string) => {
        const prevMap: Record<string, number | undefined> = {
            revenue: comparison.revenue !== undefined ? Math.round(summary.revenue / (1 + comparison.revenue / 100)) : undefined,
            couverts: comparison.couverts !== undefined ? Math.round(summary.couverts / (1 + comparison.couverts / 100)) : undefined,
        }
        const trendMap: Record<string, { label: string; value: number }[]> = {
            revenue: stats.map(d => ({ label: fmtChartLabel(d.date), value: d.revenue || 0 })),
            couverts: stats.map(d => ({ label: fmtChartLabel(d.date), value: d.couverts })),
            bookings: stats.map(d => ({ label: fmtChartLabel(d.date), value: d.bookings })),
            noShows: stats.map(d => ({ label: fmtChartLabel(d.date), value: d.noShows })),
            cancellations: stats.map(d => ({ label: fmtChartLabel(d.date), value: d.cancellations })),
            walkins: stats.map(d => ({ label: fmtChartLabel(d.date), value: d.walkins })),
            occupancy: stats.map(d => ({ label: fmtChartLabel(d.date), value: totalSeats > 0 ? Math.round(d.couverts / totalSeats * 100) : 0 })),
            revpash: stats.map(d => ({ label: fmtChartLabel(d.date), value: totalSeats > 0 ? Math.round((d.revenue || 0) / (totalSeats * SERVICE_HOURS) * 100) / 100 : 0 })),
        }
        setSelectedMetric({
            key, label, value, delta,
            prevValue: prevMap[key],
            explanation: explanation || `${label} over de geselecteerde periode`,
            trendData: trendMap[key] || []
        })
    }

    const closeDrawer = () => { setSelectedDay(null); setSelectedMetric(null) }

    // Heatmap consts
    const dayLabels = ['Zo', 'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za']
    const hours = Array.from({ length: 12 }, (_, i) => i + 11)
    const heatmapMax = Math.max(...heatmap.map(h => h.count), 1)
    const heatColor = (c: number) => {
        if (!c) return 'bg-gray-100'
        const r = c / heatmapMax
        if (r > 0.75) return 'bg-blue-600 text-white'
        if (r > 0.5) return 'bg-blue-400 text-white'
        if (r > 0.25) return 'bg-blue-200 text-blue-800'
        return 'bg-blue-100 text-blue-600'
    }

    // ── Chart tooltip ──
    const ChartTooltipContent = ({ active, payload, label }: any) => {
        if (!active || !payload?.length) return null
        const curr = payload.find((p: any) => p.dataKey === chartMetric)
        const prev = payload.find((p: any) => p.dataKey === `prev${chartMetric.charAt(0).toUpperCase() + chartMetric.slice(1)}`)
        const fmt = chartMetric === 'revenue' ? fmtCurrency : (v: number) => `${v}`
        return (
            <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2.5 shadow-lg">
                <div className="font-medium mb-1">{label}</div>
                {curr && <div>Huidig: <b>{fmt(curr.value)}</b></div>}
                {prev?.value != null && <div className="text-gray-400 mt-0.5">Vorig: {fmt(prev.value)}</div>}
            </div>
        )
    }

    // Comparison data key for chart overlay
    const prevDataKey = chartMetric === 'revenue' ? null : `prev${chartMetric.charAt(0).toUpperCase() + chartMetric.slice(1)}`

    // ── RENDER ──
    return (
        <div className="bg-gray-50 rounded-xl border border-gray-200 overflow-hidden flex flex-col" style={{ height: 'calc(100vh - 100px)' }}>
            {/* ── HEADER ── */}
            <div className="bg-white border-b border-gray-200 px-5 py-3 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                    <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" style={{ minWidth: 44, minHeight: 44 }}>
                        <ArrowLeft className="w-5 h-5 text-gray-600" />
                    </button>
                    <div>
                        <h1 className="text-xl font-bold text-gray-900">Statistieken</h1>
                        {lastUpdated && <div className="text-xs text-gray-400">Bijgewerkt {lastUpdated.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}</div>}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors" style={{ minHeight: 44 }}>
                        <Download className="w-4 h-4" /> Export CSV
                    </button>
                    <button onClick={fetchStats} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" style={{ minHeight: 44 }}>
                        <RefreshCw className={`w-4 h-4 text-gray-400 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* ── DATE CONTROLS ── */}
            <div className="bg-white border-b border-gray-200 px-5 py-2.5 flex items-center gap-2 flex-wrap shrink-0">
                {([['7d', '7 dagen'], ['30d', '30 dagen'], ['week', 'Deze week'], ['prev_week', 'Vorige week'], ['month', 'Deze maand'], ['prev_month', 'Vorige maand']] as [DatePreset, string][]).map(([key, label]) => (
                    <button key={key} onClick={() => applyPreset(key)}
                        className={`px-3 py-2 text-sm rounded-lg font-medium transition-colors ${activePreset === key ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                        style={{ minHeight: 40 }}>
                        {label}
                    </button>
                ))}
                <div className="flex items-center gap-1 ml-auto">
                    <button onClick={() => navigatePeriod(-1)} className="p-2 hover:bg-gray-100 rounded-lg" style={{ minHeight: 44 }}><ChevronLeft className="w-5 h-5 text-gray-500" /></button>
                    <span className="text-sm text-gray-500 font-medium px-2 tabular-nums">{fmtDate(dateRange.from)} — {fmtDate(dateRange.to)}</span>
                    <button onClick={() => navigatePeriod(1)} className="p-2 hover:bg-gray-100 rounded-lg" style={{ minHeight: 44 }}><ChevronRight className="w-5 h-5 text-gray-500" /></button>
                </div>
            </div>

            {/* ── TABS ── */}
            <div className="bg-white border-b border-gray-200 px-5 flex gap-0 shrink-0">
                {([['overzicht', 'Overzicht'], ['dagelijks', 'Dagelijks'], ['analyse', 'Analyse']] as [Tab, string][]).map(([key, label]) => (
                    <button key={key} onClick={() => setTab(key)}
                        className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${tab === key ? 'text-blue-600 border-blue-600' : 'text-gray-500 border-transparent hover:text-gray-700 hover:border-gray-300'}`}
                        style={{ minHeight: 48 }}>
                        {label}
                    </button>
                ))}
            </div>

            {/* ── CONTENT ── */}
            <div className="flex-1 overflow-y-auto">
                {loading ? <LoadingSkeleton /> : error ? <ErrorState onRetry={fetchStats} /> : stats.length === 0 ? <EmptyState /> : (
                    <>
                        {/* ═══ TAB: OVERZICHT ═══ */}
                        {tab === 'overzicht' && (
                            <div className="p-5 space-y-5">
                                {/* Hero KPIs — CLICKABLE */}
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                    {[
                                        { key: 'revenue', label: 'Omzet', value: fmtCurrency(summary.revenue), delta: comparison.revenue, sub: revenueData.avg_per_couvert > 0 ? `Ø ${fmtCurrencyDecimal(revenueData.avg_per_couvert)}/couvert` : null, tooltip: 'avgSpend', explain: 'Totale handmatig ingevoerde omzet voor deze periode. Klik voor dagtrend.' },
                                        { key: 'couverts', label: 'Couverts', value: summary.couverts, delta: comparison.couverts, sub: `Ø ${summary.avgPerDay}/dag`, explain: 'Totaal aantal gasten (excl. annuleringen). Klik voor dagtrend.' },
                                        { key: 'occupancy', label: 'Bezetting', value: fmtPct(summary.occupancy), sub: `${totalSeats} stoelen · ${summary.activeDays} dagen`, tooltip: 'occupancy', explain: `Berekend als couverts ÷ (${totalSeats} stoelen × ${summary.activeDays} actieve dagen). Houdt geen rekening met meerdere seatings.` },
                                        { key: 'revpash', label: 'RevPASH', value: fmtCurrencyDecimal(summary.revpash), sub: 'omzet per stoel per uur', tooltip: 'revpash', explain: `Omzet ÷ (${totalSeats} stoelen × ${summary.activeDays} dagen × ${SERVICE_HOURS} uur). Industriestandaard efficiëntiemaat.` },
                                    ].map((kpi) => (
                                        <button key={kpi.key} onClick={() => openKpiDetail(kpi.key, kpi.label, kpi.value, kpi.delta, kpi.explain)}
                                            className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md hover:border-blue-200 transition-all text-left cursor-pointer group">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-sm font-medium text-gray-500 group-hover:text-blue-600 transition-colors flex items-center gap-1">
                                                    {kpi.tooltip ? <MetricTooltip metricKey={kpi.tooltip}>{kpi.label}</MetricTooltip> : kpi.label}
                                                </span>
                                                {kpi.delta !== undefined && <Delta value={kpi.delta} />}
                                            </div>
                                            <div className="text-3xl font-bold text-gray-900 tabular-nums">{kpi.value}</div>
                                            {kpi.sub && <div className="text-sm text-gray-400 mt-1">{kpi.sub}</div>}
                                        </button>
                                    ))}
                                </div>

                                {/* Secondary KPIs — CLICKABLE */}
                                <div className="grid grid-cols-3 lg:grid-cols-5 gap-3">
                                    {[
                                        { key: 'bookings', label: 'Boekingen', value: summary.bookings, delta: comparison.bookings, explain: 'Totaal boekingen (excl. annuleringen)' },
                                        { key: 'walkins', label: 'Walk-ins', value: summary.walkins, delta: comparison.walkins, explain: 'Walk-in gasten zonder voorafgaande boeking' },
                                        { key: 'noShows', label: 'No-shows', value: summary.noShows, delta: comparison.no_shows, invert: true, sub: fmtPct(summary.noShowRate), tooltip: 'noShowRate', explain: `${summary.noShows} no-shows op ${summary.bookings} boekingen (${summary.noShowRate}%). Vorige periode: ${comparison.no_shows > 0 ? '+' : ''}${comparison.no_shows}%` },
                                        { key: 'cancellations', label: 'Annuleringen', value: summary.cancellations, delta: comparison.cancellations, invert: true, sub: fmtPct(summary.cancRate), tooltip: 'cancRate', explain: `${summary.cancellations} annuleringen (${summary.cancRate}%). Vorige periode: ${comparison.cancellations > 0 ? '+' : ''}${comparison.cancellations}%` },
                                        { key: 'avgPartySize', label: 'Gem. gezelschap', value: extraStats.avgPartySize, sub: 'personen', explain: 'Gemiddeld aantal gasten per boeking' },
                                    ].map((kpi) => (
                                        <button key={kpi.key} onClick={() => openKpiDetail(kpi.key, kpi.label, kpi.value, kpi.delta, kpi.explain)}
                                            className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm hover:border-blue-200 transition-all text-left cursor-pointer group">
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide group-hover:text-blue-600 transition-colors">
                                                    {kpi.tooltip ? <MetricTooltip metricKey={kpi.tooltip}>{kpi.label}</MetricTooltip> : kpi.label}
                                                </span>
                                                {kpi.delta !== undefined && <Delta value={kpi.delta} invert={kpi.invert} />}
                                            </div>
                                            <div className="text-xl font-bold text-gray-900 tabular-nums">{kpi.value}</div>
                                            {kpi.sub && <div className="text-xs text-gray-400 mt-0.5">{kpi.sub}</div>}
                                        </button>
                                    ))}
                                </div>

                                {/* Hero Chart — with comparison overlay */}
                                <div className="bg-white rounded-xl border border-gray-200 p-5">
                                    <div className="flex items-center justify-between mb-4">
                                        <h2 className="text-base font-semibold text-gray-900">Trend</h2>
                                        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                                            {([['couverts', 'Couverts'], ['bookings', 'Boekingen'], ['revenue', 'Omzet']] as [ChartMetric, string][]).map(([key, label]) => (
                                                <button key={key} onClick={() => setChartMetric(key)}
                                                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${chartMetric === key ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <ResponsiveContainer width="100%" height={240}>
                                        <ComposedChart data={chartData} onClick={(e: any) => { if (e?.activePayload?.[0]) { const d = stats.find(s => s.date === e.activePayload[0].payload.date); if (d) { setSelectedDay(d); setSelectedMetric(null) } } }}>
                                            <defs>
                                                <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor={ACCENT} stopOpacity={0.15} />
                                                    <stop offset="95%" stopColor={ACCENT} stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                            <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                                            <YAxis tick={{ fontSize: 12, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={40} />
                                            <Tooltip content={<ChartTooltipContent />} />
                                            <Area type="monotone" dataKey={chartMetric} stroke={ACCENT} strokeWidth={2} fill="url(#chartGrad)" dot={{ r: 3, fill: ACCENT, stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 6, fill: ACCENT }} />
                                            {/* Previous period comparison line */}
                                            {prevDataKey && <Line type="monotone" dataKey={prevDataKey} stroke="#d1d5db" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls />}
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                    <div className="flex items-center justify-center gap-4 text-xs text-gray-400 mt-2">
                                        <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-blue-600 inline-block" /> Huidig</span>
                                        {prevDataKey && <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-gray-300 inline-block" style={{ borderTop: '1.5px dashed #d1d5db' }} /> Vorige periode</span>}
                                        <span>Klik op een punt voor details</span>
                                    </div>
                                </div>

                                {/* Insight strip */}
                                <div className="flex items-center gap-3 flex-wrap">
                                    {extraStats.busiestDay && <span className="bg-white border border-gray-200 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium">Drukste dag: <b>{extraStats.busiestDay}</b></span>}
                                    {extraStats.peakHours[0] && <span className="bg-white border border-gray-200 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium">Piekuur: <b>{extraStats.peakHours[0].hour}:00</b> ({extraStats.peakHours[0].count}×)</span>}
                                    {repeatRate > 0 && <MetricTooltip metricKey="repeatRate"><span className="bg-white border border-gray-200 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium">Terugkerend: <b>{repeatRate}%</b></span></MetricTooltip>}
                                    {summary.cancRate > 10 && <span className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm font-medium">⚠ Annuleringen hoog: {summary.cancRate}%</span>}
                                </div>
                            </div>
                        )}

                        {/* ═══ TAB: DAGELIJKS ═══ */}
                        {tab === 'dagelijks' && (
                            <div className="p-5">
                                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                                    <table className="w-full text-sm">
                                        <thead className="bg-gray-50 sticky top-0">
                                            <tr>
                                                {[
                                                    { key: 'date', label: 'Datum', align: 'left' as const },
                                                    { key: 'bookings', label: 'Boekingen', align: 'right' as const },
                                                    { key: 'couverts', label: 'Couverts', align: 'right' as const },
                                                    { key: 'walkins', label: 'Walk-ins', align: 'right' as const },
                                                    { key: 'noShows', label: 'No-shows', align: 'right' as const },
                                                    { key: 'cancellations', label: 'Annul.', align: 'right' as const },
                                                    { key: 'revenue', label: 'Omzet', align: 'right' as const },
                                                    { key: 'avgSpend', label: 'Ø/couvert', align: 'right' as const },
                                                ].map(col => (
                                                    <th key={col.key} onClick={() => handleSort(col.key)}
                                                        className={`px-4 py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900 select-none transition-colors ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                                                        style={{ minHeight: 44 }}>
                                                        <span className="inline-flex items-center gap-1">
                                                            {col.label}
                                                            {sortCol === col.key && <span className="text-blue-600">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                                                        </span>
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {sortedStats.map((day, i) => {
                                                const avgSpend = day.revenue && day.couverts > 0 ? (day.revenue / day.couverts).toFixed(2) : null
                                                const sel = selectedDay?.date === day.date
                                                return (
                                                    <tr key={i} onClick={() => { setSelectedDay(sel ? null : day); setSelectedMetric(null) }}
                                                        className={`cursor-pointer transition-colors border-t border-gray-100 ${sel ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                                                        style={{ minHeight: 48 }}>
                                                        <td className="px-4 py-3 font-medium text-gray-900">{fmtDate(day.date)}</td>
                                                        <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-900">{day.bookings || <span className="text-gray-300">—</span>}</td>
                                                        <td className="px-4 py-3 text-right tabular-nums font-medium text-blue-600">{day.couverts || <span className="text-gray-300">—</span>}</td>
                                                        <td className="px-4 py-3 text-right tabular-nums text-gray-600">{day.walkins || <span className="text-gray-300">—</span>}</td>
                                                        <td className="px-4 py-3 text-right tabular-nums">{day.noShows ? <span className="text-red-600 font-medium">{day.noShows}</span> : <span className="text-gray-300">—</span>}</td>
                                                        <td className="px-4 py-3 text-right tabular-nums">{day.cancellations ? <span className="text-orange-600 font-medium">{day.cancellations}</span> : <span className="text-gray-300">—</span>}</td>
                                                        <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                                                            {editingRevenue === day.date ? (
                                                                <form className="inline-flex items-center gap-1" onSubmit={e => { e.preventDefault(); saveRevenue(day.date, revenueInput) }}>
                                                                    <span className="text-gray-400">€</span>
                                                                    <input type="number" step="0.01" autoFocus className="w-20 border border-blue-300 rounded-md px-2 py-1.5 text-right text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                                                        value={revenueInput} onChange={e => setRevenueInput(e.target.value)} onBlur={() => saveRevenue(day.date, revenueInput)} />
                                                                </form>
                                                            ) : (
                                                                <button onClick={() => { setEditingRevenue(day.date); setRevenueInput(day.revenue?.toString() || '') }}
                                                                    className={`py-1.5 px-2 rounded transition-colors text-sm ${day.revenue != null ? 'text-gray-900 font-medium hover:bg-gray-100' : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'}`}
                                                                    style={{ minHeight: 36 }}>
                                                                    {day.revenue != null ? fmtCurrency(day.revenue) : '+ invoer'}
                                                                </button>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3 text-right tabular-nums text-gray-500">{avgSpend ? `€${avgSpend}` : <span className="text-gray-300">—</span>}</td>
                                                    </tr>
                                                )
                                            })}
                                            <tr className="bg-gray-50 font-bold border-t-2 border-gray-200 sticky bottom-0">
                                                <td className="px-4 py-3 text-gray-900">Totaal</td>
                                                <td className="px-4 py-3 text-right tabular-nums text-gray-900">{summary.bookings}</td>
                                                <td className="px-4 py-3 text-right tabular-nums text-blue-700">{summary.couverts}</td>
                                                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{summary.walkins}</td>
                                                <td className="px-4 py-3 text-right tabular-nums text-red-700">{summary.noShows}</td>
                                                <td className="px-4 py-3 text-right tabular-nums text-orange-700">{summary.cancellations}</td>
                                                <td className="px-4 py-3 text-right tabular-nums text-gray-900">{fmtCurrency(summary.revenue)}</td>
                                                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{revenueData.avg_per_couvert > 0 ? fmtCurrencyDecimal(revenueData.avg_per_couvert) : '—'}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* ═══ TAB: ANALYSE ═══ */}
                        {tab === 'analyse' && (
                            <div className="p-5 space-y-5">
                                {/* Cancellation trend */}
                                {summary.cancellations > 0 && (
                                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                                        <div className="flex items-center justify-between mb-4">
                                            <h2 className="text-base font-semibold text-gray-900">Annuleringstrend</h2>
                                            <Delta value={comparison.cancellations} invert />
                                        </div>
                                        <ResponsiveContainer width="100%" height={160}>
                                            <BarChart data={stats.filter(d => d.cancellations > 0).map(d => ({ label: fmtChartLabel(d.date), cancellations: d.cancellations, noShows: d.noShows }))}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                                                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={25} allowDecimals={false} />
                                                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                                                <Bar dataKey="cancellations" fill="#f97316" radius={[3, 3, 0, 0]} name="Annuleringen" />
                                                <Bar dataKey="noShows" fill="#ef4444" radius={[3, 3, 0, 0]} name="No-shows" />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                )}

                                {/* Heatmap */}
                                <div className="bg-white rounded-xl border border-gray-200 p-5">
                                    <h2 className="text-base font-semibold text-gray-900 mb-4">Drukte per dag & uur</h2>
                                    <div className="overflow-x-auto">
                                        <table className="text-sm border-separate" style={{ borderSpacing: '3px' }}>
                                            <thead>
                                                <tr>
                                                    <th className="w-10" />
                                                    {hours.map(h => <th key={h} className="text-xs text-gray-400 font-normal text-center w-10 pb-1">{h}:00</th>)}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {dayLabels.map((day, dow) => (
                                                    <tr key={dow}>
                                                        <td className="text-sm text-gray-600 font-medium pr-2">{day}</td>
                                                        {hours.map(hour => {
                                                            const c = heatmap.find(h => h.dow === dow && h.hour === hour)?.count || 0
                                                            return (
                                                                <td key={hour}>
                                                                    <button className={`w-10 h-9 rounded flex items-center justify-center text-xs font-medium ${heatColor(c)} transition-all hover:ring-2 hover:ring-blue-400 cursor-pointer`}
                                                                        onClick={() => { /* Could open drawer with slot details */ }}
                                                                        title={`${day} ${hour}:00 — ${c} boekingen`}>
                                                                        {c > 0 ? c : ''}
                                                                    </button>
                                                                </td>
                                                            )
                                                        })}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="flex items-center gap-2 mt-3 text-xs text-gray-400">
                                        <span>Weinig</span>
                                        <div className="flex gap-1">{['bg-gray-100', 'bg-blue-100', 'bg-blue-200', 'bg-blue-400', 'bg-blue-600'].map((c, i) => <span key={i} className={`w-5 h-4 ${c} rounded`} />)}</div>
                                        <span>Veel</span>
                                    </div>
                                </div>

                                {/* Table utilization */}
                                <div className="bg-white rounded-xl border border-gray-200 p-5">
                                    <h2 className="text-base font-semibold text-gray-900 mb-4">Tafelbezetting</h2>
                                    <div className="space-y-2 max-h-72 overflow-y-auto">
                                        {tableUtil.map(t => {
                                            const maxCount = Math.max(...tableUtil.map(x => x.booking_count), 1)
                                            const pct = Math.round((t.booking_count / maxCount) * 100)
                                            return (
                                                <div key={t.id} className="flex items-center gap-3 text-sm hover:bg-gray-50 rounded-lg px-2 py-1.5 transition-colors">
                                                    <span className="w-28 shrink-0 text-gray-800 font-medium truncate">{t.name} <span className="text-gray-400 text-xs">({t.seats}p)</span></span>
                                                    <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                                                        <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%`, minWidth: t.booking_count > 0 ? '8px' : '0' }} />
                                                    </div>
                                                    <span className="w-24 shrink-0 text-right text-gray-500 text-sm tabular-nums">{t.booking_count} boek. · {t.total_guests}p</span>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>

                                {/* Covers bar chart */}
                                <div className="bg-white rounded-xl border border-gray-200 p-5">
                                    <h2 className="text-base font-semibold text-gray-900 mb-4">Couverts per dag</h2>
                                    <ResponsiveContainer width="100%" height={200}>
                                        <BarChart data={chartData} onClick={(e: any) => { if (e?.activePayload?.[0]) { const d = stats.find(s => s.date === e.activePayload[0].payload.date); if (d) { setSelectedDay(d); setSelectedMetric(null) } } }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                            <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                                            <YAxis tick={{ fontSize: 12, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={30} />
                                            <Tooltip content={<ChartTooltipContent />} />
                                            <Bar dataKey="couverts" fill={ACCENT} radius={[4, 4, 0, 0]} cursor="pointer" />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* ── METRIC DRAWER ── */}
            <MetricDrawer
                day={selectedDay}
                metric={selectedMetric}
                totalSeats={totalSeats}
                onClose={closeDrawer}
                onViewBookings={(date) => { closeDrawer(); onBack() }}
            />
        </div>
    )
}
