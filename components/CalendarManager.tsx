import React, { useMemo, useState } from "react"
import {
  Calendar,
  Clock,
  MapPin,
  ArrowUpRight,
  Download,
  Smartphone,
  Filter,
  Copy,
  Check,
  X,
  Users,
} from "lucide-react"
import { EventData, Wijk } from "../types"
import { generateICalData } from "../utils"
import { getCalendarUrl, RESTAURANT_ID } from "../api"

interface CalendarManagerProps {
  events: EventData[]
  wijken: Wijk[]
  restaurantId?: string
}

const TZ = "Europe/Amsterdam"

// YYYY-MM-DD in Amsterdam (stable grouping key)
function isoDateKeyAmsterdam(d: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d)

  const y = parts.find((p) => p.type === "year")?.value ?? "0000"
  const m = parts.find((p) => p.type === "month")?.value ?? "00"
  const day = parts.find((p) => p.type === "day")?.value ?? "00"
  return `${y}-${m}-${day}`
}

function labelDateDutch(d: Date) {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: TZ,
    weekday: "long",
    day: "2-digit",
    month: "long",
  }).format(d)
}

function labelTimeDutch(d: Date) {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d)
}

// Best effort slot -> Date
function getSlotDateObj(slot: any): Date | null {
  if (slot?.start_datetime) {
    const dt = new Date(slot.start_datetime)
    return isNaN(dt.getTime()) ? null : dt
  }

  // Fallback: try parse "YYYY-MM-DD" + "HH:mm"
  if (typeof slot?.date === "string" && typeof slot?.time === "string" && /^\d{4}-\d{2}-\d{2}$/.test(slot.date)) {
    const dt = new Date(`${slot.date}T${slot.time}:00`)
    return isNaN(dt.getTime()) ? null : dt
  }

  return null
}

