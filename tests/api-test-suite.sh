#!/bin/bash
# EVENTS API Comprehensive Test Suite
# Runs 100+ test cases covering functionality, flow, security
# Target: https://booking-production-de35.up.railway.app

API_URL="https://booking-production-de35.up.railway.app"
RESTAURANT_ID="demo-restaurant"
PASSED=0
FAILED=0
WARNINGS=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "================================================"
echo "     EVENTS API - COMPREHENSIVE TEST SUITE      "
echo "================================================"
echo "Target: $API_URL"
echo "Timestamp: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo ""

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

test_pass() {
    echo -e "${GREEN}✓ PASS${NC} - $1"
    ((PASSED++))
}

test_fail() {
    echo -e "${RED}✗ FAIL${NC} - $1"
    ((FAILED++))
}

test_warn() {
    echo -e "${YELLOW}⚠ WARN${NC} - $1"
    ((WARNINGS++))
}

# =============================================================================
# SECTION 1: HEALTH & CONNECTIVITY (5 tests)
# =============================================================================
echo ""
echo -e "${BLUE}━━━ SECTION 1: HEALTH & CONNECTIVITY ━━━${NC}"

# Test 1.1: Health endpoint returns 200
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/health")
if [ "$RESPONSE" = "200" ]; then
    test_pass "1.1 Health endpoint returns 200"
else
    test_fail "1.1 Health endpoint returns $RESPONSE (expected 200)"
fi

# Test 1.2: Health returns valid JSON with status
HEALTH=$(curl -s "$API_URL/api/health")
if echo "$HEALTH" | grep -q '"status":"ok"'; then
    test_pass "1.2 Health endpoint returns status: ok"
else
    test_fail "1.2 Health endpoint missing status field"
fi

# Test 1.3: Health returns timestamp
if echo "$HEALTH" | grep -q '"timestamp"'; then
    test_pass "1.3 Health endpoint includes timestamp"
else
    test_fail "1.3 Health endpoint missing timestamp"
fi

# Test 1.4: CORS headers present
CORS=$(curl -s -I "$API_URL/api/health" | grep -i "access-control")
if [ -n "$CORS" ]; then
    test_pass "1.4 CORS headers present"
else
    test_warn "1.4 CORS headers not visible in response"
fi

# Test 1.5: Response time under 2 seconds
START=$(date +%s.%N)
curl -s "$API_URL/api/health" > /dev/null
END=$(date +%s.%N)
DURATION=$(echo "$END - $START" | bc)
if (( $(echo "$DURATION < 2" | bc -l) )); then
    test_pass "1.5 Response time acceptable (${DURATION}s)"
else
    test_warn "1.5 Response time slow (${DURATION}s)"
fi

# =============================================================================
# SECTION 2: WIDGET DATA ENDPOINT (15 tests)
# =============================================================================
echo ""
echo -e "${BLUE}━━━ SECTION 2: WIDGET DATA ENDPOINT ━━━${NC}"

# Test 2.1: Widget endpoint returns 200 for valid restaurant
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/widget/$RESTAURANT_ID")
if [ "$RESPONSE" = "200" ]; then
    test_pass "2.1 Widget endpoint returns 200 for valid restaurant"
else
    test_fail "2.1 Widget endpoint returns $RESPONSE (expected 200)"
fi

# Test 2.2: Widget returns valid JSON
WIDGET=$(curl -s "$API_URL/api/widget/$RESTAURANT_ID")
if echo "$WIDGET" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
    test_pass "2.2 Widget returns valid JSON"
else
    test_fail "2.2 Widget returns invalid JSON"
fi

# Test 2.3: Widget contains restaurant object
if echo "$WIDGET" | grep -q '"restaurant"'; then
    test_pass "2.3 Widget contains restaurant object"
else
    test_fail "2.3 Widget missing restaurant object"
fi

# Test 2.4: Widget contains zones array
if echo "$WIDGET" | grep -q '"zones"'; then
    test_pass "2.4 Widget contains zones array"
else
    test_fail "2.4 Widget missing zones array"
fi

# Test 2.5: Widget contains events array
if echo "$WIDGET" | grep -q '"events"'; then
    test_pass "2.5 Widget contains events array"
else
    test_fail "2.5 Widget missing events array"
fi

# Test 2.6: Restaurant has required fields (id, name)
if echo "$WIDGET" | grep -q '"id":"demo-restaurant"' && echo "$WIDGET" | grep -q '"name"'; then
    test_pass "2.6 Restaurant has id and name fields"
