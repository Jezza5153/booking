import React, { useEffect } from 'react'
import { X, ArrowUpRight } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import type { DayStats, MetricDetail } from './types'
import { ACCENT } from './types'
import { fmtDateFull, fmtCurrencyDecimal, fmtChartLabel } from './formatters'

interface Props {
    day?: DayStats | null
    metric?: MetricDetail | null
    totalSeats: number
    onClose: () => void
    onViewBookings?: (date: string) => void
}

export const MetricDrawer: React.FC<Props> = ({ day, metric, totalSeats, onClose, onViewBookings }) => {
    const isOpen = !!(day || metric)

    // Escape key to close
    useEffect(() => {
        if (!isOpen) return
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        document.addEventListener('keydown', handler)
        return () => document.removeEventListener('keydown', handler)
    }, [isOpen, onClose])

    if (!isOpen) return null

    return (
        <>
            {/* Backdrop — locks background interaction */}
            <div className="fixed inset-0 bg-black/30 z-40 transition-opacity" onClick={onClose} />

            {/* Drawer */}
            <div className="fixed inset-y-0 right-0 w-80 max-w-[90vw] bg-white border-l border-gray-200 shadow-2xl z-50 flex flex-col" role="dialog" aria-modal="true">
                <div className="p-5 border-b border-gray-200 flex items-center justify-between shrink-0">
                    <h3 className="text-base font-bold text-gray-900 truncate pr-2">
                        {day ? fmtDateFull(day.date) : metric?.label || ''}
                    </h3>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg shrink-0" style={{ minHeight: 44, minWidth: 44 }} aria-label="Sluiten">
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    {/* ── Day detail mode ── */}
                    {day && (
                        <>
                            <div className="grid grid-cols-2 gap-3">
                                {[
                                    { l: 'Boekingen', v: day.bookings },
                                    { l: 'Couverts', v: day.couverts },
                                    { l: 'Walk-ins', v: day.walkins },
                                    { l: 'No-shows', v: day.noShows, warn: day.noShows > 0 },
                                    { l: 'Annuleringen', v: day.cancellations, warn: day.cancellations > 0 },
                                    { l: 'Omzet', v: day.revenue != null ? `€${day.revenue.toLocaleString('nl-NL')}` : '—' },
                                ].map((k, i) => (
                                    <div key={i} className={`rounded-lg p-3 ${k.warn ? 'bg-red-50' : 'bg-gray-50'}`}>
                                        <div className={`text-xs mb-1 ${k.warn ? 'text-red-500' : 'text-gray-500'}`}>{k.l}</div>
                                        <div className={`text-xl font-bold ${k.warn ? 'text-red-700' : 'text-gray-900'}`}>{k.v}</div>
                                    </div>
                                ))}
                            </div>
                            {day.revenue != null && day.couverts > 0 && (
                                <div className="bg-blue-50 rounded-lg p-4">
                                    <div className="text-sm text-blue-600 font-medium">Gemiddelde besteding</div>
                                    <div className="text-2xl font-bold text-blue-900 mt-1">{fmtCurrencyDecimal(day.revenue / day.couverts)}</div>
                                    <div className="text-sm text-blue-500 mt-1">per couvert</div>
                                </div>
                            )}
                            {totalSeats > 0 && (
                                <div className="bg-gray-50 rounded-lg p-4">
                                    <div className="text-sm text-gray-600 font-medium">Bezetting</div>
                                    <div className="text-2xl font-bold text-gray-900 mt-1">{Math.min(100, Math.round((day.couverts / totalSeats) * 100))}%</div>
                                    <div className="text-sm text-gray-400 mt-1">{day.couverts} van {totalSeats} stoelen</div>
                                </div>
                            )}
                            {onViewBookings && (
                                <button className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors" style={{ minHeight: 48 }}
                                    onClick={() => onViewBookings(day.date)}>
                                    <ArrowUpRight className="w-4 h-4" /> Bekijk boekingen voor deze dag
                                </button>
                            )}
                        </>
                    )}

                    {/* ── Metric detail mode ── */}
                    {metric && (
                        <>
                            <div className="bg-gray-50 rounded-lg p-4">
                                <div className="text-sm text-gray-500 mb-1">{metric.label}</div>
                                <div className="text-3xl font-bold text-gray-900">{metric.value}</div>
                                {metric.prevValue !== undefined && (
                                    <div className="text-sm text-gray-400 mt-1">Vorige periode: {metric.prevValue}</div>
                                )}
                                {metric.delta !== undefined && metric.delta !== 0 && (
                                    <div className={`text-sm font-semibold mt-1 ${metric.delta > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                        {metric.delta > 0 ? '+' : ''}{metric.delta}% vs vorige periode
                                    </div>
                                )}
                            </div>
                            <p className="text-sm text-gray-600 leading-relaxed">{metric.explanation}</p>
                            {metric.trendData.length > 0 && (
                                <div className="bg-white rounded-lg border border-gray-200 p-3">
                                    <div className="text-xs font-medium text-gray-500 mb-2">Trend</div>
                                    <ResponsiveContainer width="100%" height={120}>
                                        <AreaChart data={metric.trendData}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                                            <YAxis hide />
                                            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                                            <Area type="monotone" dataKey="value" stroke={ACCENT} strokeWidth={1.5} fill={ACCENT} fillOpacity={0.08} />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </>
    )
}
