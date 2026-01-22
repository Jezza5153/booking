import React, { useState } from 'react';
import { EventData, Slot, Wijk } from '../types';
import { Save, Star, Calendar, Trash2, Plus, GripVertical, MapPin, Users, MinusCircle, PlusCircle, Armchair, Loader2, CheckCircle, XCircle } from 'lucide-react';
// formatDateToDutch no longer needed - sending ISO dates directly to backend
import { saveAdminData, RESTAURANT_ID } from '../api';

interface AdminDashboardProps {
  events: EventData[];
  setEvents: React.Dispatch<React.SetStateAction<EventData[]>>;
  onAddEvent: () => void;
  onDeleteEvent: (id: string) => void;
  wijken: Wijk[];
  setWijken: React.Dispatch<React.SetStateAction<Wijk[]>>;
  onRefresh?: () => Promise<void>; // CRITICAL: refetch from server after save
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ events, setEvents, onAddEvent, onDeleteEvent, wijken, setWijken, onRefresh }) => {
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState('');

  // Delete confirmation modal state
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'zone' | 'event' | null; id: string | null }>({ type: null, id: null });

  // Save changes to API
  const handleSaveChanges = async () => {
    setSaving(true);
    setSaveStatus('idle');
    try {
      await saveAdminData({
        restaurantId: RESTAURANT_ID,
        zones: wijken,
        events: events
      });

      // CRITICAL FIX: Rehydrate state from server to prevent drift
      if (onRefresh) {
        await onRefresh();
      }

      setSaveStatus('success');
      setSaveMessage('Changes saved successfully!');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (error: any) {
      setSaveStatus('error');
      setSaveMessage(error.message || 'Failed to save changes');
      setTimeout(() => setSaveStatus('idle'), 5000);
    } finally {
      setSaving(false);
    }
  };

  // --- Wijk Management ---
  const handleAddWijk = () => {
    const defaultTables = { count2tops: 5, count4tops: 3, count6tops: 1 };
    const calculatedCouverts = (defaultTables.count2tops * 2) + (defaultTables.count4tops * 4) + (defaultTables.count6tops * 6);
    const newWijk: Wijk = {
      id: `w-${Date.now()}`,
      name: 'New Zone',
      ...defaultTables,
      maxCouverts: calculatedCouverts
    };
    setWijken([...wijken, newWijk]);
  };

  const handleUpdateWijk = (id: string, field: keyof Wijk, value: any) => {
    setWijken(wijken.map(w => w.id === id ? { ...w, [field]: value } : w));
  };

  const handleDeleteWijk = (id: string) => {
    setDeleteConfirm({ type: 'zone', id });
  };

  const confirmDelete = () => {
    if (deleteConfirm.type === 'zone' && deleteConfirm.id) {
      setWijken(wijken.filter(w => w.id !== deleteConfirm.id));
    } else if (deleteConfirm.type === 'event' && deleteConfirm.id) {
      onDeleteEvent(deleteConfirm.id);
    }
    setDeleteConfirm({ type: null, id: null });
  };

  const cancelDelete = () => {
    setDeleteConfirm({ type: null, id: null });
  };

  // --- Event Management ---
  const handleEventTitleChange = (eventId: string, newTitle: string) => {
    setEvents(prev => prev.map(e => e.id === eventId ? { ...e, title: newTitle } : e));
  };

  const handleEventDescriptionChange = (eventId: string, newDescription: string) => {
    setEvents(prev => prev.map(e => e.id === eventId ? { ...e, description: newDescription } : e));
  };

  const handleEventPriceChange = (eventId: string, newPrice: string) => {
    const priceNum = parseFloat(newPrice) || null;
    setEvents(prev => prev.map(e => e.id === eventId ? { ...e, price_per_person: priceNum } : e));
  };

  const handleSlotChange = (eventId: string, slotId: string, field: keyof Slot, value: any) => {
    setEvents(prev => prev.map(event => {
      if (event.id !== eventId) return event;
      return {
        ...event,
        slots: event.slots.map(slot => {
          if (slot.id !== slotId) return slot;
          return { ...slot, [field]: value };
        })
      };
    }));
  };

  const handleAddSlot = (eventId: string) => {
    setEvents(prev => prev.map(event => {
      if (event.id !== eventId) return event;
      const defaultWijk = wijken[0];

      // FIX: Build date in Amsterdam local time to prevent midnight shift
      // new Date().toISOString().split('T')[0] is UTC and can shift the day around midnight
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const localDate = `${year}-${month}-${day}`; // Local YYYY-MM-DD

      const newSlot: Slot = {
        id: `s-${Date.now()}`,
        date: localDate,
        time: '18:00',
        booked2tops: 0,
        booked4tops: 0,
        booked6tops: 0,
        wijkId: defaultWijk ? defaultWijk.id : undefined
      };
      return { ...event, slots: [...event.slots, newSlot] };
    }));
  };

  const handleDeleteSlot = (eventId: string, slotId: string) => {
    setEvents(prev => prev.map(event => {
      if (event.id !== eventId) return event;
      return { ...event, slots: event.slots.filter(s => s.id !== slotId) };
    }));
  };

  // AUDIT FIX: Send ISO date directly to backend (not Dutch format)
  // Backend parseSlotDateTime prefers ISO 8601 format: "2026-01-20"
  const handleDateSelect = (eventId: string, slotId: string, isoDate: string) => {
    // Store ISO date directly - backend handles timestamp conversion properly
    handleSlotChange(eventId, slotId, 'date', isoDate);
  };

  const toggleNextAvailable = (eventId: string, slotId: string) => {
    setEvents(prev => prev.map(event => {
      if (event.id !== eventId) return event;
      return {
        ...event,
        slots: event.slots.map(slot => {
          if (slot.id === slotId) return { ...slot, isNextAvailable: !slot.isNextAvailable };
          return { ...slot, isNextAvailable: false };
        })
      };
    }));
  };

  const adjustBookedTable = (eventId: string, slotId: string, type: '2' | '4' | '6', delta: number) => {
    setEvents(prev => prev.map(event => {
      if (event.id !== eventId) return event;
      return {
        ...event,
        slots: event.slots.map(slot => {
          if (slot.id !== slotId) return slot;

          if (type === '2') {
            return { ...slot, booked2tops: Math.max(0, slot.booked2tops + delta) };
          } else if (type === '4') {
            return { ...slot, booked4tops: Math.max(0, slot.booked4tops + delta) };
          } else {
            return { ...slot, booked6tops: Math.max(0, slot.booked6tops + delta) };
          }
        })
      };
    }));
  };

  return (
    <div className="w-full max-w-5xl mx-auto p-6 space-y-8 pb-20">

      {/* --- WIJK / ZONE CONFIGURATION --- */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <MapPin className="w-5 h-5 text-indigo-600" />
              Zone Configuration
            </h2>
            <p className="text-xs text-gray-500 mt-1">Configure the amount of tables per zone.</p>
          </div>
          <button onClick={handleAddWijk} className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100 hover:bg-indigo-100 transition-colors">
            + Add Zone
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {wijken.map(wijk => {
            // Calculate total seats from tables
            const calculatedSeats = (wijk.count2tops * 2) + (wijk.count4tops * 4) + (wijk.count6tops * 6);
            return (
              <div key={wijk.id} className="flex flex-col gap-3 bg-gray-50 p-3 rounded-lg border border-gray-200">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={wijk.name}
                    onChange={(e) => handleUpdateWijk(wijk.id, 'name', e.target.value)}
                    className="w-full text-sm font-bold bg-transparent border-none p-0 focus:ring-0 text-gray-800 placeholder-gray-400"
                    placeholder="Zone Name"
                  />
                  <button onClick={() => handleDeleteWijk(wijk.id)} className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Max Couverts Input */}
                <div className="bg-amber-50 p-2 rounded border border-amber-100">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] text-amber-600 font-medium uppercase">Max Couverts</div>
                      <div className="text-[9px] text-amber-500">Limiet per slot</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        max={200}
                        value={wijk.maxCouverts ?? calculatedSeats}
                        onChange={(e) => handleUpdateWijk(wijk.id, 'maxCouverts', parseInt(e.target.value) || calculatedSeats)}
                        className="w-16 text-center font-bold text-amber-700 bg-white border border-amber-200 rounded px-2 py-1 text-sm"
                      />
                      <span className="text-[9px] text-amber-500">/{calculatedSeats}</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-white p-2 rounded border border-gray-100 text-center">
                    <div className="text-[10px] text-gray-400 font-medium uppercase mb-1">2-Top</div>
                    <input
                      type="number"
                      value={wijk.count2tops}
                      onChange={(e) => handleUpdateWijk(wijk.id, 'count2tops', parseInt(e.target.value) || 0)}
                      className="w-full text-center font-bold text-gray-700 bg-transparent border-none p-0 focus:ring-0"
                    />
                  </div>
                  <div className="bg-white p-2 rounded border border-gray-100 text-center">
                    <div className="text-[10px] text-gray-400 font-medium uppercase mb-1">4-Top</div>
                    <input
                      type="number"
                      value={wijk.count4tops}
                      onChange={(e) => handleUpdateWijk(wijk.id, 'count4tops', parseInt(e.target.value) || 0)}
                      className="w-full text-center font-bold text-gray-700 bg-transparent border-none p-0 focus:ring-0"
                    />
                  </div>
                  <div className="bg-white p-2 rounded border border-gray-100 text-center">
                    <div className="text-[10px] text-gray-400 font-medium uppercase mb-1">6-Top</div>
                    <input
                      type="number"
                      value={wijk.count6tops}
                      onChange={(e) => handleUpdateWijk(wijk.id, 'count6tops', parseInt(e.target.value) || 0)}
                      className="w-full text-center font-bold text-gray-700 bg-transparent border-none p-0 focus:ring-0"
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* --- EVENT HEADER --- */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Event Manager</h1>
          <p className="text-sm text-gray-500">Manage time slots and simulate bookings.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onAddEvent}
            className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center gap-2 shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Event
          </button>
          <button
            onClick={handleSaveChanges}
            disabled={saving}
            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 shadow-sm transition-all ${saveStatus === 'success' ? 'bg-green-600 text-white' :
              saveStatus === 'error' ? 'bg-red-600 text-white' :
                saving ? 'bg-indigo-400 text-white cursor-wait' :
                  'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
          >
            {saving ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
            ) : saveStatus === 'success' ? (
              <><CheckCircle className="w-4 h-4" /> Saved!</>
            ) : saveStatus === 'error' ? (
              <><XCircle className="w-4 h-4" /> {saveMessage}</>
            ) : (
              <><Save className="w-4 h-4" /> Save Changes</>
            )}
          </button>
        </div>
      </div>

      {/* --- EVENTS LIST --- */}
      {events.map((event) => (
        <div key={event.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden transition-all hover:shadow-md">
          {/* Event Header */}
          <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
            <div className="flex items-center gap-4 group">
              <div className="p-2 bg-white rounded-md border border-gray-200 text-gray-400 cursor-move">
                <GripVertical className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Event Title</label>
                <input
                  type="text"
                  value={event.title}
                  onChange={(e) => handleEventTitleChange(event.id, e.target.value)}
                  className="w-full text-lg font-bold text-gray-900 bg-transparent border-none focus:ring-0 p-0 placeholder-gray-400"
                  placeholder="e.g. Taco Tuesday"
                />
              </div>
              <button
                onClick={() => setDeleteConfirm({ type: 'event', id: event.id })}
                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="Delete Event"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {/* Description and Price Row */}
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Description (optional)</label>
                <input
                  type="text"
                  value={event.description || ''}
                  onChange={(e) => handleEventDescriptionChange(event.id, e.target.value)}
                  className="w-full text-sm text-gray-700 bg-white border border-gray-200 rounded-lg px-3 py-2 placeholder-gray-400"
                  placeholder="A short description shown to customers"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Price per person (€)</label>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 font-medium">€</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={event.price_per_person || ''}
                    onChange={(e) => handleEventPriceChange(event.id, e.target.value)}
                    className="w-24 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg px-3 py-2 placeholder-gray-400"
                    placeholder="0.00"
                  />
                  <span className="text-xs text-gray-400">p.p.</span>
                </div>
              </div>
            </div>
          </div>

          {/* Slots Grid Editor */}
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-6">
              {event.slots.map((slot) => {
                const wijk = wijken.find(w => w.id === slot.wijkId);
                const max2 = wijk?.count2tops || 0;
                const max4 = wijk?.count4tops || 0;
                const max6 = wijk?.count6tops || 0;
                const isFull = (slot.booked2tops >= max2) && (slot.booked4tops >= max4) && (slot.booked6tops >= max6);

                return (
                  <div
                    key={slot.id}
                    className={`relative p-3 rounded-lg border-2 transition-colors group/slot overflow-hidden
                    ${isFull ? 'border-red-100 bg-red-50/50' : slot.isNextAvailable ? 'border-amber-200 bg-amber-50' : 'border-gray-100 hover:border-gray-200'}
                    `}
                  >
                    {/* Delete Slot */}
                    <button
                      onClick={() => handleDeleteSlot(event.id, slot.id)}
                      className="absolute -top-2 -left-2 p-1 bg-red-100 text-red-600 rounded-full opacity-0 group-hover/slot:opacity-100 transition-opacity scale-90 hover:scale-100 z-20 shadow-sm"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>

                    {/* Star Toggle */}
                    <button
                      onClick={() => toggleNextAvailable(event.id, slot.id)}
                      className={`absolute -top-2 -right-2 p-1.5 rounded-full border shadow-sm transition-colors z-10 ${slot.isNextAvailable ? 'bg-amber-100 border-amber-200 text-amber-500' : 'bg-white border-gray-200 text-gray-300 hover:text-gray-400'}`}
                      title="Toggle 'Next Available'"
                    >
                      <Star className="w-3.5 h-3.5 fill-current" />
                    </button>

                    <div className="space-y-3 pt-1">
                      {/* Date & Time & Zone */}
                      <div className="flex gap-2">
                        {/* Native Date Input (visible, works on Safari) */}
                        {/* P0-4 FIX: Controlled input shows existing date */}
                        <input
                          type="date"
                          value={slot.date?.match(/^\d{4}-\d{2}-\d{2}/) ? slot.date.slice(0, 10) : ''}
                          onChange={(e) => handleDateSelect(event.id, slot.id, e.target.value)}
                          className="w-28 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded px-2 py-1.5 cursor-pointer hover:border-indigo-300"
                        />
                        {/* Time Dropdown */}
                        <select
                          value={slot.time}
                          onChange={(e) => handleSlotChange(event.id, slot.id, 'time', e.target.value)}
                          className="w-20 text-sm font-bold text-gray-900 bg-white border border-gray-200 rounded px-1.5 py-1 text-center cursor-pointer"
                        >
                          {Array.from({ length: 48 }, (_, i) => {
                            const hours = Math.floor(i / 4) + 12; // Start at 12:00
                            const minutes = (i % 4) * 15;
                            const time = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
                            return <option key={time} value={time}>{time}</option>;
                          })}
                        </select>
                        {/* Zone Dropdown */}
                        <select
                          value={slot.wijkId || ''}
                          onChange={(e) => handleSlotChange(event.id, slot.id, 'wijkId', e.target.value)}
                          className="flex-1 min-w-0 max-w-[120px] text-xs bg-white border border-gray-200 rounded px-1.5 py-1 text-gray-600 truncate"
                        >
                          {wijken.map(w => (
                            <option key={w.id} value={w.id}>{w.name}</option>
                          ))}
                        </select>
                      </div>

                      {/* Inventory Grid */}
                      <div className="bg-white rounded border border-gray-200 p-2">
                        <div className="flex items-center justify-between text-[10px] text-gray-400 uppercase font-medium mb-1.5">
                          <span>Table Type</span>
                          <span>Booked / Total</span>
                        </div>

                        {/* 2 Tops */}
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-gray-600 font-medium w-12">2-Tops</span>
                          <div className="flex items-center gap-1">
                            <button onClick={() => adjustBookedTable(event.id, slot.id, '2', -1)} className="p-0.5 hover:bg-gray-100 rounded text-gray-400"><MinusCircle className="w-3 h-3" /></button>
                            <span className={`text-xs font-mono w-8 text-center ${slot.booked2tops >= max2 ? 'text-red-600 font-bold' : ''}`}>{slot.booked2tops}/{max2}</span>
                            <button onClick={() => adjustBookedTable(event.id, slot.id, '2', 1)} className="p-0.5 hover:bg-gray-100 rounded text-gray-400"><PlusCircle className="w-3 h-3" /></button>
                          </div>
                        </div>

                        {/* 4 Tops */}
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-gray-600 font-medium w-12">4-Tops</span>
                          <div className="flex items-center gap-1">
                            <button onClick={() => adjustBookedTable(event.id, slot.id, '4', -1)} className="p-0.5 hover:bg-gray-100 rounded text-gray-400"><MinusCircle className="w-3 h-3" /></button>
                            <span className={`text-xs font-mono w-8 text-center ${slot.booked4tops >= max4 ? 'text-red-600 font-bold' : ''}`}>{slot.booked4tops}/{max4}</span>
                            <button onClick={() => adjustBookedTable(event.id, slot.id, '4', 1)} className="p-0.5 hover:bg-gray-100 rounded text-gray-400"><PlusCircle className="w-3 h-3" /></button>
                          </div>
                        </div>

                        {/* 6 Tops */}
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-600 font-medium w-12">6-Tops</span>
                          <div className="flex items-center gap-1">
                            <button onClick={() => adjustBookedTable(event.id, slot.id, '6', -1)} className="p-0.5 hover:bg-gray-100 rounded text-gray-400"><MinusCircle className="w-3 h-3" /></button>
                            <span className={`text-xs font-mono w-8 text-center ${slot.booked6tops >= max6 ? 'text-red-600 font-bold' : ''}`}>{slot.booked6tops}/{max6}</span>
                            <button onClick={() => adjustBookedTable(event.id, slot.id, '6', 1)} className="p-0.5 hover:bg-gray-100 rounded text-gray-400"><PlusCircle className="w-3 h-3" /></button>
                          </div>
                        </div>

                      </div>

                    </div>
                  </div>
                );
              })}

              {/* Add Slot Button */}
              <button
                onClick={() => handleAddSlot(event.id)}
                className="flex flex-col items-center justify-center gap-2 p-3 rounded-lg border-2 border-dashed border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition-colors text-gray-400 hover:text-indigo-600 h-full min-h-[160px]"
              >
                <Plus className="w-6 h-6" />
                <span className="text-xs font-semibold">Add Slot</span>
              </button>
            </div>
          </div>
        </div>
      ))}

      {/* Delete Confirmation Modal */}
      {deleteConfirm.type && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-sm mx-4 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 mb-2">
              {deleteConfirm.type === 'zone' ? 'Delete Zone?' : 'Delete Event?'}
            </h3>
            <p className="text-sm text-gray-600 mb-6">
              {deleteConfirm.type === 'zone'
                ? 'Events using this zone may lose capacity settings. This action cannot be undone.'
                : 'This will permanently delete the event and all its slots. This action cannot be undone.'}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={cancelDelete}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};