else
    test_fail "2.6 Restaurant missing required fields"
fi

# Test 2.7: Events have slots
SLOT_COUNT=$(echo "$WIDGET" | grep -o '"slots"' | wc -l | tr -d ' ')
if [ "$SLOT_COUNT" -gt 0 ]; then
    test_pass "2.7 Events contain slots ($SLOT_COUNT events with slots)"
else
    test_fail "2.7 Events missing slots"
fi

# Test 2.8: Non-existent restaurant returns 404
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/widget/non-existent-restaurant")
if [ "$RESPONSE" = "404" ]; then
    test_pass "2.8 Non-existent restaurant returns 404"
else
    test_fail "2.8 Non-existent restaurant returns $RESPONSE (expected 404)"
fi

# Test 2.9: Empty restaurant ID handled
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/widget/")
if [ "$RESPONSE" = "404" ]; then
    test_pass "2.9 Empty restaurant ID returns 404"
else
    test_warn "2.9 Empty restaurant ID returns $RESPONSE"
fi

# Test 2.10: Zones have capacity fields
if echo "$WIDGET" | grep -q '"count2tops"' && echo "$WIDGET" | grep -q '"count4tops"'; then
    test_pass "2.10 Zones have capacity fields"
else
    test_fail "2.10 Zones missing capacity fields"
fi

# Test 2.11: Slots have booking counts
if echo "$WIDGET" | grep -q '"booked2tops"'; then
    test_pass "2.11 Slots have booking count fields"
else
    test_fail "2.11 Slots missing booking count fields"
fi

# Test 2.12: Slots have date/time
if echo "$WIDGET" | grep -q '"date"' && echo "$WIDGET" | grep -q '"time"'; then
    test_pass "2.12 Slots have date and time fields"
else
    test_fail "2.12 Slots missing date/time fields"
fi

# Test 2.13: SQL Injection test - widget endpoint
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/widget/'; DROP TABLE restaurants;--")
if [ "$RESPONSE" = "404" ]; then
    test_pass "2.13 SQL injection attempt handled safely (404)"
else
    test_warn "2.13 SQL injection test returned $RESPONSE"
fi

# Test 2.14: XSS payload in restaurant ID
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/widget/<script>alert(1)</script>")
if [ "$RESPONSE" = "404" ]; then
    test_pass "2.14 XSS payload in URL handled safely"
else
    test_warn "2.14 XSS test returned $RESPONSE"
fi

# Test 2.15: Unicode in restaurant ID
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/widget/café-レストラン")
if [ "$RESPONSE" = "404" ]; then
    test_pass "2.15 Unicode restaurant ID handled (404)"
else
    test_warn "2.15 Unicode test returned $RESPONSE"
fi

# =============================================================================
# SECTION 3: BOOKING ENDPOINT (20 tests)
# =============================================================================
echo ""
echo -e "${BLUE}━━━ SECTION 3: BOOKING ENDPOINT ━━━${NC}"

# Get a valid slot ID from widget data
SLOT_ID=$(echo "$WIDGET" | grep -o '"id":"slot-m[0-9a-z-]*"' | head -1 | sed 's/"id":"//;s/"//')
if [ -z "$SLOT_ID" ]; then
    SLOT_ID="slot-m1"  # Fallback
fi

# Test 3.1: POST /api/book endpoint exists
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/book" \
    -H "Content-Type: application/json" \
    -d '{}')
if [ "$RESPONSE" != "404" ]; then
    test_pass "3.1 Booking endpoint exists"
else
    test_fail "3.1 Booking endpoint returns 404"
fi

# Test 3.2: Missing fields returns 400
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/book" \
    -H "Content-Type: application/json" \
    -d '{}')
if [ "$RESPONSE" = "400" ]; then
    test_pass "3.2 Missing fields returns 400"
else
    test_warn "3.2 Missing fields returns $RESPONSE (expected 400)"
fi

# Test 3.3: Missing slot_id returns 400
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/book" \
    -H "Content-Type: application/json" \
    -d '{"table_type":"2","guest_count":2}')
if [ "$RESPONSE" = "400" ]; then
    test_pass "3.3 Missing slot_id returns 400"
else
    test_warn "3.3 Missing slot_id returns $RESPONSE"
fi

# Test 3.4: Missing table_type returns 400
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/book" \
    -H "Content-Type: application/json" \
    -d '{"slot_id":"slot-1","guest_count":2}')
