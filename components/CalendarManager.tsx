import React, { useState } from 'react';
import { EventData, Wijk } from '../types';
import { Calendar, ChevronLeft, ChevronRight, Clock, MapPin, ArrowUpRight, Download, Smartphone, Filter, ExternalLink, Copy, Check } from 'lucide-react';
import { generateICalData } from '../utils';
import { getCalendarUrl, RESTAURANT_ID } from '../api';

interface CalendarManagerProps {
  events: EventData[];
  wijken: Wijk[];
}

export const CalendarManager: React.FC<CalendarManagerProps> = ({ events, wijken }) => {
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [bookedOnly, setBookedOnly] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // 1. Flatten all slots into a single array with event metadata
  const allSlots = events.flatMap(event =>
    event.slots.map(slot => {
      const wijk = wijken.find(w => w.id === slot.wijkId);
      return {
        ...slot,
        eventTitle: event.title,
        eventId: event.id,
        wijkName: wijk?.name || 'Unknown Zone',
        max2: wijk?.count2tops || 0,
        max4: wijk?.count4tops || 0,
        max6: wijk?.count6tops || 0
      };
    })
  );

  // 2. Filter to booked only if enabled
  const filteredSlots = bookedOnly
    ? allSlots.filter(slot => slot.booked2tops > 0 || slot.booked4tops > 0 || slot.booked6tops > 0)
    : allSlots;

  // 3. Group slots by Date String
  const groupedSlots: Record<string, typeof filteredSlots> = {};
  filteredSlots.forEach(slot => {
    if (!groupedSlots[slot.date]) {
      groupedSlots[slot.date] = [];
    }
    groupedSlots[slot.date].push(slot);
  });

  const sortedDates = Object.keys(groupedSlots);

  // Handle iCal Download
  const handleDownloadCalendar = () => {
    const icalData = generateICalData(events, wijken);
    const blob = new Blob([icalData], { type: 'text/calendar;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'events_schedule.ics');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Copy calendar URL to clipboard
  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const calendarUrlAll = getCalendarUrl(RESTAURANT_ID, false);
  const calendarUrlBooked = getCalendarUrl(RESTAURANT_ID, true);

  return (
    <div className="flex h-[calc(100vh-80px)] bg-white max-w-7xl mx-auto border-x border-gray-200 shadow-xl shadow-gray-100 overflow-hidden relative">

      {/* Sidebar */}
      <div className="w-64 bg-gray-50 border-r border-gray-200 flex flex-col p-4">
        <div className="mb-8">
          <div className="flex items-center gap-2 text-indigo-700 font-bold px-3">
            <Calendar className="w-5 h-5" />
            <span>Schedule</span>
          </div>
        </div>

        <div className="space-y-3 px-1">
          {/* Booked Only Filter */}
          <button
            onClick={() => setBookedOnly(!bookedOnly)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 border shadow-sm rounded-lg text-sm font-medium transition-all group ${bookedOnly
                ? 'bg-amber-50 border-amber-200 text-amber-700'
                : 'bg-white border-gray-200 text-gray-700 hover:border-indigo-200'
              }`}
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-transform ${bookedOnly ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-500 group-hover:scale-110'
              }`}>
              <Filter className="w-4 h-4" />
            </div>
            <div className="text-left">
              <div className="text-xs text-gray-500">Filter</div>
              <div>{bookedOnly ? 'Booked Only' : 'All Slots'}</div>
            </div>
          </button>

          <button
            onClick={() => setShowSyncModal(true)}
            className="w-full flex items-center gap-3 px-3 py-2.5 bg-white border border-gray-200 shadow-sm rounded-lg text-sm font-medium text-gray-700 hover:text-indigo-600 hover:border-indigo-200 transition-all group"
          >
            <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 group-hover:scale-110 transition-transform">
              <Smartphone className="w-4 h-4" />
            </div>
            <div className="text-left">
              <div className="text-xs text-gray-500">Sync to</div>
              <div>Phone / Google</div>
            </div>
          </button>
        </div>

        <div className="mt-auto">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 px-3">Zones Inventory</div>
          <div className="space-y-2">
            {wijken.map(w => (
              <div key={w.id} className="bg-white border border-gray-200 rounded p-2">
                <div className="text-xs font-bold text-gray-800 mb-1">{w.name}</div>
                <div className="flex justify-between text-[10px] text-gray-500">
                  <span>2p: {w.count2tops}</span>
                  <span>4p: {w.count4tops}</span>
                  <span>6p: {w.count6tops}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Calendar Area */}
      <div className="flex-1 flex flex-col min-w-0 relative">

        {/* Toolbar */}
        <div className="h-16 border-b border-gray-200 flex items-center justify-between px-6 bg-white">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
              <button className="p-1 hover:bg-white rounded shadow-sm transition-all"><ChevronLeft className="w-4 h-4" /></button>
              <button className="p-1 hover:bg-white rounded shadow-sm transition-all"><ChevronRight className="w-4 h-4" /></button>
            </div>
            <h2 className="text-lg font-bold text-gray-900">
              {bookedOnly ? 'Booked Slots' : 'Upcoming Availability'}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-sm text-gray-500">
              Showing: <span className="font-bold text-gray-900">{filteredSlots.length}</span>
              {bookedOnly && <span className="text-amber-600 ml-1">(filtered)</span>}
            </div>
          </div>
        </div>

        {/* Scrollable List */}
        <div className="flex-1 overflow-y-auto bg-gray-50/50 p-8">
          <div className="max-w-4xl mx-auto space-y-8">

            {sortedDates.map(dateKey => (
              <div key={dateKey} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="bg-gray-50 px-6 py-3 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    <span className="font-bold text-gray-900">{dateKey}</span>
                  </div>
                  <span className="text-xs font-medium bg-white border px-2 py-0.5 rounded text-gray-500">
                    {groupedSlots[dateKey].length} Slots
                  </span>
                </div>

                <div className="divide-y divide-gray-100">
                  {groupedSlots[dateKey].map((slot, idx) => {
                    const totalBooked = slot.booked2tops + slot.booked4tops + slot.booked6tops;
                    const totalTables = slot.max2 + slot.max4 + slot.max6;
                    const isFull = totalBooked >= totalTables && totalTables > 0;

                    return (
                      <div key={`${slot.id}-${idx}`} className={`px-6 py-4 flex items-center justify-between transition-colors group ${isFull ? 'bg-gray-50/50' : 'hover:bg-gray-50'}`}>
                        <div className="flex items-center gap-6">
                          <div className={`w-20 font-mono text-lg font-medium flex items-center gap-2 ${isFull ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                            <Clock className="w-4 h-4 text-gray-300" />
                            {slot.time}
                          </div>
                          <div>
                            <div className={`font-semibold ${isFull ? 'text-gray-400' : 'text-gray-900'}`}>{slot.eventTitle}</div>
                            <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                              <MapPin className="w-3 h-3" />
                              {slot.wijkName}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-8">
                          {/* Usage Breakdown */}
                          <div className="flex gap-4 text-xs">
                            <div className="flex flex-col items-center">
                              <span className="text-gray-400 mb-0.5">2-Tops</span>
                              <span className={`font-mono font-medium ${slot.booked2tops >= slot.max2 ? 'text-red-500' : 'text-gray-700'}`}>{slot.booked2tops}/{slot.max2}</span>
                            </div>
                            <div className="flex flex-col items-center">
                              <span className="text-gray-400 mb-0.5">4-Tops</span>
                              <span className={`font-mono font-medium ${slot.booked4tops >= slot.max4 ? 'text-red-500' : 'text-gray-700'}`}>{slot.booked4tops}/{slot.max4}</span>
                            </div>
                            <div className="flex flex-col items-center">
                              <span className="text-gray-400 mb-0.5">6-Tops</span>
                              <span className={`font-mono font-medium ${slot.booked6tops >= slot.max6 ? 'text-red-500' : 'text-gray-700'}`}>{slot.booked6tops}/{slot.max6}</span>
                            </div>
                          </div>

                          <button className="text-sm font-medium text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 hover:underline">
                            Manage <ArrowUpRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {sortedDates.length === 0 && (
              <div className="text-center py-20 text-gray-400">
                {bookedOnly ? 'No booked slots yet.' : 'No slots found. Add events in the Editor.'}
              </div>
            )}

          </div>
        </div>
      </div>

      {/* Sync Modal Overlay */}
      {showSyncModal && (
        <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Smartphone className="w-8 h-8 text-indigo-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900">Sync to Calendar</h3>
              <p className="text-sm text-gray-500 mt-2">
                Subscribe to these URLs in iPhone, Android, or Google Calendar for live updates.
              </p>
            </div>

            {/* Calendar Subscription URLs */}
            <div className="space-y-3">
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">All Slots</span>
                  <button
                    onClick={() => handleCopyUrl(calendarUrlAll)}
                    className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                  >
                    {copiedUrl === calendarUrlAll ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedUrl === calendarUrlAll ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <code className="text-xs text-gray-500 break-all block">{calendarUrlAll}</code>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-amber-700">Booked Only</span>
                  <button
                    onClick={() => handleCopyUrl(calendarUrlBooked)}
                    className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-1"
                  >
                    {copiedUrl === calendarUrlBooked ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedUrl === calendarUrlBooked ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <code className="text-xs text-amber-600 break-all block">{calendarUrlBooked}</code>
              </div>
            </div>

            <div className="text-xs text-gray-400 text-center">
              <strong>iPhone:</strong> Settings → Calendar → Accounts → Add → Other → Add Subscribed Calendar<br />
              <strong>Google:</strong> Calendar → Other calendars + → From URL
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleDownloadCalendar}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-3 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all"
              >
                <Download className="w-5 h-5" />
                Download .ics
              </button>
              <button
                onClick={() => setShowSyncModal(false)}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl font-semibold transition-all"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};