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

export const EventCard: React.FC<EventCardProps> = ({ event, wijken, onBookingComplete, bookingEmail }) => {
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null)
  const [selectedTableType, setSelectedTableType] = useState<TableType | null>(null)
  const [guestCount, setGuestCount] = useState<number | null>(null)

  const [customerName, setCustomerName] = useState("")
  const [customerEmail, setCustomerEmail] = useState("")
  const [customerPhone, setCustomerPhone] = useState("")
  const [customerRemarks, setCustomerRemarks] = useState("")

  const [isBooking, setIsBooking] = useState(false)
  const [bookingSuccess, setBookingSuccess] = useState(false)
  const [bookingError, setBookingError] = useState<string | null>(null)

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
      setSelectedTableType(null)
      setGuestCount(null)
      setBookingError(null)
      setBookingSuccess(false)
      return
    }
    setSelectedSlotId(id)
    setSelectedTableType(null)
    setGuestCount(null)
    setBookingError(null)
    setBookingSuccess(false)
  }

  const handleTableTypeSelect = (type: TableType) => {
    setSelectedTableType(type)
    setGuestCount(null)
    setBookingError(null)
  }

  const emailLooksValid = useMemo(() => {
    if (!customerEmail.trim()) return true // optional
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim())
  }, [customerEmail])

  const canSubmit = useMemo(() => {
    if (!selectedSlotId) return false
    if (!selectedTableType || selectedTableType === "7+") return false
    if (!guestCount) return false
    if (!customerName.trim()) return false
    if (!emailLooksValid) return false
    return true
  }, [selectedSlotId, selectedTableType, guestCount, customerName, emailLooksValid])

  const handleBook = async () => {
    if (!canSubmit || !selectedSlotId || !selectedTableType || !guestCount || selectedTableType === "7+") return

    setIsBooking(true)
    setBookingError(null)

    try {
      const booking: BookingRequest = {
        slot_id: selectedSlotId,
        table_type: selectedTableType,
        guest_count: guestCount,
        customer_name: customerName.trim(),
        customer_email: customerEmail.trim() || undefined,
        customer_phone: customerPhone.trim() || undefined,
        remarks: customerRemarks.trim() || undefined,
      }

      await bookTable(booking)

      setBookingSuccess(true)
      onBookingComplete?.()

      setTimeout(() => {
        setSelectedSlotId(null)
        setSelectedTableType(null)
        setGuestCount(null)
        setCustomerName("")
        setCustomerEmail("")
        setCustomerPhone("")
        setCustomerRemarks("")
        setBookingSuccess(false)
      }, 2500)
    } catch (error: any) {
      setBookingError(error?.message || "Reserveren lukt nu even niet. Probeer het opnieuw.")
    } finally {
      setIsBooking(false)
    }
  }

  const groupEmail = bookingEmail || "reserveren@tafelaaramersfoort.nl"

  const guestOptions = useMemo(() => {
    if (selectedTableType === "2") return [1, 2]
    if (selectedTableType === "4") return [3, 4]
    if (selectedTableType === "6") return [5, 6]
    return []
  }, [selectedTableType])

  const slotCount = event.slots.length

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02]">
      <div className="px-5 py-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[18px] sm:text-[20px] font-bold tracking-tight text-[#c9a227]">
            {event.title}
          </h2>

          {selectedSlot && (
            <div className="text-[11px] sm:text-xs text-white/70 bg-black/40 border border-white/10 px-3 py-1.5 rounded-full">
              Gekozen: <span className="text-white/90 font-semibold">{selectedSlot.date} · {selectedSlot.time}</span>
            </div>
          )}
        </div>

        {/* Slots */}
        <div className="mt-4">
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
              {bookingSuccess ? (
                <div className="flex flex-col items-center justify-center py-6">
                  <div className="w-14 h-14 bg-[#c9a227]/15 rounded-full flex items-center justify-center mb-3">
                    <CheckCircle className="w-8 h-8 text-[#c9a227]" />
                  </div>
                  <div className="text-lg font-bold text-[#c9a227]">Reservering bevestigd</div>
                  <div className="text-sm text-white/60">Tot snel bij ons aan tafel.</div>
                </div>
              ) : (
                <>
                  {bookingError && (
                    <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-200 flex gap-3 items-start">
                      <AlertTriangle className="w-4 h-4 mt-0.5 text-red-300" />
                      <div>{bookingError}</div>
                    </div>
                  )}

                  {/* Step 1: table */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-white/50 uppercase">
                      <Armchair className="w-3.5 h-3.5" />
                      Kies je tafel
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {([
                        { type: "2" as const, label: "2 pers", free: availability.free2 },
                        { type: "4" as const, label: "4 pers", free: availability.free4 },
                        { type: "6" as const, label: "6 pers", free: availability.free6 },
                      ]).map((t) => {
                        const disabled = t.free === 0
                        const selected = selectedTableType === t.type
                        return (
                          <button
                            key={t.type}
                            onClick={() => handleTableTypeSelect(t.type)}
                            disabled={disabled}
                            className={[
                              "rounded-xl border px-3 py-3 text-left transition",
                              disabled ? "opacity-40 cursor-not-allowed border-white/10 bg-white/[0.02]" : "border-white/10 hover:border-[#c9a227]/40 bg-white/[0.02]",
                              selected ? "border-[#c9a227]/60 bg-[#c9a227]/10" : "",
                            ].join(" ")}
                          >
                            <div className="text-sm font-bold text-white">{t.label}</div>
                            <div className="text-[11px] text-white/55">
                              {disabled ? "Vol" : `Nog ${t.free} vrij`}
                            </div>
                          </button>
                        )
                      })}

                      <button
                        onClick={() => handleTableTypeSelect("7+")}
                        className={[
                          "rounded-xl border px-3 py-3 text-left transition",
                          selectedTableType === "7+" ? "border-[#c9a227]/60 bg-[#c9a227]/10" : "border-white/10 hover:border-[#c9a227]/40 bg-white/[0.02]",
                        ].join(" ")}
                      >
                        <div className="text-sm font-bold text-white">7+ groep</div>
                        <div className="text-[11px] text-white/55">Op aanvraag</div>
                      </button>
                    </div>
                  </div>

                  {/* Step 2 */}
                  {selectedTableType && (
                    <div className="pt-1">
                      {selectedTableType !== "7+" ? (
                        <div className="space-y-4">
                          <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-white/50 uppercase">
                            <Users className="w-3.5 h-3.5" />
                            Aantal personen
                          </div>

                          <div className="flex gap-2">
                            {guestOptions.map((num) => (
                              <button
                                key={num}
                                onClick={() => setGuestCount(num)}
                                className={[
                                  "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition",
                                  guestCount === num
                                    ? "bg-[#c9a227] text-[#0b0b0b] shadow-lg"
                                    : "bg-white/[0.02] border border-white/10 text-white hover:border-[#c9a227]/40",
                                ].join(" ")}
                              >
                                {num}
                              </button>
                            ))}
                          </div>

                          {guestCount && (
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
                          )}

                          {guestCount && (
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
                          )}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-center space-y-3">
                          <div className="text-sm text-white/80 font-semibold">
                            Voor 7+ maken we graag iets passends. Mail ons even, dan regelen we het.
                          </div>
                          <a
                            href={`mailto:${groupEmail}?subject=Groepsreservering (7+)%20-%20${encodeURIComponent(event.title)}`}
                            className="inline-flex items-center gap-2 rounded-xl border border-[#c9a227]/35 bg-[#c9a227]/10 px-4 py-3 text-sm font-bold text-[#c9a227] hover:bg-[#c9a227]/15 transition"
                          >
                            <Mail className="w-4 h-4" />
                            Mail ons
                          </a>
                          <div className="text-xs text-white/45">{groupEmail}</div>
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