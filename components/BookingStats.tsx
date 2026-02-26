import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { ArrowLeft, Download, RefreshCw, ChevronLeft, ChevronRight, FileText } from 'lucide-react'
import { API_BASE_URL } from '../api'
import type { DayStats, PrevDayStats, HeatmapCell, TableUtil, Comparison, Summary, ExtraStats, RevenueData, Tab, ChartMetric, DatePreset, MetricDetail, PartySizeBucket, LeadTimeBucket } from './stats/types'
import { SERVICE_CONFIG } from './stats/types'
import { fmtCurrency, fmtCurrencyDecimal, fmtPct, fmtDate, fmtChartLabel } from './stats/formatters'
import { MetricDrawer } from './stats/MetricDrawer'
import { LoadingSkeleton, ErrorState, EmptyState } from './stats/LoadingStates'
import { KpiGrid } from './stats/KpiGrid'
import { HeroChart } from './stats/HeroChart'
import { DailyTable } from './stats/DailyTable'
import { HeatmapCard } from './stats/HeatmapCard'
import { AnalyseCharts } from './stats/AnalyseCharts'
import { HealthSummary } from './stats/HealthSummary'
import { DateRangePicker } from './stats/DateRangePicker'
import { RevenueQuickEntry } from './stats/RevenueQuickEntry'

interface YoyData { bookings: number | null; couverts: number | null; revenue: number | null; has_data: boolean }

// ── Date Helpers ───────────────────────────────────────────────
function getPresetRange(p: DatePreset): { from: string; to: string } {
    const now = new Date()
    const fmt = (d: Date) => d.toISOString().split('T')[0]
    const sow = (d: Date) => { const r = new Date(d); r.setDate(r.getDate() - ((r.getDay() + 6) % 7)); return r }
    switch (p) {
        case '7d': { const f = new Date(now); f.setDate(f.getDate() - 7); return { from: fmt(f), to: fmt(now) } }
        case '30d': { const f = new Date(now); f.setDate(f.getDate() - 30); return { from: fmt(f), to: fmt(now) } }
        case 'week': { const s = sow(now); const e = new Date(s); e.setDate(e.getDate() + 6); return { from: fmt(s), to: fmt(e) } }
        case 'prev_week': { const s = sow(now); s.setDate(s.getDate() - 7); const e = new Date(s); e.setDate(e.getDate() + 6); return { from: fmt(s), to: fmt(e) } }
        case 'month': return { from: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), to: fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }
        case 'prev_month': return { from: fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: fmt(new Date(now.getFullYear(), now.getMonth(), 0)) }
    }
}
function detectPreset(range: { from: string; to: string }): DatePreset | null {
    for (const p of ['7d', '30d', 'week', 'prev_week', 'month', 'prev_month'] as DatePreset[])
        if (getPresetRange(p).from === range.from && getPresetRange(p).to === range.to) return p
    return null
}

// ── URL sync helpers ───────────────────────────────────────────
function readUrlState(): { tab?: Tab; from?: string; to?: string } {
    const p = new URLSearchParams(window.location.search)
    return { tab: (p.get('tab') as Tab) || undefined, from: p.get('from') || undefined, to: p.get('to') || undefined }
}
function writeUrlState(tab: Tab, range: { from: string; to: string }) {
    const p = new URLSearchParams(window.location.search)
    p.set('tab', tab); p.set('from', range.from); p.set('to', range.to)
    window.history.replaceState(null, '', `?${p}`)
}

// ── Main Orchestrator ──────────────────────────────────────────
interface Props { restaurantId: string; onBack: (date?: string) => void }

