import React, { useState, useRef, useEffect } from 'react'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'

interface Props {
    from: string
    to: string
    onChange: (range: { from: string; to: string }) => void
}

const MONTHS_NL = ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec']
const DAYS_NL = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo']
const fmt = (d: Date) => d.toISOString().split('T')[0]

export const DateRangePicker: React.FC<Props> = ({ from, to, onChange }) => {
    const [open, setOpen] = useState(false)
    const [viewMonth, setViewMonth] = useState(() => new Date(from))
    const [selecting, setSelecting] = useState<'from' | 'to'>('from')
    const [tempFrom, setTempFrom] = useState(from)
    const [tempTo, setTempTo] = useState(to)
    const ref = useRef<HTMLDivElement>(null)

    // Close on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
        const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
        document.addEventListener('mousedown', handler)
        document.addEventListener('keydown', keyHandler)
        return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', keyHandler) }
    }, [])

    const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate()
    const firstDayOfMonth = (year: number, month: number) => {
        const d = new Date(year, month, 1).getDay()
        return d === 0 ? 6 : d - 1 // Monday = 0
    }

    const y = viewMonth.getFullYear()
    const m = viewMonth.getMonth()
    const totalDays = daysInMonth(y, m)
    const startOffset = firstDayOfMonth(y, m)

    const handleDayClick = (day: number) => {
        const date = fmt(new Date(y, m, day))
        if (selecting === 'from') {
            setTempFrom(date)
            setTempTo(date > tempTo ? date : tempTo)
            setSelecting('to')
        } else {
            if (date < tempFrom) {
                setTempFrom(date)
                setSelecting('to')
            } else {
                setTempTo(date)
                onChange({ from: tempFrom, to: date })
                setOpen(false)
                setSelecting('from')
            }
        }
    }

    const isInRange = (day: number) => {
        const date = fmt(new Date(y, m, day))
        return date >= tempFrom && date <= tempTo
    }
    const isStart = (day: number) => fmt(new Date(y, m, day)) === tempFrom
    const isEnd = (day: number) => fmt(new Date(y, m, day)) === tempTo
    const isToday = (day: number) => fmt(new Date(y, m, day)) === fmt(new Date())

    const navMonth = (dir: number) => {
        const next = new Date(y, m + dir, 1)
        setViewMonth(next)
    }

    const fmtDisplay = (d: string) => {
        const dt = new Date(d)
        return `${dt.getDate()} ${MONTHS_NL[dt.getMonth()]} ${dt.getFullYear()}`
    }

    return (
        <div ref={ref} className="relative">
            <button onClick={() => { setOpen(!open); setTempFrom(from); setTempTo(to); setViewMonth(new Date(from)) }}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors"
                style={{ minHeight: 40 }}>
                <Calendar className="w-4 h-4" />
                <span className="hidden sm:inline">Aangepast</span>
            </button>

            {open && (
                <div className="absolute top-full mt-1 right-0 z-50 bg-white rounded-xl border border-gray-200 shadow-xl p-4 w-80">
                    {/* Selection indicator */}
                    <div className="flex items-center gap-2 mb-3 text-xs">
                        <button onClick={() => setSelecting('from')}
                            className={`flex-1 px-2 py-1.5 rounded-lg text-center ${selecting === 'from' ? 'bg-blue-100 text-blue-700 font-semibold' : 'bg-gray-50 text-gray-500'}`}>
                            Van: {fmtDisplay(tempFrom)}
                        </button>
                        <span className="text-gray-300">→</span>
                        <button onClick={() => setSelecting('to')}
                            className={`flex-1 px-2 py-1.5 rounded-lg text-center ${selecting === 'to' ? 'bg-blue-100 text-blue-700 font-semibold' : 'bg-gray-50 text-gray-500'}`}>
                            Tot: {fmtDisplay(tempTo)}
                        </button>
                    </div>

                    {/* Month navigation */}
                    <div className="flex items-center justify-between mb-3">
                        <button onClick={() => navMonth(-1)} className="p-1.5 hover:bg-gray-100 rounded-lg" style={{ minHeight: 36, minWidth: 36 }}>
                            <ChevronLeft className="w-4 h-4 text-gray-500" />
                        </button>
                        <span className="text-sm font-semibold text-gray-900">
                            {MONTHS_NL[m]} {y}
                        </span>
                        <button onClick={() => navMonth(1)} className="p-1.5 hover:bg-gray-100 rounded-lg" style={{ minHeight: 36, minWidth: 36 }}>
                            <ChevronRight className="w-4 h-4 text-gray-500" />
                        </button>
                    </div>

                    {/* Day headers */}
                    <div className="grid grid-cols-7 gap-0 mb-1">
                        {DAYS_NL.map(d => (
                            <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>
                        ))}
                    </div>

                    {/* Day grid */}
                    <div className="grid grid-cols-7 gap-0">
                        {Array.from({ length: startOffset }, (_, i) => (
                            <div key={`empty-${i}`} />
                        ))}
                        {Array.from({ length: totalDays }, (_, i) => {
                            const day = i + 1
                            const inRange = isInRange(day)
                            const start = isStart(day)
                            const end = isEnd(day)
                            const today = isToday(day)
                            return (
                                <button key={day} onClick={() => handleDayClick(day)}
                                    className={`h-9 text-sm font-medium rounded-lg transition-all relative
                    ${start || end ? 'bg-blue-600 text-white z-10' : inRange ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'}
                    ${today && !start && !end ? 'ring-1 ring-blue-400' : ''}
                  `}
                                    style={{ minHeight: 36 }}>
                                    {day}
                                </button>
                            )
                        })}
                    </div>

                    {/* Quick apply */}
                    <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-gray-100">
                        <button onClick={() => setOpen(false)} className="px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg">
                            Annuleren
                        </button>
                        <button onClick={() => { onChange({ from: tempFrom, to: tempTo }); setOpen(false) }}
                            className="px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                            Toepassen
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
