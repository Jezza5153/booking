import React from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import type { Summary, Comparison, ExtraStats, RevenueData, MetricDetail, DayStats } from './types'
import { SERVICE_CONFIG } from './types'
import { fmtCurrency, fmtCurrencyDecimal, fmtPct, fmtChartLabel } from './formatters'
import { MetricTooltip } from './MetricTooltip'

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

interface YoyData { bookings: number | null; couverts: number | null; revenue: number | null; has_data: boolean }

interface Props {
    summary: Summary
    comparison: Comparison
    extraStats: ExtraStats
    revenueData: RevenueData
    totalSeats: number
    stats: DayStats[]
    yoy: YoyData
    onSelectMetric: (m: MetricDetail) => void
}

export const KpiGrid: React.FC<Props> = ({ summary, comparison, extraStats, revenueData, totalSeats, stats, yoy, onSelectMetric }) => {
    const { hoursPerDay } = SERVICE_CONFIG

    const openDetail = (key: string, label: string, value: string | number, delta?: number, explanation?: string) => {
        const prevMap: Record<string, number | undefined> = {
            revenue: comparison.revenue ? Math.round(summary.revenue / (1 + comparison.revenue / 100)) : undefined,
            couverts: comparison.couverts ? Math.round(summary.couverts / (1 + comparison.couverts / 100)) : undefined,
        }
        const trendMap: Record<string, { label: string; value: number }[]> = {
            revenue: stats.map(d => ({ label: fmtChartLabel(d.date), value: d.revenue || 0 })),
            couverts: stats.map(d => ({ label: fmtChartLabel(d.date), value: d.couverts })),
            bookings: stats.map(d => ({ label: fmtChartLabel(d.date), value: d.bookings })),
            noShows: stats.map(d => ({ label: fmtChartLabel(d.date), value: d.noShows })),
            cancellations: stats.map(d => ({ label: fmtChartLabel(d.date), value: d.cancellations })),
            walkins: stats.map(d => ({ label: fmtChartLabel(d.date), value: d.walkins })),
            occupancy: stats.map(d => ({ label: fmtChartLabel(d.date), value: totalSeats > 0 ? Math.min(100, Math.round(d.couverts / totalSeats * 100)) : 0 })),
            revpash: stats.map(d => ({ label: fmtChartLabel(d.date), value: totalSeats > 0 ? Math.round((d.revenue || 0) / (totalSeats * hoursPerDay) * 100) / 100 : 0 })),
        }
        onSelectMetric({
            key, label, value, delta,
            prevValue: prevMap[key],
            explanation: explanation || `${label} over de geselecteerde periode`,
            trendData: trendMap[key] || []
        })
    }

    const heroKpis = [
        { key: 'revenue', label: 'Omzet', value: fmtCurrency(summary.revenue), delta: comparison.revenue, yoyDelta: yoy.revenue, sub: revenueData.avg_per_couvert > 0 ? `Ø ${fmtCurrencyDecimal(revenueData.avg_per_couvert)}/couvert` : null, tooltip: 'avgSpend', explain: 'Totale handmatig ingevoerde omzet. Klik voor dagtrend.' },
        { key: 'couverts', label: 'Couverts', value: summary.couverts, delta: comparison.couverts, yoyDelta: yoy.couverts, sub: `Ø ${summary.avgPerDay}/dag`, explain: 'Totaal gasten (excl. annuleringen). Klik voor dagtrend.' },
        { key: 'occupancy', label: 'Bezetting', value: fmtPct(summary.occupancy), sub: `${totalSeats} stoelen · ${summary.activeDays}d`, tooltip: 'occupancy', explain: `Couverts ÷ (${totalSeats} × ${summary.activeDays}d). Begrensd op 100% per dag.` },
        { key: 'revpash', label: 'RevPASH', value: fmtCurrencyDecimal(summary.revpash), sub: 'per stoel per uur', tooltip: 'revpash', explain: `Omzet ÷ (${totalSeats} × ${summary.activeDays}d × ${hoursPerDay}u)` },
    ]

    const secondaryKpis = [
        { key: 'bookings', label: 'Boekingen', value: summary.bookings, delta: comparison.bookings, explain: 'Totaal boekingen (excl. annuleringen)' },
        { key: 'walkins', label: 'Walk-ins', value: summary.walkins, delta: comparison.walkins, explain: 'Walk-in gasten zonder boeking' },
        { key: 'noShows', label: 'No-shows', value: summary.noShows, delta: comparison.no_shows, invert: true, sub: fmtPct(summary.noShowRate), tooltip: 'noShowRate', explain: `${summary.noShows} no-shows op ${summary.bookings} boekingen (${summary.noShowRate}%)` },
        { key: 'cancellations', label: 'Annuleringen', value: summary.cancellations, delta: comparison.cancellations, invert: true, sub: fmtPct(summary.cancRate), tooltip: 'cancRate', explain: `${summary.cancellations} annuleringen (${summary.cancRate}%)` },
        { key: 'avgPartySize', label: 'Gem. groep', value: extraStats.avgPartySize, sub: 'personen', explain: 'Gemiddeld aantal gasten per boeking' },
    ]

    return (
        <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {heroKpis.map(kpi => (
                    <button key={kpi.key} onClick={() => openDetail(kpi.key, kpi.label, kpi.value, kpi.delta, kpi.explain)}
                        className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md hover:border-blue-200 transition-all text-left cursor-pointer group">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-gray-500 group-hover:text-blue-600 transition-colors">
                                {kpi.tooltip ? <MetricTooltip metricKey={kpi.tooltip}>{kpi.label}</MetricTooltip> : kpi.label}
                            </span>
                            {kpi.delta !== undefined && <Delta value={kpi.delta} />}
                        </div>
                        <div className="text-3xl font-bold text-gray-900 tabular-nums">{kpi.value}</div>
                        {kpi.sub && <div className="text-sm text-gray-400 mt-1">{kpi.sub}</div>}
                        {yoy.has_data && kpi.yoyDelta != null && kpi.yoyDelta !== 0 && (
                            <div className={`text-xs mt-1 ${kpi.yoyDelta > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                {kpi.yoyDelta > 0 ? '↑' : '↓'} {Math.abs(kpi.yoyDelta)}% vs vorig jaar
                            </div>
                        )}
                    </button>
                ))}
            </div>
            <div className="grid grid-cols-3 lg:grid-cols-5 gap-3">
                {secondaryKpis.map(kpi => (
                    <button key={kpi.key} onClick={() => openDetail(kpi.key, kpi.label, kpi.value, kpi.delta, kpi.explain)}
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
        </>
    )
}
