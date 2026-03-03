#!/bin/bash

# ============================================
# Slot Locking System - Quick Test Script
# ============================================

echo "🔍 Slot Locking System - Quick Test"
echo "===================================="
echo ""

API_BASE="http://localhost:8000"
TOKEN=$1  # Pass your JWT token as first argument

if [ -z "$TOKEN" ]; then
  echo "❌ Error: JWT token required"
  echo "Usage: ./test-slot-lock.sh <your_jwt_token>"
  echo ""
  echo "Get your token from browser DevTools:"
  echo "1. Open browser DevTools (F12)"
  echo "2. Go to Application → Cookies"
  echo "3. Copy the 'token' cookie value"
  exit 1
fi

# Test 1: Check diagnostic endpoint
echo "📡 Test 1: Checking diagnostic endpoint..."
SLOT_ID=${2:-123}
BOOKING_DATE=${3:-2026-03-05}

echo "GET /payment/slot-lock-status?slotId=$SLOT_ID&bookingDate=$BOOKING_DATE"
echo ""

RESPONSE=$(curl -s -X GET \
  "$API_BASE/payment/slot-lock-status?slotId=$SLOT_ID&bookingDate=$BOOKING_DATE" \
  -H "Content-Type: application/json" \
  -H "Cookie: token=$TOKEN")

echo "$RESPONSE" | python -m json.tool 2>/dev/null || echo "$RESPONSE"
echo ""

# Extract lock status
LOCKED=$(echo "$RESPONSE" | grep -o '"locked":[^,]*' | cut -d':' -f2)

if [ "$LOCKED" = "true" ]; then
  echo "✅ Slot is currently locked"
  echo ""
  echo "Pending Intents:"
  echo "$RESPONSE" | grep -o '"intentId":[^,]*' | cut -d':' -f2
else
  echo "✅ Slot is available"
fi

echo ""
echo "===================================="
echo "✅ Test complete!"
echo ""
echo "Next steps:"
echo "1. Open two browsers with different customers"
echo "2. Navigate to same service page"
echo "3. Select same date and slot"
echo "4. Click 'Book Now' in both browsers rapidly"
echo "5. Check backend console for detailed logs"
echo ""
