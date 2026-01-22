import React, { useEffect, useMemo, useState } from "react"
import { fetchBookings, cancelBooking, bookTable, fetchAdminData, RESTAURANT_ID } from "../api"
import { Search, RefreshCw, Download, X, AlertTriangle, Plus } from "lucide-react"

const TZ = "Europe/Amsterdam"

// Types for admin data (events & slots)
type AdminSlot = {
    id: string
    date: string
    time: string
    start_datetime: string
    wijkId: string
    booked2tops: number
    booked4tops: number
    booked6tops: number
}

type AdminEvent = {
    id: string
    title: string
    description?: string | null
    slots: AdminSlot[]
}

type AdminZone = {
    id: string
    name: string
    count2tops: number
    count4tops: number
    count6tops: number
}

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

type BookingsResponse = {
    bookings: BookingRow[]
    total: number
    limit: number
    offset: number
}

function fmtDate(dIso: string) {
    const d = new Date(dIso)
    return new Intl.DateTimeFormat("nl-NL", {
        timeZone: TZ,
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    }).format(d)
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

function toCsv(rows: BookingRow[]) {
    const headers = [
        "Datum",
        "Tijd",
        "Naam",
        "Aantal",
        "Tafel",
        "Event",
        "Zone",
        "Status",
        "E-mail",
        "Telefoon",
        "Opmerkingen",
        "Booking ID",
    ]

    const esc = (v: any) => {
        const s = String(v ?? "")
        if (s.includes('"') || s.includes(",") || s.includes("\n")) return `"${s.replaceAll('"', '""')}"`
        return s
    }

    const lines = [
        headers.join(","),
        ...rows.map((r) =>
            [
                fmtDate(r.start_datetime),
                fmtTime(r.start_datetime),
                r.customer_name,
                r.guest_count,
                r.table_type,
                r.event_title,
                r.zone_name,
                r.status === "confirmed" ? "Bevestigd" : "Geannuleerd",
                r.customer_email ?? "",
                r.customer_phone ?? "",
                r.remarks ?? "",
                r.id,
            ].map(esc).join(",")
        ),
    ]
    return lines.join("\n")
}

export const BookingsManager: React.FC<{ restaurantId?: string }> = ({ restaurantId = RESTAURANT_ID }) => {
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [rows, setRows] = useState<BookingRow[]>([])
    const [total, setTotal] = useState(0)

    // Filters
    const [q, setQ] = useState("")
    const [status, setStatus] = useState<"confirmed" | "cancelled" | "all">("confirmed")
    const [from, setFrom] = useState("") // YYYY-MM-DD
    const [to, setTo] = useState("") // YYYY-MM-DD
    const [limit] = useState(200)
    const [offset, setOffset] = useState(0)

    const [selected, setSelected] = useState<BookingRow | null>(null)
    const [isCancelling, setIsCancelling] = useState(false)

    // Sorting
    type SortOption = "recent" | "date" | "event"
    const [sortBy, setSortBy] = useState<SortOption>("recent")

    // NEW BOOKING MODAL STATE
    const [showNewBooking, setShowNewBooking] = useState(false)
    const [adminEvents, setAdminEvents] = useState<AdminEvent[]>([])
    const [adminZones, setAdminZones] = useState<AdminZone[]>([])
    const [loadingAdmin, setLoadingAdmin] = useState(false)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)

    // Form fields for new booking
    const [newBooking, setNewBooking] = useState({
        slotId: "",
        eventId: "",
        tableType: "2" as "2" | "4" | "6",
        guestCount: 2,
        customerName: "",
        customerEmail: "",
        customerPhone: "",
        remarks: ""
    })

    // Load admin data (events & slots) when modal opens
    const loadAdminData = async () => {
        setLoadingAdmin(true)
        try {
            const data = await fetchAdminData(restaurantId)
            setAdminEvents(data.events || [])
            setAdminZones(data.zones || [])
        } catch (e: any) {
            setSubmitError("Kon events niet laden: " + (e?.message || "Onbekende fout"))
        } finally {
            setLoadingAdmin(false)
        }
    }

    // Open new booking modal
    const openNewBookingModal = () => {
        setShowNewBooking(true)
        setSubmitError(null)
        setNewBooking({
            slotId: "",
            eventId: "",
            tableType: "2",
            guestCount: 2,
            customerName: "",
            customerEmail: "",
            customerPhone: "",
            remarks: ""
        })
        loadAdminData()
    }

    // Get available slots for selected event
    const selectedEventSlots = useMemo(() => {
        if (!newBooking.eventId) return []
        const event = adminEvents.find(e => e.id === newBooking.eventId)
        return event?.slots || []
    }, [adminEvents, newBooking.eventId])

    // Get zone name for a slot
    const getZoneName = (zoneId: string) => {
        const zone = adminZones.find(z => z.id === zoneId)
        return zone?.name || "Onbekend"
    }

    // Get zone capacity for table type
    const getZoneCapacity = (zoneId: string, tableType: "2" | "4" | "6") => {
        const zone = adminZones.find(z => z.id === zoneId)
        if (!zone) return 0
        switch (tableType) {
            case "2": return zone.count2tops
            case "4": return zone.count4tops
            case "6": return zone.count6tops
            default: return 0
        }
    }

    // Check if slot has capacity for the selected table type
    const slotHasCapacity = (slot: AdminSlot, tableType: "2" | "4" | "6") => {
        const capacity = getZoneCapacity(slot.wijkId, tableType)
        switch (tableType) {
            case "2": return slot.booked2tops < capacity
            case "4": return slot.booked4tops < capacity
            case "6": return slot.booked6tops < capacity
            default: return false
        }
    }

    // Submit new booking
    const handleSubmitNewBooking = async () => {
        if (!newBooking.slotId || !newBooking.customerName.trim()) {
            setSubmitError("Selecteer een slot en voer een naam in.")
            return
        }
        setIsSubmitting(true)
        setSubmitError(null)
        try {
            await bookTable({
                slot_id: newBooking.slotId,
                table_type: newBooking.tableType,
                guest_count: newBooking.guestCount,
                customer_name: newBooking.customerName.trim(),
                customer_email: newBooking.customerEmail.trim() || undefined,
                customer_phone: newBooking.customerPhone.trim() || undefined,
                remarks: newBooking.remarks.trim() || undefined,
            })
            setShowNewBooking(false)
            await fetchData()
        } catch (e: any) {
            setSubmitError(e?.message || "Boeking mislukt.")
        } finally {
            setIsSubmitting(false)
        }
    }

    const fetchData = async () => {
        setLoading(true)
        setError(null)
        try {
            const res: BookingsResponse = await fetchBookings({
                restaurantId,
                q: q.trim() || undefined,
                status: status === "all" ? null : status,
                from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
                to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
                limit,
                offset,
            })

            setRows(res.bookings || [])
            setTotal(res.total || 0)
        } catch (e: any) {
            setError(e?.message || "Kon boekingen niet laden.")
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchData()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [restaurantId, status, from, to, offset])

    // Debounced search
    useEffect(() => {
        const t = setTimeout(() => {
            setOffset(0)
            fetchData()
        }, 350)
        return () => clearTimeout(t)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [q])

    const pageInfo = useMemo(() => {
        const start = Math.min(total, offset + 1)
        const end = Math.min(total, offset + rows.length)
        return { start, end }
    }, [total, offset, rows.length])

    // Sorted rows based on sortBy
    const sortedRows = useMemo(() => {
        const sorted = [...rows]
        switch (sortBy) {
            case "recent":
                // Sort by created_at descending (newest first)
                return sorted.sort((a, b) =>
                    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                )
            case "date":
                // Sort by start_datetime ascending (earliest first)
                return sorted.sort((a, b) =>
                    new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime()
                )
            case "event":
                // Sort by event title alphabetically, then by date
                return sorted.sort((a, b) => {
                    const eventCompare = a.event_title.localeCompare(b.event_title)
                    if (eventCompare !== 0) return eventCompare
                    return new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime()
                })
            default:
                return sorted
        }
    }, [rows, sortBy])

    const handleExport = () => {
        const csv = toCsv(sortedRows)
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `boekingen_${restaurantId}_${new Date().toISOString().slice(0, 10)}.csv`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        window.URL.revokeObjectURL(url)
    }

    const handleCancel = async (bookingId: string) => {
        setIsCancelling(true)
        try {
            await cancelBooking(bookingId)
            setSelected(null)
            await fetchData()
        } catch (e: any) {
            setError(e?.message || "Annuleren mislukt.")
        } finally {
            setIsCancelling(false)
        }
    }

    return (
        <div className="w-full max-w-6xl mx-auto p-6">
            <div className="flex items-start justify-between gap-4 mb-5">
                <div>
                    <h2 className="text-2xl font-extrabold text-gray-900">Boekingen</h2>
                    <div className="text-sm text-gray-500 mt-1">
                        Overzicht van reserveringen (datum/tijd in {TZ}).
                    </div>
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={openNewBookingModal}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white font-extrabold"
                    >
                        <Plus className="w-4 h-4" />
                        Nieuwe Boeking
                    </button>
                    <button
                        onClick={fetchData}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 font-semibold text-gray-800"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Vernieuwen
                    </button>
                    <button
                        onClick={handleExport}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#c9a227] hover:bg-[#d4af37] text-[#0b0b0b] font-extrabold"
                    >
                        <Download className="w-4 h-4" />
                        CSV export
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div className="md:col-span-2">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Zoeken</label>
                        <div className="mt-1 flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-2 bg-gray-50">
                            <Search className="w-4 h-4 text-gray-500" />
                            <input
                                value={q}
                                onChange={(e) => setQ(e.target.value)}
                                placeholder="Naam, e-mail, telefoon, opmerking…"
                                className="w-full bg-transparent outline-none text-sm"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-semibold text-gray-500 uppercase">Status</label>
                        <select
                            value={status}
                            onChange={(e) => { setOffset(0); setStatus(e.target.value as any) }}
                            className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 bg-white text-sm font-semibold"
                        >
                            <option value="confirmed">Bevestigd</option>
                            <option value="cancelled">Geannuleerd</option>
                            <option value="all">Alles</option>
                        </select>
                    </div>

                    <div>
                        <label className="text-xs font-semibold text-gray-500 uppercase">Sorteer op</label>
                        <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value as SortOption)}
                            className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 bg-white text-sm font-semibold"
                        >
                            <option value="recent">Nieuwste eerst</option>
                            <option value="date">Datum (vroegste)</option>
                            <option value="event">Event (A-Z)</option>
                        </select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-semibold text-gray-500 uppercase">Vanaf</label>
                            <input
                                type="date"
                                value={from}
                                onChange={(e) => { setOffset(0); setFrom(e.target.value) }}
                                className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 bg-white text-sm font-semibold"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-gray-500 uppercase">Tot</label>
                            <input
                                type="date"
                                value={to}
                                onChange={(e) => { setOffset(0); setTo(e.target.value) }}
                                className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 bg-white text-sm font-semibold"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Status / error */}
            {error && (
                <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex items-start gap-3">
                    <AlertTriangle className="w-4 h-4 mt-0.5" />
                    <div>{error}</div>
                </div>
            )}

            {/* Table */}
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                    <div className="text-sm text-gray-600">
                        {loading ? "Laden…" : `Resultaten: ${pageInfo.start}-${pageInfo.end} van ${total}`}
                    </div>

                    <div className="flex gap-2">
                        <button
                            disabled={offset === 0 || loading}
                            onClick={() => setOffset(Math.max(0, offset - limit))}
                            className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-semibold disabled:opacity-50"
                        >
                            Vorige
                        </button>
                        <button
                            disabled={offset + rows.length >= total || loading}
                            onClick={() => setOffset(offset + limit)}
                            className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-semibold disabled:opacity-50"
                        >
                            Volgende
                        </button>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600">
                            <tr>
                                <th className="text-left px-4 py-3 font-extrabold">Datum</th>
                                <th className="text-left px-4 py-3 font-extrabold">Tijd</th>
                                <th className="text-left px-4 py-3 font-extrabold">Naam</th>
                                <th className="text-left px-4 py-3 font-extrabold">Aantal</th>
                                <th className="text-left px-4 py-3 font-extrabold">Tafel</th>
                                <th className="text-left px-4 py-3 font-extrabold">Event</th>
                                <th className="text-left px-4 py-3 font-extrabold">Zone</th>
                                <th className="text-left px-4 py-3 font-extrabold">Status</th>
                                <th className="text-right px-4 py-3 font-extrabold">Actie</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {loading ? (
                                <tr><td className="px-4 py-6 text-gray-500" colSpan={9}>Bezig met laden…</td></tr>
                            ) : sortedRows.length === 0 ? (
                                <tr><td className="px-4 py-6 text-gray-500" colSpan={9}>Geen boekingen gevonden.</td></tr>
                            ) : (
                                sortedRows.map((b) => (
                                    <tr key={b.id} className="hover:bg-gray-50">
                                        <td className="px-4 py-3 font-semibold text-gray-900">{fmtDate(b.start_datetime)}</td>
                                        <td className="px-4 py-3 font-mono text-gray-900">{fmtTime(b.start_datetime)}</td>
                                        <td className="px-4 py-3 text-gray-900 font-semibold">{b.customer_name}</td>
                                        <td className="px-4 py-3 text-gray-700">{b.guest_count}</td>
                                        <td className="px-4 py-3 text-gray-700">{b.table_type}</td>
                                        <td className="px-4 py-3 text-gray-700">{b.event_title}</td>
                                        <td className="px-4 py-3 text-gray-700">{b.zone_name}</td>
                                        <td className="px-4 py-3">
                                            <span className={[
                                                "inline-flex px-2 py-1 rounded-full text-xs font-extrabold border",
                                                b.status === "confirmed"
                                                    ? "bg-green-50 text-green-700 border-green-200"
                                                    : "bg-gray-100 text-gray-600 border-gray-200"
                                            ].join(" ")}>
                                                {b.status === "confirmed" ? "Bevestigd" : "Geannuleerd"}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <button
                                                onClick={() => setSelected(b)}
                                                className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 font-semibold"
                                            >
                                                Details
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Detail modal */}
            {selected && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full p-6 space-y-4">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="text-xs font-extrabold text-gray-500 uppercase">Boeking</div>
                                <div className="text-xl font-extrabold text-gray-900">{selected.customer_name}</div>
                                <div className="text-sm text-gray-600 mt-1">
                                    {fmtDate(selected.start_datetime)} om {fmtTime(selected.start_datetime)} • {selected.guest_count} pers • tafel {selected.table_type}
                                </div>
                            </div>
                            <button onClick={() => setSelected(null)} className="p-2 rounded-xl hover:bg-gray-100" aria-label="Sluiten">
                                <X className="w-5 h-5 text-gray-600" />
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="rounded-xl border border-gray-200 p-3">
                                <div className="text-xs font-extrabold text-gray-500 uppercase">Event</div>
                                <div className="font-semibold text-gray-900">{selected.event_title}</div>
                            </div>
                            <div className="rounded-xl border border-gray-200 p-3">
                                <div className="text-xs font-extrabold text-gray-500 uppercase">Zone</div>
                                <div className="font-semibold text-gray-900">{selected.zone_name}</div>
                            </div>
                            <div className="rounded-xl border border-gray-200 p-3">
                                <div className="text-xs font-extrabold text-gray-500 uppercase">E-mail</div>
                                <div className="font-semibold text-gray-900">{selected.customer_email || "—"}</div>
                            </div>
                            <div className="rounded-xl border border-gray-200 p-3">
                                <div className="text-xs font-extrabold text-gray-500 uppercase">Telefoon</div>
                                <div className="font-semibold text-gray-900">{selected.customer_phone || "—"}</div>
                            </div>
                        </div>

                        <div className="rounded-xl border border-gray-200 p-3">
                            <div className="text-xs font-extrabold text-gray-500 uppercase">Opmerkingen</div>
                            <div className="text-gray-900 font-semibold whitespace-pre-wrap">{selected.remarks || "—"}</div>
                        </div>

                        <div className="flex items-center justify-between pt-2">
                            <div className="text-xs text-gray-500">
                                Status: <span className="font-extrabold">{selected.status === "confirmed" ? "Bevestigd" : "Geannuleerd"}</span>
                            </div>

                            {selected.status === "confirmed" ? (
                                <button
                                    onClick={() => handleCancel(selected.id)}
                                    disabled={isCancelling}
                                    className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-extrabold disabled:opacity-60"
                                >
                                    {isCancelling ? "Bezig…" : "Annuleren"}
                                </button>
                            ) : (
                                <div className="text-sm font-semibold text-gray-500">Deze boeking is al geannuleerd.</div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* NEW BOOKING MODAL */}
            {showNewBooking && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="text-xs font-extrabold text-gray-500 uppercase">Nieuwe boeking</div>
                                <div className="text-xl font-extrabold text-gray-900">Handmatig toevoegen</div>
                            </div>
                            <button onClick={() => setShowNewBooking(false)} className="p-2 rounded-xl hover:bg-gray-100" aria-label="Sluiten">
                                <X className="w-5 h-5 text-gray-600" />
                            </button>
                        </div>

                        {loadingAdmin ? (
                            <div className="py-8 text-center text-gray-500">Laden...</div>
                        ) : (
                            <>
                                {/* Event Selection */}
                                <div>
                                    <label className="text-xs font-extrabold text-gray-500 uppercase">Event *</label>
                                    <select
                                        value={newBooking.eventId}
                                        onChange={(e) => setNewBooking({ ...newBooking, eventId: e.target.value, slotId: "" })}
                                        className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 bg-white text-sm font-semibold"
                                    >
                                        <option value="">— Selecteer event —</option>
                                        {adminEvents.map(event => (
                                            <option key={event.id} value={event.id}>{event.title}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* Slot Selection */}
                                {newBooking.eventId && (
                                    <div>
                                        <label className="text-xs font-extrabold text-gray-500 uppercase">Datum & Tijd *</label>
                                        <select
                                            value={newBooking.slotId}
                                            onChange={(e) => setNewBooking({ ...newBooking, slotId: e.target.value })}
                                            className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 bg-white text-sm font-semibold"
                                        >
                                            <option value="">— Selecteer slot —</option>
                                            {selectedEventSlots.map(slot => {
                                                const hasCapacity = slotHasCapacity(slot, newBooking.tableType)
                                                return (
                                                    <option
                                                        key={slot.id}
                                                        value={slot.id}
                                                        disabled={!hasCapacity}
                                                    >
                                                        {slot.date} {slot.time} • {getZoneName(slot.wijkId)}{!hasCapacity ? " (vol)" : ""}
                                                    </option>
                                                )
                                            })}
                                        </select>
                                    </div>
                                )}

                                {/* Table Type & Guest Count */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs font-extrabold text-gray-500 uppercase">Tafel</label>
                                        <select
                                            value={newBooking.tableType}
                                            onChange={(e) => {
                                                const tt = e.target.value as "2" | "4" | "6"
                                                // Reset slot if capacity changed
                                                setNewBooking({ ...newBooking, tableType: tt, slotId: "" })
                                            }}
                                            className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 bg-white text-sm font-semibold"
                                        >
                                            <option value="2">2-persoons</option>
                                            <option value="4">4-persoons</option>
                                            <option value="6">6-persoons</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs font-extrabold text-gray-500 uppercase">Aantal gasten</label>
                                        <input
                                            type="number"
                                            min={1}
                                            max={20}
                                            value={newBooking.guestCount}
                                            onChange={(e) => setNewBooking({ ...newBooking, guestCount: Math.max(1, Math.min(20, parseInt(e.target.value) || 1)) })}
                                            className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 bg-white text-sm font-semibold"
                                        />
                                    </div>
                                </div>

                                {/* Customer Name */}
                                <div>
                                    <label className="text-xs font-extrabold text-gray-500 uppercase">Naam *</label>
                                    <input
                                        type="text"
                                        value={newBooking.customerName}
                                        onChange={(e) => setNewBooking({ ...newBooking, customerName: e.target.value })}
                                        placeholder="Naam van de gast"
                                        className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 bg-white text-sm font-semibold"
                                    />
                                </div>

                                {/* Email & Phone */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs font-extrabold text-gray-500 uppercase">E-mail (optioneel)</label>
                                        <input
                                            type="email"
                                            value={newBooking.customerEmail}
                                            onChange={(e) => setNewBooking({ ...newBooking, customerEmail: e.target.value })}
                                            placeholder="email@voorbeeld.nl"
                                            className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 bg-white text-sm font-semibold"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-extrabold text-gray-500 uppercase">Telefoon (optioneel)</label>
                                        <input
                                            type="tel"
                                            value={newBooking.customerPhone}
                                            onChange={(e) => setNewBooking({ ...newBooking, customerPhone: e.target.value })}
                                            placeholder="06 12345678"
                                            className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 bg-white text-sm font-semibold"
                                        />
                                    </div>
                                </div>

                                {/* Remarks */}
                                <div>
                                    <label className="text-xs font-extrabold text-gray-500 uppercase">Opmerkingen (optioneel)</label>
                                    <textarea
                                        value={newBooking.remarks}
                                        onChange={(e) => setNewBooking({ ...newBooking, remarks: e.target.value })}
                                        placeholder="Speciale wensen, allergieën, etc."
                                        rows={2}
                                        className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 bg-white text-sm font-semibold resize-none"
                                    />
                                </div>

                                {/* Error Message */}
                                {submitError && (
                                    <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex items-start gap-2">
                                        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                        <div>{submitError}</div>
                                    </div>
                                )}

                                {/* Submit Button */}
                                <div className="flex justify-end pt-2">
                                    <button
                                        onClick={handleSubmitNewBooking}
                                        disabled={isSubmitting || !newBooking.slotId || !newBooking.customerName.trim()}
                                        className="px-6 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white font-extrabold disabled:opacity-60 disabled:cursor-not-allowed"
                                    >
                                        {isSubmitting ? "Bezig…" : "Boeking aanmaken"}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

