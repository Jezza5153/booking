import React, { useState, useCallback, useEffect } from 'react'
import { ArrowLeftRight, X, TrendingUp, TrendingDown } from 'lucide-react'
import { API_BASE_URL } from '../../api'
import { DateRangePicker } from './DateRangePicker'
import { fmtCurrency, fmtDate, fmtPct } from './formatters'

interface PeriodData {
    bookings: number; couverts: number; revenue: number
    walkins: number; noShows: number; cancellations: number
    avgPerDay: number; activeDays: number
}

interface Props {
    restaurantId: string
    currentRange: { from: string; to: string }
    currentData: PeriodData
    token: string | null
}

const Delta = ({ a, b, invert, suffix }: { a: number; b: number; invert?: boolean; suffix?: string }) => {
    if (b === 0 && a === 0) return <span className="text-xs text-gray-400">—</span>
    const pct = b > 0 ? Math.round(((a - b) / b) * 100) : (a > 0 ? 100 : 0)
    if (pct === 0) return <span className="text-xs text-gray-400">0%</span>
    const good = invert ? pct < 0 : pct > 0
    return (
        <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${good ? 'text-emerald-600' : 'text-red-500'}`}>
            {good ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {pct > 0 ? '+' : ''}{pct}%{suffix ? ` ${suffix}` : ''}
        </span>
    )
}

export const ComparePeriods: React.FC<Props> = ({ restaurantId, currentRange, currentData, token }) => {
    const [enabled, setEnabled] = useState(false)
    const [compareRange, setCompareRange] = useState<{ from: string; to: string }>(() => {
        // Default: same length period immediately before current
        const fromDate = new Date(currentRange.from)
        const toDate = new Date(currentRange.to)
        const days = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1
        const prevTo = new Date(fromDate); prevTo.setDate(prevTo.getDate() - 1)
        const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - days + 1)
        return { from: prevFrom.toISOString().split('T')[0], to: prevTo.toISOString().split('T')[0] }
    })
    const [compareData, setCompareData] = useState<PeriodData | null>(null)
    const [loading, setLoading] = useState(false)
    const [fetchError, setFetchError] = useState(false)

    const fetchCompare = useCallback(async () => {
        setLoading(true)
        setFetchError(false)
        try {
            const params = new URLSearchParams({ restaurantId, from: compareRange.from, to: compareRange.to })
            const res = await fetch(`${API_BASE_URL}/api/admin/stats?${params}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            if (!res.ok) throw new Error('Failed')
            const data = await res.json()
            const daily = data.daily || []
            const b = daily.reduce((s: number, d: any) => s + (parseInt(d.bookings) || 0), 0)
            const c = daily.reduce((s: number, d: any) => s + (parseInt(d.couverts) || 0), 0)
            const rev = data.revenue?.total || 0
            const ad = daily.filter((d: any) => parseInt(d.bookings) > 0).length
            setCompareData({
                bookings: b, couverts: c, revenue: rev,
                walkins: daily.reduce((s: number, d: any) => s + (parseInt(d.walkins) || 0), 0),
                noShows: daily.reduce((s: number, d: any) => s + (parseInt(d.no_shows) || 0), 0),
                cancellations: daily.reduce((s: number, d: any) => s + (parseInt(d.cancellations) || 0), 0),
                avgPerDay: ad > 0 ? Math.round(c / ad) : 0,
                activeDays: ad
            })
        } catch (e) { console.error('Compare fetch error:', e); setCompareData(null); setFetchError(true) }
        finally { setLoading(false) }
    }, [compareRange, restaurantId, token])

    useEffect(() => { if (enabled) fetchCompare() }, [enabled, fetchCompare])

    if (!enabled) {
        return (
            <button onClick={() => setEnabled(true)}
                className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-blue-200 transition-all w-full"
                style={{ minHeight: 48 }}>
                <ArrowLeftRight className="w-4 h-4 text-blue-500" />
                Vergelijk met een andere periode
            </button>
        )
    }

    const kpis = [
        { label: 'Boekingen', a: currentData.bookings, b: compareData?.bookings ?? 0 },
        { label: 'Couverts', a: currentData.couverts, b: compareData?.couverts ?? 0 },
        { label: 'Omzet', a: currentData.revenue, b: compareData?.revenue ?? 0, fmt: fmtCurrency },
        { label: 'Ø/dag', a: currentData.avgPerDay, b: compareData?.avgPerDay ?? 0 },
        { label: 'No-shows', a: currentData.noShows, b: compareData?.noShows ?? 0, invert: true },
        { label: 'Annuleringen', a: currentData.cancellations, b: compareData?.cancellations ?? 0, invert: true },
    ]

    return (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <ArrowLeftRight className="w-5 h-5 text-blue-500" />
                    <h2 className="text-base font-semibold text-gray-900">Periode vergelijken</h2>
                </div>
                <button onClick={() => setEnabled(false)} className="p-2 hover:bg-gray-100 rounded-lg" style={{ minHeight: 44, minWidth: 44 }}>
                    <X className="w-4 h-4 text-gray-400" />
                </button>
            </div>

            {/* Period labels */}
            <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-blue-50 rounded-lg px-3 py-2">
                    <div className="text-xs text-blue-500 font-medium mb-0.5">Periode A (huidig)</div>
                    <div className="text-sm font-semibold text-blue-900">{fmtDate(currentRange.from)} — {fmtDate(currentRange.to)}</div>
                </div>
                <div className="bg-gray-50 rounded-lg px-3 py-2">
                    <div className="text-xs text-gray-500 font-medium mb-0.5">Periode B (vergelijk)</div>
                    <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-gray-700 flex-1">{fmtDate(compareRange.from)} — {fmtDate(compareRange.to)}</div>
                        <DateRangePicker from={compareRange.from} to={compareRange.to} onChange={setCompareRange} />
                    </div>
                </div>
            </div>

            {/* Side-by-side KPIs */}
            {loading ? (
                <div className="animate-pulse grid grid-cols-3 gap-3">
                    {[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-lg" />)}
                </div>
            ) : fetchError ? (
                <div className="text-center py-4">
                    <div className="text-sm text-red-500 mb-2">Vergelijkingsdata kon niet geladen worden</div>
                    <button onClick={fetchCompare} className="text-sm text-blue-600 font-medium hover:underline">Opnieuw proberen</button>
                </div>
            ) : compareData ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {kpis.map(kpi => (
                        <div key={kpi.label} className="bg-gray-50 rounded-lg p-3">
                            <div className="text-xs text-gray-500 font-medium mb-1.5">{kpi.label}</div>
                            <div className="flex items-end gap-2">
                                <div>
                                    <div className="text-lg font-bold text-blue-700 tabular-nums">{kpi.fmt ? kpi.fmt(kpi.a) : kpi.a}</div>
                                    <div className="text-sm text-gray-400 tabular-nums">{kpi.fmt ? kpi.fmt(kpi.b) : kpi.b}</div>
                                </div>
                                <Delta a={kpi.a} b={kpi.b} invert={kpi.invert} />
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="text-sm text-gray-400 text-center py-4">Geen data voor vergelijkingsperiode</div>
            )}

            {/* Legend */}
            <div className="flex items-center gap-4 text-xs text-gray-400 mt-3 pt-3 border-t border-gray-100">
                <span className="flex items-center gap-1"><span className="w-2 h-2 bg-blue-600 rounded-full" /> Periode A</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 bg-gray-400 rounded-full" /> Periode B</span>
            </div>
        </div>
    )
}
