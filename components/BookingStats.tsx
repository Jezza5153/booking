import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { ArrowLeft, Download, RefreshCw, ChevronLeft, ChevronRight, TrendingUp, TrendingDown, X, ArrowUpRight } from 'lucide-react'
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { API_BASE_URL } from '../api'

// ── Types ──────────────────────────────────────────────────────────
interface BookingStatsProps { restaurantId: string; onBack: () => void }
interface DayStats {
    date: string; bookings: number; couverts: number; walkins: number; noShows: number
    cancellations: number; arrived: number; revenue: number | null; revenueNotes: string | null
}
interface HeatmapCell { dow: number; hour: number; count: number }
interface TableUtil { id: string; name: string; seats: number; zone: string; booking_count: number; total_guests: number }
type Tab = 'overzicht' | 'dagelijks' | 'analyse'
type ChartMetric = 'couverts' | 'bookings' | 'revenue'
type DatePreset = '7d' | '30d' | 'week' | 'prev_week' | 'month' | 'prev_month'

// ── Constants ──────────────────────────────────────────────────────
const ACCENT = { bg: 'bg-blue-600', text: 'text-blue-600', light: 'bg-blue-50', ring: 'ring-blue-500', fill: '#2563eb', fillLight: '#dbeafe' }
const SERVICE_HOURS = 11 // 11:00–22:00

// ── Date Helpers ───────────────────────────────────────────────────
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

