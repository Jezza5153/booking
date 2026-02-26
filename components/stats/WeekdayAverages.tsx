import React from 'react'
import type { DayStats } from './types'

interface WeekdayAvg { dow: number; avg_bookings: number; avg_couverts: number }
interface Props { weekdayAverages: WeekdayAvg[]; stats: DayStats[] }

const DAY_LABELS = ['Zo', 'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za']
const DAY_LABELS_FULL = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag']

export const WeekdayAverages: React.FC<Props> = ({ weekdayAverages, stats }) => {
    if (weekdayAverages.length === 0) return null

    // Current period averages per weekday
    const currentByDow: Record<number, { bookings: number[]; couverts: number[] }> = {}
    for (const d of stats) {
        const dow = new Date(d.date).getDay()
        if (!currentByDow[dow]) currentByDow[dow] = { bookings: [], couverts: [] }
        currentByDow[dow].bookings.push(d.bookings)
        currentByDow[dow].couverts.push(d.couverts)
    }

    const maxCouverts = Math.max(...weekdayAverages.map(w => w.avg_couverts), 1)

    return (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Weekdaggemiddelden</h2>
            <p className="text-xs text-gray-400 mb-4">Historisch gemiddelde vs huidige periode per weekdag</p>
            <div className="space-y-2.5">
                {[1, 2, 3, 4, 5, 6, 0].map(dow => {
                    const avg = weekdayAverages.find(w => w.dow === dow)
                    const current = currentByDow[dow]
                    const currAvgCouverts = current ? Math.round(current.couverts.reduce((s, v) => s + v, 0) / current.couverts.length) : null
                    const currAvgBookings = current ? Math.round(current.bookings.reduce((s, v) => s + v, 0) / current.bookings.length * 10) / 10 : null

                    const histAvg = avg?.avg_couverts || 0
                    const barPct = maxCouverts > 0 ? Math.round((histAvg / maxCouverts) * 100) : 0
                    const currBarPct = currAvgCouverts != null && maxCouverts > 0 ? Math.round((currAvgCouverts / maxCouverts) * 100) : 0

                    // Delta: current vs historical
                    const delta = currAvgCouverts != null && histAvg > 0
                        ? Math.round(((currAvgCouverts - histAvg) / histAvg) * 100)
                        : null

                    return (
                        <div key={dow} className="group">
                            <div className="flex items-center gap-2 text-sm">
                                <span className="w-6 text-gray-600 font-semibold shrink-0">{DAY_LABELS[dow]}</span>
                                <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden relative">
                                    {/* Historical average bar (background) */}
                                    <div className="absolute inset-y-0 left-0 bg-blue-100 rounded-full" style={{ width: `${barPct}%` }} />
                                    {/* Current period bar (foreground) */}
                                    {currAvgCouverts != null && (
                                        <div className="absolute inset-y-0 left-0 bg-blue-500 rounded-full transition-all" style={{ width: `${currBarPct}%` }} />
                                    )}
                                </div>
                                <div className="w-28 shrink-0 text-right">
                                    <span className="text-gray-900 font-medium tabular-nums">{currAvgCouverts ?? '—'}</span>
                                    <span className="text-gray-400 text-xs ml-1">/ {histAvg}</span>
                                </div>
                                <div className="w-14 shrink-0 text-right">
                                    {delta != null && delta !== 0 && (
                                        <span className={`text-xs font-semibold ${delta > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                            {delta > 0 ? '+' : ''}{delta}%
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-400 mt-3 pt-3 border-t border-gray-100">
                <span className="flex items-center gap-1"><span className="w-3 h-2 bg-blue-500 rounded-sm inline-block" /> Huidige periode</span>
                <span className="flex items-center gap-1"><span className="w-3 h-2 bg-blue-100 rounded-sm inline-block" /> Historisch gem.</span>
                <span>Couverts per dag</span>
            </div>
        </div>
    )
}
