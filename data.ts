import { EventData, Wijk } from './types';

export const WIJKEN_DATA: Wijk[] = [
  { id: 'w1', name: 'Binnen (Main)', count2tops: 5, count4tops: 5, count6tops: 2 }, // Total capacity ~ 42 pax
  { id: 'w2', name: 'Terras (Sunny)', count2tops: 8, count4tops: 2, count6tops: 0 }, // Small tables outside
  { id: 'w3', name: 'Serre', count2tops: 2, count4tops: 4, count6tops: 1 },
];

export const EVENTS_DATA: EventData[] = [
  {
    id: 'e1',
    title: 'Makkelijke maandag',
    slots: [
      { 
        id: 's1-1', date: 'Ma 14 okt', time: '17:00', isNextAvailable: true, wijkId: 'w1', 
        booked2tops: 1, booked4tops: 0, booked6tops: 0 
      },
      { 
        id: 's1-2', date: 'Ma 14 okt', time: '17:30', wijkId: 'w1', 
        booked2tops: 5, booked4tops: 5, booked6tops: 2 
      }, // Full
      { 
        id: 's1-3', date: 'Ma 14 okt', time: '18:00', wijkId: 'w1', 
        booked2tops: 4, booked4tops: 2, booked6tops: 0 
      },
      { 
        id: 's1-4', date: 'Ma 14 okt', time: '18:30', wijkId: 'w1', 
        booked2tops: 0, booked4tops: 0, booked6tops: 0 
      },
      { 
        id: 's1-5', date: 'Ma 14 okt', time: '19:00', wijkId: 'w1', 
        booked2tops: 2, booked4tops: 4, booked6tops: 1 
      },
    ]
  },
  {
    id: 'e2',
    title: 'Wijn en spijs',
    slots: [
      { 
        id: 's2-1', date: 'Vr 18 okt', time: '18:30', wijkId: 'w3', 
        booked2tops: 0, booked4tops: 0, booked6tops: 0 
      },
      { 
        id: 's2-2', date: 'Vr 18 okt', time: '19:00', wijkId: 'w3', 
        booked2tops: 2, booked4tops: 4, booked6tops: 1 
      }, // Full
    ]
  },
  {
    id: 'e3',
    title: 'Theaterweekend',
    slots: [
      { 
        id: 's3-1', date: 'Za 26 okt', time: '17:00', wijkId: 'w1', 
        booked2tops: 0, booked4tops: 1, booked6tops: 0 
      },
      { 
        id: 's3-2', date: 'Za 26 okt', time: '17:15', wijkId: 'w1', 
        booked2tops: 1, booked4tops: 0, booked6tops: 0 
      },
      { 
        id: 's3-3', date: 'Za 26 okt', time: '17:30', isNextAvailable: true, wijkId: 'w1', 
        booked2tops: 2, booked4tops: 2, booked6tops: 0 
      },
    ]
  }
];