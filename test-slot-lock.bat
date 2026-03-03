@echo off
REM ============================================
REM Slot Locking System - Quick Test Script (Windows)
REM ============================================

echo 🔍 Slot Locking System - Quick Test
echo ====================================
echo.

set API_BASE=http://localhost:8000
set TOKEN=%1

if "%TOKEN%"=="" (
    echo ❌ Error: JWT token required
    echo Usage: test-slot-lock.bat ^<your_jwt_token^>
    echo.
    echo Get your token from browser DevTools:
    echo 1. Open browser DevTools (F12)
    echo 2. Go to Application → Cookies
    echo 3. Copy the 'token' cookie value
    pause
    exit /b 1
)

set SLOT_ID=%2
if "%SLOT_ID%"=="" set SLOT_ID=123

set BOOKING_DATE=%3
if "%BOOKING_DATE%"=="" set BOOKING_DATE=2026-03-05

echo 📡 Test: Checking diagnostic endpoint...
echo GET /payment/slot-lock-status?slotId=%SLOT_ID%&bookingDate=%BOOKING_DATE%
echo.

curl -s -X GET "%API_BASE%/payment/slot-lock-status?slotId=%SLOT_ID%&bookingDate=%BOOKING_DATE%" -H "Content-Type: application/json" -H "Cookie: token=%TOKEN%"

echo.
echo ====================================
echo ✅ Test complete!
echo.
echo Next steps:
echo 1. Open two browsers with different customers
echo 2. Navigate to same service page
echo 3. Select same date and slot
echo 4. Click 'Book Now' in both browsers rapidly
echo 5. Check backend console for detailed logs
echo.
pause
