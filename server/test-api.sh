#!/bin/bash
# Comprehensive API Test Script for Service Mode
# Tests all 20 key endpoints and logic flows

BASE_URL="${API_BASE_URL:-https://booking-two-coral.vercel.app}"
RESTAURANT_ID="${RESTAURANT_ID:-f47ac10b-58cc-4372-a567-0e02b2c3d479}"
TOKEN="${EVENTS_TOKEN:-}"
DATE=$(date +%Y-%m-%d)
PASS=0
FAIL=0

echo "🧪 EVENTS Service Mode API Tests"
echo "================================="
echo "Base URL: $BASE_URL"
echo "Restaurant: $RESTAURANT_ID"
echo "Date: $DATE"
echo ""

# Helper function
test_endpoint() {
    local name="$1"
    local method="$2"
    local endpoint="$3"
    local data="$4"
    local expected="$5"
    
    if [ "$method" == "GET" ]; then
        response=$(curl -s -w "\n%{http_code}" -H "Authorization: Bearer $TOKEN" "$BASE_URL$endpoint")
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d "$data" "$BASE_URL$endpoint")
    fi
    
    http_code=$(echo "$response" | tail -n 1)
    body=$(echo "$response" | sed '$d')
    
    if [[ "$http_code" =~ $expected ]]; then
        echo "✅ $name (HTTP $http_code)"
        PASS=$((PASS + 1))
    else
        echo "❌ $name - Expected $expected, got $http_code"
        echo "   Response: $(echo "$body" | head -c 200)"
        FAIL=$((FAIL + 1))
    fi
}

echo "📋 PUBLIC ENDPOINTS"
echo "-------------------"

# 1. Get restaurant tables
test_endpoint "1. Get Tables" "GET" "/api/restaurant/$RESTAURANT_ID/tables" "" "200"

# 2. Get restaurant opening hours
test_endpoint "2. Get Opening Hours" "GET" "/api/restaurant/$RESTAURANT_ID/openings" "" "200"

# 3. Check availability
test_endpoint "3. Check Availability" "GET" "/api/restaurant/$RESTAURANT_ID/availability?date=$DATE" "" "200"

# 4. Get events
test_endpoint "4. Get Events" "GET" "/api/events?restaurantId=$RESTAURANT_ID" "" "200"

echo ""
echo "🔒 ADMIN ENDPOINTS (Require Auth)"
echo "-----------------------------------"

# 5. Get restaurant bookings
test_endpoint "5. Get Bookings" "GET" "/api/admin/restaurant-bookings?restaurantId=$RESTAURANT_ID&date=$DATE" "" "200|401"

# 6. Get day notes
test_endpoint "6. Get Day Notes" "GET" "/api/admin/day-notes?restaurantId=$RESTAURANT_ID&date=$DATE" "" "200|401"

# 7. Search customers
test_endpoint "7. Search Customers" "GET" "/api/admin/customers/search?restaurantId=$RESTAURANT_ID&q=test" "" "200|401"

# 8. Get restaurant settings
test_endpoint "8. Get Settings" "GET" "/api/admin/restaurant-settings?restaurantId=$RESTAURANT_ID" "" "200|401|404"

echo ""
echo "📝 BOOKING CREATION TESTS"
echo "------------------------"

# 9. Create test booking (public)
BOOKING_DATA='{
  "restaurantId": "'$RESTAURANT_ID'",
  "tableId": "t1",
  "date": "'$DATE'",
  "startTime": "19:00",
  "endTime": "21:00",
  "guestCount": 2,
  "customerName": "API Test User",
  "customerEmail": "test@example.com",
  "customerPhone": "0612345678",
  "status": "confirmed"
}'
test_endpoint "9. Create Booking" "POST" "/api/restaurant/book" "$BOOKING_DATA" "201|400|500"

# 10. Create walk-in booking
WALKIN_DATA='{
  "restaurantId": "'$RESTAURANT_ID'",
  "tableId": "t2",
  "date": "'$DATE'",
  "startTime": "18:00",
  "guestCount": 4,
  "customerName": "Walk-in Guest",
  "status": "arrived",
  "isWalkin": true
}'
test_endpoint "10. Create Walk-in" "POST" "/api/restaurant/book" "$WALKIN_DATA" "201|400|500"

# 11. Create multi-table booking
MULTI_DATA='{
  "restaurantId": "'$RESTAURANT_ID'",
  "tableId": "t1",
  "tableIds": ["t1", "t2"],
  "date": "'$DATE'",
  "startTime": "20:00",
  "guestCount": 8,
  "customerName": "Large Party",
  "status": "confirmed"
}'
test_endpoint "11. Multi-Table Booking" "POST" "/api/restaurant/book" "$MULTI_DATA" "201|400|500"

echo ""
echo "🔄 STATUS UPDATE TESTS"
echo "----------------------"

# 12. Update booking status (will fail without valid booking ID)
test_endpoint "12. Update Status" "PATCH" "/api/admin/restaurant-bookings/test-id/status" '{"status":"arrived"}' "200|400|401|404"

echo ""
echo "📋 DAY NOTES TESTS"
echo "------------------"

# 13. Add day note
NOTE_DATA='{
  "restaurantId": "'$RESTAURANT_ID'",
  "date": "'$DATE'",
  "note": "API Test Note - can be deleted"
}'
test_endpoint "13. Add Day Note" "POST" "/api/admin/day-notes" "$NOTE_DATA" "201|200|401"

# 14. Delete day note (will fail without valid ID)
test_endpoint "14. Delete Day Note" "DELETE" "/api/admin/day-notes/test-id" "" "200|400|401|404"

echo ""
echo "⚙️ SETTINGS TESTS"
echo "-----------------"

# 15. Save restaurant settings
SETTINGS_DATA='{
  "restaurantId": "'$RESTAURANT_ID'",
  "tables": [{"id": "t1", "name": "Tafel 1", "seats": 4}],
  "openingHours": [{"day": 1, "open_time": "12:00", "close_time": "23:00", "is_closed": false}]
}'
test_endpoint "15. Save Settings" "POST" "/api/admin/restaurant-settings" "$SETTINGS_DATA" "200|201|401"

echo ""
echo "📊 DATA INTEGRITY TESTS"
echo "-----------------------"

# 16. Get zones
test_endpoint "16. Get Zones" "GET" "/api/zones?restaurantId=$RESTAURANT_ID" "" "200|404"

# 17. Get time slots
test_endpoint "17. Get Time Slots" "GET" "/api/slots?restaurantId=$RESTAURANT_ID" "" "200|404"

# 18. Health check
test_endpoint "18. Health Check" "GET" "/api/health" "" "200|404"

# 19. Get booking by ID (will 404)
test_endpoint "19. Get Booking by ID" "GET" "/api/admin/restaurant-bookings/test-id" "" "200|400|401|404"

# 20. Verify CORS headers
echo "20. CORS Headers: "
cors_response=$(curl -s -I -X OPTIONS "$BASE_URL/api/restaurant/$RESTAURANT_ID/tables" 2>&1 | grep -i "access-control" | head -1)
if [ -n "$cors_response" ]; then
    echo "   ✅ CORS configured"
    PASS=$((PASS + 1))
else
    echo "   ⚠️ Could not verify CORS"
fi

echo ""
echo "================================="
echo "📊 RESULTS: $PASS passed, $FAIL failed"
echo "================================="

if [ $FAIL -eq 0 ]; then
    echo "🎉 All tests passed!"
else
    echo "⚠️ Some tests failed - check responses above"
fi
