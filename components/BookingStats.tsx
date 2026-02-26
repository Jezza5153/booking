import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Users, Calendar, Clock, ArrowLeft, Download, RefreshCw, Euro, UserCheck, BarChart3 } from 'lucide-react'
import { API_BASE_URL } from '../api'

interface BookingStatsProps {
    restaurantId: string
    onBack: () => void
}

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

            // Map daily data
            const dayMap: Record<string, DayStats> = {}
            for (let i = 0; i < days; i++) {
                const d = new Date(start); d.setDate(d.getDate() + i)
                const dateStr = d.toISOString().split('T')[0]
                dayMap[dateStr] = { date: dateStr, bookings: 0, couverts: 0, walkins: 0, noShows: 0, cancellations: 0, arrived: 0, revenue: null, revenueNotes: null }
            }
            for (const row of data.daily || []) {
                if (dayMap[row.date]) {
                    dayMap[row.date] = {
                        ...dayMap[row.date],
                        bookings: parseInt(row.bookings) || 0, couverts: parseInt(row.couverts) || 0,
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
    const maxRevenue = Math.max(...stats.map(s => s.revenue || 0), 1)

    const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })
    const navigatePeriod = (direction: number) => {
        const d = new Date(startDate); d.setDate(d.getDate() + direction * (period === 'week' ? 7 : 30))
        setStartDate(d.toISOString().split('T')[0])
    }

    // Save revenue for a specific day
    const saveRevenue = async (date: string, amount: string) => {
        try {
            await fetch(`${API_BASE_URL}/api/admin/daily-revenue`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ restaurantId, date, revenue: parseFloat(amount) || 0 })
            })
            setEditingRevenue(null)
            fetchStats()
        } catch (e) { console.error('Failed to save revenue:', e) }
    }

    // CSV export
    const exportCSV = () => {
        const days = period === 'week' ? 7 : 30
        const end = new Date(startDate); end.setDate(end.getDate() + days)
        const url = `${API_BASE_URL}/api/admin/stats/export?restaurantId=${restaurantId}&from=${startDate}&to=${end.toISOString().split('T')[0]}`
        window.open(url, '_blank')
    }

    // Comparison badge
    const CompBadge = ({ value }: { value: number | undefined }) => {
        if (!value) return null
        const isUp = value > 0
        return (
            <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${isUp ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {isUp ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                {isUp ? '+' : ''}{value}%
            </span>
        )
    }

    // Heatmap grid
    const dayLabels = ['Zo', 'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za']
    const heatmapMax = Math.max(...heatmap.map(h => h.count), 1)
    const getHeatColor = (count: number) => {
        if (count === 0) return 'bg-gray-50'
        const intensity = count / heatmapMax
        if (intensity > 0.75) return 'bg-red-500 text-white'
        if (intensity > 0.5) return 'bg-orange-400 text-white'
        if (intensity > 0.25) return 'bg-amber-300'
        return 'bg-amber-100'
    }

    const maxTableBookings = Math.max(...tableUtil.map(t => t.booking_count), 1)

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-200">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <button onClick={onBack} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
                            <ArrowLeft className="w-5 h-5 text-gray-600" />
                        </button>
                        <h2 className="text-lg font-semibold text-gray-900">📊 Statistieken</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors" title="Download CSV">
                            <Download className="w-4 h-4" /> CSV
                        </button>
                        <button onClick={fetchStats} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors" title="Verversen">
                            <RefreshCw className={`w-4 h-4 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                        <button onClick={() => navigatePeriod(-1)} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
                            <ChevronLeft className="w-5 h-5 text-gray-600" />
                        </button>
                        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                            <button onClick={() => setPeriod('week')} className={`px-3 py-1.5 text-sm font-medium transition-colors ${period === 'week' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>Week</button>
                            <button onClick={() => setPeriod('month')} className={`px-3 py-1.5 text-sm font-medium transition-colors ${period === 'month' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>Maand</button>
                        </div>
                        <button onClick={() => navigatePeriod(1)} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
                            <ChevronRight className="w-5 h-5 text-gray-600" />
                        </button>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="p-8 text-center text-gray-400">Laden...</div>
            ) : (
                <>
                    {/* Summary Cards Row 1 — Primary metrics with comparison */}
                    <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 border-b border-gray-200">
                        <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-xl p-3">
                            <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-1.5 text-emerald-600"><Calendar className="w-3.5 h-3.5" /><span className="text-[10px] font-medium">Boekingen</span></div>
                                <CompBadge value={comparison.bookings} />
                            </div>
                            <div className="text-2xl font-bold text-emerald-700">{summary.totalBookings}</div>
                        </div>
                        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-3">
                            <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-1.5 text-blue-600"><Users className="w-3.5 h-3.5" /><span className="text-[10px] font-medium">Couverts</span></div>
                                <CompBadge value={comparison.couverts} />
                            </div>
                            <div className="text-2xl font-bold text-blue-700">{summary.totalCouverts}</div>
                            <div className="text-[10px] text-blue-500">Ø {summary.avgPerDay}/dag</div>
                        </div>
                        <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-3">
                            <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-1.5 text-purple-600"><TrendingUp className="w-3.5 h-3.5" /><span className="text-[10px] font-medium">Walk-ins</span></div>
                                <CompBadge value={comparison.walkins} />
                            </div>
                            <div className="text-2xl font-bold text-purple-700">{summary.totalWalkins}</div>
                        </div>
                        <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-xl p-3">
                            <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-1.5 text-red-600"><Clock className="w-3.5 h-3.5" /><span className="text-[10px] font-medium">No-shows</span></div>
                                <CompBadge value={comparison.no_shows} />
                            </div>
                            <div className="text-2xl font-bold text-red-700">{summary.totalNoShows}</div>
                            <div className="text-[10px] text-red-500">{summary.noShowRate}% rate</div>
                        </div>
                        <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-3">
                            <div className="flex items-center gap-1.5 text-green-600 mb-1"><Euro className="w-3.5 h-3.5" /><span className="text-[10px] font-medium">Omzet</span></div>
                            <div className="text-2xl font-bold text-green-700">€{summary.totalRevenue.toLocaleString('nl-NL')}</div>
                            {revenueData.avg_per_couvert > 0 && <div className="text-[10px] text-green-500">Ø €{revenueData.avg_per_couvert}/couvert</div>}
                        </div>
                        <div className="bg-gradient-to-br from-cyan-50 to-cyan-100 rounded-xl p-3">
                            <div className="flex items-center gap-1.5 text-cyan-600 mb-1"><UserCheck className="w-3.5 h-3.5" /><span className="text-[10px] font-medium">Terugkerend</span></div>
                            <div className="text-2xl font-bold text-cyan-700">{repeatRate}%</div>
                            <div className="text-[10px] text-cyan-500">{repeatCustomers} gasten</div>
                        </div>
                    </div>

                    {/* Extra Metrics Row */}
                    <div className="px-4 py-3 grid grid-cols-3 gap-3 border-b border-gray-200">
                        <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl p-3">
                            <div className="text-[10px] font-medium text-amber-600 mb-1">Ø Gezelschap</div>
                            <div className="text-xl font-bold text-amber-700">{extraStats.avgPartySize}</div>
                            <div className="text-[10px] text-amber-500">pers. per boeking</div>
                        </div>
                        <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-xl p-3">
                            <div className="text-[10px] font-medium text-indigo-600 mb-1">Drukste dag</div>
                            <div className="text-lg font-bold text-indigo-700">{extraStats.busiestDay || '-'}</div>
                        </div>
                        <div className="bg-gradient-to-br from-teal-50 to-teal-100 rounded-xl p-3">
                            <div className="text-[10px] font-medium text-teal-600 mb-1">Piekuur</div>
                            <div className="text-xl font-bold text-teal-700">{extraStats.peakHours.length > 0 ? `${extraStats.peakHours[0].hour}:00` : '-'}</div>
                            <div className="text-[10px] text-teal-500">{extraStats.peakHours.length > 0 ? `${extraStats.peakHours[0].count} boekingen` : ''}</div>
                        </div>
                    </div>

                    {/* Chart — Couverts + Revenue overlay */}
                    <div className="p-4 border-b border-gray-200">
                        <h3 className="text-sm font-medium text-gray-700 mb-3">Couverts & Omzet per dag</h3>
                        <div className="flex items-end gap-1 h-40">
                            {stats.map((day, i) => (
                                <div key={i} className="flex-1 flex flex-col items-center group relative">
                                    {/* Tooltip */}
                                    <div className="absolute bottom-full mb-1 hidden group-hover:block bg-gray-900 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap z-20 pointer-events-none">
                                        {formatDate(day.date)}: {day.couverts} couverts{day.revenue ? `, €${day.revenue}` : ''}
                                    </div>
                                    <div className="w-full flex flex-col items-center">
                                        <span className="text-[9px] text-gray-400 mb-0.5">{day.couverts || ''}</span>
                                        <div className="w-full relative">
                                            <div
                                                className="w-full bg-gradient-to-t from-blue-500 to-blue-400 rounded-t transition-all hover:from-blue-600 hover:to-blue-500"
                                                style={{ height: `${(day.couverts / maxCouverts) * 120}px`, minHeight: day.couverts > 0 ? '4px' : '0' }}
                                            />
                                            {day.revenue != null && day.revenue > 0 && (
                                                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 bg-green-500 rounded-full" style={{ height: `${(day.revenue / maxRevenue) * 120}px`, minHeight: '4px' }} />
                                            )}
                                        </div>
                                    </div>
                                    <span className="text-[9px] text-gray-400 mt-0.5">{formatDate(day.date).split(' ')[0]}</span>
                                </div>
                            ))}
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-400">
                            <span className="flex items-center gap-1"><span className="w-3 h-2 bg-blue-500 rounded" /> Couverts</span>
                            <span className="flex items-center gap-1"><span className="w-1 h-3 bg-green-500 rounded-full" /> Omzet</span>
                        </div>
                    </div>

                    {/* Hourly Heatmap */}
                    <div className="p-4 border-b border-gray-200">
                        <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                            <BarChart3 className="w-4 h-4" /> Drukte heatmap (dag × uur)
                        </h3>
                        <div className="overflow-x-auto">
                            <div className="inline-grid gap-0.5" style={{ gridTemplateColumns: `40px repeat(${Math.min(12, 24)}), 1fr)` }}>
                                {/* Hour headers */}
                                <div />
                                {Array.from({ length: 12 }, (_, i) => i + 11).map(h => (
                                    <div key={h} className="text-[9px] text-gray-400 text-center w-7">{h}:00</div>
                                ))}
                                {/* Day rows */}
                                {dayLabels.map((day, dow) => (
                                    <React.Fragment key={dow}>
                                        <div className="text-[10px] text-gray-500 font-medium pr-1 flex items-center">{day}</div>
                                        {Array.from({ length: 12 }, (_, i) => i + 11).map(hour => {
                                            const cell = heatmap.find(h => h.dow === dow && h.hour === hour)
                                            const count = cell?.count || 0
                                            return (
                                                <div key={hour} className={`w-7 h-5 rounded-sm flex items-center justify-center text-[8px] font-medium ${getHeatColor(count)}`} title={`${day} ${hour}:00 — ${count} boekingen`}>
                                                    {count > 0 ? count : ''}
                                                </div>
                                            )
                                        })}
                                    </React.Fragment>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Table Utilization */}
                    <div className="p-4 border-b border-gray-200">
                        <h3 className="text-sm font-medium text-gray-700 mb-3">Tafelbezetting</h3>
                        <div className="space-y-1.5 max-h-48 overflow-y-auto">
                            {tableUtil.map(t => (
                                <div key={t.id} className="flex items-center gap-2 text-xs">
                                    <span className="w-24 shrink-0 text-gray-600 truncate">{t.name} <sup className="text-[9px] text-gray-400">{t.seats}</sup></span>
                                    <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full transition-all"
                                            style={{ width: `${(t.booking_count / maxTableBookings) * 100}%`, minWidth: t.booking_count > 0 ? '8px' : '0' }}
                                        />
                                    </div>
                                    <span className="w-16 shrink-0 text-right text-gray-500">{t.booking_count} × {t.total_guests}p</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Daily Breakdown Table with Revenue Input */}
                    <div className="border-t border-gray-200">
                        <table className="w-full text-xs">
                            <thead className="bg-gray-50 sticky top-0">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium text-gray-600">Datum</th>
                                    <th className="px-3 py-2 text-right font-medium text-gray-600">Boekingen</th>
                                    <th className="px-3 py-2 text-right font-medium text-gray-600">Couverts</th>
                                    <th className="px-3 py-2 text-right font-medium text-gray-600">Walk-ins</th>
                                    <th className="px-3 py-2 text-right font-medium text-gray-600">No-shows</th>
                                    <th className="px-3 py-2 text-right font-medium text-gray-600">Omzet</th>
                                    <th className="px-3 py-2 text-right font-medium text-gray-600">Ø/couvert</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stats.map((day, i) => {
                                    const avgSpend = day.revenue && day.couverts > 0 ? (day.revenue / day.couverts).toFixed(2) : '-'
                                    return (
                                        <tr key={i} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50 transition-colors`}>
                                            <td className="px-3 py-1.5 text-gray-900">{formatDate(day.date)}</td>
                                            <td className="px-3 py-1.5 text-right text-emerald-600 font-medium">{day.bookings}</td>
                                            <td className="px-3 py-1.5 text-right text-blue-600 font-medium">{day.couverts}</td>
                                            <td className="px-3 py-1.5 text-right text-purple-600">{day.walkins}</td>
                                            <td className="px-3 py-1.5 text-right text-red-600">{day.noShows}</td>
                                            <td className="px-3 py-1.5 text-right">
                                                {editingRevenue === day.date ? (
                                                    <form className="inline-flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); saveRevenue(day.date, revenueInput) }}>
                                                        <span className="text-gray-400">€</span>
                                                        <input
                                                            type="number" step="0.01" autoFocus className="w-16 border border-gray-300 rounded px-1 py-0.5 text-right text-xs"
                                                            value={revenueInput} onChange={e => setRevenueInput(e.target.value)}
                                                            onBlur={() => saveRevenue(day.date, revenueInput)}
                                                        />
                                                    </form>
                                                ) : (
                                                    <button
                                                        onClick={() => { setEditingRevenue(day.date); setRevenueInput(day.revenue?.toString() || '') }}
                                                        className={`${day.revenue != null ? 'text-green-600 font-medium' : 'text-gray-300 hover:text-gray-500'} transition-colors`}
                                                    >
                                                        {day.revenue != null ? `€${day.revenue.toLocaleString('nl-NL')}` : '+ omzet'}
                                                    </button>
                                                )}
                                            </td>
                                            <td className="px-3 py-1.5 text-right text-gray-500">{avgSpend !== '-' ? `€${avgSpend}` : '-'}</td>
                                        </tr>
                                    )
                                })}
                                {/* Totals row */}
                                <tr className="bg-gray-100 font-semibold border-t-2 border-gray-300">
                                    <td className="px-3 py-2 text-gray-900">Totaal</td>
                                    <td className="px-3 py-2 text-right text-emerald-700">{summary.totalBookings}</td>
                                    <td className="px-3 py-2 text-right text-blue-700">{summary.totalCouverts}</td>
                                    <td className="px-3 py-2 text-right text-purple-700">{summary.totalWalkins}</td>
                                    <td className="px-3 py-2 text-right text-red-700">{summary.totalNoShows}</td>
                                    <td className="px-3 py-2 text-right text-green-700">€{summary.totalRevenue.toLocaleString('nl-NL')}</td>
                                    <td className="px-3 py-2 text-right text-gray-700">{revenueData.avg_per_couvert > 0 ? `€${revenueData.avg_per_couvert}` : '-'}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    )
}
