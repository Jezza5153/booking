import React, { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, RefreshCcw } from "lucide-react"
import { EventCard } from "./EventCard"
import { EventData, Wijk } from "../types"
import { WIJKEN_DATA, EVENTS_DATA } from "../data"
import { fetchWidgetData, RESTAURANT_ID } from "../api"

interface EventsWidgetProps {
  events?: EventData[]
  wijken?: Wijk[]
  restaurantId?: string
  /** For customer-facing embed, this should be true by default */
  useApi?: boolean
  /** Optional: show/hide brand header */
  showHeader?: boolean
}

export const EventsWidget: React.FC<EventsWidgetProps> = ({
  events: propEvents,
  wijken: propWijken,
  restaurantId = RESTAURANT_ID,
  useApi = true,
  showHeader = true,
}) => {
  const [apiEvents, setApiEvents] = useState<EventData[] | null>(null)
  const [apiWijken, setApiWijken] = useState<Wijk[] | null>(null)
  const [loading, setLoading] = useState<boolean>(useApi)
  const [error, setError] = useState<string | null>(null)

  const fallbackEvents = propEvents ?? EVENTS_DATA
  const fallbackWijken = propWijken ?? WIJKEN_DATA

  const events = useMemo(() => (useApi ? apiEvents ?? [] : fallbackEvents), [useApi, apiEvents, fallbackEvents])
  const wijken = useMemo(() => (useApi ? apiWijken ?? [] : fallbackWijken), [useApi, apiWijken, fallbackWijken])

  const loadData = useCallback(async () => {
    if (!useApi) return
    setLoading(true)
    setError(null)

    try {
      const data = await fetchWidgetData(restaurantId)
      setApiEvents(data.events ?? [])
      setApiWijken(data.zones ?? [])
    } catch (e: any) {
      console.error("Failed to load widget data:", e)
      setError(e?.message || "We kunnen de beschikbaarheid nu even niet laden.")
      setApiEvents([])
      setApiWijken([])
    } finally {
      setLoading(false)
    }
  }, [useApi, restaurantId])

  useEffect(() => {
    if (useApi) void loadData()
  }, [useApi, loadData])

  const activeEvents = useMemo(() => {
    // Pro filter: only show events with visible slots (avoid empty cards)
    return (events ?? []).filter((ev) => Array.isArray(ev.slots) && ev.slots.length > 0)
  }, [events])

  const handleBookingComplete = useCallback(() => {
    if (useApi) void loadData()
  }, [useApi, loadData])

  return (
    <div className="w-full h-full bg-[#0b0b0b] text-white font-sans">
      <div className="mx-auto max-w-[620px] h-full flex flex-col">
        {showHeader && (
          <div className="sticky top-0 z-30 bg-[#0b0b0b]/92 backdrop-blur-md border-b border-white/10">
            <div className="px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#c9a227] to-[#8f6f17] shadow-sm flex items-center justify-center">
                  <span className="text-[#0b0b0b] font-black text-sm tracking-wide">E</span>
                </div>
                <div className="leading-tight">
                  <div className="text-[13px] font-semibold tracking-wide text-[#c9a227] uppercase">
                    EVENTS Booking
                  </div>
                  <div className="text-[12px] text-white/60">
                    Kies een event & tijdslot
                  </div>
                </div>
              </div>

              {useApi && (
                <button
                  onClick={loadData}
                  className="text-xs text-white/70 hover:text-white flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 hover:border-white/20 transition"
                >
                  <RefreshCcw className="w-3.5 h-3.5" />
                  Vernieuwen
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto no-scrollbar pb-10">
          {loading ? (
            <div className="px-5 py-8">
              <div className="flex items-center gap-3 text-white/70">
                <Loader2 className="w-5 h-5 animate-spin text-[#c9a227]" />
                <p className="text-sm">Beschikbaarheid laden…</p>
              </div>

              {/* lightweight skeleton */}
              <div className="mt-6 space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div
                    key={i}
                    className="h-16 rounded-xl border border-white/10 bg-white/[0.03] animate-pulse"
                  />
                ))}
              </div>
            </div>
          ) : error ? (
            <div className="px-5 py-10">
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-5">
                <div className="text-sm font-semibold text-red-200">
                  Laden mislukt
                </div>
                <div className="mt-1 text-sm text-red-200/80">
                  {error}
                </div>
                <button
                  onClick={loadData}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl border border-[#c9a227]/30 bg-[#c9a227]/10 px-4 py-2 text-sm font-semibold text-[#c9a227] hover:bg-[#c9a227]/15 transition"
                >
                  <RefreshCcw className="w-4 h-4" />
                  Opnieuw proberen
                </button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-white/10">
              {activeEvents.length > 0 ? (
                activeEvents.map((event) => (
                  <div key={event.id} className="px-5 py-5">
                    <EventCard
                      event={event}
                      wijken={wijken}
                      onBookingComplete={handleBookingComplete}
                    />
                  </div>
                ))
              ) : (
                <div className="px-5 py-12 text-center">
                  <div className="text-sm font-semibold text-white/80">
                    Geen beschikbare events
                  </div>
                  <div className="mt-2 text-sm text-white/55">
                    Probeer later opnieuw of neem contact op met het restaurant.
                  </div>
                  {useApi && (
                    <button
                      onClick={loadData}
                      className="mt-6 inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-white/75 hover:text-white hover:border-white/20 transition"
                    >
                      <RefreshCcw className="w-4 h-4" />
                      Vernieuwen
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="py-8 flex flex-col items-center gap-2 text-white/35">
            <div className="text-[10px] tracking-widest uppercase">
              Powered by EVENTS
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}