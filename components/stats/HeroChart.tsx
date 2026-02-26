import React from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Line, ComposedChart } from 'recharts'
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

export const HeroChart: React.FC<Props> = ({ data, metric, onMetricChange, onDayClick, stats }) => {
    const prevDataKey = `prev${metric.charAt(0).toUpperCase() + metric.slice(1)}`
    const hasPrev = data.some(d => (d as any)[prevDataKey] != null)

    return (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-gray-900">Trend</h2>
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
                </ComposedChart>
            </ResponsiveContainer>
            <div className="flex items-center justify-center gap-4 text-xs text-gray-400 mt-2">
                <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-blue-600 inline-block" /> Huidig</span>
                {hasPrev && <span className="flex items-center gap-1"><span className="w-4 h-0.5 inline-block" style={{ borderTop: '1.5px dashed #d1d5db' }} /> Vorige periode</span>}
                <span>Klik voor details</span>
            </div>
        </div>
    )
}
