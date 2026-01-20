import React, { useState } from 'react';
import { EventData, Wijk } from '../types';
import { SlotBubble } from './SlotBubble';
import { ArrowRight, ExternalLink, Users, Mail, Armchair, Loader2, CheckCircle } from 'lucide-react';
import { bookTable, BookingRequest } from '../api';

interface EventCardProps {
  event: EventData;
  wijken: Wijk[];
  onBookingComplete?: () => void;
}

type TableType = '2' | '4' | '6' | '7+';

export const EventCard: React.FC<EventCardProps> = ({ event, wijken, onBookingComplete }) => {
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [selectedTableType, setSelectedTableType] = useState<TableType | null>(null);
  const [guestCount, setGuestCount] = useState<number | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerRemarks, setCustomerRemarks] = useState('');
  const [isBooking, setIsBooking] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);

  const handleSlotClick = (id: string) => {
    if (selectedSlotId === id) {
      // Deselect
      setSelectedSlotId(null);
      setSelectedTableType(null);
      setGuestCount(null);
      setBookingError(null);
    } else {
      // Select new
      setSelectedSlotId(id);
      setSelectedTableType(null);
      setGuestCount(null);
      setBookingError(null);
      setBookingSuccess(false);
    }
  };

  const handleTableTypeSelect = (type: TableType) => {
    setSelectedTableType(type);
    setGuestCount(null);
    setBookingError(null);
  };

  const handleBook = async () => {
    if (!selectedSlotId || !selectedTableType || !guestCount || selectedTableType === '7+') return;
    if (!customerName.trim()) {
      setBookingError('Vul alsjeblieft je naam in.');
      return;
    }

    setIsBooking(true);
    setBookingError(null);

    try {
      const booking: BookingRequest = {
        slot_id: selectedSlotId,
        table_type: selectedTableType,
        guest_count: guestCount,
        customer_name: customerName.trim(),
        customer_email: customerEmail || undefined,
        customer_phone: customerPhone || undefined,
        remarks: customerRemarks || undefined,
      };

      const result = await bookTable(booking);

      setBookingSuccess(true);

      // Notify parent to refresh data
      if (onBookingComplete) {
        onBookingComplete();
      }

      // Show success and reset after delay (no redirect)
      setTimeout(() => {
        setSelectedSlotId(null);
        setSelectedTableType(null);
        setGuestCount(null);
        setCustomerName('');
        setCustomerEmail('');
        setCustomerPhone('');
        setCustomerRemarks('');
        setBookingSuccess(false);
      }, 3000);

    } catch (error: any) {
      setBookingError(error.message || 'Booking failed. Please try again.');
    } finally {
      setIsBooking(false);
    }
  };

  const selectedSlot = event.slots.find(s => s.id === selectedSlotId);
  const slotCount = event.slots.length;

  // Calculate availability for the selected slot
  const wijk = selectedSlot ? wijken.find(w => w.id === selectedSlot.wijkId) : null;

  const availability = selectedSlot && wijk ? {
    free2: Math.max(0, wijk.count2tops - selectedSlot.booked2tops),
    free4: Math.max(0, wijk.count4tops - selectedSlot.booked4tops),
    free6: Math.max(0, wijk.count6tops - selectedSlot.booked6tops),
  } : { free2: 0, free4: 0, free6: 0 };

  return (
    <div className="flex flex-col gap-5 p-6 border-b border-[#2a2a2a] last:border-0 bg-[#0f0f0f] first:pt-8 last:pb-8">

      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-bold text-[#c9a227] tracking-tight">
          {event.title}
        </h2>
      </div>

      {/* Slots Layout */}
      {slotCount <= 3 ? (
        <div className="flex flex-wrap gap-4 justify-center py-2">
          {event.slots.map((slot) => (
            <div key={slot.id} className="w-full sm:w-auto min-w-[120px]">
              <SlotBubble
                slot={slot}
                isSelected={selectedSlotId === slot.id}
                onClick={() => handleSlotClick(slot.id)}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 min-[500px]:grid-cols-5 gap-3 sm:gap-4" role="group" aria-label={`Available slots for ${event.title}`}>
          {event.slots.map((slot) => (
            <div key={slot.id} className="col-span-1">
              <SlotBubble
                slot={slot}
                isSelected={selectedSlotId === slot.id}
                onClick={() => handleSlotClick(slot.id)}
              />
            </div>
          ))}
        </div>
      )}

      {/* EXPANDABLE BOOKING FLOW */}
      <div className={`
        overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.25,1,0.5,1)]
        ${selectedSlotId ? 'max-h-[600px] opacity-100 mt-2' : 'max-h-0 opacity-0 mt-0'}
      `}>
        <div className="bg-[#1a1a1a] rounded-2xl border border-[#2a2a2a] p-5 space-y-6">

          {/* Booking Success State */}
          {bookingSuccess && (
            <div className="flex flex-col items-center justify-center py-6 animate-in zoom-in-95">
              <div className="w-16 h-16 bg-[#c9a227]/20 rounded-full flex items-center justify-center mb-4">
                <CheckCircle className="w-10 h-10 text-[#c9a227]" />
              </div>
              <div className="text-lg font-bold text-[#c9a227]">Booking Confirmed!</div>
              <div className="text-sm text-gray-400">You're all set 🎉</div>
            </div>
          )}

          {/* Error Message */}
          {bookingError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center text-red-700 text-sm animate-in shake">
              {bookingError}
            </div>
          )}

          {/* Normal booking flow */}
          {!bookingSuccess && (
            <>
              {/* STEP 1: Select Table Type */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-gray-400 uppercase tracking-wider">
                  <Armchair className="w-3.5 h-3.5" />
                  Select a Table
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {/* 2-Top */}
                  <button
                    onClick={() => handleTableTypeSelect('2')}
                    disabled={availability.free2 === 0}
                    className={`
                        flex flex-col items-center justify-center p-3 rounded-xl border transition-all
                        ${selectedTableType === '2'
                        ? 'bg-white border-indigo-600 shadow-md ring-1 ring-indigo-100 text-indigo-700'
                        : availability.free2 === 0
                          ? 'bg-gray-100 border-transparent opacity-50 cursor-not-allowed text-gray-400'
                          : 'bg-white border-gray-200 hover:border-indigo-300 text-gray-700 hover:shadow-sm'
                      }
                      `}
                  >
                    <span className="text-sm font-bold">2-Pers</span>
                    <span className="text-[10px] font-medium opacity-60">
                      {availability.free2 === 0 ? 'Full' : `${availability.free2} left`}
                    </span>
                  </button>

                  {/* 4-Top */}
                  <button
                    onClick={() => handleTableTypeSelect('4')}
                    disabled={availability.free4 === 0}
                    className={`
                        flex flex-col items-center justify-center p-3 rounded-xl border transition-all
                        ${selectedTableType === '4'
                        ? 'bg-white border-indigo-600 shadow-md ring-1 ring-indigo-100 text-indigo-700'
                        : availability.free4 === 0
                          ? 'bg-gray-100 border-transparent opacity-50 cursor-not-allowed text-gray-400'
                          : 'bg-white border-gray-200 hover:border-indigo-300 text-gray-700 hover:shadow-sm'
                      }
                      `}
                  >
                    <span className="text-sm font-bold">4-Pers</span>
                    <span className="text-[10px] font-medium opacity-60">
                      {availability.free4 === 0 ? 'Full' : `${availability.free4} left`}
                    </span>
                  </button>

                  {/* 6-Top */}
                  <button
                    onClick={() => handleTableTypeSelect('6')}
                    disabled={availability.free6 === 0}
                    className={`
                        flex flex-col items-center justify-center p-3 rounded-xl border transition-all
                        ${selectedTableType === '6'
                        ? 'bg-white border-indigo-600 shadow-md ring-1 ring-indigo-100 text-indigo-700'
                        : availability.free6 === 0
                          ? 'bg-gray-100 border-transparent opacity-50 cursor-not-allowed text-gray-400'
                          : 'bg-white border-gray-200 hover:border-indigo-300 text-gray-700 hover:shadow-sm'
                      }
                      `}
                  >
                    <span className="text-sm font-bold">6-Pers</span>
                    <span className="text-[10px] font-medium opacity-60">
                      {availability.free6 === 0 ? 'Full' : `${availability.free6} left`}
                    </span>
                  </button>

                  {/* 7+ Group */}
                  <button
                    onClick={() => handleTableTypeSelect('7+')}
                    className={`
                        flex flex-col items-center justify-center p-3 rounded-xl border transition-all
                        ${selectedTableType === '7+'
                        ? 'bg-indigo-600 border-indigo-600 shadow-md text-white'
                        : 'bg-indigo-50 border-indigo-100 hover:border-indigo-300 text-indigo-700'
                      }
                      `}
                  >
                    <span className="text-sm font-bold">Group 7+</span>
                    <span className="text-[10px] font-medium opacity-80">
                      Request
                    </span>
                  </button>
                </div>
              </div>

              {/* STEP 2: Logic Branch */}
              {selectedTableType && (
                <div className="animate-in slide-in-from-top-2 fade-in duration-300">

                  {/* Branch A: Standard Table Selected */}
                  {selectedTableType !== '7+' && (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 text-xs font-bold text-gray-400 uppercase tracking-wider">
                        <Users className="w-3.5 h-3.5" />
                        Number of Guests
                      </div>

                      <div className="flex gap-2">
                        {(selectedTableType === '2' ? [1, 2] :
                          selectedTableType === '4' ? [3, 4] :
                            [5, 6]).map(num => (
                              <button
                                key={num}
                                onClick={() => setGuestCount(num)}
                                className={`
                                w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all
                                ${guestCount === num
                                    ? 'bg-[#c9a227] text-[#0f0f0f] shadow-lg scale-110'
                                    : 'bg-[#1a1a1a] border border-[#3a3a3a] text-white hover:border-[#c9a227]'
                                  }
                              `}
                              >
                                {num}
                              </button>
                            ))}
                      </div>

                      {/* Customer Details Form */}
                      {guestCount && (
                        <div className="space-y-3 animate-in fade-in">
                          {/* Name (Required) */}
                          <div>
                            <label className="text-xs font-medium text-gray-400">Naam *</label>
                            <input
                              type="text"
                              value={customerName}
                              onChange={(e) => setCustomerName(e.target.value)}
                              placeholder="Je naam"
                              required
                              className="w-full mt-1 px-4 py-3 rounded-xl bg-[#0f0f0f] border border-[#3a3a3a] text-white placeholder-gray-500 focus:border-[#c9a227] focus:ring-1 focus:ring-[#c9a227] outline-none transition-all"
                            />
                          </div>

                          {/* Email (Optional) */}
                          <div>
                            <label className="text-xs font-medium text-gray-400">E-mail (voor bevestiging)</label>
                            <input
                              type="email"
                              value={customerEmail}
                              onChange={(e) => setCustomerEmail(e.target.value)}
                              placeholder="email@voorbeeld.nl"
                              className="w-full mt-1 px-4 py-3 rounded-xl bg-[#0f0f0f] border border-[#3a3a3a] text-white placeholder-gray-500 focus:border-[#c9a227] focus:ring-1 focus:ring-[#c9a227] outline-none transition-all"
                            />
                          </div>

                          {/* Phone (Optional) */}
                          <div>
                            <label className="text-xs font-medium text-gray-400">Telefoon (optioneel)</label>
                            <input
                              type="tel"
                              value={customerPhone}
                              onChange={(e) => setCustomerPhone(e.target.value)}
                              placeholder="06-12345678"
                              className="w-full mt-1 px-4 py-3 rounded-xl bg-[#0f0f0f] border border-[#3a3a3a] text-white placeholder-gray-500 focus:border-[#c9a227] focus:ring-1 focus:ring-[#c9a227] outline-none transition-all"
                            />
                          </div>

                          {/* Remarks (Optional) */}
                          <div>
                            <label className="text-xs font-medium text-gray-400">Opmerkingen (optioneel)</label>
                            <textarea
                              value={customerRemarks}
                              onChange={(e) => setCustomerRemarks(e.target.value)}
                              placeholder="Bijv. allergieen, verjaardag, kinderstoel..."
                              rows={2}
                              className="w-full mt-1 px-4 py-3 rounded-xl bg-[#0f0f0f] border border-[#3a3a3a] text-white placeholder-gray-500 focus:border-[#c9a227] focus:ring-1 focus:ring-[#c9a227] outline-none transition-all resize-none"
                            />
                          </div>
                        </div>
                      )}

                      {/* Final Action Button */}
                      {guestCount && (
                        <div className="pt-2 animate-in fade-in slide-in-from-bottom-2">
                          <button
                            onClick={handleBook}
                            disabled={isBooking}
                            className="w-full bg-gradient-to-r from-[#c9a227] to-[#a08020] hover:from-[#d4af37] hover:to-[#b89828] disabled:from-gray-600 disabled:to-gray-700 text-[#0f0f0f] px-4 py-4 rounded-xl text-base font-bold transition-all shadow-lg shadow-[#c9a227]/20 hover:shadow-xl hover:shadow-[#c9a227]/30 hover:-translate-y-0.5 active:translate-y-0 flex items-center justify-center gap-2 group"
                          >
                            {isBooking ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Booking...
                              </>
                            ) : (
                              <>
                                Book {selectedSlot?.time} for {guestCount}
                                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Branch B: 7+ Group Selected */}
                  {selectedTableType === '7+' && (
                    <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 text-center space-y-3">
                      <div className="text-sm text-indigo-900 font-medium">
                        For groups of 7 or more, we arrange a special setup for you.
                      </div>
                      <a
                        href="mailto:reserveren@tafelaaramersfoort.nl?subject=Group Booking Request (7+)"
                        className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors shadow-sm"
                      >
                        <Mail className="w-4 h-4" />
                        Email Us
                      </a>
                      <div className="text-xs text-indigo-400">
                        reserveren@tafelaaramersfoort.nl
                      </div>
                    </div>
                  )}

                </div>
              )}
            </>
          )}

        </div>
      </div>

    </div>
  );
};