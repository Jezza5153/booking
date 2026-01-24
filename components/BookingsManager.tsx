import React, { useEffect, useMemo, useState } from "react"
import { fetchBookings, cancelBooking, bookTable, fetchAdminData, RESTAURANT_ID, API_BASE_URL } from "../api"
import { Search, RefreshCw, Download, X, AlertTriangle, Plus, Calendar, Users, MessageSquare, Mail, ChevronLeft, ChevronRight } from "lucide-react"

const TZ = "Europe/Amsterdam"

// Types
type BookingStatus = "confirmed" | "cancelled"

export type BookingRow = {
    id: string
    status: BookingStatus
    created_at: string
    customer_name: string
    customer_email?: string | null
    customer_phone?: string | null
    remarks?: string | null
    guest_count: number
    table_type: "2" | "4" | "6" | "7+"
    start_datetime: string
    event_title: string
    zone_name: string
}

type RestaurantBooking = {
    id: string
    table_id: string
    start_time: string
    end_time: string
    guest_count: number
    customer_name: string
    customer_email?: string
    customer_phone?: string
    remarks?: string
    status: string
}

type Table = {
    id: string
    name: string
    seats: number
    zone: string
}

function fmtTime(dIso: string) {
    const d = new Date(dIso)
    return new Intl.DateTimeFormat("nl-NL", {
        timeZone: TZ,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(d)
}

export const BookingsManager: React.FC<{ restaurantId?: string }> = ({ restaurantId = RESTAURANT_ID }) => {
    const [loading, setLoading] = useState(true)
    const [rows, setRows] = useState<BookingRow[]>([])
    const [allEvents, setAllEvents] = useState<{ id: string; title: string }[]>([])
    const [selected, setSelected] = useState<BookingRow | null>(null)
    const [isCancelling, setIsCancelling] = useState(false)

    // Restaurant timeline state
    const [timelineDate, setTimelineDate] = useState(() => new Date().toISOString().split('T')[0])
    const [tables, setTables] = useState<Table[]>([])
    const [restaurantBookings, setRestaurantBookings] = useState<RestaurantBooking[]>([])
    const [loadingTimeline, setLoadingTimeline] = useState(true)
    const [openingHours, setOpeningHours] = useState<{ day: number; is_open: boolean }[]>([])

    // Modal states
    const [showEventBookingModal, setShowEventBookingModal] = useState(false)
    const [showRestaurantBookingModal, setShowRestaurantBookingModal] = useState(false)
    const [bookingForm, setBookingForm] = useState({
        customer_name: '',
        customer_email: '',
        customer_phone: '',
        guest_count: 2,
        date: new Date().toISOString().split('T')[0],
        time: '18:00',
        remarks: '',
        event_id: ''
    })
    const [isSubmitting, setIsSubmitting] = useState(false)

    // Fetch event bookings and all events
    const fetchData = async () => {
        setLoading(true)
        try {
            // Fetch bookings
            const res = await fetchBookings({
                restaurantId,
                status: "confirmed",
                limit: 200,
                offset: 0,
            })
            setRows(res.bookings || [])

            // Fetch all events (to show even without bookings)
            const adminData = await fetchAdminData(restaurantId)
            if (adminData?.events) {
                setAllEvents(adminData.events.map((e: any) => ({ id: e.id, title: e.title })))
            }
        } catch (e) {
            console.error('Failed to load bookings:', e)
        } finally {
            setLoading(false)
        }
    }

    // Fetch restaurant timeline data
    const fetchTimelineData = async () => {
        setLoadingTimeline(true)
        try {
            const tablesRes = await fetch(`${API_BASE_URL}/api/restaurant/${restaurantId}/tables`)
            const tablesData = await tablesRes.json()
            setTables(tablesData.tables || [])

            const bookingsRes = await fetch(
                `${API_BASE_URL}/api/admin/restaurant-bookings?restaurantId=${restaurantId}&date=${timelineDate}`,
                { headers: { 'Authorization': `Bearer ${localStorage.getItem('events_token')}` } }
            )
            if (bookingsRes.ok) {
                const bookingsData = await bookingsRes.json()
                setRestaurantBookings(bookingsData.bookings || [])
            }

            // Fetch opening hours
            const hoursRes = await fetch(`${API_BASE_URL}/api/restaurant/${restaurantId}/opening-hours`)
            if (hoursRes.ok) {
                const hoursData = await hoursRes.json()
                setOpeningHours(hoursData.openingHours || [])
            }
        } catch (e) {
            console.error('Failed to load timeline:', e)
        } finally {
            setLoadingTimeline(false)
        }
    }

    useEffect(() => {
        fetchData()
    }, [restaurantId])

    useEffect(() => {
        fetchTimelineData()
    }, [restaurantId, timelineDate])

    // Group event bookings by event title
    const groupedByEvent = useMemo(() => {
        const groups: Record<string, BookingRow[]> = {}
        rows.forEach(booking => {
            const key = booking.event_title
            if (!groups[key]) groups[key] = []
            groups[key].push(booking)
        })
        // Sort bookings within each group by date
        Object.values(groups).forEach(group => {
            group.sort((a, b) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime())
        })
        return groups
    }, [rows])

    const eventTitles = useMemo(() => {
        // Combine all events with those that have bookings
        const titlesFromAllEvents = (allEvents || []).map(e => e.title)
        const titlesFromBookings = Object.keys(groupedByEvent)
        const uniqueTitles = Array.from(new Set([...titlesFromAllEvents, ...titlesFromBookings]))
        return uniqueTitles.sort()
    }, [allEvents, groupedByEvent])

    const handleCancel = async (bookingId: string) => {
        setIsCancelling(true)
        try {
            await cancelBooking(bookingId)
            setSelected(null)
            await fetchData()
        } catch (e: any) {
            console.error('Cancel failed:', e)
        } finally {
            setIsCancelling(false)
        }
    }

    // Submit event booking
    const submitEventBooking = async () => {
        if (!bookingForm.event_id || !bookingForm.customer_name) return
        setIsSubmitting(true)
        try {
            const token = localStorage.getItem('events_token')
            const res = await fetch(`${API_BASE_URL}/api/admin/bookings`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    restaurantId,
                    eventId: bookingForm.event_id,
                    customer_name: bookingForm.customer_name,
                    customer_email: bookingForm.customer_email,
                    customer_phone: bookingForm.customer_phone,
                    guest_count: bookingForm.guest_count,
                    remarks: bookingForm.remarks
                })
            })
            if (res.ok) {
                setShowEventBookingModal(false)
                setBookingForm({
                    customer_name: '', customer_email: '', customer_phone: '',
                    guest_count: 2, date: new Date().toISOString().split('T')[0],
                    time: '18:00', remarks: '', event_id: ''
                })
                await fetchData()
            } else {
                const err = await res.json()
                alert(err.error || 'Boeking mislukt')
            }
        } catch (e) {
            console.error('Event booking failed:', e)
            alert('Boeking mislukt')
        } finally {
            setIsSubmitting(false)
        }
    }

    // Submit restaurant booking
    const submitRestaurantBooking = async () => {
        if (!bookingForm.customer_name) return
        setIsSubmitting(true)
        try {
            const token = localStorage.getItem('events_token')
            const res = await fetch(`${API_BASE_URL}/api/admin/restaurant-bookings`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    restaurantId,
                    date: bookingForm.date,
                    time: bookingForm.time,
                    customer_name: bookingForm.customer_name,
                    customer_email: bookingForm.customer_email,
                    customer_phone: bookingForm.customer_phone,
                    guest_count: bookingForm.guest_count,
                    remarks: bookingForm.remarks
                })
            })
            if (res.ok) {
                setShowRestaurantBookingModal(false)
                setBookingForm({
                    customer_name: '', customer_email: '', customer_phone: '',
                    guest_count: 2, date: new Date().toISOString().split('T')[0],
                    time: '18:00', remarks: '', event_id: ''
                })
                await fetchTimelineData()
            } else {
                const err = await res.json()
                alert(err.error || 'Boeking mislukt')
            }
        } catch (e) {
            console.error('Restaurant booking failed:', e)
            alert('Boeking mislukt')
        } finally {
            setIsSubmitting(false)
        }
    }

    // Mark booking as arrived
    const markAsArrived = async (bookingId: string) => {
        try {
            const token = localStorage.getItem('events_token')
            const res = await fetch(`${API_BASE_URL}/api/admin/restaurant-bookings/${bookingId}/status`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ status: 'arrived' })
            })
            if (res.ok) {
                // Update local state
                setRestaurantBookings(prev => prev.map(b =>
                    b.id === bookingId ? { ...b, status: 'arrived' } : b
                ))
            }
        } catch (e) {
            console.error('Failed to mark as arrived:', e)
        }
    }

    const navigateDate = (delta: number) => {
        const d = new Date(timelineDate)
        d.setDate(d.getDate() + delta)
        setTimelineDate(d.toISOString().split('T')[0])
    }

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr)
        return d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })
    }

    // Time slots for timeline (17:00 to 23:00)
    const timeSlots = useMemo(() => {
        const slots: string[] = []
        for (let h = 17; h <= 22; h++) {
            slots.push(`${h.toString().padStart(2, '0')}:00`)
            slots.push(`${h.toString().padStart(2, '0')}:30`)
        }
        slots.push('23:00')
        return slots
    }, [])

    // Check if the timeline date is open
    const isOpenToday = useMemo(() => {
        const d = new Date(timelineDate)
        const dayOfWeek = d.getDay() // 0=Sunday
        const dayInfo = openingHours.find(h => h.day === dayOfWeek)
        return dayInfo?.is_open !== false // Default to open if not found
    }, [timelineDate, openingHours])

    return (
        <div className="w-full max-w-7xl mx-auto p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-2xl font-extrabold text-gray-900">Boekingen Overzicht</h2>
                    <p className="text-sm text-gray-500 mt-1">Events links, Restaurant rechts</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => { fetchData(); fetchTimelineData(); }}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 font-semibold text-gray-800"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Vernieuwen
                    </button>
                </div>
            </div>

            {/* Couverts Stats Bar */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl border border-amber-200 p-4">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">📊</span>
                        <span className="text-xs font-medium text-amber-700 uppercase">Verwacht</span>
                    </div>
                    <div className="text-2xl font-bold text-amber-900">
                        {restaurantBookings.filter(b => b.status !== 'arrived' && b.status !== 'cancelled').reduce((sum, b) => sum + (b.guest_count || 0), 0)}
                    </div>
                    <div className="text-xs text-amber-600">couverts nog niet binnen</div>
                </div>
                <div className="bg-gradient-to-br from-emerald-50 to-green-50 rounded-xl border border-emerald-200 p-4">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">✅</span>
                        <span className="text-xs font-medium text-emerald-700 uppercase">Binnen</span>
                    </div>
                    <div className="text-2xl font-bold text-emerald-900">
                        {restaurantBookings.filter(b => b.status === 'arrived').reduce((sum, b) => sum + (b.guest_count || 0), 0)}
                    </div>
                    <div className="text-xs text-emerald-600">couverts gearriveerd</div>
                </div>
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-200 p-4">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">🚶</span>
                        <span className="text-xs font-medium text-blue-700 uppercase">Walk-in</span>
                    </div>
                    <div className="text-2xl font-bold text-blue-900">
                        {restaurantBookings.filter(b => b.status === 'walkin' || (b as any).is_walkin).reduce((sum, b) => sum + (b.guest_count || 0), 0)}
                    </div>
                    <div className="text-xs text-blue-600">couverts ingelopen</div>
                </div>
                <div className="bg-gradient-to-br from-purple-50 to-violet-50 rounded-xl border border-purple-200 p-4">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">📈</span>
                        <span className="text-xs font-medium text-purple-700 uppercase">Totaal Binnen</span>
                    </div>
                    <div className="text-2xl font-bold text-purple-900">
                        {restaurantBookings.filter(b => b.status === 'arrived' || b.status === 'walkin' || (b as any).is_walkin).reduce((sum, b) => sum + (b.guest_count || 0), 0)}
                    </div>
                    <div className="text-xs text-purple-600">binnen + walk-in</div>
                </div>
            </div>

            {/* Two Column Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* LEFT COLUMN: Event Bookings */}
                <div className="space-y-4">
                    <div className="bg-indigo-50 rounded-xl border border-indigo-200 p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="font-bold text-indigo-900 flex items-center gap-2">
                                    <Calendar className="w-5 h-5" />
                                    🎪 Event Boekingen
                                </h3>
                                <p className="text-xs text-indigo-600 mt-1">Gegroepeerd per event</p>
                            </div>
                            <button
                                onClick={() => setShowEventBookingModal(true)}
                                className="flex items-center gap-1.5 bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
                            >
                                <Plus className="w-4 h-4" />
                                Boeking
                            </button>
                        </div>
                    </div>

                    {loading ? (
                        <div className="text-center py-8 text-gray-500">Laden...</div>
                    ) : eventTitles.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">Geen events gevonden</div>
                    ) : (
                        eventTitles.map(eventTitle => {
                            const bookings = groupedByEvent[eventTitle] || [];
                            return (
                                <div key={eventTitle} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                                    <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                                        <h4 className="font-bold text-gray-900">{eventTitle}</h4>
                                        <p className="text-xs text-gray-500">{bookings.length} reserveringen</p>
                                    </div>
                                    {bookings.length === 0 ? (
                                        <div className="px-4 py-6 text-center text-gray-400 text-sm">
                                            Nog geen reserveringen voor dit event
                                        </div>
                                    ) : (
                                        <div className="divide-y divide-gray-100">
                                            {bookings.map(booking => (
                                                <div
                                                    key={booking.id}
                                                    className="px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                                                    onClick={() => setSelected(booking)}
                                                >
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-3">
                                                                <span className="font-semibold text-gray-900">{booking.customer_name}</span>
                                                                <span className="text-sm text-gray-600 flex items-center gap-1">
                                                                    <Users className="w-3.5 h-3.5" />
                                                                    {booking.guest_count}
                                                                </span>
                                                            </div>
                                                            {booking.remarks && (
                                                                <div className="mt-1 text-sm text-amber-700 bg-amber-50 rounded px-2 py-1 flex items-start gap-1.5">
                                                                    <MessageSquare className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                                                                    <span className="truncate">{booking.remarks}</span>
                                                                </div>
                                                            )}
                                                            {booking.customer_email && (
                                                                <div className="mt-1 text-xs text-gray-500 flex items-center gap-1">
                                                                    <Mail className="w-3 h-3" />
                                                                    {booking.customer_email}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="text-right text-xs text-gray-500">
                                                            {fmtTime(booking.start_datetime)}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>

                {/* RIGHT COLUMN: Restaurant Timeline */}
                <div className="space-y-4">
                    <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="font-bold text-emerald-900 flex items-center gap-2">
                                    🍽️ Restaurant Tafels
                                </h3>
                                <p className="text-xs text-emerald-600 mt-1">Dagelijks overzicht</p>
                            </div>
                            <button
                                onClick={() => setShowRestaurantBookingModal(true)}
                                className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 transition-colors text-sm font-medium"
                            >
                                <Plus className="w-4 h-4" />
                                Boeking
                            </button>
                        </div>
                    </div>

                    {/* Date Navigation */}
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                        <div className="flex items-center justify-between">
                            <button
                                onClick={() => navigateDate(-1)}
                                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                <ChevronLeft className="w-5 h-5 text-gray-600" />
                            </button>
                            <span className="font-semibold text-gray-900">{formatDate(timelineDate)}</span>
                            <button
                                onClick={() => navigateDate(1)}
                                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                <ChevronRight className="w-5 h-5 text-gray-600" />
                            </button>
                        </div>
                    </div>

                    {/* Timeline Grid */}
                    <div className="bg-gradient-to-br from-white to-emerald-50/30 rounded-xl border border-emerald-200/50 overflow-hidden shadow-lg">
                        {loadingTimeline ? (
                            <div className="text-center py-8 text-gray-500">Laden...</div>
                        ) : !isOpenToday ? (
                            <div className="text-center py-12 bg-gradient-to-br from-gray-100 to-gray-50">
                                <div className="text-6xl mb-4">🚫</div>
                                <h3 className="text-xl font-bold text-gray-700 mb-2">Gesloten</h3>
                                <p className="text-gray-500">Het restaurant is op deze dag gesloten</p>
                            </div>
                        ) : tables.length === 0 ? (
                            <div className="text-center py-8 text-gray-500">Geen tafels geconfigureerd</div>
                        ) : (
                            <div className="overflow-x-auto">
                                {/* Time Header */}
                                <div className="flex border-b border-gray-200 sticky top-0 bg-white z-10">
                                    <div className="w-24 shrink-0 px-3 py-2 bg-gray-50 text-xs font-medium text-gray-500 uppercase border-r border-gray-200">
                                        Tafel
                                    </div>
                                    <div className="flex-1 flex">
                                        {timeSlots.map((slot, i) => (
                                            <div
                                                key={slot}
                                                className={`w-14 shrink-0 px-1 py-2 text-center text-[10px] font-medium ${i % 2 === 0 ? 'text-gray-700 bg-gray-50' : 'text-gray-400'} border-r border-gray-100`}
                                            >
                                                {slot}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Table Rows */}
                                {tables.map((table, tableIndex) => {
                                    const tableBookings = restaurantBookings.filter(b => b.table_id === table.id)
                                    return (
                                        <div
                                            key={table.id}
                                            className={`flex border-b border-gray-100 ${tableIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
                                        >
                                            <div className="w-24 shrink-0 px-3 py-2 flex items-center gap-2 border-r border-gray-200">
                                                <span className="font-medium text-sm text-gray-900">{table.name}</span>
                                                <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                                                    {table.seats}
                                                </span>
                                            </div>
                                            <div className="flex-1 relative h-12 flex">
                                                {timeSlots.map((_, i) => (
                                                    <div key={i} className="w-14 shrink-0 border-r border-gray-100" />
                                                ))}
                                                {/* Booking blocks would be positioned absolutely here */}
                                                {tableBookings.map(booking => {
                                                    const startMins = parseInt(booking.start_time.split(':')[0]) * 60 + parseInt(booking.start_time.split(':')[1])
                                                    const endMins = parseInt(booking.end_time.split(':')[0]) * 60 + parseInt(booking.end_time.split(':')[1])
                                                    const gridStartMins = 17 * 60
                                                    const slotWidth = 56 // w-14 = 56px
                                                    const left = ((startMins - gridStartMins) / 30) * slotWidth
                                                    const width = ((endMins - startMins) / 30) * slotWidth

                                                    return (
                                                        <div
                                                            key={booking.id}
                                                            style={{ left: `${left}px`, width: `${Math.max(width, 50)}px` }}
                                                            className="absolute top-1 bottom-1 bg-emerald-500 rounded-md px-2 py-1 overflow-hidden"
                                                            title={`${booking.customer_name} - ${booking.guest_count} pers. ${booking.remarks ? `\n${booking.remarks}` : ''}`}
                                                        >
                                                            <div className="text-white text-[10px] font-medium truncate">
                                                                {booking.guest_count}p {booking.customer_name}
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    {/* Restaurant Bookings List */}
                    {restaurantBookings.length > 0 && (
                        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                            <div className="bg-emerald-50 px-4 py-3 border-b border-emerald-200">
                                <h4 className="font-bold text-emerald-900">Vandaag: {restaurantBookings.length} reserveringen</h4>
                            </div>
                            <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
                                {restaurantBookings.map(booking => (
                                    <div key={booking.id} className={`px-4 py-3 ${booking.status === 'arrived' ? 'bg-emerald-50/50' : ''}`}>
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-3">
                                                    <span className="font-semibold text-gray-900">{booking.customer_name}</span>
                                                    <span className="text-sm text-gray-600 flex items-center gap-1">
                                                        <Users className="w-3.5 h-3.5" />
                                                        {booking.guest_count}
                                                    </span>
                                                    {booking.status === 'arrived' && (
                                                        <span className="text-xs bg-emerald-500 text-white px-2 py-0.5 rounded-full font-medium">
                                                            ✓ Binnen
                                                        </span>
                                                    )}
                                                </div>
                                                {booking.remarks && (
                                                    <div className="mt-1 text-sm text-amber-700 bg-amber-50 rounded px-2 py-1 flex items-start gap-1.5">
                                                        <MessageSquare className="w-3.5 h-3.5 mt-0.5" />
                                                        <span>{booking.remarks}</span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <div className="text-right text-sm font-mono text-gray-700">
                                                    {booking.start_time}
                                                </div>
                                                {booking.status !== 'arrived' && (
                                                    <button
                                                        onClick={() => markAsArrived(booking.id)}
                                                        className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 transition-colors"
                                                    >
                                                        Binnen
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Detail Modal */}
            {
                selected && (
                    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
                            <div className="flex items-start justify-between">
                                <div>
                                    <div className="text-xs font-bold text-gray-500 uppercase">Boeking Details</div>
                                    <div className="text-xl font-bold text-gray-900">{selected.customer_name}</div>
                                </div>
                                <button onClick={() => setSelected(null)} className="p-2 rounded-xl hover:bg-gray-100">
                                    <X className="w-5 h-5 text-gray-600" />
                                </button>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="rounded-xl border border-gray-200 p-3">
                                    <div className="text-xs font-bold text-gray-500 uppercase">Aantal</div>
                                    <div className="font-semibold text-gray-900">{selected.guest_count} personen</div>
                                </div>
                                <div className="rounded-xl border border-gray-200 p-3">
                                    <div className="text-xs font-bold text-gray-500 uppercase">Tafel</div>
                                    <div className="font-semibold text-gray-900">{selected.table_type}-pers</div>
                                </div>
                                <div className="rounded-xl border border-gray-200 p-3">
                                    <div className="text-xs font-bold text-gray-500 uppercase">Event</div>
                                    <div className="font-semibold text-gray-900">{selected.event_title}</div>
                                </div>
                                <div className="rounded-xl border border-gray-200 p-3">
                                    <div className="text-xs font-bold text-gray-500 uppercase">Zone</div>
                                    <div className="font-semibold text-gray-900">{selected.zone_name}</div>
                                </div>
                            </div>

                            {selected.remarks && (
                                <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-3">
                                    <div className="text-xs font-bold text-amber-600 uppercase flex items-center gap-1">
                                        <MessageSquare className="w-3.5 h-3.5" />
                                        Opmerkingen
                                    </div>
                                    <div className="text-amber-900 font-medium mt-1">{selected.remarks}</div>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-3">
                                {selected.customer_email && (
                                    <div className="rounded-xl border border-gray-200 p-3">
                                        <div className="text-xs font-bold text-gray-500 uppercase">E-mail</div>
                                        <div className="font-semibold text-gray-900 text-sm truncate">{selected.customer_email}</div>
                                    </div>
                                )}
                                {selected.customer_phone && (
                                    <div className="rounded-xl border border-gray-200 p-3">
                                        <div className="text-xs font-bold text-gray-500 uppercase">Telefoon</div>
                                        <div className="font-semibold text-gray-900">{selected.customer_phone}</div>
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center justify-between pt-2">
                                <div className="text-xs text-gray-500">
                                    Tijd: <span className="font-bold">{fmtTime(selected.start_datetime)}</span>
                                </div>
                                {selected.status === "confirmed" && (
                                    <button
                                        onClick={() => handleCancel(selected.id)}
                                        disabled={isCancelling}
                                        className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold disabled:opacity-60"
                                    >
                                        {isCancelling ? "Bezig…" : "Annuleren"}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Event Booking Modal */}
            {showEventBookingModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                    🎪 Nieuwe Event Boeking
                                </h3>
                                <button onClick={() => setShowEventBookingModal(false)} className="text-white/80 hover:text-white">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                        <div className="p-4 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Event</label>
                                <select
                                    value={bookingForm.event_id}
                                    onChange={e => setBookingForm(f => ({ ...f, event_id: e.target.value }))}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                >
                                    <option value="">Selecteer event...</option>
                                    {allEvents.map(ev => (
                                        <option key={ev.id} value={ev.id}>{ev.title}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Naam</label>
                                    <input
                                        type="text"
                                        value={bookingForm.customer_name}
                                        onChange={e => setBookingForm(f => ({ ...f, customer_name: e.target.value }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                        placeholder="Klantnaam"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Gasten</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={bookingForm.guest_count}
                                        onChange={e => setBookingForm(f => ({ ...f, guest_count: parseInt(e.target.value) || 1 }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                                    <input
                                        type="email"
                                        value={bookingForm.customer_email}
                                        onChange={e => setBookingForm(f => ({ ...f, customer_email: e.target.value }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                        placeholder="email@voorbeeld.nl"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Telefoon</label>
                                    <input
                                        type="tel"
                                        value={bookingForm.customer_phone}
                                        onChange={e => setBookingForm(f => ({ ...f, customer_phone: e.target.value }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                        placeholder="+31..."
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Opmerkingen</label>
                                <textarea
                                    value={bookingForm.remarks}
                                    onChange={e => setBookingForm(f => ({ ...f, remarks: e.target.value }))}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                    rows={2}
                                    placeholder="Bijzonderheden..."
                                />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={() => setShowEventBookingModal(false)}
                                    className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 font-medium"
                                >
                                    Annuleren
                                </button>
                                <button
                                    onClick={submitEventBooking}
                                    disabled={!bookingForm.event_id || !bookingForm.customer_name || isSubmitting}
                                    className="flex-1 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg font-bold hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50"
                                >
                                    {isSubmitting ? 'Bezig...' : 'Boeken'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Restaurant Booking Modal */}
            {showRestaurantBookingModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 p-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                    🍽️ Nieuwe Tafel Boeking
                                </h3>
                                <button onClick={() => setShowRestaurantBookingModal(false)} className="text-white/80 hover:text-white">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                        <div className="p-4 space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Datum</label>
                                    <input
                                        type="date"
                                        value={bookingForm.date}
                                        onChange={e => setBookingForm(f => ({ ...f, date: e.target.value }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Tijd</label>
                                    <input
                                        type="time"
                                        value={bookingForm.time}
                                        onChange={e => setBookingForm(f => ({ ...f, time: e.target.value }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Naam</label>
                                    <input
                                        type="text"
                                        value={bookingForm.customer_name}
                                        onChange={e => setBookingForm(f => ({ ...f, customer_name: e.target.value }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                                        placeholder="Klantnaam"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Gasten</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={bookingForm.guest_count}
                                        onChange={e => setBookingForm(f => ({ ...f, guest_count: parseInt(e.target.value) || 1 }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                                    <input
                                        type="email"
                                        value={bookingForm.customer_email}
                                        onChange={e => setBookingForm(f => ({ ...f, customer_email: e.target.value }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                                        placeholder="email@voorbeeld.nl"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Telefoon</label>
                                    <input
                                        type="tel"
                                        value={bookingForm.customer_phone}
                                        onChange={e => setBookingForm(f => ({ ...f, customer_phone: e.target.value }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                                        placeholder="+31..."
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Opmerkingen</label>
                                <textarea
                                    value={bookingForm.remarks}
                                    onChange={e => setBookingForm(f => ({ ...f, remarks: e.target.value }))}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                                    rows={2}
                                    placeholder="Bijzonderheden..."
                                />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={() => setShowRestaurantBookingModal(false)}
                                    className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 font-medium"
                                >
                                    Annuleren
                                </button>
                                <button
                                    onClick={submitRestaurantBooking}
                                    disabled={!bookingForm.customer_name || isSubmitting}
                                    className="flex-1 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-lg font-bold hover:from-emerald-700 hover:to-teal-700 disabled:opacity-50"
                                >
                                    {isSubmitting ? 'Bezig...' : 'Boeken'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div >
    )
}