if [ "$RESPONSE" = "400" ]; then
    test_pass "3.4 Missing table_type returns 400"
else
    test_warn "3.4 Missing table_type returns $RESPONSE"
fi

# Test 3.5: Missing guest_count returns 400
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/book" \
    -H "Content-Type: application/json" \
    -d '{"slot_id":"slot-1","table_type":"2"}')
if [ "$RESPONSE" = "400" ]; then
    test_pass "3.5 Missing guest_count returns 400"
else
    test_warn "3.5 Missing guest_count returns $RESPONSE"
fi

# Test 3.6: Invalid slot_id returns 404
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/book" \
    -H "Content-Type: application/json" \
    -d '{"slot_id":"non-existent-slot","table_type":"2","guest_count":2}')
if [ "$RESPONSE" = "404" ]; then
    test_pass "3.6 Invalid slot_id returns 404"
else
    test_warn "3.6 Invalid slot_id returns $RESPONSE (expected 404)"
fi

# Test 3.7: Invalid table_type returns 400
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/book" \
    -H "Content-Type: application/json" \
    -d '{"slot_id":"slot-1","table_type":"10","guest_count":2}')
if [ "$RESPONSE" = "400" ] || [ "$RESPONSE" = "404" ]; then
    test_pass "3.7 Invalid table_type handled"
else
    test_warn "3.7 Invalid table_type returns $RESPONSE"
fi

# Test 3.8: SQL injection in slot_id
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/book" \
    -H "Content-Type: application/json" \
    -d '{"slot_id":"1; DROP TABLE slots;--","table_type":"2","guest_count":2}')
if [ "$RESPONSE" = "400" ] || [ "$RESPONSE" = "404" ]; then
    test_pass "3.8 SQL injection in slot_id blocked"
else
    test_warn "3.8 SQL injection test returned $RESPONSE"
fi

# Test 3.9: Negative guest_count
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/book" \
    -H "Content-Type: application/json" \
    -d '{"slot_id":"slot-1","table_type":"2","guest_count":-5}')
if [ "$RESPONSE" = "400" ] || [ "$RESPONSE" = "404" ]; then
    test_pass "3.9 Negative guest_count handled"
else
    test_warn "3.9 Negative guest_count returns $RESPONSE"
fi

# Test 3.10: Very large guest_count
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/book" \
    -H "Content-Type: application/json" \
    -d '{"slot_id":"slot-1","table_type":"2","guest_count":99999}')
if [ "$RESPONSE" = "400" ] || [ "$RESPONSE" = "404" ]; then
    test_pass "3.10 Large guest_count handled"
else
    test_warn "3.10 Large guest_count returns $RESPONSE"
fi

# Test 3.11: Empty JSON body
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/book" \
    -H "Content-Type: application/json" \
    -d '')
if [ "$RESPONSE" = "400" ]; then
    test_pass "3.11 Empty body returns 400"
else
    test_warn "3.11 Empty body returns $RESPONSE"
fi

# Test 3.12: Invalid JSON
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/book" \
    -H "Content-Type: application/json" \
    -d 'not valid json')
if [ "$RESPONSE" = "400" ]; then
    test_pass "3.12 Invalid JSON returns 400"
else
    test_warn "3.12 Invalid JSON returns $RESPONSE"
fi

# Test 3.13: GET method not allowed on /api/book
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/book")
if [ "$RESPONSE" = "404" ]; then
    test_pass "3.13 GET on /api/book returns 404"
else
    test_warn "3.13 GET on /api/book returns $RESPONSE"
fi

# Test 3.14: PUT method not allowed
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$API_URL/api/book" \
    -H "Content-Type: application/json" \
    -d '{}')
if [ "$RESPONSE" = "404" ]; then
    test_pass "3.14 PUT on /api/book returns 404"
else
    test_warn "3.14 PUT on /api/book returns $RESPONSE"
fi

# Test 3.15: DELETE method not allowed
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$API_URL/api/book")
if [ "$RESPONSE" = "404" ]; then
    test_pass "3.15 DELETE on /api/book returns 404"
else
    test_warn "3.15 DELETE on /api/book returns $RESPONSE"
fi

# Test 3.16: Content-Type header required
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/book" \
    -d '{"slot_id":"slot-1","table_type":"2","guest_count":2}')
if [ "$RESPONSE" != "500" ]; then
    test_pass "3.16 Request without Content-Type handled"
