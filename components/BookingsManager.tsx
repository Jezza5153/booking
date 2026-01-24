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
                                onClick={() => window.location.hash = '#/tafels'}
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
                                onClick={() => window.location.hash = '#/tafels'}
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
                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                        {loadingTimeline ? (
                            <div className="text-center py-8 text-gray-500">Laden...</div>
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
                                    <div key={booking.id} className="px-4 py-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-3">
                                                    <span className="font-semibold text-gray-900">{booking.customer_name}</span>
                                                    <span className="text-sm text-gray-600 flex items-center gap-1">
                                                        <Users className="w-3.5 h-3.5" />
                                                        {booking.guest_count}
                                                    </span>
                                                </div>
                                                {booking.remarks && (
                                                    <div className="mt-1 text-sm text-amber-700 bg-amber-50 rounded px-2 py-1 flex items-start gap-1.5">
                                                        <MessageSquare className="w-3.5 h-3.5 mt-0.5" />
                                                        <span>{booking.remarks}</span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="text-right text-sm font-mono text-gray-700">
                                                {booking.start_time}
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
        </div >
    )
}
