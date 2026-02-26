import React from 'react'
import type { HeatmapCell } from './types'

interface Props {
    heatmap: HeatmapCell[]
    onCellClick: (dow: number, hour: number, count: number) => void
}

const dayLabels = ['Zo', 'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za']
const hours = Array.from({ length: 12 }, (_, i) => i + 11)

export const HeatmapCard: React.FC<Props> = ({ heatmap, onCellClick }) => {
    const max = Math.max(...heatmap.map(h => h.count), 1)
    const color = (c: number) => {
        if (!c) return 'bg-gray-100'
        const r = c / max
        if (r > 0.75) return 'bg-blue-600 text-white'
        if (r > 0.5) return 'bg-blue-400 text-white'
        if (r > 0.25) return 'bg-blue-200 text-blue-800'
        return 'bg-blue-100 text-blue-600'
    }

    return (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Drukte per dag & uur</h2>
            <div className="overflow-x-auto">
                <table className="text-sm border-separate" style={{ borderSpacing: '3px' }}>
                    <thead>
                        <tr>
                            <th className="w-10" />
                            {hours.map(h => <th key={h} className="text-xs text-gray-400 font-normal text-center w-10 pb-1">{h}:00</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {dayLabels.map((day, dow) => (
                            <tr key={dow}>
                                <td className="text-sm text-gray-600 font-medium pr-2">{day}</td>
                                {hours.map(hour => {
                                    const c = heatmap.find(h => h.dow === dow && h.hour === hour)?.count || 0
                                    return (
                                        <td key={hour}>
                                            <button className={`w-10 h-9 rounded flex items-center justify-center text-xs font-medium ${color(c)} transition-all hover:ring-2 hover:ring-blue-400 cursor-pointer`}
                                                onClick={() => onCellClick(dow, hour, c)}
                                                title={`${day} ${hour}:00 — ${c} boekingen`}>
                                                {c > 0 ? c : ''}
                                            </button>
                                        </td>
                                    )
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="flex items-center gap-2 mt-3 text-xs text-gray-400">
                <span>Weinig</span>
                <div className="flex gap-1">{['bg-gray-100', 'bg-blue-100', 'bg-blue-200', 'bg-blue-400', 'bg-blue-600'].map((c, i) => <span key={i} className={`w-5 h-4 ${c} rounded`} />)}</div>
                <span>Veel</span>
            </div>
        </div>
    )
}