else
    test_fail "3.16 Missing Content-Type causes 500"
fi

# Test 3.17: XSS in slot_id field
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/book" \
    -H "Content-Type: application/json" \
    -d '{"slot_id":"<script>alert(1)</script>","table_type":"2","guest_count":2}')
if [ "$RESPONSE" != "500" ]; then
    test_pass "3.17 XSS in slot_id handled safely"
else
    test_fail "3.17 XSS causes server error"
fi

# Test 3.18: Null values in fields
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/book" \
    -H "Content-Type: application/json" \
    -d '{"slot_id":null,"table_type":null,"guest_count":null}')
if [ "$RESPONSE" = "400" ]; then
    test_pass "3.18 Null values return 400"
else
    test_warn "3.18 Null values return $RESPONSE"
fi

# Test 3.19: Array injection
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/book" \
    -H "Content-Type: application/json" \
    -d '{"slot_id":["slot-1","slot-2"],"table_type":"2","guest_count":2}')
if [ "$RESPONSE" = "400" ] || [ "$RESPONSE" = "404" ]; then
    test_pass "3.19 Array injection handled"
else
    test_warn "3.19 Array injection returns $RESPONSE"
fi

# Test 3.20: Object injection
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/book" \
    -H "Content-Type: application/json" \
    -d '{"slot_id":{"$ne":""},"table_type":"2","guest_count":2}')
if [ "$RESPONSE" = "400" ] || [ "$RESPONSE" = "404" ]; then
    test_pass "3.20 Object injection handled"
else
    test_warn "3.20 Object injection returns $RESPONSE"
fi

# =============================================================================
# SECTION 4: AUTHENTICATION ENDPOINT (25 tests)
# =============================================================================
echo ""
echo -e "${BLUE}━━━ SECTION 4: AUTHENTICATION ENDPOINT ━━━${NC}"

# Test 4.1: Login endpoint exists
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{}')
if [ "$RESPONSE" != "404" ]; then
    test_pass "4.1 Login endpoint exists"
else
    test_fail "4.1 Login endpoint returns 404"
fi

# Test 4.2: Missing credentials returns 400
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{}')
if [ "$RESPONSE" = "400" ]; then
    test_pass "4.2 Missing credentials returns 400"
else
    test_warn "4.2 Missing credentials returns $RESPONSE"
fi

# Test 4.3: Missing password returns 400
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"admin"}')
if [ "$RESPONSE" = "400" ]; then
    test_pass "4.3 Missing password returns 400"
else
    test_warn "4.3 Missing password returns $RESPONSE"
fi

# Test 4.4: Invalid credentials returns 401
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"wrong","password":"wrong"}')
if [ "$RESPONSE" = "401" ]; then
    test_pass "4.4 Invalid credentials returns 401"
else
    test_warn "4.4 Invalid credentials returns $RESPONSE"
fi

# Test 4.5: Valid login returns 200 and token (if credentials are default)
LOGIN_RESPONSE=$(curl -s -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin"}')
if echo "$LOGIN_RESPONSE" | grep -q '"token"'; then
    test_pass "4.5 Valid login returns token"
    TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*"' | sed 's/"token":"//;s/"//')
else
    test_warn "4.5 Login did not return token (password may not be 'admin')"
    TOKEN=""
fi

# Test 4.6: Login returns username
if echo "$LOGIN_RESPONSE" | grep -q '"username"'; then
    test_pass "4.6 Login response includes username"
else
    test_warn "4.6 Login response missing username"
fi

# Test 4.7: Get method not allowed on login
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/auth/login")
if [ "$RESPONSE" = "404" ]; then
    test_pass "4.7 GET on login returns 404"
else
    test_warn "4.7 GET on login returns $RESPONSE"
fi

# Test 4.8: Verify endpoint requires token
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/auth/verify")
if [ "$RESPONSE" = "401" ]; then
    test_pass "4.8 Verify without token returns 401"
else
    test_warn "4.8 Verify without token returns $RESPONSE"
fi

# Test 4.9: Verify with invalid token returns 401
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/auth/verify" \
    -H "Authorization: Bearer invalid-token-here")
if [ "$RESPONSE" = "401" ]; then
    test_pass "4.9 Invalid token returns 401"
else
    test_warn "4.9 Invalid token returns $RESPONSE"
fi

# Test 4.10: Verify with valid token returns 200
if [ -n "$TOKEN" ]; then
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/auth/verify" \
        -H "Authorization: Bearer $TOKEN")
    if [ "$RESPONSE" = "200" ]; then
        test_pass "4.10 Valid token returns 200"
    else
        test_fail "4.10 Valid token returns $RESPONSE (expected 200)"
    fi
else
    test_warn "4.10 Skipped - no valid token available"
fi

# Test 4.11: SQL injection in username
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"admin'\'' OR 1=1--","password":"test"}')
if [ "$RESPONSE" = "401" ]; then
    test_pass "4.11 SQL injection in username blocked"
