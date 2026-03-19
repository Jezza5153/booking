import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2, RefreshCcw, Calendar, ChevronRight, Clock } from "lucide-react"
import { EventCard } from "./EventCard"
import { EventData, Wijk } from "../types"
import { WIJKEN_DATA, EVENTS_DATA } from "../data"
import { fetchWidgetData, fetchOpeningHours, peekWidgetDataCache, RESTAURANT_ID } from "../api"
import { parseSlotDateForUi } from "../utils"
import type { OpeningHour, WidgetDataResponse } from "../api"

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

const loadRestaurantBookingModule = () =>
  import("./RestaurantBooking").then((module) => ({ default: module.RestaurantBooking }))
const RestaurantBooking = lazy(loadRestaurantBookingModule)

/** Compact — only shows today's hours */
const OpeningHoursBar: React.FC<{ hours: OpeningHour[] }> = ({ hours }) => {
  const today = new Date().getDay() // 0=Sun
  const todayHours = hours.find(h => h.dayOfWeek === today)
  if (!todayHours) return null

  return (
    <div className="px-4 py-1.5 flex items-center justify-center gap-1.5 text-[11px] text-white/35">
      <Clock className="w-3 h-3" />
      {todayHours.isOpen ? (
        <span>Vandaag {todayHours.open}–{todayHours.close}</span>
      ) : (
        <span>Vandaag gesloten</span>
      )}
    </div>
  )
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
  const [openingHours, setOpeningHours] = useState<OpeningHour[]>([])
  const widgetIncludesOpeningHours = useRef<boolean | null>(null)
  const eventsScrollerRef = useRef<HTMLDivElement | null>(null)

  const [urlEventId, setUrlEventId] = useState<string | null>(null)

  useEffect(() => {
    // Read ?event=xxx from URL to auto-expand an event
    const params = new URLSearchParams(window.location.search)
    const ev = params.get('event')
    if (ev) setUrlEventId(ev)
  }, [])

  const fallbackEvents = propEvents ?? EVENTS_DATA
  const fallbackWijken = propWijken ?? WIJKEN_DATA

  const events = useMemo(() => (useApi ? apiEvents ?? [] : fallbackEvents), [useApi, apiEvents, fallbackEvents])
  const wijken = useMemo(() => (useApi ? apiWijken ?? [] : fallbackWijken), [useApi, apiWijken, fallbackWijken])

  const applyWidgetData = useCallback((data: WidgetDataResponse) => {
    setApiEvents(data.events ?? [])
    setApiWijken(data.zones ?? [])
    if (Array.isArray(data.openingHours)) {
      setOpeningHours(data.openingHours)
    }
  }, [])

  const loadData = useCallback(async (options: {
    silentRefresh?: boolean
    forceRefresh?: boolean
    signal?: AbortSignal
  } = {}) => {
    if (!useApi) return
    const { silentRefresh = false, forceRefresh = false, signal } = options

    if (!silentRefresh) {
      setLoading(true)
    }
    setError(null)

    try {
      // Until all environments return openingHours from /api/widget, prefetch fallback in parallel
      // to avoid a waterfall on first paint.
      const shouldPrefetchOpeningHours = widgetIncludesOpeningHours.current !== true
      const openingHoursPromise = shouldPrefetchOpeningHours
        ? fetchOpeningHours(restaurantId, { signal })
        : null

      const data = await fetchWidgetData(restaurantId, { forceRefresh, signal })
      if (signal?.aborted) return
      applyWidgetData(data)

      if (Array.isArray(data.openingHours)) {
        widgetIncludesOpeningHours.current = true
        setOpeningHours(data.openingHours)
      } else {
        widgetIncludesOpeningHours.current = false
        const hours = openingHoursPromise
          ? await openingHoursPromise
          : await fetchOpeningHours(restaurantId, { signal })
        if (signal?.aborted) return
        setOpeningHours(hours)
      }
    } catch (e: any) {
      if (signal?.aborted) return
      console.error("Failed to load widget data:", e)
      if (!silentRefresh) {
        setError(e?.message || "We kunnen de beschikbaarheid nu even niet laden.")
        setApiEvents([])
        setApiWijken([])
      }
    } finally {
      if (signal?.aborted) return
      if (!silentRefresh) {
        setLoading(false)
      }
    }
  }, [useApi, restaurantId, applyWidgetData])

  // Use cached data for instant paint, then refresh in background.
  useEffect(() => {
    if (!useApi) return

    const cached = peekWidgetDataCache(restaurantId)
    if (cached) {
      applyWidgetData(cached)
      setLoading(false)
    } else {
      setLoading(true)
    }

    const controller = new AbortController()
    void loadData({
      silentRefresh: Boolean(cached),
      forceRefresh: Boolean(cached),
      signal: controller.signal,
    })

    return () => {
      controller.abort()
    }
  }, [useApi, restaurantId, applyWidgetData, loadData])

  const activeEvents = useMemo(() => {
    const now = Date.now()

    // Filter events and their slots:
    // 1. Only include slots that are in the future
    // 2. Only include events that have at least one future slot
    return (events ?? [])
      .map((ev) => {
        // Filter out past slots
        const futureSlots = (ev.slots ?? []).filter((slot) => {
          const dt = parseSlotDateForUi(slot)
          return dt ? dt.getTime() > now : true
        })
        return { ...ev, slots: futureSlots }
      })
      .filter((ev) => ev.slots.length > 0) // Only show events with future slots
  }, [events])

  useEffect(() => {
    // Auto-scroll to the requested event if it exists
    if (urlEventId && activeEvents.length > 0 && !loading) {
      // Small timeout ensures the DOM has rendered the EventCard elements
      const timer = setTimeout(() => {
        const el = document.getElementById(`event-${urlEventId}`)
        if (el && eventsScrollerRef.current) {
          // Calculate scroll position relative to the scroll container
          eventsScrollerRef.current.scrollTo({
            top: el.offsetTop - eventsScrollerRef.current.offsetTop - 16,
            behavior: 'smooth'
          })
        }
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [urlEventId, activeEvents, loading])

  // Silent refresh after booking - no spinner, no disruption
  const handleBookingComplete = useCallback(() => {
    if (useApi) {
      void loadData({ silentRefresh: true, forceRefresh: true })
    }
  }, [useApi, loadData])

  return (
    <div className="w-full h-full bg-[#0b0b0b] text-white font-sans">
      {/* Animation class defined in index.css (PERF: avoids inline <style> re-injection) */}
      <div className="mx-auto max-w-[380px] h-full flex flex-col">
        {/* Fixed Restaurant Header */}
        {showHeader && (
          <div className="sticky top-0 z-30 bg-[#0b0b0b]/80 backdrop-blur-xl">
            <div className="px-4 py-3 text-center">
              <h1 className="text-lg font-bold tracking-wide text-white">{restaurantName}</h1>
              <p className="text-xs text-white/50 tracking-wide">{restaurantSubtitle}</p>
            </div>
            {/* Subtle gradient fade instead of harsh white line */}
            <div className="h-[1px] bg-gradient-to-r from-transparent via-white/8 to-transparent" />
          </div>
        )}

        {/* Compact opening hours */}
        {openingHours.length > 0 && (
          <OpeningHoursBar hours={openingHours} />
        )}

        {/* Restaurant Reservation Button (Tapla-style green) */}
        <div className="px-4 pt-4 pb-2">
          <button
            onClick={() => setShowRestaurantBooking(!showRestaurantBooking)}
            onMouseEnter={() => { void loadRestaurantBookingModule() }}
            onFocus={() => { void loadRestaurantBookingModule() }}
            className="group w-full flex items-center justify-between gap-3 p-3 rounded-xl bg-[#b68a64] hover:bg-[#c49b72] transition-all duration-200 shadow-[0_0_20px_rgba(182,138,100,0.15)] hover:shadow-[0_0_30px_rgba(182,138,100,0.25)]"
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
            <ChevronRight className={`w-5 h-5 text-white/70 transition-transform duration-200 ${showRestaurantBooking ? 'rotate-90' : 'group-hover:translate-x-0.5'}`} />
          </button>

          {/* Restaurant booking flow */}
          {showRestaurantBooking && (
            <div className="mt-3">
              <Suspense fallback={
                <div className="rounded-xl border border-white/10 bg-black/30 p-4 flex items-center gap-2 text-white/70 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin text-[#c9a227]" />
                  Reserveringsflow laden...
                </div>
              }>
                <RestaurantBooking
                  restaurantId={restaurantId}
                  onClose={() => setShowRestaurantBooking(false)}
                  onComplete={handleBookingComplete}
                />
              </Suspense>
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

        <div ref={eventsScrollerRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain -webkit-overflow-scrolling-touch" style={{ WebkitOverflowScrolling: 'touch' }}>
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
                  onClick={() => void loadData({ forceRefresh: true })}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl border border-[#c9a227]/30 bg-[#c9a227]/10 px-4 py-2 text-sm font-semibold text-[#c9a227] hover:bg-[#c9a227]/15 transition"
                >
                  <RefreshCcw className="w-4 h-4" />
                  Opnieuw proberen
                </button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {activeEvents.length > 0 ? (
                activeEvents.map((event, index) => (
                  <div key={event.id} id={`event-${event.id}`} className="px-5 py-5 animate-fade-in-up" style={{ animationDelay: `${index * 80}ms` }}>
                    <EventCard
                      event={event}
                      wijken={wijken}
                      onBookingComplete={handleBookingComplete}
                      autoExpand={urlEventId === event.id}
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
                      onClick={() => void loadData({ forceRefresh: true })}
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
        </div>

        {/* Scroll fade hint — shows when content is scrollable */}
        <div className="pointer-events-none h-6 -mt-6 relative z-10 bg-gradient-to-t from-[#0b0b0b] to-transparent" />

        {/* Branded footer — compact, doesn't steal space from events */}
        <div className="shrink-0 relative overflow-hidden">
          <a
            href="https://jezzacooks.com"
            target="_blank"
            rel="noopener noreferrer"
            className="relative z-10 flex flex-col items-center py-3 group"
          >
            <div className="text-[9px] tracking-[0.2em] uppercase text-white/20 group-hover:text-white/35 transition-colors">
              Powered by
            </div>
            <div className="text-sm font-bold tracking-wide bg-gradient-to-r from-[#c9a227] to-[#b68a64] bg-clip-text text-transparent mt-0.5">
              jezzacooks.com
            </div>
          </a>
        </div>
      </div>
    </div>
  )
}