export const CalendarManager: React.FC<CalendarManagerProps> = ({
  events,
  wijken,
  restaurantId = RESTAURANT_ID,
}) => {
  const [showSyncModal, setShowSyncModal] = useState(false)
  const [bookedOnly, setBookedOnly] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)
  const [selectedSlotDetails, setSelectedSlotDetails] = useState<any | null>(null)

  const allSlots = useMemo(() => {
    return events.flatMap((event) =>
      event.slots.map((slot: any) => {
        const wijk = wijken.find((w) => w.id === slot.wijkId)
        const dt = getSlotDateObj(slot)

        return {
          ...slot,
          eventTitle: event.title,
          eventId: event.id,
          wijkName: wijk?.name || "Onbekende zone",
          max2: wijk?.count2tops || 0,
          max4: wijk?.count4tops || 0,
          max6: wijk?.count6tops || 0,
          _dt: dt, // internal date object
          _dateKey: dt ? isoDateKeyAmsterdam(dt) : slot.date ?? "onbekend",
          _dateLabel: dt ? labelDateDutch(dt) : slot.date ?? "Onbekende datum",
          _timeLabel: dt ? labelTimeDutch(dt) : slot.time ?? "--:--",
        }
      })
    )
  }, [events, wijken])

  const filteredSlots = useMemo(() => {
    if (!bookedOnly) return allSlots
    return allSlots.filter((s: any) => (s.booked2tops || 0) > 0 || (s.booked4tops || 0) > 0 || (s.booked6tops || 0) > 0)
  }, [allSlots, bookedOnly])

  // Group by dateKey, sorted chronologically
  const grouped = useMemo(() => {
    const map = new Map<string, any[]>()
    for (const slot of filteredSlots) {
      const key = slot._dateKey
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(slot)
    }

    // sort slots inside group by datetime
    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => {
        const ta = a._dt ? a._dt.getTime() : 0
        const tb = b._dt ? b._dt.getTime() : 0
        return ta - tb
      })
      map.set(k, arr)
    }

    const keys = Array.from(map.keys()).sort((a, b) => a.localeCompare(b))
    return { map, keys }
  }, [filteredSlots])

  const calendarUrlAll = getCalendarUrl(restaurantId, false)
  const calendarUrlBooked = getCalendarUrl(restaurantId, true)

  const handleCopyUrl = async (url: string) => {
    await navigator.clipboard.writeText(url)
    setCopiedUrl(url)
    setTimeout(() => setCopiedUrl(null), 2000)
  }

  const handleDownloadCalendar = () => {
    // local generation (werkt ook offline); jouw utils.ts kan ISO + legacy aan
    const icalData = generateICalData(events, wijken)
    const blob = new Blob([icalData], { type: "text/calendar;charset=utf-8" })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.setAttribute("download", "events_planning.ics")
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-[calc(100vh-80px)] bg-white max-w-7xl mx-auto border-x border-gray-200 shadow-xl shadow-gray-100 overflow-hidden relative">
      {/* Sidebar */}
      <div className="w-72 bg-gray-50 border-r border-gray-200 flex flex-col p-4">
        <div className="mb-6 px-2">
          <div className="flex items-center gap-2 text-gray-900 font-extrabold">
            <Calendar className="w-5 h-5 text-[#c9a227]" />
            <span>Planning</span>
          </div>
          <div className="text-xs text-gray-500 mt-1">Overzicht van tijdsloten en bezetting</div>
        </div>

        <div className="space-y-3 px-1">
          {/* Filter */}
          <button
            onClick={() => setBookedOnly(!bookedOnly)}
            className={[
              "w-full flex items-center gap-3 px-3 py-2.5 border rounded-xl text-sm font-semibold transition",
              bookedOnly ? "bg-[#c9a227]/10 border-[#c9a227]/30 text-[#7a5e14]" : "bg-white border-gray-200 text-gray-800 hover:border-gray-300",
            ].join(" ")}
          >
            <div
              className={[
                "w-8 h-8 rounded-full flex items-center justify-center",
                bookedOnly ? "bg-[#c9a227]/20 text-[#7a5e14]" : "bg-gray-100 text-gray-600",
              ].join(" ")}
            >
              <Filter className="w-4 h-4" />
            </div>
            <div className="text-left">
              <div className="text-[11px] text-gray-500">Filter</div>
              <div>{bookedOnly ? "Alleen geboekt" : "Alle tijdsloten"}</div>
            </div>
          </button>

          <button
            onClick={() => setShowSyncModal(true)}
            className="w-full flex items-center gap-3 px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-800 hover:border-gray-300 transition"
          >
            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-700">
              <Smartphone className="w-4 h-4" />
            </div>
            <div className="text-left">
              <div className="text-[11px] text-gray-500">Synchroniseren</div>
              <div>Telefoon / Google Agenda</div>
            </div>
          </button>
        </div>

        <div className="mt-auto pt-6">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 px-2">
            Zones
          </div>
          <div className="space-y-2">
            {wijken.map((w) => (
              <div key={w.id} className="bg-white border border-gray-200 rounded-xl p-3">
                <div className="text-xs font-bold text-gray-800 mb-1">{w.name}</div>
                <div className="flex justify-between text-[11px] text-gray-500">
                  <span>2p: {w.count2tops}</span>
                  <span>4p: {w.count4tops}</span>
                  <span>6p: {w.count6tops}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Toolbar */}
        <div className="h-16 border-b border-gray-200 flex items-center justify-between px-6 bg-white">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-extrabold text-gray-900">
              {bookedOnly ? "Geboekte tijdsloten" : "Beschikbaarheid"}
            </h2>
            <span className="text-xs font-semibold bg-gray-100 border border-gray-200 px-2 py-1 rounded-full text-gray-600">
              {filteredSlots.length} tijdsloten
            </span>
            {bookedOnly && (
              <span className="text-xs font-semibold bg-[#c9a227]/10 border border-[#c9a227]/25 px-2 py-1 rounded-full text-[#7a5e14]">
                gefilterd
              </span>
            )}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto bg-gray-50/50 p-6 sm:p-8">
          <div className="max-w-4xl mx-auto space-y-8">
            {grouped.keys.map((dateKey) => {
              const slots = grouped.map.get(dateKey) || []
              const dateLabel = slots[0]?._dateLabel ?? dateKey

              return (
                <div key={dateKey} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="bg-gray-50 px-6 py-3 border-b border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-gray-400" />
                      <span className="font-extrabold text-gray-900 capitalize">{dateLabel}</span>
                    </div>
                    <span className="text-xs font-semibold bg-white border border-gray-200 px-2 py-1 rounded-full text-gray-600">
                      {slots.length} tijdsloten
                    </span>
                  </div>

                  <div className="divide-y divide-gray-100">
                    {slots.map((slot: any, idx: number) => {
                      const totalBooked = (slot.booked2tops || 0) + (slot.booked4tops || 0) + (slot.booked6tops || 0)
                      const totalTables = (slot.max2 || 0) + (slot.max4 || 0) + (slot.max6 || 0)
                      const isFull = totalTables > 0 && totalBooked >= totalTables

                      return (
                        <div
                          key={`${slot.id}-${idx}`}
                          className={["px-6 py-4 flex items-center justify-between gap-4", isFull ? "bg-gray-50/60" : "hover:bg-gray-50"].join(" ")}
                        >
                          <div className="flex items-center gap-6 min-w-0">
                            <div className={["w-24 font-mono text-lg font-semibold flex items-center gap-2", isFull ? "text-gray-400 line-through" : "text-gray-900"].join(" ")}>
                              <Clock className="w-4 h-4 text-gray-300" />
                              {slot._timeLabel}
                            </div>

                            <div className="min-w-0">
                              <div className={["font-semibold truncate", isFull ? "text-gray-400" : "text-gray-900"].join(" ")}>
                                {slot.eventTitle}
                              </div>
                              <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                                <MapPin className="w-3 h-3" />
                                <span className="truncate">{slot.wijkName}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-6">
                            {/* Breakdown */}
                            <div className="hidden sm:flex gap-4 text-xs">
                              <div className="flex flex-col items-center">
                                <span className="text-gray-400 mb-0.5">2p</span>
                                <span className={["font-mono font-semibold", (slot.booked2tops || 0) >= (slot.max2 || 0) && (slot.max2 || 0) > 0 ? "text-red-600" : "text-gray-700"].join(" ")}>
                                  {slot.booked2tops || 0}/{slot.max2 || 0}
                                </span>
                              </div>
                              <div className="flex flex-col items-center">
                                <span className="text-gray-400 mb-0.5">4p</span>
                                <span className={["font-mono font-semibold", (slot.booked4tops || 0) >= (slot.max4 || 0) && (slot.max4 || 0) > 0 ? "text-red-600" : "text-gray-700"].join(" ")}>
                                  {slot.booked4tops || 0}/{slot.max4 || 0}
                                </span>
                              </div>
                              <div className="flex flex-col items-center">
                                <span className="text-gray-400 mb-0.5">6p</span>
                                <span className={["font-mono font-semibold", (slot.booked6tops || 0) >= (slot.max6 || 0) && (slot.max6 || 0) > 0 ? "text-red-600" : "text-gray-700"].join(" ")}>
                                  {slot.booked6tops || 0}/{slot.max6 || 0}
                                </span>
                              </div>
                            </div>

                            {/* Beheren */}
                            <button
                              onClick={() => setSelectedSlotDetails(slot)}
                              className="text-sm font-semibold text-[#7a5e14] hover:text-[#c9a227] flex items-center gap-1"
                            >
                              Beheren <ArrowUpRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            {grouped.keys.length === 0 && (
              <div className="text-center py-20 text-gray-500">
                {bookedOnly ? "Nog geen geboekte tijdsloten." : "Geen tijdsloten gevonden. Voeg events toe in de editor."}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sync modal */}
      {showSyncModal && (
        <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 bg-[#c9a227]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Smartphone className="w-8 h-8 text-[#7a5e14]" />
              </div>
              <h3 className="text-xl font-extrabold text-gray-900">Synchroniseren met agenda</h3>
              <p className="text-sm text-gray-500 mt-2">
                Gebruik deze links in iPhone, Android of Google Agenda voor live updates.
              </p>
            </div>

            <div className="space-y-3">
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-gray-800">Alle tijdsloten</span>
                  <button
                    onClick={() => handleCopyUrl(calendarUrlAll)}
                    className="text-xs font-semibold text-[#7a5e14] hover:text-[#c9a227] flex items-center gap-1"
                  >
                    {copiedUrl === calendarUrlAll ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedUrl === calendarUrlAll ? "Gekopieerd" : "Kopieer"}
                  </button>
                </div>
                <code className="text-xs text-gray-600 break-all block">{calendarUrlAll}</code>
              </div>

              <div className="bg-[#c9a227]/10 border border-[#c9a227]/25 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-[#7a5e14]">Alleen geboekt</span>
                  <button
                    onClick={() => handleCopyUrl(calendarUrlBooked)}
                    className="text-xs font-semibold text-[#7a5e14] hover:text-[#c9a227] flex items-center gap-1"
                  >
                    {copiedUrl === calendarUrlBooked ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedUrl === calendarUrlBooked ? "Gekopieerd" : "Kopieer"}
                  </button>
                </div>
                <code className="text-xs text-[#7a5e14] break-all block">{calendarUrlBooked}</code>
              </div>
            </div>

            <div className="text-xs text-gray-500 text-center">
              <strong>iPhone:</strong> Instellingen → Agenda → Accounts → Voeg account toe → Overig → Abonnementagenda<br />
              <strong>Google:</strong> Agenda → Andere agenda's + → Via URL
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleDownloadCalendar}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 py-3 rounded-xl font-extrabold flex items-center justify-center gap-2 transition"
              >
                <Download className="w-5 h-5" />
                Download .ics
              </button>
              <button
                onClick={() => setShowSyncModal(false)}
                className="flex-1 bg-[#c9a227] hover:bg-[#d4af37] text-[#0b0b0b] py-3 rounded-xl font-extrabold transition"
              >
                Klaar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Slot details modal */}
      {selectedSlotDetails && (
        <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-extrabold text-gray-900">{selectedSlotDetails.eventTitle}</h3>
                <p className="text-sm text-gray-500">
                  {selectedSlotDetails._dateLabel} om {selectedSlotDetails._timeLabel}
                </p>
              </div>
              <button
                onClick={() => setSelectedSlotDetails(null)}
                className="p-1 hover:bg-gray-100 rounded-lg transition"
                aria-label="Sluiten"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="border-t border-gray-100 pt-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-gray-100 rounded-xl flex items-center justify-center">
                  <MapPin className="w-4 h-4 text-gray-600" />
                </div>
                <div>
                  <div className="text-[11px] text-gray-400 uppercase">Zone</div>
                  <div className="font-semibold text-gray-900">{selectedSlotDetails.wijkName}</div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-[#c9a227]/15 rounded-xl flex items-center justify-center">
                  <Users className="w-4 h-4 text-[#7a5e14]" />
                </div>
                <div>
                  <div className="text-[11px] text-gray-400 uppercase">Bezetting</div>
                  <div className="font-semibold text-gray-900">
                    2p: {selectedSlotDetails.booked2tops || 0}/{selectedSlotDetails.max2 || 0} •{" "}
                    4p: {selectedSlotDetails.booked4tops || 0}/{selectedSlotDetails.max4 || 0} •{" "}
                    6p: {selectedSlotDetails.booked6tops || 0}/{selectedSlotDetails.max6 || 0}
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={() => setSelectedSlotDetails(null)}
              className="w-full bg-[#c9a227] hover:bg-[#d4af37] text-[#0b0b0b] py-3 rounded-xl font-extrabold transition"
            >
              Sluiten
            </button>
          </div>
        </div>
      )}
    </div>
  )
}