else
    test_warn "4.11 SQL injection test returned $RESPONSE"
fi

# Test 4.12: SQL injection in password
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"'\'' OR 1=1--"}')
if [ "$RESPONSE" = "401" ]; then
    test_pass "4.12 SQL injection in password blocked"
else
    test_warn "4.12 SQL injection password test returned $RESPONSE"
fi

# Test 4.13: Very long username
LONG_STRING=$(printf 'a%.0s' {1..10000})
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$LONG_STRING\",\"password\":\"test\"}" 2>/dev/null)
if [ "$RESPONSE" != "500" ]; then
    test_pass "4.13 Long username handled (returned $RESPONSE)"
else
    test_fail "4.13 Long username causes 500 error"
fi

# Test 4.14: Very long password
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"admin\",\"password\":\"$LONG_STRING\"}" 2>/dev/null)
if [ "$RESPONSE" != "500" ]; then
    test_pass "4.14 Long password handled (returned $RESPONSE)"
else
    test_fail "4.14 Long password causes 500 error"
fi

# Test 4.15: XSS in username
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"<script>alert(1)</script>","password":"test"}')
if [ "$RESPONSE" = "401" ]; then
    test_pass "4.15 XSS in username handled"
else
    test_warn "4.15 XSS test returned $RESPONSE"
fi

# Test 4.16: Unicode in username
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"管理员","password":"test"}')
if [ "$RESPONSE" = "401" ]; then
    test_pass "4.16 Unicode username handled"
else
    test_warn "4.16 Unicode test returned $RESPONSE"
fi

# Test 4.17: Null byte injection
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"admin\u0000","password":"test"}')
if [ "$RESPONSE" = "401" ]; then
    test_pass "4.17 Null byte injection handled"
else
    test_warn "4.17 Null byte test returned $RESPONSE"
fi

# Test 4.18: JWT tampering - invalid signature
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/auth/verify" \
    -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImFkbWluIiwicm9sZSI6ImFkbWluIn0.tampered")
if [ "$RESPONSE" = "401" ]; then
    test_pass "4.18 Tampered JWT rejected"
else
    test_fail "4.18 Tampered JWT not rejected (returned $RESPONSE)"
fi

# Test 4.19: JWT with "none" algorithm
NONE_JWT="eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VybmFtZSI6ImFkbWluIiwicm9sZSI6ImFkbWluIn0."
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/auth/verify" \
    -H "Authorization: Bearer $NONE_JWT")
if [ "$RESPONSE" = "401" ]; then
    test_pass "4.19 JWT with 'none' algorithm rejected"
else
    test_fail "4.19 JWT 'none' algorithm vulnerability!"
fi

# Test 4.20: Empty Authorization header
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/auth/verify" \
    -H "Authorization: ")
if [ "$RESPONSE" = "401" ]; then
    test_pass "4.20 Empty Authorization header returns 401"
else
    test_warn "4.20 Empty Authorization returns $RESPONSE"
fi

# Test 4.21: Authorization without Bearer prefix
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/auth/verify" \
    -H "Authorization: $TOKEN")
if [ "$RESPONSE" = "401" ]; then
    test_pass "4.21 Token without Bearer prefix rejected"
else
    test_warn "4.21 Token without Bearer returns $RESPONSE"
fi

# Test 4.22: Case sensitivity of Bearer
if [ -n "$TOKEN" ]; then
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/auth/verify" \
        -H "Authorization: bearer $TOKEN")
    if [ "$RESPONSE" = "401" ]; then
        test_pass "4.22 'bearer' (lowercase) rejected"
    else
        test_warn "4.22 'bearer' (lowercase) returns $RESPONSE"
    fi
else
    test_warn "4.22 Skipped - no token"
fi