// ── Main Component ─────────────────────────────────────────────────
export const BookingStats: React.FC<BookingStatsProps> = ({ restaurantId, onBack }) => {
    // State
    const [tab, setTab] = useState<Tab>('overzicht')
    const [preset, setPreset] = useState<DatePreset>('30d')
    const [dateRange, setDateRange] = useState(() => getPresetRange('30d'))
    const [stats, setStats] = useState<DayStats[]>([])
    const [loading, setLoading] = useState(true)
    const [comparison, setComparison] = useState<Record<string, number>>({})
    const [heatmap, setHeatmap] = useState<HeatmapCell[]>([])
    const [tableUtil, setTableUtil] = useState<TableUtil[]>([])
    const [repeatRate, setRepeatRate] = useState(0)
    const [revenueData, setRevenueData] = useState({ total: 0, avg_per_couvert: 0 })
    const [extraStats, setExtraStats] = useState({ avgPartySize: 0, busiestDay: null as string | null, peakHours: [] as { hour: number; count: number }[], activeDays: 0 })
    const [chartMetric, setChartMetric] = useState<ChartMetric>('couverts')
    const [selectedDay, setSelectedDay] = useState<DayStats | null>(null)
    const [editingRevenue, setEditingRevenue] = useState<string | null>(null)
    const [revenueInput, setRevenueInput] = useState('')
    const [sortCol, setSortCol] = useState<string>('date')
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
    const token = localStorage.getItem('events_token')

    // Fetch
    const fetchStats = useCallback(async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams({ restaurantId, from: dateRange.from, to: dateRange.to })
            const res = await fetch(`${API_BASE_URL}/api/admin/stats?${params}`, { headers: { 'Authorization': `Bearer ${token}` } })
            if (!res.ok) throw new Error('Failed')
            const data = await res.json()

            // Fill all days in range
            const from = new Date(dateRange.from), to = new Date(dateRange.to)
            const days: DayStats[] = []
            for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
                const ds = d.toISOString().split('T')[0]
                const row = (data.daily || []).find((r: any) => r.date === ds)
                days.push({
                    date: ds, bookings: parseInt(row?.bookings) || 0, couverts: parseInt(row?.couverts) || 0,
                    walkins: parseInt(row?.walkins) || 0, noShows: parseInt(row?.no_shows) || 0,
                    cancellations: parseInt(row?.cancellations) || 0, arrived: parseInt(row?.arrived) || 0,
                    revenue: row?.revenue ?? null, revenueNotes: row?.revenue_notes ?? null
                })
            }
            setStats(days)
            setComparison(data.comparison || {})
            setHeatmap(data.heatmap || [])
            setTableUtil(data.table_utilization || [])
            setRepeatRate(data.repeat_rate || 0)
            setRevenueData(data.revenue || { total: 0, avg_per_couvert: 0 })
            setExtraStats({ avgPartySize: data.avg_party_size || 0, busiestDay: data.busiest_day || null, peakHours: data.peak_hours || [], activeDays: data.active_days || 0 })
        } catch (e) { console.error('Stats fetch error:', e); setStats([]) }
        finally { setLoading(false) }
    }, [dateRange, restaurantId, token])

    useEffect(() => { fetchStats() }, [fetchStats])

    // Derived
    const totalSeats = useMemo(() => tableUtil.reduce((s, t) => s + t.seats, 0), [tableUtil])
    const summary = useMemo(() => {
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

    // Chart data
    const chartData = useMemo(() => stats.map(d => ({
        label: new Date(d.date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }),
        date: d.date, couverts: d.couverts, bookings: d.bookings, revenue: d.revenue || 0
    })), [stats])

    // Sorted table data
    const sortedStats = useMemo(() => {
        const copy = [...stats]
        copy.sort((a, b) => {
            let va: any = a[sortCol as keyof DayStats] ?? 0, vb: any = b[sortCol as keyof DayStats] ?? 0
            if (sortCol === 'avgSpend') { va = a.revenue && a.couverts ? a.revenue / a.couverts : 0; vb = b.revenue && b.couverts ? b.revenue / b.couverts : 0 }
            return sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1)
        })
        return copy
    }, [stats, sortCol, sortDir])

    const handleSort = (col: string) => {
        if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
        else { setSortCol(col); setSortDir('desc') }
    }

    const applyPreset = (p: DatePreset) => { setPreset(p); setDateRange(getPresetRange(p)) }
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
    const exportCSV = () => { window.open(`${API_BASE_URL}/api/admin/stats/export?restaurantId=${restaurantId}&from=${dateRange.from}&to=${dateRange.to}`, '_blank') }
    const fmtDate = (s: string) => new Date(s).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })
    const fmtDateFull = (s: string) => new Date(s).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })

    // Delta badge
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

    // Chart tooltip
    const ChartTooltip = ({ active, payload, label }: any) => {
        if (!active || !payload?.length) return null
        return (
            <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg">
                <div className="font-medium mb-1">{label}</div>
                <div>{payload[0]?.value} {chartMetric === 'revenue' ? '€' : chartMetric}</div>
            </div>
        )
    }

    // Heatmap
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

    // ── RENDER ──────────────────────────────────────────────────────
    return (
        <div className="bg-gray-50 rounded-xl border border-gray-200 overflow-hidden flex flex-col" style={{ height: 'calc(100vh - 100px)' }}>
            {/* ── HEADER ── */}
            <div className="bg-white border-b border-gray-200 px-5 py-3 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                    <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" style={{ minWidth: 44, minHeight: 44 }}>
                        <ArrowLeft className="w-5 h-5 text-gray-600" />
                    </button>
                    <h1 className="text-xl font-bold text-gray-900">Statistieken</h1>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors" style={{ minHeight: 44 }}>
                        <Download className="w-4 h-4" /> Export
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
                        className={`px-3 py-2 text-sm rounded-lg font-medium transition-colors ${preset === key ? `${ACCENT.bg} text-white` : 'text-gray-600 hover:bg-gray-100'}`}
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
                        className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${tab === key ? `${ACCENT.text} border-blue-600` : 'text-gray-500 border-transparent hover:text-gray-700 hover:border-gray-300'}`}
                        style={{ minHeight: 48 }}>
                        {label}
                    </button>
                ))}
            </div>

            {/* ── CONTENT ── */}
            <div className="flex-1 overflow-y-auto">
                {loading ? (
                    <div className="p-12 text-center">
                        <div className="inline-block w-8 h-8 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
                        <div className="text-sm text-gray-400 mt-3">Data laden...</div>
                    </div>
                ) : (
                    <>
                        {/* ═══ TAB: OVERZICHT ═══ */}
                        {tab === 'overzicht' && (
                            <div className="p-5 space-y-5">
                                {/* Hero KPIs — large, 4 across */}
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                    {[
                                        { label: 'Omzet', value: `€${summary.revenue.toLocaleString('nl-NL')}`, delta: comparison.couverts, sub: revenueData.avg_per_couvert > 0 ? `Ø €${revenueData.avg_per_couvert}/couvert` : null },
                                        { label: 'Couverts', value: summary.couverts, delta: comparison.couverts, sub: `Ø ${summary.avgPerDay}/dag` },
                                        { label: 'Bezetting', value: `${summary.occupancy}%`, sub: `${totalSeats} stoelen · ${summary.activeDays} dagen` },
                                        { label: 'RevPASH', value: `€${summary.revpash}`, sub: 'omzet per stoel per uur' },
                                    ].map((kpi, i) => (
                                        <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow cursor-default">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-sm font-medium text-gray-500">{kpi.label}</span>
                                                {kpi.delta !== undefined && <Delta value={kpi.delta} />}
                                            </div>
                                            <div className="text-3xl font-bold text-gray-900 tabular-nums">{kpi.value}</div>
                                            {kpi.sub && <div className="text-sm text-gray-400 mt-1">{kpi.sub}</div>}
                                        </div>
                                    ))}
                                </div>

                                {/* Secondary KPIs — smaller, 5 across */}
                                <div className="grid grid-cols-3 lg:grid-cols-5 gap-3">
                                    {[
                                        { label: 'Boekingen', value: summary.bookings, delta: comparison.bookings },
                                        { label: 'Walk-ins', value: summary.walkins, delta: comparison.walkins },
                                        { label: 'No-shows', value: summary.noShows, delta: comparison.no_shows, invert: true, sub: `${summary.noShowRate}%` },
                                        { label: 'Annuleringen', value: summary.cancellations, sub: `${summary.cancRate}%` },
                                        { label: 'Gem. gezelschap', value: extraStats.avgPartySize, sub: 'personen' },
                                    ].map((kpi, i) => (
                                        <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm transition-shadow cursor-default">
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{kpi.label}</span>
                                                {kpi.delta !== undefined && <Delta value={kpi.delta} invert={kpi.invert} />}
                                            </div>
                                            <div className="text-xl font-bold text-gray-900 tabular-nums">{kpi.value}</div>
                                            {kpi.sub && <div className="text-xs text-gray-400 mt-0.5">{kpi.sub}</div>}
                                        </div>
                                    ))}
                                </div>

                                {/* Hero Chart */}
                                <div className="bg-white rounded-xl border border-gray-200 p-5">
                                    <div className="flex items-center justify-between mb-4">
                                        <h2 className="text-base font-semibold text-gray-900">Trend</h2>
                                        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                                            {([['couverts', 'Couverts'], ['bookings', 'Boekingen'], ['revenue', 'Omzet']] as [ChartMetric, string][]).map(([key, label]) => (
                                                <button key={key} onClick={() => setChartMetric(key)}
                                                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${chartMetric === key ? `${ACCENT.bg} text-white` : 'text-gray-500 hover:bg-gray-50'}`}>
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <ResponsiveContainer width="100%" height={240}>
                                        <AreaChart data={chartData} onClick={(e: any) => { if (e?.activePayload?.[0]) { const d = stats.find(s => s.date === e.activePayload[0].payload.date); if (d) setSelectedDay(d) } }}>
                                            <defs>
                                                <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor={ACCENT.fill} stopOpacity={0.15} />
                                                    <stop offset="95%" stopColor={ACCENT.fill} stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                            <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                                            <YAxis tick={{ fontSize: 12, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={40} />
                                            <Tooltip content={<ChartTooltip />} />
                                            <Area type="monotone" dataKey={chartMetric} stroke={ACCENT.fill} strokeWidth={2} fill="url(#chartGrad)" dot={{ r: 3, fill: ACCENT.fill, stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 6, fill: ACCENT.fill }} />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                    <div className="text-xs text-gray-400 mt-2 text-center">Klik op een punt voor dagdetails</div>
                                </div>

                                {/* Insight strip */}
                                <div className="flex items-center gap-3 flex-wrap">
                                    {extraStats.busiestDay && <span className="bg-white border border-gray-200 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium">Drukste dag: <b>{extraStats.busiestDay}</b></span>}
                                    {extraStats.peakHours[0] && <span className="bg-white border border-gray-200 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium">Piekuur: <b>{extraStats.peakHours[0].hour}:00</b> ({extraStats.peakHours[0].count}×)</span>}
                                    {repeatRate > 0 && <span className="bg-white border border-gray-200 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium">Terugkerend: <b>{repeatRate}%</b></span>}
                                </div>
                            </div>
                        )}

                        {/* ═══ TAB: DAGELIJKS ═══ */}
                        {tab === 'dagelijks' && (
                            <div className="p-5">
                                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                                    <table className="w-full text-sm">
                                        <thead className="bg-gray-50">
                                            <tr>
                                                {[
                                                    { key: 'date', label: 'Datum', align: 'left' },
                                                    { key: 'bookings', label: 'Boekingen', align: 'right' },
                                                    { key: 'couverts', label: 'Couverts', align: 'right' },
                                                    { key: 'walkins', label: 'Walk-ins', align: 'right' },
                                                    { key: 'noShows', label: 'No-shows', align: 'right' },
                                                    { key: 'cancellations', label: 'Annul.', align: 'right' },
                                                    { key: 'revenue', label: 'Omzet', align: 'right' },
                                                    { key: 'avgSpend', label: 'Ø/couvert', align: 'right' },
                                                ].map(col => (
                                                    <th key={col.key} onClick={() => handleSort(col.key)}
                                                        className={`px-4 py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900 select-none transition-colors text-${col.align}`}
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
                                                    <tr key={i} onClick={() => setSelectedDay(sel ? null : day)}
                                                        className={`cursor-pointer transition-colors border-t border-gray-100 ${sel ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                                                        style={{ minHeight: 48 }}>
                                                        <td className="px-4 py-3 font-medium text-gray-900">{fmtDate(day.date)}</td>
                                                        <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-900">{day.bookings || <span className="text-gray-300">—</span>}</td>
                                                        <td className="px-4 py-3 text-right tabular-nums font-medium text-blue-600">{day.couverts || <span className="text-gray-300">—</span>}</td>
                                                        <td className="px-4 py-3 text-right tabular-nums text-gray-600">{day.walkins || <span className="text-gray-300">—</span>}</td>
                                                        <td className="px-4 py-3 text-right tabular-nums text-gray-600">{day.noShows ? <span className="text-red-600">{day.noShows}</span> : <span className="text-gray-300">—</span>}</td>
                                                        <td className="px-4 py-3 text-right tabular-nums text-gray-600">{day.cancellations ? <span className="text-orange-600">{day.cancellations}</span> : <span className="text-gray-300">—</span>}</td>
                                                        <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                                                            {editingRevenue === day.date ? (
                                                                <form className="inline-flex items-center gap-1" onSubmit={e => { e.preventDefault(); saveRevenue(day.date, revenueInput) }}>
                                                                    <span className="text-gray-400">€</span>
                                                                    <input type="number" step="0.01" autoFocus className="w-20 border border-blue-300 rounded-md px-2 py-1.5 text-right text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                                                        value={revenueInput} onChange={e => setRevenueInput(e.target.value)} onBlur={() => saveRevenue(day.date, revenueInput)} />
                                                                </form>
                                                            ) : (
                                                                <button onClick={() => { setEditingRevenue(day.date); setRevenueInput(day.revenue?.toString() || '') }}
                                                                    className={`py-1.5 px-2 rounded transition-colors text-sm ${day.revenue != null ? 'text-gray-900 font-medium hover:bg-gray-100' : 'text-gray-300 hover:text-blue-600 hover:bg-blue-50'}`}
                                                                    style={{ minHeight: 36 }}>
                                                                    {day.revenue != null ? `€${day.revenue.toLocaleString('nl-NL')}` : '+ invoer'}
                                                                </button>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3 text-right tabular-nums text-gray-500">{avgSpend ? `€${avgSpend}` : <span className="text-gray-300">—</span>}</td>
                                                    </tr>
                                                )
                                            })}
                                            {/* Totals */}
                                            <tr className="bg-gray-50 font-bold border-t-2 border-gray-200">
                                                <td className="px-4 py-3 text-gray-900">Totaal</td>
                                                <td className="px-4 py-3 text-right tabular-nums text-gray-900">{summary.bookings}</td>
                                                <td className="px-4 py-3 text-right tabular-nums text-blue-700">{summary.couverts}</td>
                                                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{summary.walkins}</td>
                                                <td className="px-4 py-3 text-right tabular-nums text-red-700">{summary.noShows}</td>
                                                <td className="px-4 py-3 text-right tabular-nums text-orange-700">{summary.cancellations}</td>
                                                <td className="px-4 py-3 text-right tabular-nums text-gray-900">€{summary.revenue.toLocaleString('nl-NL')}</td>
                                                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{revenueData.avg_per_couvert > 0 ? `€${revenueData.avg_per_couvert}` : '—'}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* ═══ TAB: ANALYSE ═══ */}
                        {tab === 'analyse' && (
                            <div className="p-5 space-y-5">
                                {/* Heatmap */}
                                <div className="bg-white rounded-xl border border-gray-200 p-5">
                                    <h2 className="text-base font-semibold text-gray-900 mb-4">Drukte per dag & uur</h2>
                                    <div className="overflow-x-auto">
                                        <table className="text-sm border-separate" style={{ borderSpacing: '3px' }}>
                                            <thead>
                                                <tr>
                                                    <th className="w-10" />
                                                    {hours.map(h => <th key={h} className="text-xs text-gray-400 font-normal text-center w-9 pb-1">{h}:00</th>)}
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
                                                                    <div className={`w-9 h-8 rounded flex items-center justify-center text-xs font-medium ${heatColor(c)} transition-colors cursor-default`}
                                                                        title={`${day} ${hour}:00 — ${c} boekingen`}>
                                                                        {c > 0 ? c : ''}
                                                                    </div>
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
                                            const pct = Math.max(...tableUtil.map(x => x.booking_count), 1) > 0 ? Math.round((t.booking_count / Math.max(...tableUtil.map(x => x.booking_count), 1)) * 100) : 0
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
                                        <BarChart data={chartData} onClick={(e: any) => { if (e?.activePayload?.[0]) { const d = stats.find(s => s.date === e.activePayload[0].payload.date); if (d) setSelectedDay(d) } }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                            <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                                            <YAxis tick={{ fontSize: 12, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={30} />
                                            <Tooltip content={<ChartTooltip />} />
                                            <Bar dataKey="couverts" fill={ACCENT.fill} radius={[4, 4, 0, 0]} cursor="pointer" />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* ── DETAIL DRAWER ── */}
            {selectedDay && (
                <div className="absolute inset-y-0 right-0 w-80 bg-white border-l border-gray-200 shadow-xl z-30 flex flex-col" style={{ position: 'fixed', top: 0, bottom: 0 }}>
                    <div className="p-5 border-b border-gray-200 flex items-center justify-between shrink-0">
                        <h3 className="text-base font-bold text-gray-900">{fmtDateFull(selectedDay.date)}</h3>
                        <button onClick={() => setSelectedDay(null)} className="p-2 hover:bg-gray-100 rounded-lg" style={{ minHeight: 44 }}><X className="w-5 h-5 text-gray-500" /></button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-5 space-y-5">
                        {/* KPIs */}
                        <div className="grid grid-cols-2 gap-3">
                            {[
                                { l: 'Boekingen', v: selectedDay.bookings },
                                { l: 'Couverts', v: selectedDay.couverts },
                                { l: 'Walk-ins', v: selectedDay.walkins },
                                { l: 'No-shows', v: selectedDay.noShows },
                                { l: 'Annuleringen', v: selectedDay.cancellations },
                                { l: 'Omzet', v: selectedDay.revenue != null ? `€${selectedDay.revenue}` : '—' },
                            ].map((k, i) => (
                                <div key={i} className="bg-gray-50 rounded-lg p-3">
                                    <div className="text-xs text-gray-500 mb-1">{k.l}</div>
                                    <div className="text-xl font-bold text-gray-900">{k.v}</div>
                                </div>
                            ))}
                        </div>
                        {/* Avg spend */}
                        {selectedDay.revenue != null && selectedDay.couverts > 0 && (
                            <div className="bg-blue-50 rounded-lg p-4">
                                <div className="text-sm text-blue-600 font-medium">Gemiddelde besteding</div>
                                <div className="text-2xl font-bold text-blue-900 mt-1">€{(selectedDay.revenue / selectedDay.couverts).toFixed(2)}</div>
                                <div className="text-sm text-blue-500 mt-1">per couvert</div>
                            </div>
                        )}
                        {/* Occupancy for that day */}
                        {totalSeats > 0 && (
                            <div className="bg-gray-50 rounded-lg p-4">
                                <div className="text-sm text-gray-600 font-medium">Bezetting</div>
                                <div className="text-2xl font-bold text-gray-900 mt-1">{Math.round((selectedDay.couverts / totalSeats) * 100)}%</div>
                                <div className="text-sm text-gray-400 mt-1">{selectedDay.couverts} van {totalSeats} stoelen</div>
                            </div>
                        )}
                        {/* Link to bookings view */}
                        <button className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors" style={{ minHeight: 48 }}
                            onClick={() => { setSelectedDay(null); onBack() }}>
                            <ArrowUpRight className="w-4 h-4" /> Bekijk boekingen
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
