import React from 'react'
import type { DayStats, Summary, RevenueData } from './types'
import { fmtCurrency, fmtCurrencyDecimal, fmtDate } from './formatters'

interface Props {
    stats: DayStats[]
    summary: Summary
    revenueData: RevenueData
    sortCol: string
    sortDir: 'asc' | 'desc'
    selectedDate: string | null
    editingRevenue: string | null
    revenueInput: string
    onSort: (col: string) => void
    onRowClick: (day: DayStats) => void
    onEditRevenue: (date: string) => void
    onRevenueChange: (val: string) => void
    onSaveRevenue: (date: string, amount: string) => void
}

export const DailyTable: React.FC<Props> = ({
    stats, summary, revenueData, sortCol, sortDir, selectedDate,
    editingRevenue, revenueInput, onSort, onRowClick, onEditRevenue, onRevenueChange, onSaveRevenue
}) => {
    const sorted = [...stats].sort((a, b) => {
        let va: any = a[sortCol as keyof DayStats] ?? 0, vb: any = b[sortCol as keyof DayStats] ?? 0
        if (sortCol === 'avgSpend') { va = a.revenue && a.couverts ? a.revenue / a.couverts : 0; vb = b.revenue && b.couverts ? b.revenue / b.couverts : 0 }
        return sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1)
    })

    const cols = [
        { key: 'date', label: 'Datum', left: true },
        { key: 'bookings', label: 'Boek.' },
        { key: 'couverts', label: 'Couv.' },
        { key: 'walkins', label: 'Walk-in' },
        { key: 'noShows', label: 'No-show' },
        { key: 'cancellations', label: 'Annul.' },
        { key: 'revenue', label: 'Omzet' },
        { key: 'avgSpend', label: 'Ø/couv.' },
    ]

    return (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0 z-10">
                    <tr>
                        {cols.map(c => (
                            <th key={c.key} onClick={() => onSort(c.key)}
                                className={`px-3 py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900 select-none ${c.left ? 'text-left' : 'text-right'}`}
                                style={{ minHeight: 44 }}>
                                <span className="inline-flex items-center gap-1">
                                    {c.label}
                                    {sortCol === c.key && <span className="text-blue-600">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                                </span>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {sorted.map((day, i) => {
                        const avg = day.revenue && day.couverts > 0 ? (day.revenue / day.couverts).toFixed(2) : null
                        const sel = selectedDate === day.date
                        return (
                            <tr key={i} onClick={() => onRowClick(day)}
                                className={`cursor-pointer transition-colors border-t border-gray-100 ${sel ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                                <td className="px-3 py-2.5 font-medium text-gray-900">{fmtDate(day.date)}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums">{day.bookings || <span className="text-gray-300">—</span>}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums font-medium text-blue-600">{day.couverts || <span className="text-gray-300">—</span>}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{day.walkins || <span className="text-gray-300">—</span>}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums">{day.noShows ? <span className="text-red-600 font-medium">{day.noShows}</span> : <span className="text-gray-300">—</span>}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums">{day.cancellations ? <span className="text-orange-600 font-medium">{day.cancellations}</span> : <span className="text-gray-300">—</span>}</td>
                                <td className="px-3 py-2.5 text-right" onClick={e => e.stopPropagation()}>
                                    {editingRevenue === day.date ? (
                                        <form className="inline-flex items-center gap-1" onSubmit={e => { e.preventDefault(); onSaveRevenue(day.date, revenueInput) }}>
                                            <span className="text-gray-400">€</span>
                                            <input type="number" step="0.01" autoFocus className="w-20 border border-blue-300 rounded px-2 py-1 text-right text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                                value={revenueInput} onChange={e => onRevenueChange(e.target.value)} onBlur={() => onSaveRevenue(day.date, revenueInput)} />
                                        </form>
                                    ) : (
                                        <button onClick={() => onEditRevenue(day.date)}
                                            className={`py-1 px-2 rounded text-sm ${day.revenue != null ? 'text-gray-900 font-medium hover:bg-gray-100' : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'}`}
                                            style={{ minHeight: 36 }}>
                                            {day.revenue != null ? fmtCurrency(day.revenue) : '+ invoer'}
                                        </button>
                                    )}
                                </td>
                                <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{avg ? `€${avg}` : <span className="text-gray-300">—</span>}</td>
                            </tr>
                        )
                    })}
                    <tr className="bg-gray-50 font-bold border-t-2 border-gray-200 sticky bottom-0">
                        <td className="px-3 py-3">Totaal</td>
                        <td className="px-3 py-3 text-right tabular-nums">{summary.bookings}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-blue-700">{summary.couverts}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{summary.walkins}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-red-700">{summary.noShows}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-orange-700">{summary.cancellations}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{fmtCurrency(summary.revenue)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{revenueData.avg_per_couvert > 0 ? fmtCurrencyDecimal(revenueData.avg_per_couvert) : '—'}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    )
}
