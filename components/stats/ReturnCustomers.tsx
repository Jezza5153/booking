import React, { useState, useMemo } from 'react'
import { Users, Repeat } from 'lucide-react'

interface FreqEntry { times: number; customers: number; total_bookings: number; total_couverts: number }
interface Props { frequency: FreqEntry[] }

export const ReturnCustomers: React.FC<Props> = ({ frequency }) => {
    const [threshold, setThreshold] = useState(2)

    if (frequency.length === 0) return null

    // Total unique customers
    const totalCustomers = useMemo(() => frequency.reduce((s, f) => s + f.customers, 0), [frequency])
    const totalBookings = useMemo(() => frequency.reduce((s, f) => s + f.total_bookings, 0), [frequency])
    const totalCouverts = useMemo(() => frequency.reduce((s, f) => s + f.total_couverts, 0), [frequency])

    // Stats for customers who booked >= threshold times
    const filtered = useMemo(() => {
        const matching = frequency.filter(f => f.times >= threshold)
        return {
            customers: matching.reduce((s, f) => s + f.customers, 0),
            bookings: matching.reduce((s, f) => s + f.total_bookings, 0),
            couverts: matching.reduce((s, f) => s + f.total_couverts, 0),
        }
    }, [frequency, threshold])

    const pctCustomers = totalCustomers > 0 ? Math.round(filtered.customers / totalCustomers * 100) : 0
    const pctBookings = totalBookings > 0 ? Math.round(filtered.bookings / totalBookings * 100) : 0
    const pctCouverts = totalCouverts > 0 ? Math.round(filtered.couverts / totalCouverts * 100) : 0

    // Bar chart data (1-10+)
    const maxCustomers = Math.max(...frequency.map(f => f.customers), 1)
    const bars = useMemo(() => {
        const result: { label: string; count: number }[] = []
        for (let i = 1; i <= 10; i++) {
            if (i < 10) {
                const entry = frequency.find(f => f.times === i)
                result.push({ label: `${i}×`, count: entry?.customers || 0 })
            } else {
                // 10+ bucket
                const count = frequency.filter(f => f.times >= 10).reduce((s, f) => s + f.customers, 0)
                result.push({ label: '10+', count })
            }
        }
        return result
    }, [frequency])

    return (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-2 mb-4">
                <div className="w-9 h-9 bg-purple-100 rounded-lg flex items-center justify-center">
                    <Repeat className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                    <h2 className="text-base font-semibold text-gray-900">Terugkerende gasten</h2>
                    <div className="text-xs text-gray-400">{totalCustomers} unieke gasten · alle tijd</div>
                </div>
            </div>

            {/* Frequency bar chart */}
            <div className="flex items-end gap-1 h-20 mb-4">
                {bars.map((bar, i) => {
                    const pct = maxCustomers > 0 ? Math.max(4, Math.round((bar.count / maxCustomers) * 100)) : 4
                    const isActive = (i + 1) >= threshold || (i === 9 && threshold <= 10)
                    return (
                        <div key={bar.label} className="flex-1 flex flex-col items-center gap-1">
                            <div className="text-[10px] text-gray-400 tabular-nums">{bar.count > 0 ? bar.count : ''}</div>
                            <div className={`w-full rounded-t transition-all ${isActive ? 'bg-purple-500' : 'bg-gray-200'}`}
                                style={{ height: `${pct}%`, minHeight: bar.count > 0 ? 4 : 2 }} />
                            <div className="text-[10px] text-gray-500 font-medium">{bar.label}</div>
                        </div>
                    )
                })}
            </div>

            {/* Threshold slider */}
            <div className="mb-4">
                <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-medium text-gray-700">Minimaal aantal boekingen</label>
                    <span className="text-sm font-bold text-purple-600 tabular-nums bg-purple-50 px-2 py-0.5 rounded">{threshold}×</span>
                </div>
                <input type="range" min={1} max={10} value={threshold} onChange={e => setThreshold(parseInt(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                    style={{ minHeight: 44 }} />
                <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                    <span>1×</span><span>5×</span><span>10×</span>
                </div>
            </div>

            {/* Three stats */}
            <div className="grid grid-cols-3 gap-3">
                <div className="bg-purple-50 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-purple-700 tabular-nums">{filtered.customers}</div>
                    <div className="text-xs text-purple-500 font-medium mt-0.5">Gasten</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{pctCustomers}% van totaal</div>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-blue-700 tabular-nums">{filtered.bookings}</div>
                    <div className="text-xs text-blue-500 font-medium mt-0.5">Boekingen</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{pctBookings}% van totaal</div>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-emerald-700 tabular-nums">{filtered.couverts}</div>
                    <div className="text-xs text-emerald-500 font-medium mt-0.5">Couverts</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{pctCouverts}% van totaal</div>
                </div>
            </div>

            <div className="text-xs text-gray-400 mt-3 pt-3 border-t border-gray-100">
                Gasten die {threshold}× of vaker hebben geboekt (op basis van e-mailadres)
            </div>
        </div>
    )
}
