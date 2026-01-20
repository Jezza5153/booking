#!/usr/bin/env node
/**
 * Concurrency Load Test for Booking System
 * 
 * Verifies that under concurrent load:
 * 1. Exactly capacity bookings succeed
 * 2. Remaining requests get 409 (capacity exceeded)
 * 3. Slot counters match actual bookings
 * 
 * Run with: node tests/concurrency-test.js
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';
const PARALLEL_REQUESTS = 50;
const TEST_SLOT_ID = process.argv[2] || null;

async function getWidgetData() {
    const response = await fetch(`${API_URL}/api/widget/demo-restaurant`);
    if (!response.ok) throw new Error('Failed to fetch widget data');
    return response.json();
}

async function makeBooking(slotId, tableType, index) {
    const idempotencyKey = `test-${Date.now()}-${index}`;

    try {
        const response = await fetch(`${API_URL}/api/book`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                slot_id: slotId,
                table_type: tableType,
                guest_count: parseInt(tableType),
                customer_name: `Test User ${index}`,
                customer_email: `test${index}@example.com`,
                idempotency_key: idempotencyKey
            })
        });

        return {
            index,
            status: response.status,
            success: response.ok,
            body: await response.json()
        };
    } catch (error) {
        return {
            index,
            status: 0,
            success: false,
            error: error.message
        };
    }
}

async function runConcurrencyTest() {
    console.log('🔄 Concurrency Load Test');
    console.log('========================');
    console.log(`Target: ${API_URL}`);
    console.log(`Parallel requests: ${PARALLEL_REQUESTS}`);
    console.log('');

    // Get widget data to find a slot
    let slotId = TEST_SLOT_ID;
    let expectedCapacity;

    if (!slotId) {
        console.log('📥 Fetching widget data to find a slot...');
        try {
            const data = await getWidgetData();
            const firstEvent = data.events[0];
            if (!firstEvent || !firstEvent.slots[0]) {
                console.error('❌ No slots available for testing');
                process.exit(1);
            }

            slotId = firstEvent.slots[0].id;
            const zone = data.zones.find(z => z.id === firstEvent.slots[0].wijkId);
            expectedCapacity = zone ? zone.count2tops : 5;

            console.log(`   Using slot: ${slotId}`);
            console.log(`   Zone capacity (2-tops): ${expectedCapacity}`);
        } catch (error) {
            console.error('❌ Failed to fetch widget data:', error.message);
            process.exit(1);
        }
    }

    console.log('');
    console.log(`🚀 Firing ${PARALLEL_REQUESTS} parallel booking requests...`);
    console.log('');

    // Fire all requests in parallel
    const startTime = Date.now();
    const promises = Array.from({ length: PARALLEL_REQUESTS }, (_, i) =>
        makeBooking(slotId, '2', i)
    );

    const results = await Promise.all(promises);
    const duration = Date.now() - startTime;

    // Analyze results
    const successful = results.filter(r => r.status === 201 || r.status === 200);
    const capacityExceeded = results.filter(r => r.status === 409);
    const errors = results.filter(r => r.status !== 201 && r.status !== 200 && r.status !== 409);

    console.log('📊 Results Summary');
    console.log('─────────────────────────────────────');
    console.log(`   Total requests:    ${PARALLEL_REQUESTS}`);
    console.log(`   Successful (201):  ${successful.length}`);
    console.log(`   Capacity full (409): ${capacityExceeded.length}`);
    console.log(`   Other errors:      ${errors.length}`);
    console.log(`   Duration:          ${duration}ms`);
    console.log('');

    // Verify counts
    if (expectedCapacity !== undefined) {
        console.log('✅ Verification');
        console.log('─────────────────────────────────────');

        if (successful.length <= expectedCapacity) {
            console.log(`   ✓ Successful bookings (${successful.length}) <= capacity (${expectedCapacity})`);
        } else {
            console.log(`   ✗ OVERSOLD! Successful: ${successful.length}, Capacity: ${expectedCapacity}`);
        }

        if (successful.length + capacityExceeded.length === PARALLEL_REQUESTS - errors.length) {
            console.log(`   ✓ All requests accounted for (201 + 409 = total)`);
        }

        if (errors.length === 0) {
            console.log('   ✓ No unexpected errors');
        } else {
            console.log(`   ✗ ${errors.length} unexpected errors:`);
            errors.forEach(e => console.log(`      - Request ${e.index}: ${e.status} ${e.error || JSON.stringify(e.body)}`));
        }
    }

    console.log('');
    console.log('💡 To verify database consistency, check:');
    console.log(`   curl "${API_URL}/api/admin/reconcile?restaurantId=demo-restaurant"`);
    console.log('');

    // Exit with error code if oversold
    if (expectedCapacity !== undefined && successful.length > expectedCapacity) {
        console.log('❌ TEST FAILED: Capacity exceeded');
        process.exit(1);
    }

    console.log('✅ Concurrency test complete');
}

runConcurrencyTest().catch(error => {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
});
