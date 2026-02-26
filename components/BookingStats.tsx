import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Users, Calendar, Clock, ArrowLeft, Download, RefreshCw, Euro, UserCheck, ChevronDown, ChevronUp, X } from 'lucide-react'
import { API_BASE_URL } from '../api'

interface BookingStatsProps { restaurantId: string; onBack: () => void }
interface DayStats {
    date: string; bookings: number; couverts: number; walkins: number; noShows: number
    cancellations: number; arrived: number; revenue: number | null; revenueNotes: string | null
}
interface HeatmapCell { dow: number; hour: number; count: number }
interface TableUtil { id: string; name: string; seats: number; zone: string; booking_count: number; total_guests: number }

export const BookingStats: React.FC<BookingStatsProps> = ({ restaurantId, onBack }) => {
    const [period, setPeriod] = useState<'week' | 'month'>('week')
    const [startDate, setStartDate] = useState(() => {
        const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0]
    })
    const [stats, setStats] = useState<DayStats[]>([])
    const [loading, setLoading] = useState(true)
    const [comparison, setComparison] = useState<Record<string, number>>({})
    const [heatmap, setHeatmap] = useState<HeatmapCell[]>([])
    const [tableUtil, setTableUtil] = useState<TableUtil[]>([])
    const [repeatRate, setRepeatRate] = useState(0)
    const [repeatCustomers, setRepeatCustomers] = useState(0)
    const [revenueData, setRevenueData] = useState({ total: 0, avg_per_couvert: 0 })
    const [editingRevenue, setEditingRevenue] = useState<string | null>(null)
    const [revenueInput, setRevenueInput] = useState('')
    const [selectedDay, setSelectedDay] = useState<DayStats | null>(null)
    const [expandedSection, setExpandedSection] = useState<string | null>('chart')
    const [extraStats, setExtraStats] = useState<{
        avgPartySize: number; busiestDay: string | null; peakHours: { hour: number; count: number }[]; activeDays: number
    }>({ avgPartySize: 0, busiestDay: null, peakHours: [], activeDays: 0 })

    const token = localStorage.getItem('events_token')

    const fetchStats = useCallback(async () => {
        setLoading(true)
        try {
            const days = period === 'week' ? 7 : 30
            const start = new Date(startDate)
            const end = new Date(start); end.setDate(end.getDate() + days)
            const params = new URLSearchParams({ restaurantId, from: startDate, to: end.toISOString().split('T')[0] })
            const response = await fetch(`${API_BASE_URL}/api/admin/stats?${params}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            if (!response.ok) throw new Error('Failed to fetch stats')
            const data = await response.json()

            const dayMap: Record<string, DayStats> = {}
            for (let i = 0; i < days; i++) {
                const d = new Date(start); d.setDate(d.getDate() + i)
                const dateStr = d.toISOString().split('T')[0]
                dayMap[dateStr] = { date: dateStr, bookings: 0, couverts: 0, walkins: 0, noShows: 0, cancellations: 0, arrived: 0, revenue: null, revenueNotes: null }
            }
            for (const row of data.daily || []) {
                if (dayMap[row.date]) {
                    dayMap[row.date] = {
                        ...dayMap[row.date], bookings: parseInt(row.bookings) || 0, couverts: parseInt(row.couverts) || 0,
                        walkins: parseInt(row.walkins) || 0, noShows: parseInt(row.no_shows) || 0,
                        cancellations: parseInt(row.cancellations) || 0, arrived: parseInt(row.arrived) || 0,
                        revenue: row.revenue, revenueNotes: row.revenue_notes
                    }
                }
            }
            setStats(Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date)))
            setComparison(data.comparison || {})
            setHeatmap(data.heatmap || [])
            setTableUtil(data.table_utilization || [])
            setRepeatRate(data.repeat_rate || 0)
            setRepeatCustomers(data.repeat_customers || 0)
            setRevenueData(data.revenue || { total: 0, avg_per_couvert: 0 })
            setExtraStats({
                avgPartySize: data.avg_party_size || 0, busiestDay: data.busiest_day || null,
                peakHours: data.peak_hours || [], activeDays: data.active_days || 0
            })
        } catch (e) { console.error('Failed to fetch stats:', e); setStats([]) }
        finally { setLoading(false) }
    }, [startDate, period, restaurantId, token])

    useEffect(() => { fetchStats() }, [fetchStats])

    const summary = useMemo(() => ({
        totalBookings: stats.reduce((s, d) => s + d.bookings, 0),
        totalCouverts: stats.reduce((s, d) => s + d.couverts, 0),
        avgPerDay: Math.round(stats.reduce((s, d) => s + d.couverts, 0) / (stats.filter(d => d.bookings > 0).length || 1)),
        totalWalkins: stats.reduce((s, d) => s + d.walkins, 0),
        totalNoShows: stats.reduce((s, d) => s + d.noShows, 0),
        noShowRate: stats.length ? Math.round(stats.reduce((s, d) => s + d.noShows, 0) / Math.max(stats.reduce((s, d) => s + d.bookings, 0), 1) * 100) : 0,
        totalRevenue: stats.reduce((s, d) => s + (d.revenue || 0), 0)
    }), [stats])

    const maxCouverts = Math.max(...stats.map(s => s.couverts), 1)
    const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })
    const formatDateFull = (dateStr: string) => new Date(dateStr).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    const navigatePeriod = (dir: number) => {
        const d = new Date(startDate); d.setDate(d.getDate() + dir * (period === 'week' ? 7 : 30))
        setStartDate(d.toISOString().split('T')[0])
    }

    const saveRevenue = async (date: string, amount: string) => {
        try {
            await fetch(`${API_BASE_URL}/api/admin/daily-revenue`, {
                method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ restaurantId, date, revenue: parseFloat(amount) || 0 })
            })
            setEditingRevenue(null); fetchStats()
        } catch (e) { console.error('Failed to save revenue:', e) }
    }

    const exportCSV = () => {
        const days = period === 'week' ? 7 : 30
        const end = new Date(startDate); end.setDate(end.getDate() + days)
        window.open(`${API_BASE_URL}/api/admin/stats/export?restaurantId=${restaurantId}&from=${startDate}&to=${end.toISOString().split('T')[0]}`, '_blank')
    }

    // Comparison badge
    const Badge = ({ value }: { value: number | undefined }) => {
        if (value === undefined || value === 0) return null
        const up = value > 0
        return (
            <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${up ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                {up ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                {up ? '+' : ''}{value}%
            </span>
        )
    }

    // Section toggle
    const Section = ({ id, title, children, defaultOpen = true }: { id: string; title: string; children: React.ReactNode; defaultOpen?: boolean }) => {
        const open = expandedSection === id || (expandedSection === null && defaultOpen)
        return (
            <div className="border-b border-gray-100">
                <button onClick={() => setExpandedSection(expandedSection === id ? null : id)} className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-gray-50 transition-colors">
                    <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
                    {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </button>
                {open && <div className="px-4 pb-4">{children}</div>}
            </div>
        )
    }

    // Heatmap
    const dayLabels = ['Zo', 'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za']
    const hours = Array.from({ length: 12 }, (_, i) => i + 11) // 11:00 - 22:00
    const heatmapMax = Math.max(...heatmap.map(h => h.count), 1)
    const getHeatColor = (count: number) => {
        if (count === 0) return 'bg-gray-100 text-gray-300'
        const r = count / heatmapMax
        if (r > 0.75) return 'bg-red-500 text-white'
        if (r > 0.5) return 'bg-orange-400 text-white'
        if (r > 0.25) return 'bg-amber-300 text-amber-900'
        return 'bg-amber-100 text-amber-700'
    }

    const maxTableBookings = Math.max(...tableUtil.map(t => t.booking_count), 1)

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden max-h-[calc(100vh-120px)] overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 z-20 bg-white px-4 py-3 border-b border-gray-200 shadow-sm">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <button onClick={onBack} className="p-1.5 hover:bg-gray-100 rounded-lg"><ArrowLeft className="w-5 h-5 text-gray-600" /></button>
                        <h2 className="text-lg font-bold text-gray-900">Statistieken</h2>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <button onClick={exportCSV} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-200">
                            <Download className="w-3.5 h-3.5" /> CSV
                        </button>
                        <button onClick={fetchStats} className="p-1.5 hover:bg-gray-100 rounded-lg">
                            <RefreshCw className={`w-4 h-4 text-gray-400 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                        <div className="w-px h-5 bg-gray-200 mx-1" />
                        <button onClick={() => navigatePeriod(-1)} className="p-1 hover:bg-gray-100 rounded"><ChevronLeft className="w-4 h-4 text-gray-500" /></button>
                        <div className="flex rounded-md border border-gray-200 overflow-hidden">
                            <button onClick={() => setPeriod('week')} className={`px-2.5 py-1 text-xs font-medium ${period === 'week' ? 'bg-gray-800 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>Week</button>
                            <button onClick={() => setPeriod('month')} className={`px-2.5 py-1 text-xs font-medium ${period === 'month' ? 'bg-gray-800 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>Maand</button>
                        </div>
                        <button onClick={() => navigatePeriod(1)} className="p-1 hover:bg-gray-100 rounded"><ChevronRight className="w-4 h-4 text-gray-500" /></button>
                    </div>
                </div>
            </div>

            {loading ? <div className="p-12 text-center text-gray-400">Laden...</div> : (
                <>
                    {/* KPI Cards — clean, minimal */}
                    <div className="p-4 grid grid-cols-3 lg:grid-cols-6 gap-2">
                        {[
                            { label: 'Boekingen', value: summary.totalBookings, icon: Calendar, color: 'text-emerald-600', comp: comparison.bookings },
                            { label: 'Couverts', value: summary.totalCouverts, icon: Users, color: 'text-blue-600', comp: comparison.couverts, sub: `Ø ${summary.avgPerDay}/dag` },
                            { label: 'Walk-ins', value: summary.totalWalkins, icon: TrendingUp, color: 'text-violet-600', comp: comparison.walkins },
                            { label: 'No-shows', value: summary.totalNoShows, icon: Clock, color: 'text-red-600', comp: comparison.no_shows, sub: `${summary.noShowRate}%` },
                            { label: 'Omzet', value: `€${summary.totalRevenue.toLocaleString('nl-NL')}`, icon: Euro, color: 'text-green-600', sub: revenueData.avg_per_couvert > 0 ? `Ø €${revenueData.avg_per_couvert}/p` : undefined },
                            { label: 'Terugkerend', value: `${repeatRate}%`, icon: UserCheck, color: 'text-cyan-600', sub: `${repeatCustomers} gasten` },
                        ].map((card, i) => (
                            <div key={i} className="bg-gray-50 hover:bg-gray-100 rounded-lg p-3 transition-colors cursor-default border border-gray-100">
                                <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-1"><card.icon className={`w-3 h-3 ${card.color}`} /><span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">{card.label}</span></div>
                                    {card.comp !== undefined && <Badge value={card.comp} />}
                                </div>
                                <div className={`text-xl font-bold ${card.color}`}>{card.value}</div>
                                {card.sub && <div className="text-[10px] text-gray-400 mt-0.5">{card.sub}</div>}
                            </div>
                        ))}
                    </div>

                    {/* Quick insights bar */}
                    <div className="px-4 pb-3 flex items-center gap-3 text-xs text-gray-500">
                        <span className="bg-amber-50 text-amber-700 px-2 py-1 rounded-md font-medium">Ø {extraStats.avgPartySize} p/boeking</span>
                        <span className="bg-indigo-50 text-indigo-700 px-2 py-1 rounded-md font-medium">Drukste: {extraStats.busiestDay || '-'}</span>
                        <span className="bg-teal-50 text-teal-700 px-2 py-1 rounded-md font-medium">Piek: {extraStats.peakHours[0] ? `${extraStats.peakHours[0].hour}:00 (${extraStats.peakHours[0].count}×)` : '-'}</span>
                        <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded-md font-medium">{extraStats.activeDays} actieve dagen</span>
                    </div>

                    {/* Day detail modal */}
                    {selectedDay && (
                        <div className="mx-4 mb-3 bg-blue-50 border border-blue-200 rounded-lg p-3 relative animate-in fade-in">
                            <button onClick={() => setSelectedDay(null)} className="absolute top-2 right-2 p-1 hover:bg-blue-100 rounded"><X className="w-3.5 h-3.5 text-blue-400" /></button>
                            <h4 className="font-semibold text-blue-900 text-sm mb-2">{formatDateFull(selectedDay.date)}</h4>
                            <div className="grid grid-cols-4 gap-3 text-xs">
                                <div><span className="text-blue-400">Boekingen</span><div className="font-bold text-blue-900">{selectedDay.bookings}</div></div>
                                <div><span className="text-blue-400">Couverts</span><div className="font-bold text-blue-900">{selectedDay.couverts}</div></div>
                                <div><span className="text-blue-400">No-shows</span><div className="font-bold text-blue-900">{selectedDay.noShows}</div></div>
                                <div><span className="text-blue-400">Omzet</span><div className="font-bold text-blue-900">{selectedDay.revenue != null ? `€${selectedDay.revenue}` : '-'}</div></div>
                            </div>
                            {selectedDay.revenue != null && selectedDay.couverts > 0 && (
                                <div className="mt-2 text-xs text-blue-600">Gem. besteding: <b>€{(selectedDay.revenue / selectedDay.couverts).toFixed(2)}</b> per couvert</div>
                            )}
                        </div>
                    )}

                    {/* Chart — clickable bars */}
                    <Section id="chart" title="Couverts & Omzet per dag">
                        <div className="flex items-end gap-1 h-36">
                            {stats.map((day, i) => (
                                <div key={i} className="flex-1 flex flex-col items-center group cursor-pointer" onClick={() => setSelectedDay(selectedDay?.date === day.date ? null : day)}>
                                    <span className="text-[9px] text-gray-400 mb-0.5 opacity-0 group-hover:opacity-100 transition-opacity">{day.couverts}</span>
                                    <div className="w-full relative">
                                        <div
                                            className={`w-full rounded-t transition-all ${selectedDay?.date === day.date ? 'bg-blue-600' : 'bg-blue-400 hover:bg-blue-500'}`}
                                            style={{ height: `${(day.couverts / maxCouverts) * 110}px`, minHeight: day.couverts > 0 ? '3px' : '0' }}
                                        />
                                        {day.revenue != null && day.revenue > 0 && (
                                            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1.5 bg-emerald-400 rounded-full opacity-80" style={{ height: `${Math.min((day.revenue / Math.max(...stats.map(s => s.revenue || 0), 1)) * 110, 110)}px`, minHeight: '4px' }} />
                                        )}
                                    </div>
                                    <span className={`text-[9px] mt-1 transition-colors ${selectedDay?.date === day.date ? 'text-blue-600 font-bold' : 'text-gray-400'}`}>
                                        {formatDate(day.date).split(' ')[0]}
                                    </span>
                                </div>
                            ))}
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-400">
                            <span className="flex items-center gap-1"><span className="w-3 h-2 bg-blue-400 rounded" /> Couverts</span>
                            <span className="flex items-center gap-1"><span className="w-1.5 h-3 bg-emerald-400 rounded-full" /> Omzet</span>
                            <span className="ml-auto">Klik op een balk voor details</span>
                        </div>
                    </Section>

                    {/* Heatmap — fixed grid */}
                    <Section id="heatmap" title="Drukte per dag & uur" defaultOpen={false}>
                        <div className="overflow-x-auto -mx-1">
                            <table className="text-[10px] border-collapse">
                                <thead>
                                    <tr>
                                        <th className="w-8" />
                                        {hours.map(h => <th key={h} className="px-0.5 py-1 text-gray-400 font-normal text-center w-7">{h}h</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {dayLabels.map((day, dow) => (
                                        <tr key={dow}>
                                            <td className="pr-1 text-gray-500 font-medium">{day}</td>
                                            {hours.map(hour => {
                                                const count = heatmap.find(h => h.dow === dow && h.hour === hour)?.count || 0
                                                return (
                                                    <td key={hour} className="px-0.5 py-0.5">
                                                        <div className={`w-7 h-5 rounded-sm flex items-center justify-center font-medium ${getHeatColor(count)} transition-colors hover:ring-1 hover:ring-gray-400 cursor-default`} title={`${day} ${hour}:00 — ${count} boekingen`}>
                                                            {count > 0 ? count : '·'}
                                                        </div>
                                                    </td>
                                                )
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex items-center gap-2 mt-2 text-[10px] text-gray-400">
                            <span>Weinig</span>
                            <div className="flex gap-0.5">
                                <span className="w-4 h-3 bg-gray-100 rounded-sm" />
                                <span className="w-4 h-3 bg-amber-100 rounded-sm" />
                                <span className="w-4 h-3 bg-amber-300 rounded-sm" />
                                <span className="w-4 h-3 bg-orange-400 rounded-sm" />
                                <span className="w-4 h-3 bg-red-500 rounded-sm" />
                            </div>
                            <span>Veel</span>
                        </div>
                    </Section>

                    {/* Table utilization — clickable */}
                    <Section id="tables" title={`Tafelbezetting (${tableUtil.length} tafels)`} defaultOpen={false}>
                        <div className="space-y-1 max-h-52 overflow-y-auto">
                            {tableUtil.map(t => {
                                const pct = maxTableBookings > 0 ? Math.round((t.booking_count / maxTableBookings) * 100) : 0
                                return (
                                    <div key={t.id} className="flex items-center gap-2 text-xs group hover:bg-gray-50 rounded px-1 py-0.5 transition-colors">
                                        <span className="w-24 shrink-0 text-gray-700 truncate font-medium">{t.name}<sup className="text-[8px] text-gray-400 ml-0.5">{t.seats}</sup></span>
                                        <div className="flex-1 h-3.5 bg-gray-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%`, minWidth: t.booking_count > 0 ? '6px' : '0' }} />
                                        </div>
                                        <span className="w-20 shrink-0 text-right text-gray-400 text-[10px]">{t.booking_count}× · {t.total_guests}p</span>
                                    </div>
                                )
                            })}
                        </div>
                    </Section>

                    {/* Daily table with revenue — main data view */}
                    <Section id="table" title="Dagelijks overzicht" defaultOpen={true}>
                        <div className="-mx-4">
                            <table className="w-full text-xs">
                                <thead className="bg-gray-50 sticky top-0">
                                    <tr className="text-gray-500 uppercase tracking-wide text-[10px]">
                                        <th className="px-4 py-2 text-left font-medium">Datum</th>
                                        <th className="px-2 py-2 text-right font-medium">Boek.</th>
                                        <th className="px-2 py-2 text-right font-medium">Couv.</th>
                                        <th className="px-2 py-2 text-right font-medium">Walk-in</th>
                                        <th className="px-2 py-2 text-right font-medium">No-show</th>
                                        <th className="px-3 py-2 text-right font-medium">Omzet</th>
                                        <th className="px-2 py-2 text-right font-medium">Ø/p</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {stats.map((day, i) => {
                                        const avgSpend = day.revenue && day.couverts > 0 ? (day.revenue / day.couverts).toFixed(2) : null
                                        const isSelected = selectedDay?.date === day.date
                                        return (
                                            <tr key={i} onClick={() => setSelectedDay(isSelected ? null : day)}
                                                className={`cursor-pointer transition-colors ${isSelected ? 'bg-blue-50 border-l-2 border-blue-500' : i % 2 === 0 ? 'bg-white hover:bg-gray-50' : 'bg-gray-50/50 hover:bg-gray-100/50'}`}>
                                                <td className="px-4 py-1.5 text-gray-800 font-medium">{formatDate(day.date)}</td>
                                                <td className="px-2 py-1.5 text-right tabular-nums text-emerald-600 font-semibold">{day.bookings || <span className="text-gray-300">-</span>}</td>
                                                <td className="px-2 py-1.5 text-right tabular-nums text-blue-600 font-semibold">{day.couverts || <span className="text-gray-300">-</span>}</td>
                                                <td className="px-2 py-1.5 text-right tabular-nums text-violet-500">{day.walkins || <span className="text-gray-300">-</span>}</td>
                                                <td className="px-2 py-1.5 text-right tabular-nums text-red-500">{day.noShows || <span className="text-gray-300">-</span>}</td>
                                                <td className="px-3 py-1.5 text-right" onClick={e => e.stopPropagation()}>
                                                    {editingRevenue === day.date ? (
                                                        <form className="inline-flex items-center" onSubmit={e => { e.preventDefault(); saveRevenue(day.date, revenueInput) }}>
                                                            <span className="text-gray-400 text-[10px]">€</span>
                                                            <input type="number" step="0.01" autoFocus className="w-16 border border-blue-300 rounded px-1 py-0.5 text-right text-xs focus:ring-1 focus:ring-blue-400 outline-none"
                                                                value={revenueInput} onChange={e => setRevenueInput(e.target.value)}
                                                                onBlur={() => saveRevenue(day.date, revenueInput)} />
                                                        </form>
                                                    ) : (
                                                        <button onClick={() => { setEditingRevenue(day.date); setRevenueInput(day.revenue?.toString() || '') }}
                                                            className={`transition-colors text-xs ${day.revenue != null ? 'text-green-600 font-semibold hover:text-green-700' : 'text-gray-300 hover:text-blue-500 hover:underline'}`}>
                                                            {day.revenue != null ? `€${day.revenue.toLocaleString('nl-NL')}` : '+ invoer'}
                                                        </button>
                                                    )}
                                                </td>
                                                <td className="px-2 py-1.5 text-right tabular-nums text-gray-400">{avgSpend ? `€${avgSpend}` : '-'}</td>
                                            </tr>
                                        )
                                    })}
                                    {/* Totals */}
                                    <tr className="bg-gray-100 font-bold border-t-2 border-gray-200 text-xs">
                                        <td className="px-4 py-2 text-gray-800">Totaal</td>
                                        <td className="px-2 py-2 text-right text-emerald-700 tabular-nums">{summary.totalBookings}</td>
                                        <td className="px-2 py-2 text-right text-blue-700 tabular-nums">{summary.totalCouverts}</td>
                                        <td className="px-2 py-2 text-right text-violet-700 tabular-nums">{summary.totalWalkins}</td>
                                        <td className="px-2 py-2 text-right text-red-700 tabular-nums">{summary.totalNoShows}</td>
                                        <td className="px-3 py-2 text-right text-green-700 tabular-nums">€{summary.totalRevenue.toLocaleString('nl-NL')}</td>
                                        <td className="px-2 py-2 text-right text-gray-600 tabular-nums">{revenueData.avg_per_couvert > 0 ? `€${revenueData.avg_per_couvert}` : '-'}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </Section>
                </>
            )}
        </div>
    )
}
