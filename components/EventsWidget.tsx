import React, { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, RefreshCcw, Calendar, ChevronRight } from "lucide-react"
import { EventCard } from "./EventCard"
import { RestaurantBooking } from "./RestaurantBooking"
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
  /** Restaurant name for header */
  restaurantName?: string
  /** Restaurant subtitle */
  restaurantSubtitle?: string
}

export const EventsWidget: React.FC<EventsWidgetProps> = ({
  events: propEvents,
  wijken: propWijken,
  restaurantId = RESTAURANT_ID,
  useApi = true,
  showHeader = true,
  restaurantName = "De Tafelaar",
  restaurantSubtitle = "Shared dining restaurant",
}) => {
  const [apiEvents, setApiEvents] = useState<EventData[] | null>(null)
  const [apiWijken, setApiWijken] = useState<Wijk[] | null>(null)
  const [loading, setLoading] = useState<boolean>(useApi)
  const [error, setError] = useState<string | null>(null)
  const [showRestaurantBooking, setShowRestaurantBooking] = useState(false)

  const fallbackEvents = propEvents ?? EVENTS_DATA
  const fallbackWijken = propWijken ?? WIJKEN_DATA

  const events = useMemo(() => (useApi ? apiEvents ?? [] : fallbackEvents), [useApi, apiEvents, fallbackEvents])
  const wijken = useMemo(() => (useApi ? apiWijken ?? [] : fallbackWijken), [useApi, apiWijken, fallbackWijken])

  // silentRefresh = true means no loading spinner (used after booking)
  const loadData = useCallback(async (silentRefresh = false) => {
    if (!useApi) return
    if (!silentRefresh) {
      setLoading(true)
    }
    setError(null)

    try {
      const data = await fetchWidgetData(restaurantId)
      setApiEvents(data.events ?? [])
      setApiWijken(data.zones ?? [])
    } catch (e: any) {
      console.error("Failed to load widget data:", e)
      if (!silentRefresh) {
        setError(e?.message || "We kunnen de beschikbaarheid nu even niet laden.")
      }
      setApiEvents([])
      setApiWijken([])
    } finally {
      if (!silentRefresh) {
        setLoading(false)
      }
    }
  }, [useApi, restaurantId])

  useEffect(() => {
    if (useApi) void loadData(false)
  }, [useApi, loadData])

  const activeEvents = useMemo(() => {
    // Pro filter: only show events with visible slots (avoid empty cards)
    return (events ?? []).filter((ev) => Array.isArray(ev.slots) && ev.slots.length > 0)
  }, [events])

  // Silent refresh after booking - no spinner, no disruption
  const handleBookingComplete = useCallback(() => {
    if (useApi) void loadData(true)
  }, [useApi, loadData])

  return (
    <div className="w-full h-full bg-[#0b0b0b] text-white font-sans">
      <div className="mx-auto max-w-[380px] h-full flex flex-col">
        {/* Fixed Restaurant Header */}
        {showHeader && (
          <div className="sticky top-0 z-30 bg-[#0b0b0b] border-b border-white/10">
            <div className="px-4 py-3 text-center">
              <h1 className="text-lg font-bold tracking-wide text-white">{restaurantName}</h1>
              <p className="text-xs text-white/50 tracking-wide">{restaurantSubtitle}</p>
            </div>
          </div>
        )}

        {/* Restaurant Reservation Button (Tapla-style green) */}
        <div className="px-4 pt-4 pb-2">
          <button
            onClick={() => setShowRestaurantBooking(!showRestaurantBooking)}
            className="w-full flex items-center justify-between gap-3 p-3 rounded-xl bg-[#3D9970] hover:bg-[#3D9970]/90 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                <Calendar className="w-4 h-4 text-white" />
              </div>
              <div className="text-left">
                <div className="text-sm font-semibold text-white">Reserveren</div>
                <div className="text-[11px] text-white/70">Tafel boeken à la carte</div>
              </div>
            </div>
            <ChevronRight className={`w-5 h-5 text-white/70 transition-transform ${showRestaurantBooking ? 'rotate-90' : ''}`} />
          </button>

          {/* Restaurant booking flow */}
          {showRestaurantBooking && (
            <div className="mt-3">
              <RestaurantBooking
                restaurantId={restaurantId}
                onClose={() => setShowRestaurantBooking(false)}
                onComplete={handleBookingComplete}
              />
            </div>
          )}
        </div>

        {/* Events Section Header */}
        <div className="px-4 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-[#c9a227] to-[#8f6f17] flex items-center justify-center">
              <span className="text-[#0b0b0b] font-bold text-[10px]">E</span>
            </div>
            <span className="text-xs font-semibold tracking-wide text-[#c9a227] uppercase">Speciale Events</span>
          </div>
        </div>

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