import React, { useEffect, useMemo, useState } from "react"
import { fetchBookings, cancelBooking, RESTAURANT_ID } from "../api"
import { Search, RefreshCw, Download, X, AlertTriangle } from "lucide-react"

const TZ = "Europe/Amsterdam"

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

    const handleExport = () => {
        const csv = toCsv(rows)
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
                            ) : rows.length === 0 ? (
                                <tr><td className="px-4 py-6 text-gray-500" colSpan={9}>Geen boekingen gevonden.</td></tr>
                            ) : (
                                rows.map((b) => (
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
        </div>
    )
}
