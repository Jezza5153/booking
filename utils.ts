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
  try {
    const parts = dutchDateStr.split(' ');
    if (parts.length < 3) return null;

    const day = parseInt(parts[1], 10);
    const monthStr = parts[2].toLowerCase().replace('.', '');

    const months: Record<string, number> = {
      'jan': 0, 'feb': 1, 'mrt': 2, 'apr': 3, 'mei': 4, 'jun': 5,
      'jul': 6, 'aug': 7, 'sep': 8, 'okt': 9, 'nov': 10, 'dec': 11
    };

    const month = months[monthStr];
    if (month === undefined) return null;

    const [hours, minutes] = timeStr.split(':').map(n => parseInt(n, 10));

    const now = new Date();
    let year = now.getFullYear();
    const candidate = new Date(year, month, day, hours, minutes);

    if (candidate.getTime() < now.getTime() - (30 * 24 * 60 * 60 * 1000)) {
      candidate.setFullYear(year + 1);
    }

    return candidate;
  } catch (e) {
    return null;
  }
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
      let start: Date | null;
      if (slot.date?.match(/^\d{4}-\d{2}-\d{2}/)) {
        // ISO format: "2026-01-20"
        const [hours, minutes] = (slot.time || '12:00').split(':').map(n => parseInt(n, 10));
        start = new Date(slot.date);
        start.setHours(hours, minutes, 0, 0);
      } else {
        // Dutch format fallback: "Ma 21 jan"
        start = parseDutchDateToObj(slot.date, slot.time);
      }
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