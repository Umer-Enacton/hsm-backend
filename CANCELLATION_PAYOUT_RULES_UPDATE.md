# Cancellation & Reschedule Payout Rules Update

## Overview
Updated the money flow rules for booking cancellations and reschedule fees.

---

## NEW MONEY FLOW RULES

### 1. Confirmed Booking Cancellation (₹500 example)
```
Customer gets back: ₹425 (85%)
Provider keeps:     ₹50  (10%) - compensation for holding the slot
Platform keeps:     ₹25  (5%)  - platform fee
```

### 2. Pending Booking Cancellation
```
Customer gets back: ₹500 (100% refund)
Provider gets:      ₹0
Platform gets:       ₹0
```

### 3. Provider Rejects Pending Booking
```
Customer gets back: ₹500 (100% refund)
Provider gets:      ₹0
Platform gets:       ₹0
```

### 4. Reschedule Fee (₹100 flat)
```
Customer pays: ₹100
When approved → ₹100 goes to PROVIDER (not platform)
```

### 5. Provider Declines Reschedule
```
Customer gets back: ₹100 (full refund)
```

### 6. Customer Cancels Reschedule Request
```
From the ₹100 reschedule fee:
Customer gets back: ₹50  (50% refund)
Provider keeps:     ₹50  (50%)
```

---

## SUMMARY TABLE

| Scenario | Customer Pays | Customer Gets Back | Provider Gets | Platform Gets |
|----------|--------------|-------------------|--------------|---------------|
| **New Booking** | ₹500 | - | - (₹475 later) | - (₹25 later) |
| **Cancel Pending** | ₹500 | ₹500 | ₹0 | ₹0 |
| **Cancel Confirmed** | ₹500 | ₹425 | ₹50 | ₹25 |
| **Reject Pending** | ₹500 | ₹500 | ₹0 | ₹0 |
| **Reschedule Fee** | ₹100 | - | ₹100 (when approved) | ₹0 |
| **Reschedule Declined** | - | ₹100 | ₹0 | ₹0 |
| **Reschedule Cancelled** | - | ₹50 | ₹50 | ₹0 |
| **Booking Completed** | - | - | ₹475 | ₹25 |

---

## FILES CHANGED

### Backend Controllers
1. **booking.controller.js**
   - `calculateCancellationRefund()`: Updated to 85/10/5 split for confirmed cancellations
   - `cancelBooking()`: Updated to track platform fee separately
   - `approveReschedule()`: Added tracking of reschedule fee going to provider
   - `cancelRescheduleRequest()`: Updated for 50/50 split when customer cancels

### Backend Schema (models/schema.js)
2. **bookings table** - Added fields:
   - `platformFeeAmount` - Track platform fee on confirmed cancellation
   - `rescheduleFeeProviderPayout` - Track reschedule fee amount for provider
   - `rescheduleFeePayoutStatus` - Track payout status

3. **payments table** - Added field:
   - `rescheduleFeePayoutStatus` - Track reschedule fee payout status

### Migration
4. **drizzle/0018_update_cancellation_payout_rules.sql** - Database migration for new fields

---

## DATABASE FIELDS

### Bookings Table
| Field | Type | Description |
|-------|------|-------------|
| `platformFeeAmount` | integer | Platform fee retained on cancellation (paise) |
| `rescheduleFeeProviderPayout` | integer | Reschedule fee going to provider (paise) |
| `rescheduleFeePayoutStatus` | varchar(20) | "pending", "paid" |

### Payments Table
| Field | Type | Description |
|-------|------|-------------|
| `rescheduleFeePayoutStatus` | varchar(20) | "pending", "paid" |

---

## API RESPONSE CHANGES

### Cancel Booking Response
```json
{
  "message": "Booking cancelled and refund initiated successfully",
  "booking": { ... },
  "refund": {
    "refundId": "refund_abc123",
    "refundAmount": 425,
    "refundPercentage": 85
  },
  "providerPayout": {
    "amount": 50,
    "percentage": 10,
    "status": "pending"
  },
  "platformFee": {
    "amount": 25,
    "percentage": 5,
    "status": "retained"
  }
}
```

### Cancel Reschedule Request Response
```json
{
  "message": "Reschedule request cancelled. Original booking time restored. 50% refund processed.",
  "refund": {
    "refundId": "refund_xyz789",
    "refundAmount": 50,
    "originalFee": 100
  },
  "providerPayout": {
    "amount": 50,
    "percentage": 50,
    "status": "pending"
  }
}
```

### Approve Reschedule Response
```json
{
  "message": "Reschedule approved successfully. Booking is now confirmed with the new time.",
  "booking": { ... },
  "rescheduleFeeToProvider": 100
}
```

---

## NOTES

1. **Provider CANNOT reject confirmed bookings** - They can only reschedule
2. **Reschedule fee is flat ₹100** regardless of booking amount
3. **Maximum 2 reschedules** per booking
4. **Confirmed booking cancellation** gives customer 85%, provider 10%, platform 5%
5. **All refunds** processed via Razorpay
6. **Reschedule fee now goes to provider** (not platform)
7. **Customer cancelling reschedule** results in 50/50 split

---

## MIGRATION APPLIED

Migration `0018_update_cancellation_payout_rules.sql` has been applied to the database.

To verify:
```bash
cd home-service-management-backend
psql $DATABASE_URL -c "\d bookings" | grep -E "(platform_fee_amount|reschedule_fee)"
```
