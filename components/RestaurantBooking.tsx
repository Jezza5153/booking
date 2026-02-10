import React, { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight, Users, Clock, Check, Loader2, AlertTriangle } from 'lucide-react'
import { API_BASE_URL } from '../api'

interface RestaurantBookingProps {
    restaurantId: string
    onClose: () => void
    onComplete?: () => void
}

interface TimeSlot {
    time: string
    end_time: string | null
    available: number
    disabled?: boolean
    reason?: string
}

export const RestaurantBooking: React.FC<RestaurantBookingProps> = ({
    restaurantId,
    onClose,
    onComplete
}) => {
    // Steps: 1=guests, 2=date, 3=time, 4=details, 5=confirm
    const [step, setStep] = useState(1)
    const [guests, setGuests] = useState<number | null>(null)
    const [selectedDate, setSelectedDate] = useState<string | null>(null)
    const [selectedTime, setSelectedTime] = useState<string | null>(null)
    const [slots, setSlots] = useState<TimeSlot[]>([])
    const [closeTime, setCloseTime] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Customer details
    const [name, setName] = useState('')
    const [email, setEmail] = useState('')
    const [phone, setPhone] = useState('')
    const [remarks, setRemarks] = useState('')
    const [newsletterOptIn, setNewsletterOptIn] = useState(true)

    // Booking result
    const [booking, setBooking] = useState<{ booking_id: string; table_name: string } | null>(null)
    const [isBooking, setIsBooking] = useState(false)

    // Opening hours: which days are closed (0=Sun, 1=Mon, ..., 6=Sat)
    const [closedDays, setClosedDays] = useState<Set<number>>(new Set())

    // Calendar state
    const [currentMonth, setCurrentMonth] = useState(() => {
        const now = new Date()
        return new Date(now.getFullYear(), now.getMonth(), 1)
    })

    // Fetch opening hours on mount to know which days are closed
    useEffect(() => {
        const fetchOpenings = async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/api/restaurant/${restaurantId}/openings`)
                const data = await res.json()
                const closed = new Set<number>()
                if (data.openings) {
                    for (const o of data.openings) {
                        if (!o.is_open) closed.add(o.day)
                    }
                }
                setClosedDays(closed)
            } catch (e) {
                // If we can't fetch openings, don't block — all days will appear open
                console.warn('Could not fetch opening hours:', e)
            }
        }
        fetchOpenings()
    }, [restaurantId])

    // Fetch availability when date and guests are selected
    const fetchAvailability = useCallback(async () => {
        if (!selectedDate || !guests) return
        setLoading(true)
        setError(null)
        try {
            const res = await fetch(
                `${API_BASE_URL}/api/restaurant/${restaurantId}/availability?date=${selectedDate}&guests=${guests}`
            )
            const data = await res.json()
            setSlots(data.slots || [])
            setCloseTime(data.close_time || null)
            if (data.slots?.length === 0) {
                setError(data.message || 'Geen beschikbare tijden')
            }
        } catch (e) {
            setError('Kon beschikbaarheid niet laden')
            setSlots([])
            setCloseTime(null)
        } finally {
            setLoading(false)
        }
    }, [selectedDate, guests, restaurantId])

    useEffect(() => {
        if (selectedDate && guests) {
            fetchAvailability()
        }
    }, [selectedDate, guests, fetchAvailability])

    // Submit booking
    const handleSubmit = async () => {
        if (!guests || !selectedDate || !selectedTime || !name || !email) return
        setIsBooking(true)
        setError(null)
        try {
            const res = await fetch(`${API_BASE_URL}/api/restaurant/book`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    restaurant_id: restaurantId,
                    date: selectedDate,
                    time: selectedTime,
                    guest_count: guests,
                    customer_name: name,
                    customer_email: email || null,
                    customer_phone: phone || null,
                    remarks: remarks || null,
                    newsletter_opt_in: newsletterOptIn
                })
            })
            const data = await res.json()
            if (data.success) {
                setBooking(data)
                setStep(5)
                onComplete?.()
            } else {
                setError(data.error || 'Reservering mislukt')
            }
        } catch (e) {
            setError('Er ging iets mis. Probeer opnieuw.')
        } finally {
            setIsBooking(false)
        }
    }

    // Calendar helpers
    const getDaysInMonth = (date: Date) => {
        const year = date.getFullYear()
        const month = date.getMonth()
        const firstDay = new Date(year, month, 1).getDay()
        const daysInMonth = new Date(year, month + 1, 0).getDate()
        return { firstDay: firstDay === 0 ? 6 : firstDay - 1, daysInMonth }
    }

    const { firstDay, daysInMonth } = getDaysInMonth(currentMonth)
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const formatDate = (year: number, month: number, day: number) =>
        `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`

    return (
        <div className="bg-[#0b0b0b] rounded-xl border border-[#3D9970]/30 overflow-hidden">
            {/* Header */}
            <div className="bg-[#3D9970] px-4 py-3 flex items-center justify-between">
                <div className="text-white font-semibold text-sm">Tafel Reserveren</div>
                {step > 1 && step < 5 && (
                    <button onClick={() => setStep(step - 1)} className="text-white/80 hover:text-white text-xs flex items-center gap-1">
                        <ChevronLeft className="w-4 h-4" /> Terug
                    </button>
                )}
            </div>

            <div className="p-4">
                {/* Step 1: Guests */}
                {step === 1 && (
                    <div>
                        <div className="text-white/60 text-xs mb-3 flex items-center gap-2">
                            <Users className="w-4 h-4" /> Aantal personen
                        </div>
                        <div className="grid grid-cols-6 gap-2">
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => (
                                <button
                                    key={n}
                                    onClick={() => { setGuests(n); setStep(2) }}
                                    className={`py-2 rounded-lg text-sm font-medium transition-colors relative ${guests === n
                                        ? 'bg-[#3D9970] text-white'
                                        : 'bg-white/5 text-white/80 hover:bg-white/10'
                                        } ${n >= 7 ? 'ring-1 ring-[#c9a227]/30' : ''}`}
                                >
                                    {n}
                                    {n >= 7 && <span className="absolute -top-1 -right-1 w-2 h-2 bg-[#c9a227] rounded-full"></span>}
                                </button>
                            ))}
                        </div>
                        <div className="text-[10px] text-white/40 mt-2 flex items-center gap-1">
                            <span className="inline-block w-2 h-2 bg-[#c9a227] rounded-full"></span>
                            7-12 personen: Chef's Choice arrangement
                        </div>
                    </div>
                )}

                {/* Step 2: Date */}
                {step === 2 && (
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))} className="p-1 text-white/60 hover:text-white">
                                <ChevronLeft className="w-5 h-5" />
                            </button>
                            <div className="text-white text-sm font-medium">
                                {currentMonth.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' })}
                            </div>
                            <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))} className="p-1 text-white/60 hover:text-white">
                                <ChevronRight className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="grid grid-cols-7 gap-1 text-center mb-2">
                            {['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].map(d => (
                                <div key={d} className="text-[10px] text-white/40 uppercase">{d}</div>
                            ))}
                        </div>
                        <div className="grid grid-cols-7 gap-1">
                            {Array(firstDay).fill(null).map((_, i) => <div key={`e-${i}`} />)}
                            {Array(daysInMonth).fill(null).map((_, i) => {
                                const day = i + 1
                                const dateStr = formatDate(currentMonth.getFullYear(), currentMonth.getMonth(), day)
                                const dateObj = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day)
                                const isPast = dateObj < today
                                const dayOfWeek = dateObj.getDay() // 0=Sun, 1=Mon, ..., 6=Sat
                                const isClosed = closedDays.has(dayOfWeek)
                                const isDisabled = isPast || isClosed
                                const isSelected = selectedDate === dateStr
                                return (
                                    <button
                                        key={day}
                                        disabled={isDisabled}
                                        title={isClosed ? 'Gesloten' : undefined}
                                        onClick={() => { if (!isDisabled) { setSelectedDate(dateStr); setStep(3) } }}
                                        className={`py-2 rounded-lg text-sm transition-colors ${isDisabled
                                            ? isClosed && !isPast
                                                ? 'text-white/20 cursor-not-allowed bg-red-900/10 line-through'
                                                : 'text-white/20 cursor-not-allowed'
                                            : isSelected ? 'bg-[#3D9970] text-white'
                                                : 'text-white/80 hover:bg-white/10'
                                            }`}
                                    >
                                        {day}
                                    </button>
                                )
                            })}
                        </div>
                        {closedDays.size > 0 && (
                            <div className="text-[10px] text-white/30 mt-2 flex items-center gap-1">
                                <span className="inline-block w-2 h-2 bg-red-900/30 rounded-sm" /> = gesloten
                            </div>
                        )}
                    </div>
                )}

                {/* Step 3: Time */}
                {step === 3 && (
                    <div>
                        <div className="text-white/60 text-xs mb-3 flex items-center gap-2">
                            <Clock className="w-4 h-4" /> Kies een tijd
                        </div>
                        {loading ? (
                            <div className="flex items-center gap-2 text-white/60 py-4">
                                <Loader2 className="w-4 h-4 animate-spin" /> Laden...
                            </div>
                        ) : error ? (
                            <div className="text-red-400 text-sm py-4">{error}</div>
                        ) : (
                            <>
                                <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                                    {slots.map(slot => (
                                        <button
                                            key={slot.time}
                                            onClick={() => { if (!slot.disabled) { setSelectedTime(slot.time); setStep(4) } }}
                                            disabled={slot.disabled}
                                            title={slot.disabled ? slot.reason : undefined}
                                            className={`py-2 rounded-lg text-sm font-medium transition-colors ${slot.disabled
                                                ? 'bg-white/5 text-white/20 cursor-not-allowed line-through'
                                                : selectedTime === slot.time
                                                    ? 'bg-[#3D9970] text-white'
                                                    : 'bg-white/5 text-white/80 hover:bg-white/10'
                                                }`}
                                        >
                                            {slot.time}
                                        </button>
                                    ))}
                                </div>
                                {closeTime && (
                                    <div className="text-[10px] text-white/30 mt-2 flex items-center gap-1">
                                        🕐 Keuken sluit om {closeTime}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}

                {/* Step 4: Details */}
                {step === 4 && (
                    <div className="space-y-3">
                        <div className="text-white/60 text-xs mb-2">Jouw gegevens</div>
                        <input
                            type="text"
                            placeholder="Naam *"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/40"
                        />
                        <input
                            type="email"
                            placeholder="E-mail *"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/40"
                            required
                        />
                        <input
                            type="tel"
                            placeholder="Telefoon"
                            value={phone}
                            onChange={e => setPhone(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/40"
                        />
                        <textarea
                            placeholder="Opmerkingen..."
                            value={remarks}
                            onChange={e => setRemarks(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/40 resize-none h-16"
                        />
                        <label className="flex items-center gap-2 cursor-pointer py-1">
                            <input
                                type="checkbox"
                                checked={newsletterOptIn}
                                onChange={e => setNewsletterOptIn(e.target.checked)}
                                className="w-4 h-4 rounded border-white/20 bg-white/10 text-[#3D9970] focus:ring-[#3D9970] focus:ring-offset-0"
                            />
                            <span className="text-white/60 text-xs">Ja, ik ontvang graag de nieuwsbrief van De Tafelaar</span>
                        </label>
                        {error && <div className="text-red-400 text-sm">{error}</div>}
                        <button
                            onClick={handleSubmit}
                            disabled={!name || !email || isBooking}
                            className="w-full py-2.5 rounded-lg bg-[#3D9970] text-white font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {isBooking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            Bevestig Reservering
                        </button>
                    </div>
                )}

                {/* Step 5: Confirmation */}
                {step === 5 && booking && (
                    <div className="text-center py-4">
                        <div className="w-12 h-12 bg-[#3D9970] rounded-full flex items-center justify-center mx-auto mb-3">
                            <Check className="w-6 h-6 text-white" />
                        </div>
                        <div className="text-white font-semibold mb-1">Reservering bevestigd!</div>
                        <div className="text-white/60 text-sm mb-4">
                            {guests} personen • {selectedDate} om {selectedTime}
                        </div>
                        <div className="text-white/40 text-xs mb-4">{booking.table_name}</div>
                        <button
                            onClick={onClose}
                            className="text-[#3D9970] text-sm font-medium hover:underline"
                        >
                            Sluiten
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}
