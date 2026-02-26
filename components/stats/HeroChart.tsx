import React, { useState, useEffect } from 'react'
import { XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Line, ComposedChart, ReferenceLine, Area } from 'recharts'
import type { ChartMetric, DayStats } from './types'
import { ACCENT } from './types'
import { fmtCurrency } from './formatters'

interface ChartPoint {
    label: string; date: string
    couverts: number; bookings: number; revenue: number
    prevCouverts: number | null; prevBookings: number | null; prevRevenue: number | null
}

interface Props {
    data: ChartPoint[]
    metric: ChartMetric
    onMetricChange: (m: ChartMetric) => void
    onDayClick: (day: DayStats) => void
    stats: DayStats[]
    restaurantId: string
}

const ChartTooltipContent = ({ active, payload, label, metric }: any) => {
    if (!active || !payload?.length) return null
    const curr = payload.find((p: any) => p.dataKey === metric)
    const prevKey = `prev${metric.charAt(0).toUpperCase() + metric.slice(1)}`
    const prev = payload.find((p: any) => p.dataKey === prevKey)
    const fmt = metric === 'revenue' ? fmtCurrency : (v: number) => `${v}`
    return (
        <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2.5 shadow-lg">
            <div className="font-medium mb-1">{label}</div>
            {curr && <div>Huidig: <b>{fmt(curr.value)}</b></div>}
            {prev?.value != null && <div className="text-gray-400 mt-0.5">Vorig: {fmt(prev.value)}</div>}
        </div>
    )
}

const TARGET_LABELS: Record<ChartMetric, string> = { revenue: 'Omzet doel', couverts: 'Couvert doel', bookings: 'Boekingsdoel' }

export const HeroChart: React.FC<Props> = ({ data, metric, onMetricChange, onDayClick, stats, restaurantId }) => {
    const prevDataKey = `prev${metric.charAt(0).toUpperCase() + metric.slice(1)}`
    const hasPrev = data.some(d => (d as any)[prevDataKey] != null)

    // Target (per day) stored in localStorage per restaurant + metric
    const storageKey = `target_${restaurantId}_${metric}`
    const [target, setTarget] = useState<number | null>(() => {
        const v = localStorage.getItem(storageKey)
        return v ? parseFloat(v) : null
    })
    const [editingTarget, setEditingTarget] = useState(false)
    const [targetInput, setTargetInput] = useState('')

    useEffect(() => {
        const v = localStorage.getItem(`target_${restaurantId}_${metric}`)
        setTarget(v ? parseFloat(v) : null)
    }, [metric, restaurantId])

    const saveTarget = () => {
        const val = parseFloat(targetInput)
        if (!isNaN(val) && val > 0) {
            localStorage.setItem(storageKey, val.toString())
            setTarget(val)
        } else {
            localStorage.removeItem(storageKey)
            setTarget(null)
        }
        setEditingTarget(false)
    }

    return (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-gray-900">Trend</h2>
                <div className="flex items-center gap-2">
                    <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                        {([['couverts', 'Couverts'], ['bookings', 'Boekingen'], ['revenue', 'Omzet']] as [ChartMetric, string][]).map(([key, label]) => (
                            <button key={key} onClick={() => onMetricChange(key)}
                                className={`px-3 py-1.5 text-sm font-medium transition-colors ${metric === key ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                                style={{ minHeight: 36 }}>
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
            <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={data} onClick={(e: any) => {
                    if (e?.activePayload?.[0]) {
                        const d = stats.find(s => s.date === e.activePayload[0].payload.date)
                        if (d) onDayClick(d)
                    }
                }}>
                    <defs>
                        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={ACCENT} stopOpacity={0.15} />
                            <stop offset="95%" stopColor={ACCENT} stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={40} />
                    <Tooltip content={<ChartTooltipContent metric={metric} />} />
                    <Area type="monotone" dataKey={metric} stroke={ACCENT} strokeWidth={2} fill="url(#chartGrad)" dot={{ r: 3, fill: ACCENT, stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 6, fill: ACCENT }} />
                    {hasPrev && <Line type="monotone" dataKey={prevDataKey} stroke="#d1d5db" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls />}
                    {target != null && (
                        <ReferenceLine y={target} stroke="#f59e0b" strokeDasharray="6 3" strokeWidth={1.5}
                            label={{ value: `Doel: ${metric === 'revenue' ? `€${target}` : target}`, position: 'right', fill: '#f59e0b', fontSize: 11, fontWeight: 600 }} />
                    )}
                </ComposedChart>
            </ResponsiveContainer>
            <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-4 text-xs text-gray-400">
                    <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-blue-600 inline-block" /> Huidig</span>
                    {hasPrev && <span className="flex items-center gap-1"><span className="w-4 h-0.5 inline-block" style={{ borderTop: '1.5px dashed #d1d5db' }} /> Vorige periode</span>}
                    {target != null && <span className="flex items-center gap-1"><span className="w-4 h-0.5 inline-block" style={{ borderTop: '1.5px dashed #f59e0b' }} /> Dagdoel</span>}
                    <span>Klik voor details</span>
                </div>
                {editingTarget ? (
                    <form className="flex items-center gap-1" onSubmit={e => { e.preventDefault(); saveTarget() }}>
                        <input type="number" step="any" autoFocus placeholder={TARGET_LABELS[metric]}
                            className="w-24 px-2 py-1 text-xs border border-amber-300 rounded focus:ring-2 focus:ring-amber-400 outline-none text-right"
                            value={targetInput} onChange={e => setTargetInput(e.target.value)}
                            onBlur={saveTarget} />
                        <span className="text-xs text-gray-400">/dag</span>
                    </form>
                ) : (
                    <button onClick={() => { setEditingTarget(true); setTargetInput(target?.toString() || '') }}
                        className="text-xs text-amber-600 hover:text-amber-700 font-medium hover:bg-amber-50 px-2 py-1 rounded transition-colors">
                        {target != null ? `Doel: ${metric === 'revenue' ? `€${target}` : target}/dag` : '+ Doel instellen'}
                    </button>
                )}
            </div>
        </div>
    )
}
