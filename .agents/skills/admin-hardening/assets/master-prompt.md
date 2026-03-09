Use `$admin-hardening`.

You are working on the EVENTS restaurant admin booking system. Your job is to harden and clean up the existing codebase without losing feature coverage. Do not add new product scope until the current admin flows are robust.

Goals:
- preserve all current admin capabilities
- make booking logic consistent across Tafels, admin routes, public booking routes, and shared utils
- remove service-night risks where the UI and backend disagree
- improve admin usability so operators feel in control from the Tafels screen

Non-goals:
- do not invent new features unless needed to complete or preserve an existing one
- do not remove or silently simplify current features just because the code is messy
- do not redesign the whole product unless required to make an existing flow understandable

Primary surfaces:
- `components/TimelineGrid.tsx` is the live service console
- `server/routes/admin.js` is the authoritative admin backend
- `server/routes/public.js` still powers availability and some Tafels booking flows
- `server/utils.js` should hold shared booking math where possible
- `components/AdminDashboard.tsx` is setup/config
- `components/BookingsManager.tsx` is secondary overview unless explicitly upgraded

Required workflow:
1. Read the current implementation before changing anything.
2. Inventory the exact features involved in the target area.
3. State the invariant that must become true.
4. Trace every route and UI path that affects that invariant.
5. Fix shared/backend logic first.
6. Update UI to match the corrected rule.
7. Re-check that no feature was lost.
8. Run `npm run build`.
9. Run `npx tsc --noEmit`.
10. Summarize changed invariants, files changed, remaining risks, and manual verification needed.

Hard requirements:
- A table shown free in Tafels must also be bookable by the backend.
- A blocked table or blocked time range must never appear actionable.
- Opening hours and special-date overrides must agree across widget, availability, admin create, admin edit, and Tafels.
- Grouped bookings must behave as one logical reservation across render, edit, and status changes.
- Waitlist conversion must never drop a guest before a booking is actually created.
- Settings exposed in admin must either be enforced at runtime or removed from the UI in the same patch.
- Critical service actions should stay visible and usable on common screen sizes.

Features that must be preserved:
- Tafels day grid
- Tafels week summary
- quick-book
- walk-ins
- waitlist with notes and preferred time
- day notes
- full-day and timed table blocks
- bulk block for tonight
- grouped bookings
- booking details and edit modal
- status updates
- customer history and visit indicators
- restaurant setup for tables, zones, `can_combine`, hours, slot duration, max party size, buffer time, max covers per night

Prioritization:
1. booking integrity
2. occupancy correctness
3. opening-hours and block enforcement
4. grouped-booking consistency
5. waitlist and walk-in safety
6. settings/runtime consistency
7. admin usability and control clarity
8. cleanup and duplication reduction

Implementation rules:
- prefer tightening existing paths over creating new parallel logic
- prefer shared helpers over duplicated validation
- do not leave one admin flow stricter or looser than another without a deliberate reason
- if a screen is not the primary service console, make it feel secondary
- keep edits incremental and verifiable

At the end, report:
- features audited
- invariants fixed
- files changed
- tests/build/typecheck run
- remaining risks that still need user validation
