import { EventData, Slot, Wijk } from './types';

/**
 * Checks if a slot has a table available for the given party size
 */
export const isSlotAvailableForParty = (slot: Slot, wijk: Wijk | undefined, partySize: number): boolean => {
  if (!wijk) return false; // Safety fallback

  // Mapping:
  // 1-2 people -> Needs 2-top (or 4-top, or 6-top if we allow upgrade)
  // 3-4 people -> Needs 4-top (or 6-top)
  // 5-6 people -> Needs 6-top

  // Calculate remaining inventory
  const free2 = Math.max(0, wijk.count2tops - slot.booked2tops);
  const free4 = Math.max(0, wijk.count4tops - slot.booked4tops);
  const free6 = Math.max(0, wijk.count6tops - slot.booked6tops);

  if (partySize <= 2) {
    return free2 > 0 || free4 > 0 || free6 > 0;
  } else if (partySize <= 4) {
    return free4 > 0 || free6 > 0;
  } else if (partySize <= 6) {
    return free6 > 0;
  }

  return false; // > 6 not supported in this simple demo
};

/**
 * Formats a YYYY-MM-DD date string into the "ShortDay Day Month" format (e.g., "Ma 14 okt")
 */
export const formatDateToDutch = (isoDate: string): string => {
  if (!isoDate) return '';

  const date = new Date(isoDate);
  if (isNaN(date.getTime())) return isoDate;

  const formatter = new Intl.DateTimeFormat('nl-NL', {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });

  const parts = formatter.formatToParts(date);

  const weekday = parts.find(p => p.type === 'weekday')?.value || '';
  const day = parts.find(p => p.type === 'day')?.value || '';
  const month = parts.find(p => p.type === 'month')?.value || '';
  const cleanMonth = month.replace('.', '');

  return `${weekday.charAt(0).toUpperCase() + weekday.slice(1)} ${day} ${cleanMonth}`;
};

const parseDutchDateToObj = (dutchDateStr: string, timeStr: string): Date | null => {
  const months: Record<string, number> = {
    jan: 0, feb: 1, mrt: 2, apr: 3, mei: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, okt: 9, nov: 10, dec: 11
  };
  const weekdays = new Set(['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo', 'maa', 'din', 'woe', 'don', 'vri', 'zat', 'zon']);

  const normalized = String(dutchDateStr || '').trim().toLowerCase().replace(/\./g, '').replace(/,/g, ' ');
  if (!normalized) return null;

  const parts = normalized.split(/\s+/).filter(Boolean);
  const compact = parts.length > 0 && weekdays.has(parts[0]) ? parts.slice(1) : parts;
  if (compact.length < 2) return null;

  const day = parseInt(compact[0], 10);
  const monthIndex = months[compact[1]];
  if (Number.isNaN(day) || monthIndex === undefined) return null;

  const [hoursRaw, minutesRaw] = (timeStr || '12:00').split(':');
  const hours = parseInt(hoursRaw, 10);
  const minutes = parseInt(minutesRaw, 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;

  const explicitYear = compact.length >= 3 ? parseInt(compact[2], 10) : NaN;
  const now = new Date();
  let year = Number.isNaN(explicitYear) ? now.getFullYear() : explicitYear;
  const candidate = new Date(year, monthIndex, day, hours, minutes, 0, 0);

  if (Number.isNaN(explicitYear) && candidate.getTime() < now.getTime() - (30 * 24 * 60 * 60 * 1000)) {
    candidate.setFullYear(year + 1);
  }

  if (Number.isNaN(candidate.getTime())) return null;
  return candidate;
};

export const parseSlotDateForUi = (slot: Slot & { start_datetime?: string }): Date | null => {
  if (slot.start_datetime) {
    const iso = new Date(slot.start_datetime);
    if (!Number.isNaN(iso.getTime())) return iso;
  }

  const slotDate = String(slot.date || '').trim();
  if (!slotDate) return null;

  const [hoursRaw, minutesRaw] = (slot.time || '12:00').split(':');
  const hours = parseInt(hoursRaw, 10);
  const minutes = parseInt(minutesRaw, 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;

  const isoDateMatch = slotDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateMatch) {
    const year = parseInt(isoDateMatch[1], 10);
    const month = parseInt(isoDateMatch[2], 10) - 1;
    const day = parseInt(isoDateMatch[3], 10);
    const dt = new Date(year, month, day, hours, minutes, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(slotDate)) {
    const isoDateTime = new Date(slotDate);
    if (!Number.isNaN(isoDateTime.getTime())) return isoDateTime;
  }

  return parseDutchDateToObj(slotDate, slot.time || '12:00');
};

export const generateICalData = (events: EventData[], wijken: Wijk[]): string => {
  let icalContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//EVENTS Manager//Booking System//NL',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:EVENTS Bookings',
    'X-WR-TIMEZONE:Europe/Amsterdam'
  ];

  events.forEach(event => {
    event.slots.forEach(slot => {
      // P0-5 FIX: Support both ISO format (new) and Dutch format (legacy)
      const start = parseSlotDateForUi(slot as Slot & { start_datetime?: string });
      if (!start) return;

      const end = new Date(start.getTime() + (2 * 60 * 60 * 1000));
      const formatICalDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      const wijkName = wijken.find(w => w.id === slot.wijkId)?.name || 'General';

      const totalBookedTables = slot.booked2tops + slot.booked4tops + slot.booked6tops;
      const totalCapacityTables = wijken.find(w => w.id === slot.wijkId)
        ? (wijken.find(w => w.id === slot.wijkId)!.count2tops + wijken.find(w => w.id === slot.wijkId)!.count4tops + wijken.find(w => w.id === slot.wijkId)!.count6tops)
        : 0;

      icalContent.push('BEGIN:VEVENT');
      icalContent.push(`UID:${slot.id}@events-manager.app`);
      icalContent.push(`DTSTAMP:${formatICalDate(new Date())}`);
      icalContent.push(`DTSTART:${formatICalDate(start)}`);
      icalContent.push(`DTEND:${formatICalDate(end)}`);
      icalContent.push(`SUMMARY:(Tbls: ${totalBookedTables}/${totalCapacityTables}) ${event.title}`);
      icalContent.push(`DESCRIPTION:Zone: ${wijkName}\\n2-Tops: ${slot.booked2tops}\\n4-Tops: ${slot.booked4tops}\\n6-Tops: ${slot.booked6tops}`);
      icalContent.push(`LOCATION:Restaurant - ${wijkName}`);
      icalContent.push('STATUS:CONFIRMED');
      icalContent.push('END:VEVENT');
    });
  });

  icalContent.push('END:VCALENDAR');
  return icalContent.join('\r\n');
};
