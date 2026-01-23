import React, { useMemo, useState } from "react"
import { EventData, Wijk } from "../types"
import { SlotBubble } from "./SlotBubble"
import { ArrowRight, Users, Mail, Armchair, Loader2, CheckCircle, AlertTriangle } from "lucide-react"
import { bookTable, BookingRequest } from "../api"

interface EventCardProps {
  event: EventData
  wijken: Wijk[]
  onBookingComplete?: () => void
  bookingEmail?: string // pass from widget data if available
}

type TableType = "2" | "4" | "6" | "7+"

// Helper: Calculate table type from guest count
function guestCountToTableType(count: number): TableType {
  if (count <= 2) return "2"
  if (count <= 4) return "4"
  if (count <= 6) return "6"
  return "7+"
}

export const EventCard: React.FC<EventCardProps> = ({ event, wijken, onBookingComplete, bookingEmail }) => {
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null)
  const [guestCount, setGuestCount] = useState<number | null>(null)
  const [largeGroupInput, setLargeGroupInput] = useState<string>("") // For 7+ groups

  // Auto-calculate table type from guest count
  const selectedTableType: TableType | null = guestCount ? guestCountToTableType(guestCount) : null
  const isLargeGroup = guestCount && guestCount >= 7

  const [customerName, setCustomerName] = useState("")
  const [customerEmail, setCustomerEmail] = useState("")
  const [customerPhone, setCustomerPhone] = useState("")
  const [customerRemarks, setCustomerRemarks] = useState("")

  const [isBooking, setIsBooking] = useState(false)
  const [bookingSuccess, setBookingSuccess] = useState(false)
  const [bookingError, setBookingError] = useState<string | null>(null)
  const [bookingResponse, setBookingResponse] = useState<{
    booking_id: string
    start_datetime: string
    event_title: string
    zone_name: string
    customer_name: string
    guest_count: number
    table_type: string
  } | null>(null)

  const selectedSlot = useMemo(() => event.slots.find((s) => s.id === selectedSlotId) ?? null, [event.slots, selectedSlotId])

  const wijk = useMemo(() => {
    if (!selectedSlot) return null
    return wijken.find((w) => w.id === selectedSlot.wijkId) ?? null
  }, [selectedSlot, wijken])

  const availability = useMemo(() => {
    if (!selectedSlot || !wijk) return { free2: 0, free4: 0, free6: 0 }
    return {
      free2: Math.max(0, wijk.count2tops - selectedSlot.booked2tops),
      free4: Math.max(0, wijk.count4tops - selectedSlot.booked4tops),
      free6: Math.max(0, wijk.count6tops - selectedSlot.booked6tops),
    }
  }, [selectedSlot, wijk])

  const handleSlotClick = (id: string) => {
    if (selectedSlotId === id) {
      setSelectedSlotId(null)
      setGuestCount(null)
      setLargeGroupInput("")
      setBookingError(null)
      setBookingSuccess(false)
      return
    }
    setSelectedSlotId(id)
    setGuestCount(null)
    setLargeGroupInput("")
    setBookingError(null)
    setBookingSuccess(false)
  }

  // Check if calculated table type has availability
  const tableTypeHasCapacity = (tableType: TableType): boolean => {
    if (tableType === "2") return availability.free2 > 0
    if (tableType === "4") return availability.free4 > 0
    if (tableType === "6") return availability.free6 > 0
    return true // 7+ always returns true (handled via email)
  }

  // Handle guest count selection
  const handleGuestCountSelect = (count: number) => {
    if (count === 7) {
      // 7+ selected, use input field
      setGuestCount(7)
      setLargeGroupInput("7")
    } else {
      setGuestCount(count)
      setLargeGroupInput("")
    }
    setBookingError(null)
  }

  // Handle large group input change
  const handleLargeGroupInputChange = (value: string) => {
    setLargeGroupInput(value)
    const num = parseInt(value)
    if (!isNaN(num) && num >= 7 && num <= 50) {
      setGuestCount(num)
    } else if (value === "") {
      setGuestCount(7)
    }
  }

  const emailLooksValid = useMemo(() => {
    if (!customerEmail.trim()) return true // optional
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim())
  }, [customerEmail])

  const canSubmit = useMemo(() => {
    if (!selectedSlotId) return false
    if (!guestCount) return false
    if (guestCount > 50) return false
    // For 1-6: check table capacity
    if (guestCount <= 6) {
      const tableType = guestCountToTableType(guestCount)
      if (!tableTypeHasCapacity(tableType)) return false
    }
    // For 7+: always allow (manual handling)
    if (!customerName.trim()) return false
    if (!emailLooksValid) return false
    return true
  }, [selectedSlotId, guestCount, customerName, emailLooksValid, availability])

  const handleBook = async () => {
    if (!canSubmit || !selectedSlotId || !guestCount) return
    const tableType = guestCount <= 6 ? guestCountToTableType(guestCount) : null

    setIsBooking(true)
    setBookingError(null)

    try {
      const booking: BookingRequest = {
        slot_id: selectedSlotId,
        table_type: tableType as "2" | "4" | "6" | undefined,
        guest_count: guestCount,
        customer_name: customerName.trim(),
        customer_email: customerEmail.trim() || undefined,
        customer_phone: customerPhone.trim() || undefined,
        remarks: customerRemarks.trim() || undefined,
      }

      const response = await bookTable(booking)

      // Verify we got a real booking back
      if (!response?.booking_id) {
        throw new Error('Reservering niet bevestigd. Probeer opnieuw.')
      }

      setBookingResponse(response)
      setBookingSuccess(true)

      // Silent refresh in background (no loading overlay for user)
      onBookingComplete?.()

      // REMOVED: Auto-close timeout - let user view and close manually
      // The confirmation screen now stays until user clicks "Sluiten"
    } catch (error: any) {
      setBookingError(error?.message || "Reserveren lukt nu even niet. Probeer het opnieuw.")
    } finally {
      setIsBooking(false)
    }
  }

  const groupEmail = bookingEmail || "reserveren@tafelaaramersfoort.nl"

  const slotCount = event.slots.length

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02]">
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <h2 className="text-[15px] sm:text-[16px] font-bold tracking-tight text-[#c9a227]">
              {event.title}
            </h2>
            {event.description && (
              <p className="text-[11px] text-white/60 mt-0.5 leading-snug">{event.description}</p>
            )}
            {event.price_per_person && (
              <div className="text-[11px] text-white/75 mt-1 font-medium">
                €{event.price_per_person.toFixed(2).replace('.', ',')} <span className="text-white/50 font-normal">p.p.</span>
              </div>
            )}
          </div>

          {selectedSlot && (
            <div className="text-[10px] text-white/70 bg-black/40 border border-white/10 px-2 py-1 rounded-full shrink-0">
              {selectedSlot.date} · {selectedSlot.time}
            </div>
          )}
        </div>

        {/* Slots */}
        <div className="mt-3">
          {slotCount <= 3 ? (
            <div className="flex flex-wrap gap-3 justify-center">
              {event.slots.map((slot) => {
                const slotWijk = wijken.find(w => w.id === slot.wijkId)
                return (
                  <div key={slot.id} className="min-w-[120px]">
                    <SlotBubble slot={slot} wijk={slotWijk} isSelected={selectedSlotId === slot.id} onClick={() => handleSlotClick(slot.id)} />
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="grid grid-cols-4 min-[500px]:grid-cols-5 gap-3" role="group" aria-label={`Tijdsloten voor ${event.title}`}>
              {event.slots.map((slot) => {
                const slotWijk = wijken.find(w => w.id === slot.wijkId)
                return <SlotBubble key={slot.id} slot={slot} wijk={slotWijk} isSelected={selectedSlotId === slot.id} onClick={() => handleSlotClick(slot.id)} />
              })}
            </div>
          )}
        </div>
      </div>

      {/* Booking panel */}
      <div
        className={[
          "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
          selectedSlotId ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        ].join(" ")}
      >
        <div className="overflow-hidden">
          <div className="px-5 pb-5">
            <div className="rounded-2xl border border-white/10 bg-black/40 p-5 space-y-5">
              {bookingSuccess && bookingResponse ? (
                <div className="flex flex-col items-center justify-center py-6 space-y-4">
                  <div className="w-14 h-14 bg-[#c9a227]/15 rounded-full flex items-center justify-center">
                    <CheckCircle className="w-8 h-8 text-[#c9a227]" />
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-[#c9a227]">Reservering bevestigd ✓</div>
                    <div className="text-sm text-white/60 mt-1">Je tafel staat voor je klaar.</div>
                  </div>

                  {/* Booking details */}
                  <div className="w-full rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-white/50">Datum</span>
                      <span className="text-white font-semibold">
                        {new Date(bookingResponse.start_datetime).toLocaleDateString('nl-NL', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Amsterdam' })}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/50">Tijd</span>
                      <span className="text-white font-semibold">
                        {new Date(bookingResponse.start_datetime).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' })}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/50">Naam</span>
                      <span className="text-white font-semibold">{bookingResponse.customer_name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/50">Gezelschap</span>
                      <span className="text-white font-semibold">{bookingResponse.guest_count} personen</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/50">Tafel</span>
                      <span className="text-white font-semibold">{bookingResponse.table_type}-pers</span>
                    </div>
                    <div className="flex justify-between border-t border-white/10 pt-2 mt-2">
                      <span className="text-white/40 text-xs">Referentie</span>
                      <span className="text-white/60 text-xs font-mono">{bookingResponse.booking_id.slice(0, 8)}…</span>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setSelectedSlotId(null)
                      setGuestCount(null)
                      setLargeGroupInput("")
                      setCustomerName("")
                      setCustomerEmail("")
                      setCustomerPhone("")
                      setCustomerRemarks("")
                      setBookingSuccess(false)
                      setBookingResponse(null)
                    }}
                    className="rounded-xl border border-white/15 bg-white/[0.03] px-5 py-2.5 text-sm font-semibold text-white/70 hover:bg-white/[0.06] transition"
                  >
                    Sluiten
                  </button>
                </div>
              ) : (
                <>
                  {bookingError && (
                    <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-200 flex gap-3 items-start">
                      <AlertTriangle className="w-4 h-4 mt-0.5 text-red-300" />
                      <div>{bookingError}</div>
                    </div>
                  )}

                  {/* Step 1: Aantal personen */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-white/50 uppercase">
                      <Users className="w-3.5 h-3.5" />
                      Hoeveel personen?
                    </div>

                    <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                      {[1, 2, 3, 4, 5, 6].map((num) => {
                        const tableType = guestCountToTableType(num)
                        const hasCapacity = tableType === "2" ? availability.free2 > 0 :
                          tableType === "4" ? availability.free4 > 0 :
                            availability.free6 > 0
                        const selected = guestCount === num
                        return (
                          <button
                            key={num}
                            onClick={() => handleGuestCountSelect(num)}
                            disabled={!hasCapacity}
                            className={[
                              "w-full h-12 rounded-xl border flex items-center justify-center text-base font-bold transition",
                              !hasCapacity ? "opacity-40 cursor-not-allowed border-white/10 bg-white/[0.02] text-white/50" : "border-white/10 hover:border-[#c9a227]/40 bg-white/[0.02] text-white",
                              selected ? "border-[#c9a227]/60 bg-[#c9a227] text-[#0b0b0b] shadow-lg" : "",
                            ].join(" ")}
                          >
                            {num}
                          </button>
                        )
                      })}

                      <button
                        onClick={() => handleGuestCountSelect(7)}
                        className={[
                          "w-full h-12 rounded-xl border flex items-center justify-center text-base font-bold transition",
                          guestCount && guestCount >= 7 ? "border-[#c9a227]/60 bg-[#c9a227]/10 text-[#c9a227]" : "border-white/10 hover:border-[#c9a227]/40 bg-white/[0.02] text-white",
                        ].join(" ")}
                      >
                        7+
                      </button>
                    </div>

                    {/* Show selected table info for 1-6, or input for 7+ */}
                    {guestCount && guestCount <= 6 && (
                      <div className="text-[11px] text-white/50 flex items-center gap-1.5">
                        <Armchair className="w-3 h-3" />
                        <span>Automatisch: <span className="text-white/70 font-medium">{guestCountToTableType(guestCount)}-persoonstafel</span></span>
                      </div>
                    )}

                    {guestCount && guestCount >= 7 && (
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-white/60">Exacte aantal personen (7-50)</label>
                        <input
                          type="number"
                          min={7}
                          max={50}
                          value={largeGroupInput}
                          onChange={(e) => handleLargeGroupInputChange(e.target.value)}
                          placeholder="bijv. 12"
                          className="w-full px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white placeholder-white/35 focus:border-[#c9a227]/60 focus:ring-1 focus:ring-[#c9a227]/30 outline-none text-center text-lg font-bold"
                        />
                        <div className="text-[11px] text-white/40">
                          Voor groepen van 7+ nemen we contact met je op om de beste plek te regelen.
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Step 2: Customer details or 7+ message */}
                  {guestCount && (
                    <div className="pt-1">
                      {guestCount <= 6 ? (
                        <div className="space-y-4">

                          <div className="space-y-3">
                            <div className="text-[11px] text-white/40 mb-3">
                              Je gegevens worden alleen gebruikt voor deze reservering.
                            </div>
                            <div>
                              <label className="text-xs font-medium text-white/60">Naam *</label>
                              <input
                                type="text"
                                value={customerName}
                                onChange={(e) => setCustomerName(e.target.value)}
                                placeholder="Je naam"
                                className="w-full mt-1 px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white placeholder-white/35 focus:border-[#c9a227]/60 focus:ring-1 focus:ring-[#c9a227]/30 outline-none"
                              />
                              {!customerName.trim() && (
                                <div className="mt-1 text-[11px] text-white/40">Vul je naam in om door te gaan.</div>
                              )}
                            </div>

                            <div>
                              <label className="text-xs font-medium text-white/60">E-mail (optioneel, alleen voor bevestiging)</label>
                              <input
                                type="email"
                                value={customerEmail}
                                onChange={(e) => setCustomerEmail(e.target.value)}
                                placeholder="email@voorbeeld.nl"
                                className="w-full mt-1 px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white placeholder-white/35 focus:border-[#c9a227]/60 focus:ring-1 focus:ring-[#c9a227]/30 outline-none"
                              />
                              {!emailLooksValid && (
                                <div className="mt-1 text-[11px] text-red-200/80">Dit e-mailadres lijkt niet te kloppen.</div>
                              )}
                            </div>

                            <div>
                              <label className="text-xs font-medium text-white/60">Telefoon (optioneel)</label>
                              <input
                                type="tel"
                                value={customerPhone}
                                onChange={(e) => setCustomerPhone(e.target.value)}
                                placeholder="06 12345678"
                                className="w-full mt-1 px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white placeholder-white/35 focus:border-[#c9a227]/60 focus:ring-1 focus:ring-[#c9a227]/30 outline-none"
                              />
                            </div>

                            <div>
                              <label className="text-xs font-medium text-white/60">Opmerkingen (optioneel)</label>
                              <textarea
                                value={customerRemarks}
                                onChange={(e) => setCustomerRemarks(e.target.value)}
                                placeholder="Allergieën? Zet ze hier, dan houden we rekening."
                                rows={2}
                                className="w-full mt-1 px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white placeholder-white/35 focus:border-[#c9a227]/60 focus:ring-1 focus:ring-[#c9a227]/30 outline-none resize-none"
                              />
                            </div>
                          </div>

                          <button
                            onClick={handleBook}
                            disabled={isBooking || !canSubmit}
                            className={[
                              "w-full rounded-xl px-4 py-4 text-base font-bold transition flex items-center justify-center gap-2",
                              "bg-gradient-to-r from-[#c9a227] to-[#8f6f17] text-[#0b0b0b]",
                              "hover:from-[#d4af37] hover:to-[#a8831d]",
                              (isBooking || !canSubmit) ? "opacity-60 cursor-not-allowed" : "",
                            ].join(" ")}
                          >
                            {isBooking ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Bezig met reserveren…
                              </>
                            ) : (
                              <>
                                Bevestig reservering <span className="opacity-80">({selectedSlot?.time})</span>
                                <ArrowRight className="w-4 h-4" />
                              </>
                            )}
                          </button>
                        </div>
                      ) : (
                        /* 7+ group booking form */
                        <div className="space-y-4">
                          <div className="rounded-xl border border-[#c9a227]/20 bg-[#c9a227]/5 p-3">
                            <div className="text-sm text-[#c9a227] font-semibold">📞 Groepsreservering ({guestCount} personen)</div>
                            <div className="text-[11px] text-white/50 mt-1">Je ontvangt een bevestiging zodra we je aanvraag hebben verwerkt.</div>
                          </div>

                          <div className="space-y-3">
                            <div>
                              <label className="text-xs font-medium text-white/60">Naam *</label>
                              <input
                                type="text"
                                value={customerName}
                                onChange={(e) => setCustomerName(e.target.value)}
                                placeholder="Je naam"
                                className="w-full mt-1 px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white placeholder-white/35 focus:border-[#c9a227]/60 focus:ring-1 focus:ring-[#c9a227]/30 outline-none"
                              />
                            </div>

                            <div>
                              <label className="text-xs font-medium text-white/60">E-mail *</label>
                              <input
                                type="email"
                                value={customerEmail}
                                onChange={(e) => setCustomerEmail(e.target.value)}
                                placeholder="email@voorbeeld.nl"
                                className="w-full mt-1 px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white placeholder-white/35 focus:border-[#c9a227]/60 focus:ring-1 focus:ring-[#c9a227]/30 outline-none"
                              />
                            </div>

                            <div>
                              <label className="text-xs font-medium text-white/60">Telefoon (voor contact)</label>
                              <input
                                type="tel"
                                value={customerPhone}
                                onChange={(e) => setCustomerPhone(e.target.value)}
                                placeholder="06 12345678"
                                className="w-full mt-1 px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white placeholder-white/35 focus:border-[#c9a227]/60 focus:ring-1 focus:ring-[#c9a227]/30 outline-none"
                              />
                            </div>

                            <div>
                              <label className="text-xs font-medium text-white/60">Opmerkingen (optioneel)</label>
                              <textarea
                                value={customerRemarks}
                                onChange={(e) => setCustomerRemarks(e.target.value)}
                                placeholder="Speciale wensen, allergieën, opstelling..."
                                rows={2}
                                className="w-full mt-1 px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white placeholder-white/35 focus:border-[#c9a227]/60 focus:ring-1 focus:ring-[#c9a227]/30 outline-none resize-none"
                              />
                            </div>
                          </div>

                          <button
                            onClick={handleBook}
                            disabled={isBooking || !canSubmit}
                            className={[
                              "w-full rounded-xl px-4 py-4 text-base font-bold transition flex items-center justify-center gap-2",
                              "bg-gradient-to-r from-[#c9a227] to-[#8f6f17] text-[#0b0b0b]",
                              "hover:from-[#d4af37] hover:to-[#a8831d]",
                              (isBooking || !canSubmit) ? "opacity-60 cursor-not-allowed" : "",
                            ].join(" ")}
                          >
                            {isBooking ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Bezig met aanvragen…
                              </>
                            ) : (
                              <>
                                Aanvraag versturen
                                <ArrowRight className="w-4 h-4" />
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}