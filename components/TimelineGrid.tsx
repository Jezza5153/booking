import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
    ChevronLeft, ChevronRight, Plus, X, RefreshCw,
    Check, Clock, UserX, UserCheck, Users, Edit3, Trash2,
    StickyNote, Star, AlertCircle, Phone, Mail, Printer, Copy, Calendar
} from 'lucide-react'
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
    preferences?: string[]
    can_combine?: boolean
}

interface Booking {
    id: string
    table_id: string
    start_time: string
    end_time: string
    guest_count: number
    customer_name: string
    customer_email?: string
    customer_phone?: string
    status: 'confirmed' | 'arrived' | 'no_show' | 'cancelled' | 'walkin'
    is_walkin?: boolean
    dietary_notes?: string
    remarks?: string
    tables_linked?: string[]
    customer_id?: string
    customer_visits?: number
    visit_count?: string | number
    group_id?: string
    is_primary?: boolean
    table_name?: string
    linked_tables?: string | null
}

interface Customer {
    id: string
    name: string
    email?: string
    phone?: string
    total_visits: number
    tags?: string[]
    dietary_notes?: string
}

interface DayNote {
    id: string
    note: string
    created_at: string
}

interface OpeningHours {
    day: number
    is_open: boolean
    open_time: string
    close_time: string
}

