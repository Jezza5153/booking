import React from 'react'
import { Globe, Phone, MapPin, Mail, MoreHorizontal } from 'lucide-react'

interface SourceEntry { source: string; bookings: number; couverts: number }
interface Props { sources: SourceEntry[] }

const SOURCE_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
    website: { label: 'Website', icon: <Globe className="w-4 h-4" />, color: 'bg-blue-500' },
    phone: { label: 'Telefoon', icon: <Phone className="w-4 h-4" />, color: 'bg-emerald-500' },
    walkin: { label: 'Walk-in', icon: <MapPin className="w-4 h-4" />, color: 'bg-amber-500' },
    email: { label: 'E-mail', icon: <Mail className="w-4 h-4" />, color: 'bg-purple-500' },
    other: { label: 'Overig', icon: <MoreHorizontal className="w-4 h-4" />, color: 'bg-gray-400' },
}

export const SourceBreakdown: React.FC<Props> = ({ sources }) => {
    if (sources.length === 0) return null

    const totalBookings = sources.reduce((s, e) => s + e.bookings, 0)
    const totalCouverts = sources.reduce((s, e) => s + e.couverts, 0)

    return (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Bron van boekingen</h2>
            <p className="text-xs text-gray-400 mb-4">Waar komen je boekingen vandaan?</p>

            {/* Stacked bar */}
            <div className="flex h-6 rounded-full overflow-hidden mb-4">
                {sources.map(s => {
                    const pct = totalBookings > 0 ? (s.bookings / totalBookings * 100) : 0
                    if (pct === 0) return null
                    const meta = SOURCE_META[s.source] || SOURCE_META.other
                    return (
                        <div key={s.source} className={`${meta.color} transition-all`}
                            style={{ width: `${pct}%`, minWidth: pct > 0 ? '4px' : '0' }}
                            title={`${meta.label}: ${s.bookings} boekingen (${Math.round(pct)}%)`} />
                    )
                })}
            </div>

            {/* Breakdown list */}
            <div className="space-y-2.5">
                {sources.map(s => {
                    const meta = SOURCE_META[s.source] || SOURCE_META.other
                    const pct = totalBookings > 0 ? Math.round(s.bookings / totalBookings * 100) : 0
                    return (
                        <div key={s.source} className="flex items-center gap-3 text-sm">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white ${meta.color}`}>
                                {meta.icon}
                            </div>
                            <div className="flex-1">
                                <div className="font-medium text-gray-900">{meta.label}</div>
                                <div className="text-xs text-gray-400">{s.couverts} couverts</div>
                            </div>
                            <div className="text-right">
                                <div className="font-semibold text-gray-900 tabular-nums">{s.bookings}</div>
                                <div className="text-xs text-gray-400 tabular-nums">{pct}%</div>
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Total */}
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 text-sm">
                <span className="font-medium text-gray-500">Totaal</span>
                <span className="font-bold text-gray-900 tabular-nums">{totalBookings} boekingen · {totalCouverts} couverts</span>
            </div>
        </div>
    )
}
