/**
 * DST (Daylight Saving Time) Tests for Europe/Amsterdam
 * 
 * Run with: node tests/dst-tests.js
 */

import assert from 'assert';

// Helper to format dates in Amsterdam timezone
function formatAmsterdam(date) {
    return new Intl.DateTimeFormat('nl-NL', {
        timeZone: 'Europe/Amsterdam',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(date);
}

// Helper to parse ISO and return Amsterdam local time parts
function getAmsterdamParts(isoString) {
    const date = new Date(isoString);
    const formatted = formatAmsterdam(date);
    return { formatted, date };
}

console.log('🕐 Running DST Tests for Europe/Amsterdam\n');

// ============================================
// Test 1: Spring Forward (Last Sunday of March)
// 2026-03-29 02:00 → 03:00 (clock jumps forward, 02:xx doesn't exist)
// ============================================

console.log('Test 1: Spring Forward (March 29, 2026)');

// 01:30 exists
const beforeSpring = getAmsterdamParts('2026-03-29T00:30:00Z'); // 01:30 CET
console.log('  Before spring forward (00:30 UTC):', beforeSpring.formatted);
assert(beforeSpring.formatted.includes('01:30'), 'Should be 01:30 local');

// 03:30 exists (02:30 was skipped)
const afterSpring = getAmsterdamParts('2026-03-29T01:30:00Z'); // 03:30 CEST
console.log('  After spring forward (01:30 UTC):', afterSpring.formatted);
assert(afterSpring.formatted.includes('03:30'), 'Should be 03:30 local (02:30 skipped)');

console.log('  ✅ Spring forward test passed\n');

// ============================================
// Test 2: Fall Back (Last Sunday of October)
// 2026-10-25 03:00 → 02:00 (clock goes back, 02:xx happens twice)
// ============================================

console.log('Test 2: Fall Back (October 25, 2026)');

// First 02:30 (still CEST, UTC+2)
const beforeFall = getAmsterdamParts('2026-10-25T00:30:00Z'); // 02:30 CEST
console.log('  First 02:30 (00:30 UTC, still CEST):', beforeFall.formatted);
assert(beforeFall.formatted.includes('02:30'), 'Should be 02:30 local (first occurrence)');

// Second 02:30 (now CET, UTC+1)
const afterFall = getAmsterdamParts('2026-10-25T01:30:00Z'); // 02:30 CET
console.log('  Second 02:30 (01:30 UTC, now CET):', afterFall.formatted);
assert(afterFall.formatted.includes('02:30'), 'Should be 02:30 local (second occurrence)');

// 03:30 is unambiguous
const afterFallLater = getAmsterdamParts('2026-10-25T02:30:00Z'); // 03:30 CET
console.log('  After fall back (02:30 UTC):', afterFallLater.formatted);
assert(afterFallLater.formatted.includes('03:30'), 'Should be 03:30 local');

console.log('  ✅ Fall back test passed\n');

// ============================================
// Test 3: Midnight Boundary
// ============================================

console.log('Test 3: Midnight Boundary');

// 23:59 on one day
const beforeMidnight = getAmsterdamParts('2026-01-19T22:59:00Z'); // 23:59 CET
console.log('  Before midnight (22:59 UTC):', beforeMidnight.formatted);
assert(beforeMidnight.formatted.includes('23:59'), 'Should be 23:59');
assert(beforeMidnight.formatted.includes('19'), 'Should be day 19');

// 00:01 on next day
const afterMidnight = getAmsterdamParts('2026-01-19T23:01:00Z'); // 00:01 CET
console.log('  After midnight (23:01 UTC):', afterMidnight.formatted);
assert(afterMidnight.formatted.includes('00:01'), 'Should be 00:01');
assert(afterMidnight.formatted.includes('20'), 'Should be day 20');

console.log('  ✅ Midnight boundary test passed\n');

// ============================================
// Test 4: TIMESTAMPTZ round-trip
// ============================================

console.log('Test 4: ISO 8601 Round-Trip');

const isoInput = '2026-06-15T18:30:00+02:00'; // 18:30 CEST
const parsed = new Date(isoInput);
const utcIso = parsed.toISOString();
const amsterdamDisplay = formatAmsterdam(parsed);

console.log('  Input:', isoInput);
console.log('  UTC ISO:', utcIso);
console.log('  Amsterdam display:', amsterdamDisplay);

assert(utcIso === '2026-06-15T16:30:00.000Z', 'UTC should be 16:30');
assert(amsterdamDisplay.includes('18:30'), 'Amsterdam should show 18:30');

console.log('  ✅ Round-trip test passed\n');

// ============================================
// Summary
// ============================================

console.log('========================================');
console.log('🎉 All DST tests passed!');
console.log('========================================');
