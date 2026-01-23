import React, { useState, useEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { API_BASE_URL } from '../api'
import { RestaurantBooking } from './RestaurantBooking'

interface TimelineGridProps {
    restaurantId: string
}

interface Table {
    id: string
    name: string
    seats: number
    zone: string
}

interface Booking {
    id: string
    table_id: string
    start_time: string
    end_time: string
    guest_count: number
    customer_name: string
    status: string
}

export const TimelineGrid: React.FC<TimelineGridProps> = ({ restaurantId }) => {
    const [date, setDate] = useState(() => {
        const today = new Date()
        return today.toISOString().split('T')[0]
    })
    const [tables, setTables] = useState<Table[]>([])
    const [bookings, setBookings] = useState<Booking[]>([])
    const [loading, setLoading] = useState(true)
    const [showNewBookingModal, setShowNewBookingModal] = useState(false)

    // Time slots from 14:00 to 23:00 (30 min intervals)
    const timeSlots = useMemo(() => {
        const slots: string[] = []
        for (let h = 14; h <= 22; h++) {
            slots.push(`${h.toString().padStart(2, '0')}:00`)
            slots.push(`${h.toString().padStart(2, '0')}:30`)
        }
        slots.push('23:00')
        return slots
    }, [])

    // Fetch tables and bookings
    const fetchData = async () => {
        setLoading(true)
        try {
            // Fetch tables
            const tablesRes = await fetch(`${API_BASE_URL}/api/restaurant/${restaurantId}/tables`)
            const tablesData = await tablesRes.json()
            setTables(tablesData.tables || [])

            // Fetch bookings for this date
            const bookingsRes = await fetch(
                `${API_BASE_URL}/api/admin/restaurant-bookings?restaurantId=${restaurantId}&date=${date}`,
                { headers: { 'Authorization': `Bearer ${localStorage.getItem('events_token')}` } }
            )
            if (bookingsRes.ok) {
                const bookingsData = await bookingsRes.json()
                setBookings(bookingsData.bookings || [])
            }
        } catch (e) {
            console.error('Failed to load timeline data:', e)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchData()
    }, [restaurantId, date])

    // Navigate date
    const navigateDate = (delta: number) => {
        const d = new Date(date)
        d.setDate(d.getDate() + delta)
        setDate(d.toISOString().split('T')[0])
    }

    // Calculate booking position on grid
    const getBookingStyle = (booking: Booking) => {
        const startMins = parseInt(booking.start_time.split(':')[0]) * 60 + parseInt(booking.start_time.split(':')[1])
        const endMins = parseInt(booking.end_time.split(':')[0]) * 60 + parseInt(booking.end_time.split(':')[1])
        const gridStartMins = 14 * 60 // 14:00
        const slotWidth = 60 // pixels per 30 mins

        const left = ((startMins - gridStartMins) / 30) * slotWidth
        const width = ((endMins - startMins) / 30) * slotWidth

        return { left: `${left}px`, width: `${width}px` }
    }

    // Format date for display
    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr)
        return d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    }

    return (
        <>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                {/* Header */}
                <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => navigateDate(-1)}
                            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            <ChevronLeft className="w-5 h-5 text-gray-600" />
                        </button>
                        <span className="font-semibold text-gray-900 min-w-[200px] text-center">
                            {formatDate(date)}
                        </span>
                        <button
                            onClick={() => navigateDate(1)}
                            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            <ChevronRight className="w-5 h-5 text-gray-600" />
                        </button>
                    </div>
                    <button
                        onClick={() => setShowNewBookingModal(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-[#3D9970] hover:bg-[#3D9970]/90 rounded-lg transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        Nieuwe boeking
                    </button>
                </div>

                {/* Timeline Grid */}
                <div className="overflow-x-auto">
                    <div className="min-w-[1000px]">
                        {/* Time Header */}
                        <div className="flex border-b border-gray-200">
                            <div className="w-32 shrink-0 px-3 py-2 bg-gray-50 text-xs font-medium text-gray-500 uppercase">
                                Tafel
                            </div>
                            <div className="flex-1 flex">
                                {timeSlots.map((slot, i) => (
                                    <div
                                        key={slot}
                                        className={`w-[60px] shrink-0 px-1 py-2 text-center text-xs font-medium ${i % 2 === 0 ? 'text-gray-700' : 'text-gray-400'
                                            } border-l border-gray-100`}
                                    >
                                        {slot}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Table Rows */}
                        {loading ? (
                            <div className="px-4 py-8 text-center text-gray-400">Laden...</div>
                        ) : tables.length === 0 ? (
                            <div className="px-4 py-8 text-center text-gray-400">Geen tafels gevonden</div>
                        ) : (
                            tables.map((table, tableIndex) => {
                                const tableBookings = bookings.filter(b => b.table_id === table.id)
                                return (
                                    <div
                                        key={table.id}
                                        className={`flex border-b border-gray-100 ${tableIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
                                    >
                                        {/* Table Info */}
                                        <div className="w-32 shrink-0 px-3 py-2 flex items-center gap-2">
                                            <span className="font-medium text-sm text-gray-900">{table.name}</span>
                                            <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                                                {table.seats}
                                            </span>
                                        </div>

                                        {/* Timeline */}
                                        <div className="flex-1 relative h-12">
                                            {/* Grid lines */}
                                            <div className="absolute inset-0 flex">
                                                {timeSlots.map((_, i) => (
                                                    <div key={i} className="w-[60px] shrink-0 border-l border-gray-100" />
                                                ))}
                                            </div>

                                            {/* Bookings */}
                                            {tableBookings.map(booking => (
                                                <div
                                                    key={booking.id}
                                                    style={getBookingStyle(booking)}
                                                    className="absolute top-1 bottom-1 bg-[#3D9970] rounded-md px-2 py-1 cursor-pointer hover:bg-[#3D9970]/80 transition-colors overflow-hidden"
                                                    title={`${booking.customer_name} - ${booking.guest_count} pers.`}
                                                >
                                                    <div className="text-white text-xs font-medium truncate">
                                                        {booking.guest_count} {booking.customer_name}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </div>
                </div>
            </div>

            {/* New Booking Modal */}
            {showNewBookingModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-[#0b0b0b] rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto relative">
                        <button
                            onClick={() => setShowNewBookingModal(false)}
                            className="absolute top-3 right-3 p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors z-10"
                        >
                            <X className="w-5 h-5" />
                        </button>
                        <RestaurantBooking
                            restaurantId={restaurantId}
                            onClose={() => setShowNewBookingModal(false)}
                            onComplete={() => {
                                fetchData()
                                setShowNewBookingModal(false)
                            }}
                        />
                    </div>
                </div>
            )}
        </>
    )
}
