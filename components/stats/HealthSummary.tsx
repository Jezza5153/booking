import React from 'react'
import type { Summary, Comparison, ExtraStats, RevenueData } from './types'
import { fmtCurrency, fmtPct, fmtCurrencyDecimal } from './formatters'

interface Props {
    summary: Summary
    comparison: Comparison
    extraStats: ExtraStats
    revenueData: RevenueData
    repeatRate: number
    totalSeats: number
}

export const HealthSummary: React.FC<Props> = ({ summary, comparison, extraStats, revenueData, repeatRate, totalSeats }) => {
    // Score 0-100: weighted composite
    const revScore = Math.min(100, comparison.revenue > 0 ? 75 + comparison.revenue * 0.5 : Math.max(25, 50 + comparison.revenue * 0.5))
    const occScore = Math.min(100, summary.occupancy)
    const cancScore = Math.max(0, 100 - summary.cancRate * 3)
    const noshowScore = Math.max(0, 100 - summary.noShowRate * 5)
    const health = Math.round((revScore * 0.35 + occScore * 0.25 + cancScore * 0.2 + noshowScore * 0.2))

    const grade = health >= 80 ? 'Uitstekend' : health >= 60 ? 'Goed' : health >= 40 ? 'Matig' : 'Actie nodig'
    const gradeColor = health >= 80 ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : health >= 60 ? 'text-blue-700 bg-blue-50 border-blue-200' : health >= 40 ? 'text-orange-700 bg-orange-50 border-orange-200' : 'text-red-700 bg-red-50 border-red-200'
    const barColor = health >= 80 ? 'bg-emerald-500' : health >= 60 ? 'bg-blue-500' : health >= 40 ? 'bg-orange-500' : 'bg-red-500'

    // Build plain-language insights
    const insights: string[] = []
    if (comparison.revenue > 5) insights.push(`Omzet steeg ${comparison.revenue}% ten opzichte van vorige periode.`)
    else if (comparison.revenue < -5) insights.push(`Omzet daalde ${Math.abs(comparison.revenue)}% — onderzoek de oorzaak.`)
    if (summary.cancRate > 10) insights.push(`Annuleringspercentage van ${summary.cancRate}% is boven de norm (< 10%).`)
    if (summary.noShowRate > 5) insights.push(`No-show rate van ${summary.noShowRate}% kost stoelen — overweeg bevestigings-SMS.`)
    if (summary.occupancy > 85) insights.push(`Bezetting van ${summary.occupancy}% is bijna vol — overweeg uitbreiding of dubbele seating.`)
    else if (summary.occupancy < 40) insights.push(`Bezetting van slechts ${summary.occupancy}% — marketing of minder stoelen?`)
    if (repeatRate > 30) insights.push(`${repeatRate}% terugkerende gasten — loyaliteit is sterk.`)
    if (insights.length === 0) insights.push('Alle kernindicatoren zijn binnen normale waarden.')

    return (
        <div className={`rounded-xl border p-4 ${gradeColor}`}>
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                    <div className="text-2xl font-bold">{health}</div>
                    <div>
                        <div className="text-sm font-semibold">{grade}</div>
                        <div className="text-xs opacity-70">Bedrijfsgezondheid</div>
                    </div>
                </div>
                <div className="w-32 h-2.5 bg-white/50 rounded-full overflow-hidden">
                    <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${health}%` }} />
                </div>
            </div>
            <div className="space-y-1">
                {insights.map((ins, i) => (
                    <p key={i} className="text-sm leading-snug">{ins}</p>
                ))}
            </div>
        </div>
    )
}
