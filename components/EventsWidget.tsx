import React, { useEffect, useState } from 'react';
import { EventCard } from './EventCard';
import { EventData, Wijk } from '../types';
import { WIJKEN_DATA, EVENTS_DATA } from '../data';
import { fetchWidgetData, RESTAURANT_ID } from '../api';
import { Loader2 } from 'lucide-react';

interface EventsWidgetProps {
  events?: EventData[];
  wijken?: Wijk[];
  restaurantId?: string;
  useApi?: boolean;
}

export const EventsWidget: React.FC<EventsWidgetProps> = ({
  events: propEvents,
  wijken: propWijken,
  restaurantId = RESTAURANT_ID,
  useApi = false  // Set to true to use API instead of props
}) => {
  const [events, setEvents] = useState<EventData[]>(propEvents || EVENTS_DATA);
  const [wijken, setWijken] = useState<Wijk[]>(propWijken || WIJKEN_DATA);
  const [loading, setLoading] = useState(useApi);
  const [error, setError] = useState<string | null>(null);

  // Fetch from API if useApi is enabled
  const loadData = async () => {
    if (!useApi) return;

    setLoading(true);
    setError(null);

    try {
      const data = await fetchWidgetData(restaurantId);
      setEvents(data.events);
      setWijken(data.zones);
    } catch (err: any) {
      console.error('Failed to load widget data:', err);
      setError(err.message || 'Failed to load events');
      // Fallback to prop data or static data
      setEvents(propEvents || EVENTS_DATA);
      setWijken(propWijken || WIJKEN_DATA);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [restaurantId, useApi]);

  // Update from props when not using API
  useEffect(() => {
    if (!useApi && propEvents) {
      setEvents(propEvents);
    }
    if (!useApi && propWijken) {
      setWijken(propWijken);
    }
  }, [propEvents, propWijken, useApi]);

  // Callback for when booking completes - refresh data
  const handleBookingComplete = () => {
    if (useApi) {
      loadData();
    }
  };

  // Show all events that have any capacity left in general
  const activeEvents = events.filter(event => event.slots.length > 0);

  return (
    <div className="w-full h-full bg-white flex flex-col font-sans text-gray-900">
      {/* Sticky Header */}
      <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-200/50 px-6 py-4 flex items-center justify-between transition-all">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded bg-black shadow-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm tracking-widest">E</span>
          </div>
          <span className="font-bold text-gray-900 tracking-tight text-lg uppercase">EVENTS</span>
        </div>

        <div className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100/50 flex items-center gap-1.5 shadow-sm">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
          </span>
          LIVE
        </div>
      </div>

      {/* Content Scroll Area */}
      <div className="flex-1 overflow-y-auto no-scrollbar pb-12">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin" />
            <p className="text-sm">Loading events...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-40 text-red-400 text-sm p-6 text-center">
            <p>{error}</p>
            <button
              onClick={loadData}
              className="mt-3 text-indigo-600 hover:text-indigo-700 font-medium"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {activeEvents.length > 0 ? (
              activeEvents.map(event => (
                <EventCard
                  key={event.id}
                  event={event}
                  wijken={wijken}
                  onBookingComplete={handleBookingComplete}
                />
              ))
            ) : (
              <div className="flex flex-col items-center justify-center h-40 text-gray-400 text-sm">
                <p>No available events currently.</p>
              </div>
            )}
          </div>
        )}

        {/* Footer watermark */}
        <div className="flex flex-col items-center justify-center py-8 gap-1 opacity-40 hover:opacity-100 transition-opacity duration-300">
          <div className="w-4 h-4 rounded bg-gray-200 flex items-center justify-center">
            <span className="text-[8px] text-white font-bold">E</span>
          </div>
          <div className="text-[10px] uppercase tracking-widest font-semibold text-gray-400">
            Powered by EVENTS
          </div>
        </div>
      </div>
    </div>
  );
};