import React from 'react'
import { TrendingDown } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from 'recharts'
import type { DayStats, Comparison, PartySizeBucket, LeadTimeBucket, TableUtil, HeatmapCell } from './types'
import { ACCENT, LEAD_TIME_LABELS } from './types'
import { fmtChartLabel } from './formatters'

const COLORS = ['#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe']

interface Props {
    stats: DayStats[]
    comparison: Comparison
    tableUtil: TableUtil[]
    partySizes: PartySizeBucket[]
    leadTimes: LeadTimeBucket[]
    repeatRate: number
    peakHours: { hour: number; count: number }[]
    totalSeats: number
    activeDays: number
    onDayClick: (day: DayStats) => void
}

export const AnalyseCharts: React.FC<Props> = ({ stats, comparison, tableUtil, partySizes, leadTimes, repeatRate, peakHours, totalSeats, activeDays, onDayClick }) => {
    const hasCancellations = stats.some(d => d.cancellations > 0 || d.noShows > 0)
    const maxTableCount = Math.max(...tableUtil.map(t => t.booking_count), 1)

    // Time slot utilization data
    const slotData = Array.from({ length: 12 }, (_, i) => {
        const hour = i + 11
        const ph = peakHours.find(p => p.hour === hour)
        const count = ph?.count || 0
        const capacity = totalSeats * (activeDays || 1)
        return { hour: `${hour}:00`, boekingen: count, bezetting: capacity > 0 ? Math.min(100, Math.round(count / capacity * 100)) : 0 }
    })

    // First-time vs repeat data
    const repeatData = repeatRate > 0 ? [
        { name: 'Terugkerend', value: repeatRate },
        { name: 'Eerste bezoek', value: 100 - repeatRate },
    ] : []

    return (
        <div className="space-y-5">
            {/* Cancellation trend */}
            {hasCancellations && (
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-base font-semibold text-gray-900">Annuleringstrend</h2>
                        {comparison.cancellations !== 0 && (
                            <span className={`inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded ${comparison.cancellations < 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                                <TrendingDown className="w-3 h-3" />{comparison.cancellations > 0 ? '+' : ''}{comparison.cancellations}%
                            </span>
                        )}
                    </div>
                    <ResponsiveContainer width="100%" height={160}>
                        <BarChart data={stats.filter(d => d.cancellations > 0 || d.noShows > 0).map(d => ({ label: fmtChartLabel(d.date), cancellations: d.cancellations, noShows: d.noShows }))}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={25} allowDecimals={false} />
                            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                            <Bar dataKey="cancellations" fill="#f97316" radius={[3, 3, 0, 0]} name="Annuleringen" />
                            <Bar dataKey="noShows" fill="#ef4444" radius={[3, 3, 0, 0]} name="No-shows" />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* Party size + Lead time + Repeat — side by side */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Party size distribution */}
                {partySizes.length > 0 && (
                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                        <h2 className="text-sm font-semibold text-gray-900 mb-3">Groepsgrootte</h2>
                        <div className="space-y-2">
                            {partySizes.map(ps => {
                                const total = partySizes.reduce((s, p) => s + p.count, 0)
                                const pct = total > 0 ? Math.round(ps.count / total * 100) : 0
                                return (
                                    <div key={ps.size} className="flex items-center gap-2 text-sm">
                                        <span className="w-8 text-gray-600 font-medium shrink-0">{ps.size}p</span>
                                        <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%`, minWidth: ps.count > 0 ? '4px' : '0' }} />
                                        </div>
                                        <span className="w-16 text-right text-gray-500 tabular-nums shrink-0">{ps.count} ({pct}%)</span>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )}

                {/* Lead time distribution */}
                {leadTimes.length > 0 && (
                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                        <h2 className="text-sm font-semibold text-gray-900 mb-3">Boekingstijd vooruit</h2>
                        <div className="space-y-2">
                            {['same_day', '1_day', '2_3_days', '4_7_days', '8_plus'].map(key => {
                                const lt = leadTimes.find(l => l.bucket === key)
                                const total = leadTimes.reduce((s, l) => s + l.count, 0)
                                const pct = total > 0 && lt ? Math.round(lt.count / total * 100) : 0
                                return (
                                    <div key={key} className="flex items-center gap-2 text-sm">
                                        <span className="w-20 text-gray-600 shrink-0 text-xs">{LEAD_TIME_LABELS[key]}</span>
                                        <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-blue-400 rounded-full" style={{ width: `${pct}%`, minWidth: lt && lt.count > 0 ? '4px' : '0' }} />
                                        </div>
                                        <span className="w-12 text-right text-gray-500 tabular-nums text-xs shrink-0">{lt?.count || 0}</span>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )}

                {/* First-time vs repeat donut */}
                {repeatData.length > 0 && (
                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                        <h2 className="text-sm font-semibold text-gray-900 mb-3">Eerste vs terugkerend</h2>
                        <div className="flex items-center gap-4">
                            <div style={{ width: 100, height: 100 }}>
                                <ResponsiveContainer>
                                    <PieChart>
                                        <Pie data={repeatData} dataKey="value" innerRadius={25} outerRadius={45} paddingAngle={2}>
                                            {repeatData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                                        </Pie>
                                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="space-y-1.5 text-sm">
                                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-blue-600" /> Terugkerend: <b>{repeatRate}%</b></div>
                                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-blue-400" /> Eerste bezoek: <b>{100 - repeatRate}%</b></div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Table utilization */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-base font-semibold text-gray-900 mb-4">Tafelbezetting</h2>
                <div className="space-y-2 max-h-72 overflow-y-auto">
                    {tableUtil.map(t => {
                        const pct = Math.round((t.booking_count / maxTableCount) * 100)
                        return (
                            <div key={t.id} className="flex items-center gap-3 text-sm hover:bg-gray-50 rounded-lg px-2 py-1.5">
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

            {/* Time slot utilization */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-base font-semibold text-gray-900 mb-1">Tijdslotbezetting</h2>
                <p className="text-xs text-gray-400 mb-4">Boekingen per uur versus capaciteit ({totalSeats} stoelen × {activeDays} dagen)</p>
                <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={slotData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="hour" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={30} allowDecimals={false} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number, name: string) => [name === 'bezetting' ? `${v}%` : v, name === 'bezetting' ? 'Bezetting' : 'Boekingen']} />
                        <Bar dataKey="boekingen" fill={ACCENT} radius={[3, 3, 0, 0]} name="Boekingen" />
                    </BarChart>
                </ResponsiveContainer>
            </div>

            {/* Covers bar chart */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-base font-semibold text-gray-900 mb-4">Couverts per dag</h2>
                <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={stats.map(d => ({ label: fmtChartLabel(d.date), couverts: d.couverts, date: d.date }))}
                        onClick={(e: any) => { if (e?.activePayload?.[0]) { const d = stats.find(s => s.date === e.activePayload[0].payload.date); if (d) onDayClick(d) } }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 12, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={30} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                        <Bar dataKey="couverts" fill={ACCENT} radius={[4, 4, 0, 0]} cursor="pointer" name="Couverts" />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    )
}