// Status color mapping
const STATUS_COLORS = {
    confirmed: { bg: 'bg-emerald-500', hover: 'hover:bg-emerald-600', text: 'Bevestigd', icon: Check },
    arrived: { bg: 'bg-amber-500', hover: 'hover:bg-amber-600', text: 'Gearriveerd', icon: UserCheck },
    no_show: { bg: 'bg-red-500', hover: 'hover:bg-red-600', text: 'No-show', icon: UserX },
    cancelled: { bg: 'bg-gray-400', hover: 'hover:bg-gray-500', text: 'Geannuleerd', icon: X },
    walkin: { bg: 'bg-blue-500', hover: 'hover:bg-blue-600', text: 'Walk-in', icon: Users }
}
// Customer History sub-component for booking detail modal
const CustomerHistory: React.FC<{ email?: string; customerId?: string; currentBookingId: string }> = ({ email, customerId, currentBookingId }) => {
    const [history, setHistory] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [expanded, setExpanded] = useState(false)

    useEffect(() => {
        const fetchHistory = async () => {
            try {
                const token = localStorage.getItem('events_token')
                const params = new URLSearchParams({ restaurantId: 'demo-restaurant' })
                if (customerId) params.set('customerId', customerId)
                else if (email) params.set('email', email)
                else { setLoading(false); return }

                const res = await fetch(`${API_BASE_URL}/api/admin/customer-history?${params}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                })
                const data = await res.json()
                // Filter out the current booking
                setHistory((data.history || []).filter((h: any) => h.booking_date !== undefined))
            } catch {
                setHistory([])
            }
            setLoading(false)
        }
        fetchHistory()
    }, [email, customerId, currentBookingId])

    if (loading) return <div className="text-xs text-gray-400 py-1">Geschiedenis laden...</div>
    if (history.length <= 1) return null // Only current booking, no history

    const statusLabel: Record<string, string> = {
        confirmed: '✅', arrived: '🟢', no_show: '❌', cancelled: '⛔', walkin: '🚶'
    }

    return (
        <div className="border-t pt-2">
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between text-xs font-medium text-gray-600 hover:text-gray-900"
            >
                <span>📋 Eerdere bezoeken ({history.length - 1})</span>
                <ChevronRight className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />
            </button>
            {expanded && (
                <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
                    {history.filter((_, i) => i > 0).map((h, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs bg-gray-50 rounded-lg p-2">
                            <span className="text-gray-400 w-20 shrink-0">{h.booking_date}</span>
                            <span className="font-medium">{h.guest_count}p</span>
                            <span className="text-gray-400">{h.table_name}</span>
                            <span>{statusLabel[h.status] || h.status}</span>
                            {h.remarks && (
                                <span className="text-amber-600 truncate ml-auto" title={h.remarks}>
                                    📝 {h.remarks}
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

export const TimelineGrid: React.FC<TimelineGridProps> = ({ restaurantId }) => {
    const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
    const [tables, setTables] = useState<Table[]>([])
    const [bookings, setBookings] = useState<Booking[]>([])
    const [loading, setLoading] = useState(true)
    const [openingHours, setOpeningHours] = useState<OpeningHours[]>([])
    const [dayNotes, setDayNotes] = useState<DayNote[]>([])
    const [newNoteText, setNewNoteText] = useState('')
    const [showDayNotes, setShowDayNotes] = useState(false)

    // Modal states
    const [showNewBookingModal, setShowNewBookingModal] = useState(false)
    const [showQuickBookModal, setShowQuickBookModal] = useState(false)
    const [showWalkinModal, setShowWalkinModal] = useState(false)
    const [showBookingDetail, setShowBookingDetail] = useState<Booking | null>(null)
    const [showCustomerSearch, setShowCustomerSearch] = useState(false)
    const [showCalendarPopup, setShowCalendarPopup] = useState(false)

    // Toast notification
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

    // Confirmation dialog
    const [confirmDialog, setConfirmDialog] = useState<{
        message: string
        action: () => void
        type: 'danger' | 'warning'
    } | null>(null)

    // Quick book state (when clicking a cell)
    const [quickBookData, setQuickBookData] = useState<{ table: Table; time: string } | null>(null)
    const [quickBookForm, setQuickBookForm] = useState({
        guest_count: 2,
        customer_name: '',
        customer_phone: '',
        customer_email: '',
        duration: 180,
        remarks: ''
    })

    // Walk-in state
    const [walkinForm, setWalkinForm] = useState({
        guest_count: 2,
        customer_name: '',
        table_id: ''
    })

    // Edit booking state
    const [editingBooking, setEditingBooking] = useState<Booking | null>(null)
    const [editForm, setEditForm] = useState({
        guest_count: 2,
        customer_name: '',
        customer_phone: '',
        customer_email: '',
        remarks: '',
        time: '',
        duration: 180
    })

    // Submitting state for double-click protection
    const [isSubmitting, setIsSubmitting] = useState(false)

    // Customer search
    const [customerSearchQuery, setCustomerSearchQuery] = useState('')
    const [customerSearchResults, setCustomerSearchResults] = useState<Customer[]>([])

    // View mode: day or week
    const [viewMode, setViewMode] = useState<'day' | 'week'>('day')

    // Helper: strip seconds from time strings (e.g. "17:30:00" → "17:30")
    const fmtTime = (t: string) => t?.slice(0, 5) || t

    // Waitlist
    const [waitlist, setWaitlist] = useState<Array<{
        id: string
        customer_name: string
        customer_phone?: string
        guest_count: number
        preferred_time?: string
        notes?: string
        created_at: string
    }>>([])
    const [showWaitlistPanel, setShowWaitlistPanel] = useState(false)
    const [waitlistForm, setWaitlistForm] = useState({
        customer_name: '',
        customer_phone: '',
        guest_count: 2,
        preferred_time: '',
        notes: ''
    })

    const [slotDuration, setSlotDuration] = useState<15 | 30 | 60>(30) // minutes per slot

    // Generate time slots based on opening hours and slot duration
    const timeSlots = useMemo(() => {
        const today = new Date(date)
        const dayOfWeek = today.getDay()
        const todayHours = openingHours.find(h => h.day === dayOfWeek)

        // Default hours if not loaded yet
        let startHour = 12
        let endHour = 23

        if (todayHours?.is_open) {
            startHour = parseInt(todayHours.open_time?.split(':')[0] || '12')
            endHour = parseInt(todayHours.close_time?.split(':')[0] || '23')
        } else if (openingHours.length === 0) {
            // Fallback when opening hours haven't loaded yet
            startHour = 12
            endHour = 23
        }

        const slots: string[] = []
        for (let h = startHour; h <= endHour; h++) {
            for (let m = 0; m < 60; m += slotDuration) {
                if (h === endHour && m > 0) break // Don't go past closing
                slots.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`)
            }
        }
        return slots
    }, [date, openingHours, slotDuration])

    const gridStartHour = useMemo(() => {
        if (timeSlots.length === 0) return 12
        return parseInt(timeSlots[0].split(':')[0])
    }, [timeSlots])

    // Check if today is open
    const isOpenToday = useMemo(() => {
        const today = new Date(date)
        const dayOfWeek = today.getDay()
        const todayHours = openingHours.find(h => h.day === dayOfWeek)
        return todayHours?.is_open ?? true // Default to open if no data
    }, [date, openingHours])

    // PERF: Fetch all data in parallel (saves ~400-800ms vs sequential)
    const fetchData = useCallback(async () => {
        setLoading(true)
        try {
            const token = localStorage.getItem('events_token')
            const headers = { 'Authorization': `Bearer ${token}` }

            const [tablesRes, hoursRes, bookingsRes, notesRes, waitlistRes] = await Promise.all([
                fetch(`${API_BASE_URL}/api/restaurant/${restaurantId}/tables`),
                fetch(`${API_BASE_URL}/api/restaurant/${restaurantId}/openings`),
                fetch(`${API_BASE_URL}/api/admin/restaurant-bookings?restaurantId=${restaurantId}&date=${date}`, { headers }),
                fetch(`${API_BASE_URL}/api/admin/day-notes?restaurantId=${restaurantId}&date=${date}`, { headers }),
                fetch(`${API_BASE_URL}/api/restaurant/${restaurantId}/waitlist?date=${date}`, { headers })
            ])

            const tablesData = await tablesRes.json()
            setTables(tablesData.tables || [])

            if (hoursRes.ok) {
                const hoursData = await hoursRes.json()
                setOpeningHours(hoursData.openings || [])
            }

            if (bookingsRes.ok) {
                const bookingsData = await bookingsRes.json()
                setBookings(bookingsData.bookings || [])
            }

            if (notesRes.ok) {
                const notesData = await notesRes.json()
                setDayNotes(notesData.notes || [])
            }

            if (waitlistRes.ok) {
                const waitlistData = await waitlistRes.json()
                setWaitlist(waitlistData.waitlist || [])
            }
        } catch (e) {
            console.error('Failed to load timeline data:', e)
        } finally {
            setLoading(false)
        }
    }, [restaurantId, date])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    // Toast helper
    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setToast({ message, type })
        setTimeout(() => setToast(null), 3000)
    }

    // Check for newBooking query param to auto-open modal
    useEffect(() => {
        const hash = window.location.hash
        if (hash.includes('newBooking=true')) {
            setShowNewBookingModal(true)
            // Clean up the URL
            window.location.hash = '#/tafels'
        }
    }, [])

    // Navigate date
    const navigateDate = (delta: number) => {
        const d = new Date(date)
        d.setDate(d.getDate() + delta)
        setDate(d.toISOString().split('T')[0])
    }

    const goToToday = () => setDate(new Date().toISOString().split('T')[0])

    // Format date for display
    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr)
        return d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })
    }

    // Calculate booking position on grid (adapts to slot duration)
    const getBookingStyle = (booking: Booking) => {
        const startMins = parseInt(booking.start_time.split(':')[0]) * 60 + parseInt(booking.start_time.split(':')[1])
        const endMins = parseInt(booking.end_time.split(':')[0]) * 60 + parseInt(booking.end_time.split(':')[1])
        const gridStartMins = gridStartHour * 60
        const slotWidthPx = 60 // pixel width per slot

        // Calculate based on current slot duration
        const left = ((startMins - gridStartMins) / slotDuration) * slotWidthPx
        const width = ((endMins - startMins) / slotDuration) * slotWidthPx

        return { left: `${left}px`, width: `${Math.max(width, slotWidthPx)}px` }
    }

    // PERF: Memoized booking occupancy lookup — O(1) per cell instead of O(n)
    const occupiedSlots = useMemo(() => {
        const set = new Set<string>()
        for (const b of bookings) {
            if (b.status === 'cancelled') continue
            const startMins = parseInt(b.start_time.split(':')[0]) * 60 + parseInt(b.start_time.split(':')[1])
            const endMins = parseInt(b.end_time.split(':')[0]) * 60 + parseInt(b.end_time.split(':')[1])
            // Mark every slot minute this booking covers
            for (let m = startMins; m < endMins; m += slotDuration) {
                set.add(`${b.table_id}:${m}`)
            }
        }
        return set
    }, [bookings, slotDuration])

    // Check if a slot is available for a table (O(1) lookup)
    const isSlotAvailable = (table: Table, timeSlot: string) => {
        const slotMins = parseInt(timeSlot.split(':')[0]) * 60 + parseInt(timeSlot.split(':')[1])
        return !occupiedSlots.has(`${table.id}:${slotMins}`)
    }

    // Handle cell click for quick booking
    const handleCellClick = (table: Table, timeSlot: string) => {
        if (!isSlotAvailable(table, timeSlot)) return

        setQuickBookData({ table, time: timeSlot })
        setQuickBookForm({
            guest_count: Math.min(table.seats, 2),
            customer_name: '',
            customer_phone: '',
            customer_email: '',
            duration: 90,
            remarks: ''
        })
        setShowQuickBookModal(true)
    }

    // Submit quick booking
    const submitQuickBook = async () => {
        if (!quickBookData || !quickBookForm.customer_name || isSubmitting) return
        setIsSubmitting(true)

        try {
            const token = localStorage.getItem('events_token')
            const startTime = quickBookData.time
            const [h, m] = startTime.split(':').map(Number)
            const endMins = h * 60 + m + quickBookForm.duration
            const endTime = `${Math.floor(endMins / 60).toString().padStart(2, '0')}:${(endMins % 60).toString().padStart(2, '0')}`

            const res = await fetch(`${API_BASE_URL}/api/restaurant/book`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    restaurant_id: restaurantId,
                    table_id: quickBookData.table.id,
                    date,
                    time: startTime,
                    end_time: endTime,
                    guest_count: quickBookForm.guest_count,
                    customer_name: quickBookForm.customer_name,
                    customer_phone: quickBookForm.customer_phone,
                    customer_email: quickBookForm.customer_email,
                    remarks: quickBookForm.remarks,
                    status: 'confirmed'
                })
            })

            if (res.ok) {
                setShowQuickBookModal(false)
                setQuickBookData(null)
                showToast('Boeking succesvol aangemaakt', 'success')
                fetchData()
            } else {
                const err = await res.json().catch(() => null)
                showToast(err?.error || 'Boeking mislukt', 'error')
            }
        } catch (e) {
            console.error('Failed to create booking:', e)
            showToast('Boeking mislukt', 'error')
        } finally {
            setIsSubmitting(false)
        }
    }

    // Smart table allocation for any party size
    // Returns single table or array of tables to combine
    const findBestTables = (guestCount: number, forTime?: string): { tables: Table[]; totalSeats: number } | null => {
        const checkTime = forTime || (() => {
            const now = new Date()
            return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
        })()

        // Get all available tables at this time
        const availableTables = tables
            .filter(t => isSlotAvailable(t, checkTime) && (t.can_combine !== false))
            .sort((a, b) => a.seats - b.seats)

        if (availableTables.length === 0) return null

        // Strategy 1: Single table (if one fits)
        const singleTable = availableTables.find(t => t.seats >= guestCount)
        if (singleTable) {
            return { tables: [singleTable], totalSeats: singleTable.seats }
        }

        // Strategy 2: Combine tables (for parties > largest single table)
        // Try to find the smallest combination that fits
        const totalSeatsNeeded = guestCount

        // Simple greedy: start with largest tables
        const sortedDesc = [...availableTables].sort((a, b) => b.seats - a.seats)
        let selectedTables: Table[] = []
        let currentSeats = 0

        for (const table of sortedDesc) {
            if (currentSeats >= totalSeatsNeeded) break
            selectedTables.push(table)
            currentSeats += table.seats
        }

        if (currentSeats >= totalSeatsNeeded) {
            return { tables: selectedTables, totalSeats: currentSeats }
        }

        // Not enough capacity
        return null
    }

    // Simplified single table finder (for backwards compatibility)
    const findBestTable = (guestCount: number): Table | null => {
        const result = findBestTables(guestCount)
        return result?.tables[0] || null
    }

    // Submit walk-in with multi-table support
    const submitWalkin = async () => {
        if (!walkinForm.customer_name || walkinForm.guest_count < 1 || isSubmitting) return
        setIsSubmitting(true)

        // Use smart allocation for multi-table
        const allocation = walkinForm.table_id
            ? { tables: [tables.find(t => t.id === walkinForm.table_id)!], totalSeats: 0 }
            : findBestTables(walkinForm.guest_count)

        if (!allocation || allocation.tables.length === 0) {
            showToast('Geen beschikbare tafels voor dit aantal gasten', 'error')
            setIsSubmitting(false)
            return
        }

        try {
            const token = localStorage.getItem('events_token')
            const now = new Date()
            const startTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
            const endMins = now.getHours() * 60 + now.getMinutes() + 90
            const endTime = `${Math.floor(endMins / 60).toString().padStart(2, '0')}:${(endMins % 60).toString().padStart(2, '0')}`

            // Book all tables in the allocation
            const tableIds = allocation.tables.map(t => t.id)
            const primaryTable = allocation.tables[0]

            const res = await fetch(`${API_BASE_URL}/api/restaurant/book`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    restaurant_id: restaurantId,
                    table_id: primaryTable.id,
                    table_ids: tableIds, // All tables for this booking
                    date,
                    time: startTime,
                    end_time: endTime,
                    guest_count: walkinForm.guest_count,
                    customer_name: walkinForm.customer_name,
                    status: 'arrived',
                    is_walkin: true,
                    tables_linked: tableIds.length > 1 ? tableIds : undefined
                })
            })

            if (res.ok) {
                setShowWalkinModal(false)
                setWalkinForm({ guest_count: 2, customer_name: '', table_id: '' })
                showToast('Walk-in succesvol geplaatst', 'success')
                fetchData()
            } else {
                const err = await res.json().catch(() => null)
                showToast(err?.error || 'Walk-in mislukt', 'error')
            }
        } catch (e) {
            console.error('Failed to create walk-in:', e)
            showToast('Walk-in mislukt', 'error')
        } finally {
            setIsSubmitting(false)
        }
    }

    // Update booking status
    const updateBookingStatus = async (bookingId: string, status: string) => {
        // Optimistic update - update local state immediately
        setBookings(prev => prev.map(b =>
            b.id === bookingId ? { ...b, status } : b
        ))
        try {
            const token = localStorage.getItem('events_token')
            await fetch(`${API_BASE_URL}/api/admin/restaurant-bookings/${bookingId}/status`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ status })
            })
            setShowBookingDetail(null)
            const statusLabels: Record<string, string> = {
                'arrived': 'Gearriveerd',
                'no_show': 'No-show',
                'confirmed': 'Bevestigd',
                'cancelled': 'Geannuleerd'
            }
            showToast(`Status gewijzigd naar ${statusLabels[status] || status}`, 'success')
        } catch (e) {
            console.error('Failed to update status:', e)
            showToast('Status wijzigen mislukt', 'error')
            fetchData() // Revert on error
        }
    }

    // Quick mark as arrived helper
    const markAsArrived = (bookingId: string) => updateBookingStatus(bookingId, 'arrived')

    // Add day note
    const addDayNote = async () => {
        if (!newNoteText.trim()) return
        try {
            const token = localStorage.getItem('events_token')
            await fetch(`${API_BASE_URL}/api/admin/day-notes`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    restaurantId,
                    date,
                    note: newNoteText
                })
            })
            setNewNoteText('')
            fetchData()
        } catch (e) {
            console.error('Failed to add note:', e)
        }
    }

    // Delete day note
    const deleteDayNote = async (noteId: string) => {
        try {
            const token = localStorage.getItem('events_token')
            await fetch(`${API_BASE_URL}/api/admin/day-notes/${noteId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            })
            fetchData()
        } catch (e) {
            console.error('Failed to delete note:', e)
        }
    }

    // Calculate capacity percentage per time slot
    const getSlotCapacity = (timeSlot: string) => {
        const slotMins = parseInt(timeSlot.split(':')[0]) * 60 + parseInt(timeSlot.split(':')[1])
        let bookedSeats = 0

        bookings.forEach(b => {
            if (b.status === 'cancelled') return
            const startMins = parseInt(b.start_time.split(':')[0]) * 60 + parseInt(b.start_time.split(':')[1])
            const endMins = parseInt(b.end_time.split(':')[0]) * 60 + parseInt(b.end_time.split(':')[1])
            if (slotMins >= startMins && slotMins < endMins) {
                bookedSeats += b.guest_count
            }
        })

        const totalSeats = tables.reduce((sum, t) => sum + t.seats, 0)
        return totalSeats > 0 ? Math.round((bookedSeats / totalSeats) * 100) : 0
    }

    // Search customers
    const searchCustomers = async (query: string) => {
        if (query.length < 2) {
            setCustomerSearchResults([])
            return
        }
        try {
            const token = localStorage.getItem('events_token')
            const res = await fetch(
                `${API_BASE_URL}/api/admin/customers/search?restaurantId=${restaurantId}&q=${encodeURIComponent(query)}`,
                { headers: { 'Authorization': `Bearer ${token}` } }
            )
            if (res.ok) {
                const data = await res.json()
                setCustomerSearchResults(data.customers || [])
            }
        } catch (e) {
            console.error('Customer search failed:', e)
        }
    }

    const StatusIcon = ({ status }: { status: string }) => {
        const config = STATUS_COLORS[status as keyof typeof STATUS_COLORS] || STATUS_COLORS.confirmed
        const Icon = config.icon
        return <Icon className="w-3 h-3" />
    }

    return (
        <>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                {/* Header - Modern Premium Design */}
                <div className="px-6 py-4 border-b border-gray-100 bg-white/80 backdrop-blur-sm sticky top-0 z-20">
                    <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
                        {/* Left: Date Navigation & View Mode */}
                        <div className="flex items-center gap-4">
                            {/* TODAY BUTTON - Prominent standalone when not on today */}
                            {date !== new Date().toISOString().split('T')[0] && (
                                <button
                                    onClick={goToToday}
                                    className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-amber-500/30 hover:bg-amber-600 transition-all active:scale-95 animate-pulse"
                                >
                                    <Calendar className="w-4 h-4" />
                                    VANDAAG
                                </button>
                            )}
                            <div className="flex items-center bg-gray-50 rounded-lg p-1 border border-gray-100 shadow-sm relative">
                                <button
                                    onClick={() => navigateDate(-1)}
                                    className="p-1.5 hover:bg-white hover:shadow-sm rounded-md transition-all text-gray-500 hover:text-gray-900"
                                >
                                    <ChevronLeft className="w-5 h-5" />
                                </button>
                                <button
                                    onClick={() => setShowCalendarPopup(!showCalendarPopup)}
                                    className="px-3 py-1 text-sm font-semibold text-gray-700 hover:text-gray-900 transition-colors flex items-center gap-1"
                                >
                                    <Calendar className="w-3.5 h-3.5" />
                                    Kalender
                                </button>
                                <button
                                    onClick={() => navigateDate(1)}
                                    className="p-1.5 hover:bg-white hover:shadow-sm rounded-md transition-all text-gray-500 hover:text-gray-900"
                                >
                                    <ChevronRight className="w-5 h-5" />
                                </button>

                                {/* Mini Calendar Popup */}
                                {showCalendarPopup && (
                                    <>
                                        <div className="fixed inset-0 z-30" onClick={() => setShowCalendarPopup(false)} />
                                        <div className="absolute top-full left-0 mt-2 bg-white rounded-xl shadow-2xl border border-gray-200 p-4 z-40 w-72">
                                            {(() => {
                                                const calDate = new Date(date)
                                                const calYear = calDate.getFullYear()
                                                const calMonth = calDate.getMonth()
                                                const firstDayRaw = new Date(calYear, calMonth, 1).getDay()
                                                const firstDay = firstDayRaw === 0 ? 6 : firstDayRaw - 1
                                                const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate()
                                                const todayStr = new Date().toISOString().split('T')[0]
                                                return (
                                                    <>
                                                        <div className="flex items-center justify-between mb-3">
                                                            <button
                                                                onClick={() => {
                                                                    const d = new Date(date)
                                                                    d.setMonth(d.getMonth() - 1)
                                                                    setDate(d.toISOString().split('T')[0])
                                                                }}
                                                                className="p-1 hover:bg-gray-100 rounded-md text-gray-500"
                                                            >
                                                                <ChevronLeft className="w-4 h-4" />
                                                            </button>
                                                            <span className="text-sm font-semibold text-gray-900 capitalize">
                                                                {calDate.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' })}
                                                            </span>
                                                            <button
                                                                onClick={() => {
                                                                    const d = new Date(date)
                                                                    d.setMonth(d.getMonth() + 1)
                                                                    setDate(d.toISOString().split('T')[0])
                                                                }}
                                                                className="p-1 hover:bg-gray-100 rounded-md text-gray-500"
                                                            >
                                                                <ChevronRight className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                        <div className="grid grid-cols-7 gap-1 text-center mb-1">
                                                            {['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].map(d => (
                                                                <div key={d} className="text-[10px] text-gray-400 uppercase font-medium">{d}</div>
                                                            ))}
                                                        </div>
                                                        <div className="grid grid-cols-7 gap-1">
                                                            {Array(firstDay).fill(null).map((_, i) => <div key={`e-${i}`} />)}
                                                            {Array.from({ length: daysInMonth }, (_, i) => {
                                                                const day = i + 1
                                                                const dayStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                                                                const isToday = dayStr === todayStr
                                                                const isSelected = dayStr === date
                                                                return (
                                                                    <button
                                                                        key={day}
                                                                        onClick={() => {
                                                                            setDate(dayStr)
                                                                            setShowCalendarPopup(false)
                                                                        }}
                                                                        className={`py-1.5 rounded-lg text-sm transition-all ${isSelected
                                                                            ? 'bg-gray-900 text-white font-bold'
                                                                            : isToday
                                                                                ? 'bg-emerald-100 text-emerald-800 font-semibold'
                                                                                : 'text-gray-700 hover:bg-gray-100'
                                                                            }`}
                                                                    >
                                                                        {day}
                                                                    </button>
                                                                )
                                                            })}
                                                        </div>
                                                        <div className="mt-2 pt-2 border-t flex justify-between">
                                                            <button
                                                                onClick={() => {
                                                                    setDate(todayStr)
                                                                    setShowCalendarPopup(false)
                                                                }}
                                                                className="text-xs text-emerald-600 font-medium hover:underline"
                                                            >
                                                                Naar vandaag
                                                            </button>
                                                        </div>
                                                    </>
                                                )
                                            })()}
                                        </div>
                                    </>
                                )}
                            </div>

                            <div className="flex flex-col">
                                <h2 className="text-xl font-bold text-gray-900 leading-none">
                                    {new Date(date).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })}
                                </h2>
                                <span className="text-xs text-gray-400 font-medium uppercase tracking-wider mt-0.5">
                                    {viewMode === 'day' ? 'Dagoverzicht' : 'Weekoverzicht'}
                                </span>
                            </div>
                        </div>

                        {/* Center: Live Stats Pill */}
                        <div className="hidden 2xl:flex items-center gap-6 px-6 py-2.5 bg-gray-900 text-white rounded-full shadow-lg shadow-gray-200 transform hover:scale-105 transition-transform duration-200 cursor-default">
                            <div className="flex items-center gap-3">
                                <div className="flex -space-x-2">
                                    {[...Array(3)].map((_, i) => (
                                        <div key={i} className={`w-2 h-2 rounded-full border border-gray-900 ${i === 0 ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                                    ))}
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-lg font-bold leading-none">
                                        {bookings.filter(b => b.status !== 'cancelled').length}
                                    </span>
                                    <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Boekingen</span>
                                </div>
                            </div>
                            <div className="w-px h-8 bg-gray-700"></div>
                            <div className="flex items-center gap-3">
                                <Users className="w-4 h-4 text-blue-400" />
                                <div className="flex flex-col">
                                    <span className="text-lg font-bold leading-none">
                                        {bookings.filter(b => b.status !== 'cancelled').reduce((sum, b) => sum + b.guest_count, 0)}
                                    </span>
                                    <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Gasten</span>
                                </div>
                            </div>
                        </div>

                        {/* Right: Actions Toolbar */}
                        <div className="flex items-center gap-3">
                            {/* View Controls Group */}
                            <div className="hidden md:flex items-center bg-gray-50 rounded-lg p-1 border border-gray-100 mr-2">
                                <button
                                    onClick={() => setViewMode('day')}
                                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${viewMode === 'day' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                                >
                                    Dag
                                </button>
                                <button
                                    onClick={() => setViewMode('week')}
                                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${viewMode === 'week' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                                >
                                    Week
                                </button>
                                <div className="w-px h-4 bg-gray-200 mx-1"></div>
                                <select
                                    value={slotDuration}
                                    onChange={(e) => setSlotDuration(parseInt(e.target.value))}
                                    className="bg-transparent text-xs font-medium text-gray-600 border-none focus:ring-0 py-0 pl-2 pr-6 cursor-pointer"
                                >
                                    <option value={60}>1u</option>
                                    <option value={30}>30m</option>
                                    <option value={15}>15m</option>
                                    <option value={5}>5m</option>
                                </select>
                            </div>

                            {/* Secondary Actions */}
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={fetchData}
                                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-full transition-colors"
                                    title="Vernieuwen"
                                >
                                    <RefreshCw className="w-5 h-5" />
                                </button>
                                <button
                                    onClick={() => window.print()}
                                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-full transition-colors"
                                    title="Printen"
                                >
                                    <Printer className="w-5 h-5" />
                                </button>
                                <button
                                    onClick={() => setShowDayNotes(!showDayNotes)}
                                    className={`p-2 rounded-full transition-colors ${dayNotes.length > 0 ? 'text-amber-500 bg-amber-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'}`}
                                    title="Notities"
                                >
                                    <StickyNote className="w-5 h-5" />
                                    {dayNotes.length > 0 && <span className="absolute top-0 right-0 w-2 h-2 bg-amber-500 rounded-full"></span>}
                                </button>
                                <button
                                    onClick={() => setShowWaitlistPanel(!showWaitlistPanel)}
                                    className={`p-2 rounded-full transition-colors relative ${waitlist.length > 0 ? 'text-purple-500 bg-purple-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'}`}
                                    title="Wachtlijst"
                                >
                                    <Clock className="w-5 h-5" />
                                    {waitlist.length > 0 && (
                                        <span className="absolute -top-1 -right-1 w-4 h-4 bg-purple-500 text-white text-[10px] flex items-center justify-center rounded-full ring-2 ring-white">
                                            {waitlist.length}
                                        </span>
                                    )}
                                </button>
                            </div>

                            <div className="h-8 w-px bg-gray-200 mx-2"></div>

                            {/* Primary Actions */}
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setShowWalkinModal(true)}
                                    className="hidden sm:flex items-center gap-2 text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 upgrade-btn px-4 py-2 rounded-xl transition-all font-medium text-sm shadow-sm"
                                >
                                    <Users className="w-4 h-4 text-gray-500" />
                                    Walk-in
                                </button>

                                <button
                                    onClick={() => setShowNewBookingModal(true)}
                                    className="flex items-center gap-2 bg-[#0F172A] text-white px-5 py-2.5 rounded-xl hover:bg-black transition-all font-medium text-sm shadow-lg shadow-gray-200 active:transform active:scale-95"
                                >
                                    <Plus className="w-4 h-4" />
                                    <span>Nieuwe boeking</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>


                {/* Service Stats Bar - Quick Couverts Overview */}
                <div className="grid grid-cols-4 gap-3 mb-4">
                    <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl border border-amber-200 p-3 text-center">
                        <div className="text-2xl font-black text-amber-900">
                            {bookings.filter(b => b.status !== 'arrived' && b.status !== 'cancelled' && b.status !== 'walkin').reduce((sum, b) => sum + (b.guest_count || 0), 0)}
                        </div>
                        <div className="text-[10px] font-bold text-amber-600 uppercase">Verwacht</div>
                    </div>
                    <div className="bg-gradient-to-br from-emerald-50 to-green-50 rounded-xl border border-emerald-200 p-3 text-center">
                        <div className="text-2xl font-black text-emerald-900">
                            {bookings.filter(b => b.status === 'arrived').reduce((sum, b) => sum + (b.guest_count || 0), 0)}
                        </div>
                        <div className="text-[10px] font-bold text-emerald-600 uppercase">Binnen</div>
                    </div>
                    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-200 p-3 text-center">
                        <div className="text-2xl font-black text-blue-900">
                            {bookings.filter(b => b.status === 'walkin' || (b as any).is_walkin).reduce((sum, b) => sum + (b.guest_count || 0), 0)}
                        </div>
                        <div className="text-[10px] font-bold text-blue-600 uppercase">Walk-in</div>
                    </div>
                    <div className="bg-gradient-to-br from-purple-50 to-violet-50 rounded-xl border border-purple-200 p-3 text-center">
                        <div className="text-2xl font-black text-purple-900">
                            {bookings.filter(b => b.status === 'arrived' || b.status === 'walkin' || (b as any).is_walkin).reduce((sum, b) => sum + (b.guest_count || 0), 0)}
                        </div>
                        <div className="text-[10px] font-bold text-purple-600 uppercase">Totaal</div>
                    </div>
                </div>

                {/* Day notes display */}
                {
                    showDayNotes && (
                        <div className="mt-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium text-amber-800">📝 Dagnotities</span>
                            </div>
                            {dayNotes.map(note => (
                                <div key={note.id} className="flex items-center justify-between py-1">
                                    <span className="text-sm text-amber-900">{note.note}</span>
                                    <button
                                        onClick={() => deleteDayNote(note.id)}
                                        className="p-1 text-amber-600 hover:text-red-600"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </div>
                            ))}
                            <div className="flex gap-2 mt-2">
                                <input
                                    type="text"
                                    value={newNoteText}
                                    onChange={e => setNewNoteText(e.target.value)}
                                    placeholder="Nieuwe notitie..."
                                    className="flex-1 px-2 py-1 text-sm border border-amber-300 rounded"
                                    onKeyDown={e => e.key === 'Enter' && addDayNote()}
                                />
                                <button
                                    onClick={addDayNote}
                                    className="px-2 py-1 text-sm bg-amber-500 text-white rounded hover:bg-amber-600"
                                >
                                    Toevoegen
                                </button>
                            </div>
                        </div>
                    )
                }

                {/* Waitlist panel */}
                {
                    showWaitlistPanel && (
                        <div className="mt-2 p-3 bg-purple-50 rounded-lg border border-purple-200">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium text-purple-800">⏳ Wachtlijst</span>
                            </div>
                            {waitlist.length === 0 ? (
                                <p className="text-sm text-purple-600 italic">Geen gasten op de wachtlijst</p>
                            ) : (
                                <div className="space-y-2 mb-3">
                                    {waitlist.map(entry => (
                                        <div key={entry.id} className="flex items-center justify-between bg-white p-2 rounded border border-purple-100">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-sm">{entry.customer_name}</span>
                                                <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                                                    {entry.guest_count} pers.
                                                </span>
                                                {entry.preferred_time && (
                                                    <span className="text-xs text-gray-500">🕐 {entry.preferred_time}</span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => {
                                                        // Convert waitlist to booking
                                                        setQuickBookForm({
                                                            guest_count: entry.guest_count,
                                                            customer_name: entry.customer_name,
                                                            customer_phone: entry.customer_phone || '',
                                                            customer_email: '',
                                                            duration: 180,
                                                            remarks: entry.notes || ''
                                                        })
                                                        setShowNewBookingModal(true)
                                                        setWaitlist(prev => prev.filter(w => w.id !== entry.id))
                                                    }}
                                                    className="px-2 py-1 text-xs bg-emerald-500 text-white rounded hover:bg-emerald-600"
                                                >
                                                    Boeken
                                                </button>
                                                <button
                                                    onClick={async () => {
                                                        const token = localStorage.getItem('events_token')
                                                        try {
                                                            const res = await fetch(
                                                                `${API_BASE_URL}/api/restaurant/${restaurantId}/waitlist/${entry.id}`,
                                                                {
                                                                    method: 'DELETE',
                                                                    headers: { 'Authorization': `Bearer ${token}` }
                                                                }
                                                            )
                                                            if (res.ok) {
                                                                setWaitlist(prev => prev.filter(w => w.id !== entry.id))
                                                            }
                                                        } catch (e) {
                                                            console.error('Failed to delete from waitlist:', e)
                                                            setWaitlist(prev => prev.filter(w => w.id !== entry.id))
                                                        }
                                                    }}
                                                    className="p-1 text-purple-600 hover:text-red-600"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="grid grid-cols-4 gap-2">
                                <input
                                    type="text"
                                    value={waitlistForm.customer_name}
                                    onChange={e => setWaitlistForm(p => ({ ...p, customer_name: e.target.value }))}
                                    placeholder="Naam"
                                    className="px-2 py-1 text-sm border border-purple-300 rounded"
                                />
                                <input
                                    type="tel"
                                    value={waitlistForm.customer_phone}
                                    onChange={e => setWaitlistForm(p => ({ ...p, customer_phone: e.target.value }))}
                                    placeholder="Telefoon"
                                    className="px-2 py-1 text-sm border border-purple-300 rounded"
                                />
                                <select
                                    value={waitlistForm.guest_count}
                                    onChange={e => setWaitlistForm(p => ({ ...p, guest_count: parseInt(e.target.value) }))}
                                    className="px-2 py-1 text-sm border border-purple-300 rounded"
                                >
                                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => (
                                        <option key={n} value={n}>{n} pers.</option>
                                    ))}
                                </select>
                                <button
                                    onClick={async () => {
                                        if (waitlistForm.customer_name) {
                                            try {
                                                const res = await fetch(
                                                    `${API_BASE_URL}/api/restaurant/${restaurantId}/waitlist`,
                                                    {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({
                                                            date,
                                                            customer_name: waitlistForm.customer_name,
                                                            phone: waitlistForm.customer_phone,
                                                            guest_count: waitlistForm.guest_count,
                                                            time_preference: waitlistForm.preferred_time,
                                                            notes: waitlistForm.notes
                                                        })
                                                    }
                                                )
                                                if (res.ok) {
                                                    const data = await res.json()
                                                    setWaitlist(prev => [...prev, data.entry])
                                                    setWaitlistForm({
                                                        customer_name: '',
                                                        customer_phone: '',
                                                        guest_count: 2,
                                                        preferred_time: '',
                                                        notes: ''
                                                    })
                                                }
                                            } catch (e) {
                                                console.error('Failed to add to waitlist:', e)
                                            }
                                        }
                                    }}
                                    className="px-2 py-1 text-sm bg-purple-500 text-white rounded hover:bg-purple-600"
                                >
                                    Toevoegen
                                </button>
                            </div>
                        </div>
                    )
                }




                {/* Closed indicator */}
                {
                    !isOpenToday && (
                        <div className="px-4 py-3 bg-gray-100 text-center text-gray-500 font-medium">
                            🚫 Gesloten op deze dag
                        </div>
                    )
                }

                {/* Timeline Grid */}
                {
                    viewMode === 'week' ? (
                        /* Week View */
                        <div className="p-4">
                            <div className="grid grid-cols-7 gap-2">
                                {Array.from({ length: 7 }).map((_, i) => {
                                    const d = new Date(date)
                                    d.setDate(d.getDate() - d.getDay() + i + 1) // Start from Monday
                                    const dayStr = d.toISOString().split('T')[0]
                                    const isToday = dayStr === new Date().toISOString().split('T')[0]
                                    const isSelected = dayStr === date
                                    // Simulated count for demo - in production, fetch from API
                                    const dayBookings = bookings.filter(b =>
                                        b.status !== 'cancelled' &&
                                        new Date(b.start_time).toISOString().split('T')[0] === dayStr
                                    )
                                    const dayCouverts = dayBookings.reduce((s, b) => s + b.guest_count, 0)

                                    return (
                                        <div
                                            key={i}
                                            onClick={() => {
                                                setDate(dayStr)
                                                setViewMode('day')
                                            }}
                                            className={`p-3 rounded-lg border cursor-pointer transition-all hover:shadow-md ${isToday ? 'border-emerald-500 bg-emerald-50' :
                                                isSelected ? 'border-blue-500 bg-blue-50' :
                                                    'border-gray-200 bg-white hover:border-gray-300'
                                                }`}
                                        >
                                            <div className="text-xs font-medium text-gray-500 mb-1">
                                                {['Zo', 'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za'][(d.getDay())]}
                                            </div>
                                            <div className={`text-lg font-bold ${isToday ? 'text-emerald-700' : 'text-gray-900'}`}>
                                                {d.getDate()}
                                            </div>
                                            <div className="mt-2 space-y-1">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs text-gray-500">Boekingen</span>
                                                    <span className="text-sm font-bold text-emerald-600">{dayBookings.length || '-'}</span>
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs text-gray-500">Couverts</span>
                                                    <span className="text-sm font-bold text-blue-600">{dayCouverts || '-'}</span>
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                            <div className="mt-4 text-center text-sm text-gray-500">
                                Klik op een dag om de details te bekijken
                            </div>
                        </div>
                    ) : (
                        /* Day View */
                        <div className="overflow-x-auto">
                            <div className="min-w-[1000px]">
                                {/* Time Header */}
                                <div className="flex border-b-2 border-gray-300 sticky top-0 bg-white z-10">
                                    <div className="w-28 shrink-0 px-2 py-2 bg-gray-100 text-xs font-bold text-gray-600 uppercase border-r-2 border-gray-300 flex items-center">
                                        Tafel
                                    </div>
                                    <div className="flex-1 flex">
                                        {timeSlots.map((slot, i) => {
                                            const isFullHour = slot.endsWith(':00')
                                            return (
                                                <div
                                                    key={slot}
                                                    className={`w-[60px] shrink-0 px-1 py-2 text-center text-xs font-semibold border-l ${isFullHour ? 'border-gray-300 bg-gray-50 text-gray-800' : 'border-gray-100 text-gray-400'}`}
                                                >
                                                    {slot}
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>

                                {/* Table Rows */}
                                {loading ? (
                                    <div className="px-4 py-8 text-center text-gray-400">Laden...</div>
                                ) : tables.length === 0 ? (
                                    <div className="px-4 py-8 text-center text-gray-400">Geen tafels gevonden</div>
                                ) : (
                                    tables.map((table, tableIndex) => {
                                        const tableBookings = bookings.filter(b => b.table_id === table.id && b.status !== 'cancelled')
                                        return (
                                            <div
                                                key={table.id}
                                                className={`flex border-b border-gray-100 ${tableIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'} hover:bg-emerald-50/20 transition-colors`}
                                            >
                                                {/* Table Info */}
                                                <div className="w-28 shrink-0 px-2 py-1 flex items-center gap-1.5 border-r-2 border-gray-300 bg-gray-50/50">
                                                    <span className="font-semibold text-xs text-gray-900">{table.name}</span>
                                                    <span className="text-[10px] text-gray-400 bg-gray-200 px-1 py-0.5 rounded">{table.seats}p</span>
                                                </div>

                                                {/* Timeline */}
                                                <div className="flex-1 relative h-10">
                                                    {/* Clickable grid cells */}
                                                    <div className="absolute inset-0 flex">
                                                        {timeSlots.map((slot, i) => {
                                                            const available = isSlotAvailable(table, slot)
                                                            const isFullHour = slot.endsWith(':00')
                                                            return (
                                                                <div
                                                                    key={i}
                                                                    onClick={() => available && handleCellClick(table, slot)}
                                                                    className={`w-[60px] shrink-0 border-l ${isFullHour ? 'border-gray-300' : 'border-gray-100'} transition-colors ${available
                                                                        ? 'hover:bg-emerald-100 cursor-pointer'
                                                                        : 'bg-red-50/40 cursor-not-allowed'
                                                                        }`}
                                                                />
                                                            )
                                                        })}
                                                    </div>

                                                    {/* Bookings */}
                                                    {tableBookings.map(booking => {
                                                        const statusConfig = STATUS_COLORS[booking.status as keyof typeof STATUS_COLORS] || STATUS_COLORS.confirmed
                                                        // Check if this booking is part of a multi-table group
                                                        const isGrouped = booking.group_id && bookings.filter(b => b.group_id === booking.group_id).length > 1
                                                        const groupSiblings = isGrouped ? bookings.filter(b => b.group_id === booking.group_id) : []
                                                        const groupTableCount = groupSiblings.length
                                                        const totalGroupGuests = isGrouped ? groupSiblings[0]?.guest_count || booking.guest_count : booking.guest_count
                                                        return (
                                                            <div
                                                                key={booking.id}
                                                                style={getBookingStyle(booking)}
                                                                onClick={() => setShowBookingDetail(booking)}
                                                                className={`absolute top-0.5 bottom-0.5 ${statusConfig.bg} ${statusConfig.hover} rounded px-1.5 py-0 cursor-pointer transition-all shadow-sm hover:shadow-md overflow-hidden z-10 flex items-center ${isGrouped ? 'ring-1 ring-white/50' : ''}`}
                                                                title={`${booking.customer_name} - ${totalGroupGuests} pers.${isGrouped ? ` (${groupTableCount} tafels)` : ''}`}
                                                            >
                                                                <div className="flex items-center gap-0.5 text-white text-[11px] font-medium leading-none">
                                                                    <StatusIcon status={booking.status} />
                                                                    {booking.is_primary || !isGrouped ? (
                                                                        <span className="truncate">{totalGroupGuests}p {booking.customer_name}</span>
                                                                    ) : (
                                                                        <span className="truncate">🔗 {booking.customer_name}</span>
                                                                    )}
                                                                    {isGrouped && booking.is_primary && (
                                                                        <span className="shrink-0 bg-white/20 px-1 rounded text-[9px]" title={booking.linked_tables || ''}>🔗{booking.linked_tables ? ` ${booking.linked_tables}` : groupTableCount}</span>
                                                                    )}
                                                                    {Number(booking.visit_count) > 0 && <span>⭐</span>}
                                                                </div>
                                                                {booking.dietary_notes && (
                                                                    <div className="text-white/70 text-[10px] truncate">
                                                                        ⚠️ {booking.dietary_notes}
                                                                    </div>
                                                                )}
                                                                {(booking.customer_visits && booking.customer_visits > 1) && (
                                                                    <Star className="absolute top-0.5 right-0.5 w-3 h-3 text-yellow-300" />
                                                                )}
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        )
                                    })
                                )}
                            </div>
                        </div>
                    )
                }

                {/* Legend */}
                <div className="px-4 py-2 border-t border-gray-200 flex items-center gap-4 text-xs text-gray-500">
                    <span className="font-medium">Status:</span>
                    {Object.entries(STATUS_COLORS).map(([key, val]) => (
                        <div key={key} className="flex items-center gap-1">
                            <div className={`w-3 h-3 rounded ${val.bg}`} />
                            <span>{val.text}</span>
                        </div>
                    ))}
                </div>
            </div >

            {/* Quick Book Modal */}
            {
                showQuickBookModal && quickBookData && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-xl max-w-sm w-full p-4 shadow-xl">
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <h3 className="font-semibold text-gray-900">Snelle boeking</h3>
                                    <p className="text-sm text-gray-500">{quickBookData.table.name} om {quickBookData.time}</p>
                                </div>
                                <button onClick={() => setShowQuickBookModal(false)} className="p-1 hover:bg-gray-100 rounded">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="space-y-3">
                                <div className="flex gap-2">
                                    <div className="flex-1">
                                        <label className="text-xs text-gray-500">Gasten</label>
                                        <input
                                            type="number"
                                            min="1"
                                            value={quickBookForm.guest_count}
                                            onChange={e => setQuickBookForm(f => ({ ...f, guest_count: Math.max(1, Number(e.target.value) || 1) }))}
                                            className="w-full px-2 py-1.5 border rounded text-sm"
                                        />
                                    </div>
                                    <div className="flex-1">
                                        <label className="text-xs text-gray-500">Duur</label>
                                        <select
                                            value={quickBookForm.duration}
                                            onChange={e => setQuickBookForm(f => ({ ...f, duration: Number(e.target.value) }))}
                                            className="w-full px-2 py-1.5 border rounded text-sm"
                                        >
                                            <option value={60}>1 uur</option>
                                            <option value={90}>1.5 uur</option>
                                            <option value={120}>2 uur</option>
                                            <option value={150}>2.5 uur</option>
                                            <option value={180}>3 uur</option>
                                            <option value={210}>3.5 uur</option>
                                            <option value={240}>4 uur</option>
                                            <option value={300}>5 uur</option>
                                            <option value={360}>6 uur</option>
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-xs text-gray-500">Naam *</label>
                                    <input
                                        type="text"
                                        value={quickBookForm.customer_name}
                                        onChange={e => {
                                            setQuickBookForm(f => ({ ...f, customer_name: e.target.value }))
                                            searchCustomers(e.target.value)
                                        }}
                                        className="w-full px-2 py-1.5 border rounded text-sm"
                                        placeholder="Naam gast"
                                        autoFocus
                                    />
                                    {customerSearchResults.length > 0 && (
                                        <div className="mt-1 bg-white border rounded shadow-lg max-h-32 overflow-y-auto">
                                            {customerSearchResults.map(c => (
                                                <button
                                                    key={c.id}
                                                    onClick={() => {
                                                        setQuickBookForm(f => ({
                                                            ...f,
                                                            customer_name: c.name,
                                                            customer_email: c.email || '',
                                                            customer_phone: c.phone || ''
                                                        }))
                                                        setCustomerSearchResults([])
                                                    }}
                                                    className="w-full px-2 py-1.5 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                                                >
                                                    <span>{c.name}</span>
                                                    {c.total_visits > 1 && (
                                                        <span className="text-xs text-amber-600">🌟 {c.total_visits}x</span>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-xs text-gray-500">Telefoon</label>
                                        <input
                                            type="tel"
                                            value={quickBookForm.customer_phone}
                                            onChange={e => setQuickBookForm(f => ({ ...f, customer_phone: e.target.value }))}
                                            className="w-full px-2 py-1.5 border rounded text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-500">Email</label>
                                        <input
                                            type="email"
                                            value={quickBookForm.customer_email}
                                            onChange={e => setQuickBookForm(f => ({ ...f, customer_email: e.target.value }))}
                                            className="w-full px-2 py-1.5 border rounded text-sm"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="text-xs text-gray-500">Opmerking</label>
                                    <input
                                        type="text"
                                        value={quickBookForm.remarks}
                                        onChange={e => setQuickBookForm(f => ({ ...f, remarks: e.target.value }))}
                                        className="w-full px-2 py-1.5 border rounded text-sm"
                                        placeholder="Allergie, verjaardag, etc."
                                    />
                                </div>
                            </div>

                            <div className="flex gap-2 mt-4">
                                <button
                                    onClick={() => setShowQuickBookModal(false)}
                                    className="flex-1 px-3 py-2 border rounded-lg text-sm hover:bg-gray-50"
                                >
                                    Annuleren
                                </button>
                                <button
                                    onClick={submitQuickBook}
                                    disabled={!quickBookForm.customer_name || isSubmitting}
                                    className="flex-1 px-3 py-2 bg-emerald-500 text-white rounded-lg text-sm hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isSubmitting ? 'Bezig...' : 'Boeken'}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Walk-in Modal */}
            {
                showWalkinModal && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-xl max-w-md w-full p-4 shadow-xl">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                                    <Users className="w-5 h-5 text-blue-500" />
                                    Walk-in
                                </h3>
                                <button onClick={() => setShowWalkinModal(false)} className="p-1 hover:bg-gray-100 rounded">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="space-y-3">
                                <div>
                                    <label className="text-xs text-gray-500">Aantal gasten</label>
                                    <div className="grid grid-cols-6 gap-2 mt-1">
                                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => (
                                            <button
                                                key={n}
                                                onClick={() => setWalkinForm(f => ({ ...f, guest_count: n, table_id: '' }))}
                                                className={`py-2 rounded-lg text-sm font-medium transition-colors ${walkinForm.guest_count === n
                                                    ? 'bg-blue-500 text-white'
                                                    : 'bg-gray-100 hover:bg-gray-200'
                                                    }`}
                                            >
                                                {n}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Smart allocation preview */}
                                {(() => {
                                    const allocation = findBestTables(walkinForm.guest_count)
                                    if (allocation && allocation.tables.length > 0) {
                                        return (
                                            <div className={`p-2 rounded-lg text-sm ${allocation.tables.length > 1 ? 'bg-purple-50 border border-purple-200' : 'bg-emerald-50 border border-emerald-200'}`}>
                                                <div className="font-medium text-gray-700">
                                                    {allocation.tables.length > 1 ? '🔗 Gekoppelde tafels:' : '✅ Beschikbaar:'}
                                                </div>
                                                <div className="text-gray-600">
                                                    {allocation.tables.map(t => t.name).join(' + ')} ({allocation.totalSeats} stoelen)
                                                </div>
                                            </div>
                                        )
                                    }
                                    return (
                                        <div className="p-2 rounded-lg text-sm bg-red-50 border border-red-200 text-red-700">
                                            ❌ Geen beschikbare tafels voor {walkinForm.guest_count} gasten
                                        </div>
                                    )
                                })()}

                                <div>
                                    <label className="text-xs text-gray-500">Naam (optioneel)</label>
                                    <input
                                        type="text"
                                        value={walkinForm.customer_name}
                                        onChange={e => setWalkinForm(f => ({ ...f, customer_name: e.target.value }))}
                                        className="w-full px-2 py-1.5 border rounded text-sm"
                                        placeholder="Walk-in gast"
                                    />
                                </div>

                                <div>
                                    <label className="text-xs text-gray-500">Tafel (auto-select indien leeg)</label>
                                    <select
                                        value={walkinForm.table_id}
                                        onChange={e => setWalkinForm(f => ({ ...f, table_id: e.target.value }))}
                                        className="w-full px-2 py-1.5 border rounded text-sm"
                                    >
                                        <option value="">Automatisch kiezen</option>
                                        {tables
                                            .filter(t => t.seats >= walkinForm.guest_count)
                                            .map(t => (
                                                <option key={t.id} value={t.id}>{t.name} ({t.seats} pers.)</option>
                                            ))
                                        }
                                    </select>
                                </div>
                            </div>

                            <button
                                onClick={submitWalkin}
                                disabled={isSubmitting || !walkinForm.customer_name}
                                className="w-full mt-4 px-3 py-2.5 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                <UserCheck className="w-4 h-4" />
                                {isSubmitting ? 'Bezig...' : 'Plaats direct'}
                            </button>
                        </div>
                    </div>
                )
            }

            {/* Booking Detail Modal */}
            {
                showBookingDetail && (() => {
                    // Multi-table group info
                    const isGrouped = showBookingDetail.group_id && bookings.filter(b => b.group_id === showBookingDetail.group_id).length > 1
                    const groupSiblings = isGrouped ? bookings.filter(b => b.group_id === showBookingDetail.group_id) : []

                    return (
                        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                            <div className="bg-white rounded-xl max-w-md w-full p-4 shadow-xl max-h-[85vh] overflow-y-auto">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="font-semibold text-gray-900">Boeking details</h3>
                                    <button onClick={() => setShowBookingDetail(null)} className="p-1 hover:bg-gray-100 rounded">
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>

                                <div className="space-y-3">
                                    {/* Guest info */}
                                    <div className="flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-full ${STATUS_COLORS[showBookingDetail.status as keyof typeof STATUS_COLORS]?.bg || 'bg-gray-400'} flex items-center justify-center text-white font-bold`}>
                                            {showBookingDetail.guest_count}
                                        </div>
                                        <div>
                                            <div className="font-medium text-gray-900">{showBookingDetail.customer_name}</div>
                                            <div className="text-sm text-gray-500">
                                                {fmtTime(showBookingDetail.start_time)} - {fmtTime(showBookingDetail.end_time)}
                                            </div>
                                        </div>
                                        {Number(showBookingDetail.visit_count) > 0 && (
                                            <div className="ml-auto bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1">
                                                🌟 {showBookingDetail.visit_count}x eerder
                                            </div>
                                        )}
                                    </div>

                                    {/* Multi-table indicator */}
                                    {(showBookingDetail.linked_tables || isGrouped) && (
                                        <div className="p-2 bg-blue-50 rounded-lg text-sm text-blue-800 flex items-center gap-2">
                                            🔗 Groepsboeking: {showBookingDetail.table_name}{showBookingDetail.linked_tables ? ` + ${showBookingDetail.linked_tables}` : ''}
                                        </div>
                                    )}

                                    {showBookingDetail.customer_phone && (
                                        <a href={`tel:${showBookingDetail.customer_phone}`} className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                                            <Phone className="w-4 h-4" />
                                            {showBookingDetail.customer_phone}
                                        </a>
                                    )}

                                    {showBookingDetail.customer_email && (
                                        <a href={`mailto:${showBookingDetail.customer_email}`} className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                                            <Mail className="w-4 h-4" />
                                            {showBookingDetail.customer_email}
                                        </a>
                                    )}

                                    {showBookingDetail.remarks && (
                                        <div className="p-2 bg-amber-50 rounded-lg text-sm text-amber-800">
                                            📝 {showBookingDetail.remarks}
                                        </div>
                                    )}

                                    {showBookingDetail.dietary_notes && (
                                        <div className="p-2 bg-red-50 rounded-lg text-sm text-red-800">
                                            ⚠️ {showBookingDetail.dietary_notes}
                                        </div>
                                    )}

                                    {/* Customer History - fetched inline */}
                                    {(showBookingDetail.customer_email || showBookingDetail.customer_id) && (
                                        <CustomerHistory
                                            email={showBookingDetail.customer_email}
                                            customerId={showBookingDetail.customer_id}
                                            currentBookingId={showBookingDetail.id}
                                        />
                                    )}

                                    {/* Edit button */}
                                    <div className="border-t pt-3">
                                        <button
                                            onClick={() => {
                                                const b = showBookingDetail
                                                const startMins = parseInt(b.start_time.split(':')[0]) * 60 + parseInt(b.start_time.split(':')[1])
                                                const endMins = parseInt(b.end_time.split(':')[0]) * 60 + parseInt(b.end_time.split(':')[1])
                                                setEditForm({
                                                    guest_count: b.guest_count,
                                                    customer_name: b.customer_name,
                                                    customer_phone: b.customer_phone || '',
                                                    customer_email: b.customer_email || '',
                                                    remarks: b.remarks || '',
                                                    time: b.start_time,
                                                    duration: endMins - startMins
                                                })
                                                setEditingBooking(b)
                                                setShowBookingDetail(null)
                                            }}
                                            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 mb-3"
                                        >
                                            <Edit3 className="w-4 h-4" />
                                            Boeking bewerken
                                        </button>
                                    </div>

                                    {/* Status buttons */}
                                    <div className="border-t pt-3">
                                        <label className="text-xs text-gray-500 block mb-2">Status wijzigen</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                onClick={() => updateBookingStatus(showBookingDetail.id, 'arrived')}
                                                className="flex items-center justify-center gap-2 px-3 py-2 bg-amber-500 text-white rounded-lg text-sm hover:bg-amber-600"
                                            >
                                                <UserCheck className="w-4 h-4" />
                                                Gearriveerd
                                            </button>
                                            <button
                                                onClick={() => setConfirmDialog({
                                                    message: 'Weet je zeker dat je deze boeking als No-show wilt markeren?',
                                                    action: () => {
                                                        updateBookingStatus(showBookingDetail.id, 'no_show')
                                                        setConfirmDialog(null)
                                                    },
                                                    type: 'warning'
                                                })}
                                                className="flex items-center justify-center gap-2 px-3 py-2 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600"
                                            >
                                                <UserX className="w-4 h-4" />
                                                No-show
                                            </button>
                                            <button
                                                onClick={() => updateBookingStatus(showBookingDetail.id, 'confirmed')}
                                                className="flex items-center justify-center gap-2 px-3 py-2 bg-emerald-500 text-white rounded-lg text-sm hover:bg-emerald-600"
                                            >
                                                <Check className="w-4 h-4" />
                                                Bevestigd
                                            </button>
                                            <button
                                                onClick={() => setConfirmDialog({
                                                    message: 'Weet je zeker dat je deze boeking wilt annuleren?',
                                                    action: () => {
                                                        updateBookingStatus(showBookingDetail.id, 'cancelled')
                                                        setConfirmDialog(null)
                                                    },
                                                    type: 'danger'
                                                })}
                                                className="flex items-center justify-center gap-2 px-3 py-2 bg-gray-500 text-white rounded-lg text-sm hover:bg-gray-600"
                                            >
                                                <X className="w-4 h-4" />
                                                Annuleren
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )
                })()
            }

            {/* Edit Booking Modal */}
            {
                editingBooking && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-xl max-w-md w-full p-4 shadow-xl max-h-[85vh] overflow-y-auto">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                                    <Edit3 className="w-5 h-5 text-blue-500" />
                                    Boeking bewerken
                                </h3>
                                <button onClick={() => setEditingBooking(null)} className="p-1 hover:bg-gray-100 rounded">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="space-y-3">
                                <div className="flex gap-2">
                                    <div className="flex-1">
                                        <label className="text-xs text-gray-500">Gasten</label>
                                        <input
                                            type="number"
                                            min="1"
                                            value={editForm.guest_count}
                                            onChange={e => setEditForm(f => ({ ...f, guest_count: Math.max(1, Number(e.target.value) || 1) }))}
                                            className="w-full px-2 py-1.5 border rounded text-sm"
                                        />
                                    </div>
                                    <div className="flex-1">
                                        <label className="text-xs text-gray-500">Tijd</label>
                                        <input
                                            type="time"
                                            value={editForm.time}
                                            onChange={e => setEditForm(f => ({ ...f, time: e.target.value }))}
                                            className="w-full px-2 py-1.5 border rounded text-sm"
                                        />
                                    </div>
                                    <div className="flex-1">
                                        <label className="text-xs text-gray-500">Duur</label>
                                        <select
                                            value={editForm.duration}
                                            onChange={e => setEditForm(f => ({ ...f, duration: Number(e.target.value) }))}
                                            className="w-full px-2 py-1.5 border rounded text-sm"
                                        >
                                            <option value={60}>1 uur</option>
                                            <option value={90}>1.5 uur</option>
                                            <option value={120}>2 uur</option>
                                            <option value={150}>2.5 uur</option>
                                            <option value={180}>3 uur</option>
                                            <option value={210}>3.5 uur</option>
                                            <option value={240}>4 uur</option>
                                            <option value={300}>5 uur</option>
                                            <option value={360}>6 uur</option>
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-xs text-gray-500">Naam *</label>
                                    <input
                                        type="text"
                                        value={editForm.customer_name}
                                        onChange={e => setEditForm(f => ({ ...f, customer_name: e.target.value }))}
                                        className="w-full px-2 py-1.5 border rounded text-sm"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-xs text-gray-500">Telefoon</label>
                                        <input
                                            type="tel"
                                            value={editForm.customer_phone}
                                            onChange={e => setEditForm(f => ({ ...f, customer_phone: e.target.value }))}
                                            className="w-full px-2 py-1.5 border rounded text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-500">Email</label>
                                        <input
                                            type="email"
                                            value={editForm.customer_email}
                                            onChange={e => setEditForm(f => ({ ...f, customer_email: e.target.value }))}
                                            className="w-full px-2 py-1.5 border rounded text-sm"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="text-xs text-gray-500">Opmerkingen</label>
                                    <textarea
                                        value={editForm.remarks}
                                        onChange={e => setEditForm(f => ({ ...f, remarks: e.target.value }))}
                                        className="w-full px-2 py-1.5 border rounded text-sm h-16 resize-none"
                                    />
                                </div>

                                <button
                                    onClick={async () => {
                                        if (!editForm.customer_name || isSubmitting) return
                                        setIsSubmitting(true)
                                        try {
                                            const token = localStorage.getItem('events_token')
                                            const [h, m] = editForm.time.split(':').map(Number)
                                            const endMins = h * 60 + m + editForm.duration
                                            const endTime = `${Math.floor(endMins / 60).toString().padStart(2, '0')}:${(endMins % 60).toString().padStart(2, '0')}`

                                            const res = await fetch(`${API_BASE_URL}/api/admin/restaurant-bookings/${editingBooking.id}`, {
                                                method: 'PATCH',
                                                headers: {
                                                    'Content-Type': 'application/json',
                                                    'Authorization': `Bearer ${token}`
                                                },
                                                body: JSON.stringify({
                                                    restaurantId,
                                                    guest_count: editForm.guest_count,
                                                    customer_name: editForm.customer_name,
                                                    customer_phone: editForm.customer_phone,
                                                    customer_email: editForm.customer_email,
                                                    remarks: editForm.remarks,
                                                    time: editForm.time,
                                                    end_time: endTime,
                                                    date
                                                })
                                            })

                                            if (res.ok) {
                                                setEditingBooking(null)
                                                showToast('Boeking succesvol bijgewerkt', 'success')
                                                fetchData()
                                            } else {
                                                const err = await res.json().catch(() => null)
                                                showToast(err?.error || 'Bewerken mislukt', 'error')
                                            }
                                        } catch (e) {
                                            console.error('Failed to edit booking:', e)
                                            showToast('Bewerken mislukt', 'error')
                                        } finally {
                                            setIsSubmitting(false)
                                        }
                                    }}
                                    disabled={!editForm.customer_name || isSubmitting}
                                    className="w-full py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {isSubmitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                    Opslaan
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* New Booking Modal (Full Widget) */}
            {
                showNewBookingModal && (
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
                )
            }

            {/* Toast Notification */}
            {
                toast && (
                    <div className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-in slide-in-from-bottom-4 ${toast.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'
                        }`}>
                        {toast.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                        {toast.message}
                    </div>
                )
            }

            {/* Confirmation Dialog */}
            {
                confirmDialog && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-xl max-w-sm w-full p-5 shadow-xl">
                            <h3 className="font-semibold text-gray-900 mb-3">Bevestigen</h3>
                            <p className="text-gray-600 mb-5">{confirmDialog.message}</p>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setConfirmDialog(null)}
                                    className="flex-1 px-4 py-2 border rounded-lg text-sm hover:bg-gray-50"
                                >
                                    Annuleren
                                </button>
                                <button
                                    onClick={confirmDialog.action}
                                    className={`flex-1 px-4 py-2 text-white rounded-lg text-sm ${confirmDialog.type === 'danger' ? 'bg-red-500 hover:bg-red-600' : 'bg-amber-500 hover:bg-amber-600'
                                        }`}
                                >
                                    Bevestigen
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
        </>
    )
}