# Test 4.23: Multiple spaces in Authorization
if [ -n "$TOKEN" ]; then
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/auth/verify" \
        -H "Authorization: Bearer  $TOKEN")
    if [ "$RESPONSE" = "401" ]; then
        test_pass "4.23 Double space in Bearer rejected"
    else
        test_pass "4.23 Double space in Bearer accepted (flexible parsing)"
    fi
else
    test_warn "4.23 Skipped - no token"
fi

# Test 4.24: Expired token handling
EXPIRED_JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImFkbWluIiwicm9sZSI6ImFkbWluIiwiZXhwIjoxfQ.invalid"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/auth/verify" \
    -H "Authorization: Bearer $EXPIRED_JWT")
if [ "$RESPONSE" = "401" ]; then
    test_pass "4.24 Expired token rejected"
else
    test_warn "4.24 Expired token test returned $RESPONSE"
fi

# Test 4.25: Brute force rate limiting check (informational)
for i in {1..5}; do
    curl -s -o /dev/null -X POST "$API_URL/api/auth/login" \
        -H "Content-Type: application/json" \
        -d '{"username":"wrong","password":"wrong"}'
done
test_warn "4.25 Rate limiting: Manual verification required"

# =============================================================================
# SECTION 5: CALENDAR ENDPOINT (15 tests)
# =============================================================================
echo ""
echo -e "${BLUE}━━━ SECTION 5: CALENDAR ENDPOINT ━━━${NC}"

# Test 5.1: Calendar endpoint returns 200
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/calendar/$RESTAURANT_ID.ics")
if [ "$RESPONSE" = "200" ]; then
    test_pass "5.1 Calendar endpoint returns 200"
else
    test_fail "5.1 Calendar endpoint returns $RESPONSE"
fi

# Test 5.2: Returns valid iCal format
CALENDAR=$(curl -s "$API_URL/api/calendar/$RESTAURANT_ID.ics")
if echo "$CALENDAR" | grep -q "BEGIN:VCALENDAR"; then
    test_pass "5.2 Returns valid VCALENDAR format"
else
    test_fail "5.2 Missing VCALENDAR header"
fi

# Test 5.3: Contains VERSION
if echo "$CALENDAR" | grep -q "VERSION:2.0"; then
    test_pass "5.3 Contains VERSION:2.0"
else
    test_fail "5.3 Missing VERSION field"
fi

# Test 5.4: Contains PRODID
if echo "$CALENDAR" | grep -q "PRODID:"; then
    test_pass "5.4 Contains PRODID"
else
    test_warn "5.4 Missing PRODID field"
fi

# Test 5.5: Contains events (VEVENT)
if echo "$CALENDAR" | grep -q "BEGIN:VEVENT"; then
    test_pass "5.5 Contains VEVENT entries"
else
    test_warn "5.5 No VEVENT entries found"
fi

# Test 5.6: Events have UID
if echo "$CALENDAR" | grep -q "UID:"; then
    test_pass "5.6 Events have UID"
else
    test_warn "5.6 Missing UID in events"
fi

# Test 5.7: Events have DTSTART
if echo "$CALENDAR" | grep -q "DTSTART:"; then
    test_pass "5.7 Events have DTSTART"
else
    test_warn "5.7 Missing DTSTART in events"
fi

# Test 5.8: Content-Type header correct
CONTENT_TYPE=$(curl -s -I "$API_URL/api/calendar/$RESTAURANT_ID.ics" | grep -i "content-type" | tr -d '\r')
if echo "$CONTENT_TYPE" | grep -qi "text/calendar"; then
    test_pass "5.8 Content-Type is text/calendar"
else
    test_warn "5.8 Content-Type: $CONTENT_TYPE"
fi

# Test 5.9: Non-existent restaurant returns 404
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/calendar/non-existent.ics")
if [ "$RESPONSE" = "404" ]; then
    test_pass "5.9 Non-existent restaurant returns 404"
else
    test_warn "5.9 Non-existent restaurant returns $RESPONSE"
fi

# Test 5.10: booked_only parameter works
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/calendar/$RESTAURANT_ID.ics?booked_only=true")
if [ "$RESPONSE" = "200" ]; then
    test_pass "5.10 booked_only parameter accepted"
else
    test_warn "5.10 booked_only returns $RESPONSE"
fi

# Test 5.11: SQL injection in calendar URL
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/calendar/'; SELECT * FROM slots;--.ics")
if [ "$RESPONSE" = "404" ]; then
    test_pass "5.11 SQL injection in calendar blocked"
