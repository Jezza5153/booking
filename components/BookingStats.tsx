import React, { useState, useEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight, TrendingUp, Users, Calendar, Clock, ArrowLeft } from 'lucide-react'
import { API_BASE_URL } from '../api'

interface BookingStatsProps {
    restaurantId: string
    onBack: () => void
}

interface DayStats {
    date: string
    bookings: number
    couverts: number
    walkins: number
    noShows: number
}

export const BookingStats: React.FC<BookingStatsProps> = ({ restaurantId, onBack }) => {
    const [period, setPeriod] = useState<'week' | 'month'>('week')
    const [startDate, setStartDate] = useState(() => {
        const d = new Date()
        d.setDate(d.getDate() - 7)
        return d.toISOString().split('T')[0]
    })
    const [stats, setStats] = useState<DayStats[]>([])
    const [loading, setLoading] = useState(true)

    // Fetch real stats from API
    useEffect(() => {
        const fetchStats = async () => {
            setLoading(true)
            try {
                const days = period === 'week' ? 7 : 30
                const start = new Date(startDate)
                const end = new Date(start)
                end.setDate(end.getDate() + days)

                const token = localStorage.getItem('events_token')
                const params = new URLSearchParams({
                    restaurantId,
                    from: startDate,
                    to: end.toISOString().split('T')[0]
                })

                const response = await fetch(`${API_BASE_URL}/api/admin/bookings?${params}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                })

                if (!response.ok) throw new Error('Failed to fetch stats')

                const { bookings } = await response.json()

                // Aggregate by day
                const dayMap: Record<string, DayStats> = {}
                for (let i = 0; i < days; i++) {
                    const d = new Date(start)
                    d.setDate(d.getDate() + i)
                    const dateStr = d.toISOString().split('T')[0]
                    dayMap[dateStr] = { date: dateStr, bookings: 0, couverts: 0, walkins: 0, noShows: 0 }
                }

                for (const b of bookings || []) {
                    const dateStr = b.booking_date?.split('T')[0] || b.start_datetime?.split('T')[0]
                    if (dateStr && dayMap[dateStr]) {
                        dayMap[dateStr].bookings++
                        dayMap[dateStr].couverts += b.guest_count || 0
                        if (b.is_walkin) dayMap[dateStr].walkins++
                        if (b.status === 'no_show') dayMap[dateStr].noShows++
                    }
                }

                setStats(Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date)))
            } catch (e) {
                console.error('Failed to fetch stats:', e)
                setStats([])
            } finally {
                setLoading(false)
            }
        }
        fetchStats()
    }, [startDate, period, restaurantId])

    const summary = useMemo(() => {
        return {
            totalBookings: stats.reduce((s, d) => s + d.bookings, 0),
            totalCouverts: stats.reduce((s, d) => s + d.couverts, 0),
            avgPerDay: Math.round(stats.reduce((s, d) => s + d.couverts, 0) / (stats.length || 1)),
            totalWalkins: stats.reduce((s, d) => s + d.walkins, 0),
            totalNoShows: stats.reduce((s, d) => s + d.noShows, 0),
            noShowRate: stats.length ? Math.round((stats.reduce((s, d) => s + d.noShows, 0) / stats.reduce((s, d) => s + d.bookings, 0)) * 100) : 0
        }
    }, [stats])

    const maxCouverts = Math.max(...stats.map(s => s.couverts), 1)

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr)
        return d.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })
    }

    const navigatePeriod = (direction: number) => {
        const d = new Date(startDate)
        d.setDate(d.getDate() + direction * (period === 'week' ? 7 : 30))
        setStartDate(d.toISOString().split('T')[0])
    }

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-200">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={onBack}
                            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            <ArrowLeft className="w-5 h-5 text-gray-600" />
                        </button>
                        <h2 className="text-lg font-semibold text-gray-900">📊 Statistieken</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => navigatePeriod(-1)}
                            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            <ChevronLeft className="w-5 h-5 text-gray-600" />
                        </button>
                        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                            <button
                                onClick={() => setPeriod('week')}
                                className={`px-3 py-1.5 text-sm font-medium transition-colors ${period === 'week' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                            >
                                Week
                            </button>
                            <button
                                onClick={() => setPeriod('month')}
                                className={`px-3 py-1.5 text-sm font-medium transition-colors ${period === 'month' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                            >
                                Maand
                            </button>
                        </div>
                        <button
                            onClick={() => navigatePeriod(1)}
                            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            <ChevronRight className="w-5 h-5 text-gray-600" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 border-b border-gray-200">
                <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-emerald-600 mb-1">
                        <Calendar className="w-4 h-4" />
                        <span className="text-xs font-medium">Boekingen</span>
                    </div>
                    <div className="text-2xl font-bold text-emerald-700">{summary.totalBookings}</div>
                </div>
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-blue-600 mb-1">
                        <Users className="w-4 h-4" />
                        <span className="text-xs font-medium">Couverts</span>
                    </div>
                    <div className="text-2xl font-bold text-blue-700">{summary.totalCouverts}</div>
                    <div className="text-xs text-blue-500 mt-1">Ø {summary.avgPerDay}/dag</div>
                </div>
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-purple-600 mb-1">
                        <TrendingUp className="w-4 h-4" />
                        <span className="text-xs font-medium">Walk-ins</span>
                    </div>
                    <div className="text-2xl font-bold text-purple-700">{summary.totalWalkins}</div>
                </div>
                <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-red-600 mb-1">
                        <Clock className="w-4 h-4" />
                        <span className="text-xs font-medium">No-shows</span>
                    </div>
                    <div className="text-2xl font-bold text-red-700">{summary.totalNoShows}</div>
                    <div className="text-xs text-red-500 mt-1">{summary.noShowRate}% rate</div>
                </div>
            </div>

            {/* Chart */}
            <div className="p-4">
                <h3 className="text-sm font-medium text-gray-700 mb-4">Couverts per dag</h3>
                {loading ? (
                    <div className="h-48 flex items-center justify-center text-gray-400">Laden...</div>
                ) : (
                    <div className="flex items-end gap-1 h-48">
                        {stats.map((day, i) => (
                            <div key={i} className="flex-1 flex flex-col items-center">
                                <div className="w-full flex flex-col items-center">
                                    <span className="text-xs text-gray-500 mb-1">{day.couverts}</span>
                                    <div
                                        className="w-full bg-gradient-to-t from-blue-500 to-blue-400 rounded-t transition-all hover:from-blue-600 hover:to-blue-500"
                                        style={{ height: `${(day.couverts / maxCouverts) * 140}px` }}
                                        title={`${formatDate(day.date)}: ${day.couverts} couverts`}
                                    />
                                </div>
                                <span className="text-[10px] text-gray-400 mt-1 rotate-[-45deg] origin-top-left whitespace-nowrap">
                                    {formatDate(day.date).split(' ')[0]}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Detailed Table */}
            <div className="border-t border-gray-200">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-4 py-2 text-left font-medium text-gray-600">Datum</th>
                            <th className="px-4 py-2 text-right font-medium text-gray-600">Boekingen</th>
                            <th className="px-4 py-2 text-right font-medium text-gray-600">Couverts</th>
                            <th className="px-4 py-2 text-right font-medium text-gray-600">Walk-ins</th>
                            <th className="px-4 py-2 text-right font-medium text-gray-600">No-shows</th>
                        </tr>
                    </thead>
                    <tbody>
                        {stats.map((day, i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                <td className="px-4 py-2 text-gray-900">{formatDate(day.date)}</td>
                                <td className="px-4 py-2 text-right text-emerald-600 font-medium">{day.bookings}</td>
                                <td className="px-4 py-2 text-right text-blue-600 font-medium">{day.couverts}</td>
                                <td className="px-4 py-2 text-right text-purple-600">{day.walkins}</td>
                                <td className="px-4 py-2 text-right text-red-600">{day.noShows}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
