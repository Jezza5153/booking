---
name: admin-hardening
description: Use when hardening, refactoring, auditing, or stabilizing the EVENTS admin booking system without losing existing features. Focus on Tafels, quick-book, walk-ins, waitlist, table blocking, grouped bookings, opening hours, settings, and shared booking logic before adding new features.
---

# Admin Hardening

Use this skill when the task is to make the admin booking system more robust, more consistent, and easier to operate without stripping out existing capability.

This skill is for stabilization work, not feature expansion.

## Primary Goal

Make the current system trustworthy on a busy service night.

That means:
- preserve current feature coverage
- remove logic drift between admin and public flows
- remove UI ambiguity about where operators should act
- tighten invariants around tables, time, capacity, status, and grouped bookings

## Canonical Surfaces

Treat these as the main sources of truth while working:
- `components/TimelineGrid.tsx`: primary live service console
- `server/routes/admin.js`: authoritative admin edit/status/settings logic
- `server/routes/public.js`: availability and public booking logic that Tafels still depends on in some paths
- `server/utils.js`: shared booking math and allocator behavior
- `components/AdminDashboard.tsx`: restaurant setup and operational settings
- `components/BookingsManager.tsx`: secondary overview, not the primary floor tool unless explicitly upgraded

## Features That Must Not Regress

Preserve all of these unless the user explicitly asks to remove or replace them:
- table grid day view
- week summary view
- quick-book from Tafels
- walk-in placement
- waitlist with preferred time and notes
- day notes
- full-day table block
- timed table block
- bulk block for tonight
- grouped multi-table bookings
- booking detail modal
- booking edit modal
- status changes: confirmed, arrived, no-show, cancelled
- customer history and visit indicators
- restaurant setup: tables, seats, zones, `can_combine`
- opening hours
- slot duration, max party size, buffer time, max covers per night
- public widget special-date closing behavior

Do not silently simplify a feature just to make the code cleaner.

## Hardening Workflow

Follow this order every time:

1. Inventory the existing feature behavior.
   - Read the relevant UI and route files first.
   - Write down what the feature currently does before changing it.

2. Define the invariant.
   - Example: "A table shown free in Tafels must also be bookable by the backend."
   - Example: "A grouped booking must behave as one reservation across render, edit, and status changes."

3. Trace every path that touches that invariant.
   - For booking flows, usually inspect:
   - `TimelineGrid.tsx`
   - `BookingsManager.tsx`
   - `server/routes/admin.js`
   - `server/routes/public.js`
   - `server/utils.js`

4. Fix the shared logic first.
   - Prefer aligning code paths over duplicating special-case patches.
   - If admin and public flows disagree, decide which rule is authoritative and make both honor it.

5. Patch UI only after the backend/runtime rule is correct.
   - UI should expose the rule clearly, not invent its own interpretation.

6. Verify feature parity.
   - Re-check that the original capability still exists after cleanup.
   - Do not accept "technically cleaner" if staff lose control.

7. Validate.
   - Run `npm run build`
   - Run `npx tsc --noEmit`
   - If you add or adjust tests, run the smallest relevant test target available.

## Stabilization Priorities

When multiple issues exist, prefer this order:

1. booking integrity
2. table occupancy correctness
3. opening-hours and blocking enforcement
4. grouped-booking consistency
5. waitlist and walk-in safety
6. setup/settings runtime consistency
7. UI discoverability and operator control
8. visual polish

## Required Invariants

When working on bookings, keep these invariants true:

- A table shown available in Tafels must pass backend validation.
- A blocked table or blocked time range must not appear usable.
- Opening hours, closures, and specific-date overrides must agree across widget, admin create, admin edit, and Tafels.
- Grouped bookings must render, edit, and status-update as one logical booking.
- Counts and stats must use primary-only logic where grouped rows are duplicates of the same party.
- Waitlist conversion must not destroy the source record before a booking exists.
- Setup values must either be truly enforced at runtime or clearly not exposed as controls.

## UI/UX Rules

For admin usability work:
- keep critical service actions visible on common device sizes
- do not hide core actions behind hover or right-click only interactions if touch use matters
- prefer one obvious service console over multiple competing restaurant boards
- icon-only controls are acceptable only if the action is already highly discoverable elsewhere
- if a control changes live capacity or booking eligibility, its current state should be visible without opening a modal

## Refactor Rules

- Do not remove fields from booking or walk-in modals unless a replacement exists in the same patch.
- Do not split validation logic into more places than before.
- Do not introduce a new route when an existing route should be made authoritative.
- Prefer shared helpers in `server/utils.js` when the same booking math is reused in more than one route.
- If a screen is secondary, make that explicit in the UI instead of letting it pretend to be authoritative.

## Review Checklist

Before finishing, explicitly check:
- Did any feature disappear?
- Did any admin flow become less permissive in a way that blocks legitimate service use?
- Did any public/admin rule drift remain?
- Can a host still complete the same task in the same or fewer steps?
- Are the numbers on screen consistent with grouped bookings and covers logic?

## Output Format

When reporting work:
- list features audited
- list invariants fixed
- list files changed
- call out any remaining operator risks
- state what was validated and what was not