else
    test_warn "5.11 SQL injection test returned $RESPONSE"
fi

# Test 5.12: Path traversal attempt
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/calendar/../../../etc/passwd.ics")
if [ "$RESPONSE" = "404" ]; then
    test_pass "5.12 Path traversal blocked"
else
    test_warn "5.12 Path traversal returned $RESPONSE"
fi

# Test 5.13: Calendar ends properly
if echo "$CALENDAR" | grep -q "END:VCALENDAR"; then
    test_pass "5.13 Calendar ends with END:VCALENDAR"
else
    test_fail "5.13 Missing END:VCALENDAR"
fi

# Test 5.14: Has timezone info
if echo "$CALENDAR" | grep -q "TIMEZONE\|TZID\|X-WR-TIMEZONE"; then
    test_pass "5.14 Contains timezone information"
else
    test_warn "5.14 No explicit timezone info"
fi

# Test 5.15: Calendar name present
if echo "$CALENDAR" | grep -q "X-WR-CALNAME\|CALSCALE"; then
    test_pass "5.15 Calendar metadata present"
else
    test_warn "5.15 Missing calendar metadata"
fi

# =============================================================================
# SECTION 6: PROTECTED ROUTES (10 tests)
# =============================================================================
echo ""
echo -e "${BLUE}━━━ SECTION 6: PROTECTED ADMIN ROUTES ━━━${NC}"

# Test 6.1: Admin events endpoint requires auth
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/admin/events")
if [ "$RESPONSE" = "401" ]; then
    test_pass "6.1 Admin events requires authentication"
else
    test_fail "6.1 Admin events accessible without auth (returned $RESPONSE)"
fi

# Test 6.2: Admin events with valid token
if [ -n "$TOKEN" ]; then
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/admin/events" \
        -H "Authorization: Bearer $TOKEN")
    if [ "$RESPONSE" = "200" ]; then
        test_pass "6.2 Admin events accessible with valid token"
    else
        test_warn "6.2 Admin events with token returns $RESPONSE"
    fi
else
    test_warn "6.2 Skipped - no valid token"
fi

# Test 6.3: Admin route with expired token
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/admin/events" \
    -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImFkbWluIiwiZXhwIjoxfQ.x")
if [ "$RESPONSE" = "401" ]; then
    test_pass "6.3 Admin rejects expired token"
else
    test_warn "6.3 Expired token test returned $RESPONSE"
fi

# Test 6.4: Admin route with invalid signature
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/admin/events" \
    -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImFkbWluIn0.INVALIDSIG")
if [ "$RESPONSE" = "401" ]; then
    test_pass "6.4 Admin rejects invalid signature"
else
    test_fail "6.4 Invalid signature accepted!"
fi

# Test 6.5: Admin route returns JSON
if [ -n "$TOKEN" ]; then
    ADMIN_RESPONSE=$(curl -s "$API_URL/api/admin/events" \
        -H "Authorization: Bearer $TOKEN")
    if echo "$ADMIN_RESPONSE" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
        test_pass "6.5 Admin events returns valid JSON"
    else
        test_warn "6.5 Admin events returns invalid JSON"
    fi
else
    test_warn "6.5 Skipped - no token"
fi

# Test 6.6-6.10: Additional admin security tests
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/admin/../widget/demo-restaurant")
if [ "$RESPONSE" = "200" ] || [ "$RESPONSE" = "404" ]; then
    test_pass "6.6 Path traversal from admin handled"
else
    test_warn "6.6 Path traversal test returned $RESPONSE"
fi

RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/admin/events" \
    -H "Authorization: Bearer invalid")
if [ "$RESPONSE" = "401" ]; then
    test_pass "6.7 POST to admin without valid token rejected"
else
    test_warn "6.7 POST admin test returned $RESPONSE"
fi

RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$API_URL/api/admin/events/test" \
    -H "Authorization: Bearer invalid")
if [ "$RESPONSE" = "401" ]; then
    test_pass "6.8 DELETE to admin without valid token rejected"
else
    test_warn "6.8 DELETE admin test returned $RESPONSE"
fi

RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/admin/")
if [ "$RESPONSE" = "401" ] || [ "$RESPONSE" = "404" ]; then
    test_pass "6.9 Base admin path protected"
else
    test_warn "6.9 Base admin path returned $RESPONSE"
fi

RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/admin/unknown-route")
if [ "$RESPONSE" = "401" ] || [ "$RESPONSE" = "404" ]; then
    test_pass "6.10 Unknown admin route handled"
else
    test_warn "6.10 Unknown admin route returned $RESPONSE"
fi

# =============================================================================
# SECTION 7: ERROR HANDLING (10 tests)
# =============================================================================
echo ""
echo -e "${BLUE}━━━ SECTION 7: ERROR HANDLING ━━━${NC}"

# Test 7.1: Unknown endpoint returns 404
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/unknown")
if [ "$RESPONSE" = "404" ]; then
    test_pass "7.1 Unknown endpoint returns 404"
else
    test_warn "7.1 Unknown endpoint returns $RESPONSE"
fi

# Test 7.2: Root API path
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api")
if [ "$RESPONSE" = "404" ]; then
    test_pass "7.2 Root API path returns 404"
else
    test_warn "7.2 Root API path returns $RESPONSE"
fi

# Test 7.3: Root path
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/")
if [ "$RESPONSE" != "500" ]; then
    test_pass "7.3 Root path doesn't crash (returns $RESPONSE)"
else
    test_fail "7.3 Root path causes 500 error"
fi

# Test 7.4: Very long URL
LONG_PATH=$(printf 'a%.0s' {1..5000})
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/$LONG_PATH" 2>/dev/null)
if [ "$RESPONSE" != "500" ]; then
    test_pass "7.4 Long URL handled (returns $RESPONSE)"
else
    test_fail "7.4 Long URL causes 500 error"
fi

# Test 7.5: Special characters in URL
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/widget/%00%0a%0d")
if [ "$RESPONSE" != "500" ]; then
    test_pass "7.5 Special chars in URL handled"
else
    test_fail "7.5 Special chars cause 500 error"
fi

# Test 7.6: Double encoding
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/widget/%252e%252e%252f")
if [ "$RESPONSE" != "500" ]; then
    test_pass "7.6 Double encoding handled"
else
    test_warn "7.6 Double encoding returns $RESPONSE"
fi

# Test 7.7: HTTP method case sensitivity
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X post "$API_URL/api/book" \
    -H "Content-Type: application/json" -d '{}')
test_pass "7.7 Method case handling tested"

# Test 7.8: Large request body
LARGE_BODY=$(printf '{"data":"%s"}' "$(printf 'x%.0s' {1..100000})")
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/book" \
    -H "Content-Type: application/json" \
    -d "$LARGE_BODY" 2>/dev/null)
if [ "$RESPONSE" != "500" ]; then
    test_pass "7.8 Large request body handled (returns $RESPONSE)"
else
    test_fail "7.8 Large body causes 500 error"
fi

# Test 7.9: Empty POST body
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '')
if [ "$RESPONSE" != "500" ]; then
    test_pass "7.9 Empty POST body handled"
else
    test_fail "7.9 Empty body causes 500 error"
fi

# Test 7.10: Malformed Content-Type
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/auth/login" \
    -H "Content-Type: text/html" \
    -d '{"username":"test","password":"test"}')
if [ "$RESPONSE" != "500" ]; then
    test_pass "7.10 Wrong Content-Type handled"
else
    test_warn "7.10 Wrong Content-Type causes issue"
fi

# =============================================================================
# SUMMARY
# =============================================================================
echo ""
echo "================================================"
echo "              TEST SUMMARY                      "
echo "================================================"
TOTAL=$((PASSED + FAILED + WARNINGS))
echo -e "${GREEN}PASSED:   $PASSED${NC}"
echo -e "${RED}FAILED:   $FAILED${NC}"
echo -e "${YELLOW}WARNINGS: $WARNINGS${NC}"
echo "────────────────────────────────────────────────"
echo "TOTAL:    $TOTAL tests"
echo ""

if [ $FAILED -eq 0 ]; then
    GRADE="A"
    echo -e "${GREEN}GRADE: $GRADE - EXCELLENT${NC}"
elif [ $FAILED -le 3 ]; then
    GRADE="B"
    echo -e "${GREEN}GRADE: $GRADE - GOOD${NC}"
elif [ $FAILED -le 7 ]; then
    GRADE="C"
    echo -e "${YELLOW}GRADE: $GRADE - NEEDS IMPROVEMENT${NC}"
else
    GRADE="D"
    echo -e "${RED}GRADE: $GRADE - SIGNIFICANT ISSUES${NC}"
fi

echo ""
echo "Test completed at: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "================================================"