export const BookingStats: React.FC<Props> = ({ restaurantId, onBack }) => {
    const urlState = useMemo(() => readUrlState(), [])

    const [tab, setTab] = useState<Tab>(urlState.tab || 'overzicht')
    const [dateRange, setDateRange] = useState(() => urlState.from && urlState.to ? { from: urlState.from, to: urlState.to } : getPresetRange('30d'))
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
    const [partySizes, setPartySizes] = useState<PartySizeBucket[]>([])
    const [leadTimes, setLeadTimes] = useState<LeadTimeBucket[]>([])
    const [yoy, setYoy] = useState<YoyData>({ bookings: null, couverts: null, revenue: null, has_data: false })
    const [chartMetric, setChartMetric] = useState<ChartMetric>('couverts')
    const [selectedDay, setSelectedDay] = useState<DayStats | null>(null)
    const [selectedMetric, setSelectedMetric] = useState<MetricDetail | null>(null)
    const [editingRevenue, setEditingRevenue] = useState<string | null>(null)
    const [revenueInput, setRevenueInput] = useState('')
    const [sortCol, setSortCol] = useState('date')
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
    const token = localStorage.getItem('events_token')

    // Sync state → URL
    useEffect(() => { writeUrlState(tab, dateRange) }, [tab, dateRange])
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
                if (ds > today) continue
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
            setPartySizes(data.party_size_distribution || [])
            setLeadTimes(data.lead_time_distribution || [])
            setYoy(data.yoy || { bookings: null, couverts: null, revenue: null, has_data: false })
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
        const ad = stats.filter(d => d.bookings > 0).length
        const occ = totalSeats > 0 && ad > 0 ? Math.min(100, Math.round((c / (totalSeats * ad)) * 100)) : 0
        const rps = totalSeats > 0 && ad > 0 ? Math.round(rev / (totalSeats * ad * SERVICE_CONFIG.hoursPerDay) * 100) / 100 : 0
        return {
            bookings: b, couverts: c, revenue: rev, avgPerDay: ad > 0 ? Math.round(c / ad) : 0,
            walkins: stats.reduce((s, d) => s + d.walkins, 0),
            noShows: stats.reduce((s, d) => s + d.noShows, 0),
            cancellations: stats.reduce((s, d) => s + d.cancellations, 0),
            noShowRate: b > 0 ? Math.round(stats.reduce((s, d) => s + d.noShows, 0) / b * 100) : 0,
            cancRate: b > 0 ? Math.round(stats.reduce((s, d) => s + d.cancellations, 0) / b * 100) : 0,
            occupancy: occ, revpash: rps, activeDays: ad
        }
    }, [stats, totalSeats])

    // Chart data with comparison overlay (including revenue now)
    const chartData = useMemo(() => stats.map((d, i) => {
        const prev = prevDaily[i]
        return {
            label: fmtChartLabel(d.date), date: d.date,
            couverts: d.couverts, bookings: d.bookings, revenue: d.revenue || 0,
            prevCouverts: prev?.couverts ?? null, prevBookings: prev?.bookings ?? null,
            prevRevenue: prev?.revenue ?? null,
        }
    }), [stats, prevDaily])

    // ── Handlers ──
    const handleSort = (col: string) => { if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortCol(col); setSortDir('desc') } }
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
    const exportCSV = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/admin/stats/export?restaurantId=${restaurantId}&from=${dateRange.from}&to=${dateRange.to}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            if (!res.ok) throw new Error('Export failed')
            const blob = await res.blob()
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `statistieken_${dateRange.from}_${dateRange.to}.csv`
            a.click()
            URL.revokeObjectURL(url)
        } catch (e) { console.error('CSV export error:', e) }
    }
    const closeDrawer = () => { setSelectedDay(null); setSelectedMetric(null) }
    const onDayClick = (d: DayStats) => { setSelectedDay(d); setSelectedMetric(null) }
    const onHeatmapClick = (dow: number, hour: number, count: number) => {
        const dayLabels = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag']
        setSelectedMetric({
            key: 'heatmap', label: `${dayLabels[dow]} ${hour}:00`, value: `${count} boekingen`,
            explanation: `Er zijn ${count} boekingen geregistreerd op ${dayLabels[dow].toLowerCase()} om ${hour}:00 in de geselecteerde periode.`,
            trendData: []
        })
    }

    // Insight strip data
    const insights = useMemo(() => {
        const list: { text: string; warn?: boolean }[] = []
        if (extraStats.busiestDay) list.push({ text: `Drukste dag: ${extraStats.busiestDay}` })
        if (extraStats.peakHours[0]) list.push({ text: `Piekuur: ${extraStats.peakHours[0].hour}:00 (${extraStats.peakHours[0].count}×)` })
        if (repeatRate > 0) list.push({ text: `Terugkerend: ${repeatRate}%` })
        if (summary.cancRate > 10) list.push({ text: `⚠ Annuleringen hoog: ${summary.cancRate}%`, warn: true })
        if (summary.noShowRate > 5) list.push({ text: `⚠ No-show rate: ${summary.noShowRate}%`, warn: true })
        return list
    }, [extraStats, repeatRate, summary])

    // ── RENDER ──
    return (
        <div className="bg-gray-50 rounded-xl border border-gray-200 overflow-hidden flex flex-col" style={{ height: 'calc(100vh - 100px)' }}>
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-5 py-3 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                    <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg" style={{ minWidth: 44, minHeight: 44 }}>
                        <ArrowLeft className="w-5 h-5 text-gray-600" />
                    </button>
                    <div>
                        <h1 className="text-xl font-bold text-gray-900">Statistieken</h1>
                        {lastUpdated && <div className="text-xs text-gray-400">Bijgewerkt {lastUpdated.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}</div>}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-200" style={{ minHeight: 44 }}>
                        <Download className="w-4 h-4" /> CSV
                    </button>
                    <a href={`${API_BASE_URL}/api/admin/stats/pdf?restaurantId=${restaurantId}&from=${dateRange.from}&to=${dateRange.to}&token=${token}`}
                        target="_blank" rel="noopener" className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-200" style={{ minHeight: 44 }}>
                        <FileText className="w-4 h-4" /> PDF
                    </a>
                    <button onClick={fetchStats} className="p-2 hover:bg-gray-100 rounded-lg" style={{ minHeight: 44 }}>
                        <RefreshCw className={`w-4 h-4 text-gray-400 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Date controls */}
            <div className="bg-white border-b border-gray-200 px-5 py-2.5 flex items-center gap-2 flex-wrap shrink-0">
                {([['7d', '7d'], ['30d', '30d'], ['week', 'Week'], ['prev_week', 'Vor. week'], ['month', 'Maand'], ['prev_month', 'Vor. maand']] as [DatePreset, string][]).map(([key, label]) => (
                    <button key={key} onClick={() => applyPreset(key)}
                        className={`px-3 py-2 text-sm rounded-lg font-medium transition-colors ${activePreset === key ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                        style={{ minHeight: 40 }}>{label}</button>
                ))}
                <DateRangePicker from={dateRange.from} to={dateRange.to} onChange={setDateRange} />
                <div className="flex items-center gap-1 ml-auto">
                    <button onClick={() => navigatePeriod(-1)} className="p-2 hover:bg-gray-100 rounded-lg" style={{ minHeight: 44 }}><ChevronLeft className="w-5 h-5 text-gray-500" /></button>
                    <span className="text-sm text-gray-500 font-medium px-2 tabular-nums">{fmtDate(dateRange.from)} — {fmtDate(dateRange.to)}</span>
                    <button onClick={() => navigatePeriod(1)} className="p-2 hover:bg-gray-100 rounded-lg" style={{ minHeight: 44 }}><ChevronRight className="w-5 h-5 text-gray-500" /></button>
                </div>
            </div>

            {/* Tabs */}
            <div className="bg-white border-b border-gray-200 px-5 flex gap-0 shrink-0">
                {([['overzicht', 'Overzicht'], ['dagelijks', 'Dagelijks'], ['analyse', 'Analyse']] as [Tab, string][]).map(([key, label]) => (
                    <button key={key} onClick={() => setTab(key)}
                        className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${tab === key ? 'text-blue-600 border-blue-600' : 'text-gray-500 border-transparent hover:text-gray-700'}`}
                        style={{ minHeight: 48 }}>{label}</button>
                ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                {loading ? <LoadingSkeleton /> : error ? <ErrorState onRetry={fetchStats} /> : stats.length === 0 ? <EmptyState /> : (
                    <>
                        {tab === 'overzicht' && (
                            <div className="p-5 space-y-5">
                                <RevenueQuickEntry stats={stats} onSave={saveRevenue} />
                                <HealthSummary summary={summary} comparison={comparison} extraStats={extraStats} revenueData={revenueData} repeatRate={repeatRate} totalSeats={totalSeats} />
                                <KpiGrid summary={summary} comparison={comparison} extraStats={extraStats} revenueData={revenueData} totalSeats={totalSeats} stats={stats} yoy={yoy}
                                    onSelectMetric={m => { setSelectedMetric(m); setSelectedDay(null) }} />
                                <HeroChart data={chartData} metric={chartMetric} onMetricChange={setChartMetric} onDayClick={onDayClick} stats={stats} restaurantId={restaurantId} />
                                {insights.length > 0 && (
                                    <div className="flex items-center gap-3 flex-wrap">
                                        {insights.map((ins, i) => (
                                            <span key={i} className={`border px-3 py-2 rounded-lg text-sm font-medium ${ins.warn ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white border-gray-200 text-gray-700'}`}>{ins.text}</span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                        {tab === 'dagelijks' && (
                            <div className="p-5">
                                <DailyTable stats={stats} summary={summary} revenueData={revenueData}
                                    sortCol={sortCol} sortDir={sortDir} selectedDate={selectedDay?.date || null}
                                    editingRevenue={editingRevenue} revenueInput={revenueInput}
                                    onSort={handleSort} onRowClick={onDayClick}
                                    onEditRevenue={d => { setEditingRevenue(d); const day = stats.find(s => s.date === d); setRevenueInput(day?.revenue?.toString() || '') }}
                                    onRevenueChange={setRevenueInput} onSaveRevenue={saveRevenue} />
                            </div>
                        )}
                        {tab === 'analyse' && (
                            <div className="p-5">
                                <AnalyseCharts stats={stats} comparison={comparison} tableUtil={tableUtil}
                                    partySizes={partySizes} leadTimes={leadTimes} repeatRate={repeatRate}
                                    peakHours={extraStats.peakHours} totalSeats={totalSeats} activeDays={extraStats.activeDays}
                                    onDayClick={onDayClick} />
                                <div className="mt-5">
                                    <HeatmapCard heatmap={heatmap} onCellClick={onHeatmapClick} />
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Drawer */}
            <MetricDrawer day={selectedDay} metric={selectedMetric} totalSeats={totalSeats} onClose={closeDrawer}
                onViewBookings={(date) => { closeDrawer(); onBack(date) }} />
        </div>
    )
}
