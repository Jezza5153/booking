import React, { useState } from 'react'
import { Euro, Check, ChevronLeft, ChevronRight } from 'lucide-react'
import type { DayStats } from './types'
import { fmtCurrency, fmtDate } from './formatters'

interface Props {
    stats: DayStats[]
    onSave: (date: string, amount: string) => void
}

export const RevenueQuickEntry: React.FC<Props> = ({ stats, onSave }) => {
    // Find most recent days without revenue (candidates for entry)
    const today = new Date().toISOString().split('T')[0]
    const candidates = [...stats].reverse().filter(d => d.date <= today)
    const firstMissing = candidates.find(d => d.revenue == null)
    const defaultDate = firstMissing?.date || today

    const [selectedDate, setSelectedDate] = useState(defaultDate)
    const [amount, setAmount] = useState('')
    const [saved, setSaved] = useState(false)

    const currentDay = stats.find(d => d.date === selectedDate)
    const hasRevenue = currentDay?.revenue != null

    const handleSave = () => {
        if (!amount || isNaN(parseFloat(amount))) return
        onSave(selectedDate, amount)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
        setAmount('')
    }

    // Navigate through dates
    const dateIdx = stats.findIndex(d => d.date === selectedDate)
    const canPrev = dateIdx > 0
    const canNext = dateIdx < stats.length - 1 && stats[dateIdx + 1]?.date <= today

    const goDate = (dir: number) => {
        const newIdx = dateIdx + dir
        if (newIdx >= 0 && newIdx < stats.length && stats[newIdx].date <= today) {
            setSelectedDate(stats[newIdx].date)
            const day = stats[newIdx]
            setAmount(day.revenue != null ? day.revenue.toString() : '')
            setSaved(false)
        }
    }

    // Count days missing revenue
    const missingCount = stats.filter(d => d.date <= today && d.revenue == null).length

    return (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <div className="w-9 h-9 bg-emerald-100 rounded-lg flex items-center justify-center">
                        <Euro className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                        <h2 className="text-base font-semibold text-gray-900">Omzet invoeren</h2>
                        {missingCount > 0 && (
                            <div className="text-xs text-orange-500 font-medium">{missingCount} dag{missingCount > 1 ? 'en' : ''} nog in te vullen</div>
                        )}
                    </div>
                </div>
            </div>

            {/* Date selector */}
            <div className="flex items-center gap-2 mb-3">
                <button onClick={() => goDate(-1)} disabled={!canPrev}
                    className="p-2 hover:bg-gray-100 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed" style={{ minHeight: 44, minWidth: 44 }}>
                    <ChevronLeft className="w-4 h-4 text-gray-500" />
                </button>
                <div className="flex-1 text-center">
                    <div className="text-sm font-semibold text-gray-900">{fmtDate(selectedDate)}</div>
                    <div className="text-xs text-gray-400">{currentDay?.couverts || 0} couverts · {currentDay?.bookings || 0} boekingen</div>
                </div>
                <button onClick={() => goDate(1)} disabled={!canNext}
                    className="p-2 hover:bg-gray-100 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed" style={{ minHeight: 44, minWidth: 44 }}>
                    <ChevronRight className="w-4 h-4 text-gray-500" />
                </button>
            </div>

            {/* Revenue input */}
            <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); handleSave() }}>
                <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">€</span>
                    <input type="number" step="0.01" inputMode="decimal"
                        className="w-full pl-8 pr-3 py-3 text-lg font-semibold border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none tabular-nums text-right"
                        placeholder={hasRevenue ? `${currentDay!.revenue}` : '0.00'}
                        value={amount}
                        onChange={e => { setAmount(e.target.value); setSaved(false) }}
                        style={{ minHeight: 52 }}
                    />
                </div>
                <button type="submit"
                    className={`px-5 py-3 rounded-xl font-semibold text-sm transition-all flex items-center gap-1.5 ${saved
                        ? 'bg-emerald-600 text-white'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                        }`}
                    style={{ minHeight: 52 }}>
                    {saved ? <><Check className="w-4 h-4" /> Opgeslagen</> : 'Opslaan'}
                </button>
            </form>

            {/* Existing value indicator */}
            {hasRevenue && !saved && (
                <div className="mt-2 text-xs text-gray-400">
                    Huidige waarde: {fmtCurrency(currentDay!.revenue!)} — voer een nieuw bedrag in om te overschrijven
                </div>
            )}
        </div>
    )
}
