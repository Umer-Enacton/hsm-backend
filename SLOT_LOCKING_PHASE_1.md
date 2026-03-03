# Slot Locking System - Phase 1: Database Schema Changes

## 📅 Date: March 3, 2026

## ✅ Status: COMPLETED

---

## 🎯 Objective

Add database-level constraint to prevent race conditions when multiple customers try to book the same slot simultaneously.

---

## 🔧 Changes Made

### File: `models/schema.js`

#### 1. Added `uniqueIndex` and `sql` Imports

```javascript
const {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  boolean,
  decimal,
  time,
  pgEnum,
  uniqueIndex,  // ✨ NEW
} = require("drizzle-orm/pg-core");

const { sql } = require("drizzle-orm");  // ✨ NEW
```

#### 2. Added Partial Unique Index to `paymentIntents` Table

**Location:** Lines 185-202

**Before:**
```javascript
const paymentIntents = pgTable("payment_intents", {
  id: serial("id").primaryKey(),
  // ... columns
  expiresAt: timestamp("expires_at").notNull(), // Lock expires after 2 minutes
  // ...
});
```

**After:**
```javascript
const paymentIntents = pgTable("payment_intents", {
  id: serial("id").primaryKey(),
  // ... columns
  expiresAt: timestamp("expires_at").notNull(), // Lock expires after 1 minute
  // ...
}, (table) => ({
  // ✨ NEW: Partial unique index
  // Only one pending intent per slot per date
  slotDatePendingUnique: uniqueIndex("payment_intents_slot_date_pending_unique")
    .on(table.slotId, table.bookingDate)
    .where(sql`${table.status} = 'pending'`),
}));
```

---

## 🗄️ Database Changes

### Unique Index Created

**Name:** `payment_intents_slot_date_pending_unique`

**Columns:**
- `slotId`
- `bookingDate`

**Condition:** `status = 'pending'` (partial index)

**Purpose:** Ensures that for any slot + date combination, there can be only ONE payment_intent with status='pending'.

### How It Works

```sql
-- PostgreSQL automatically creates this index:
CREATE UNIQUE INDEX payment_intents_slot_date_pending_unique
ON payment_intents (slotId, bookingDate)
WHERE status = 'pending';
```

**What This Prevents:**
- ❌ Before: Two customers could both create pending payment_intents for the same slot
- ✅ Now: Only ONE customer can create a pending payment_intent per slot per date

**Example Scenario:**
```
Customer 1: INSERT INTO payment_intents (slotId=378, bookingDate='2026-03-05', status='pending')
            → ✅ SUCCESS (creates lock)

Customer 2: INSERT INTO payment_intents (slotId=378, bookingDate='2026-03-05', status='pending')
            → ❌ UNIQUE VIOLATION ERROR (slot already locked)
```

---

## 📊 Impact on ACID Properties

| Property | Before Phase 1 | After Phase 1 |
|----------|---------------|---------------|
| **Atomicity** | ❌ Race condition possible | ✅ Database constraint prevents duplicate locks |
| **Consistency** | ⚠️ Application-level checks only | ✅ Database-enforced consistency |
| **Isolation** | ⚠️ SERIALIZABLE alone not enough | ✅ SERIALIZABLE + unique constraint |
| **Durability** | ✅ OK | ✅ OK |

---

## 🧪 How to Verify

### Check if Index Exists in Database

```bash
# Using psql or your PostgreSQL client
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'payment_intents';
```

**Expected Output:**
```
indexname                                          | indexdef
---------------------------------------------------|----------
payment_intents_slot_date_pending_unique           | CREATE UNIQUE INDEX...
```

### Test the Constraint

```javascript
// Try to create two pending intents for same slot/date
await db.insert(paymentIntents).values({
  slotId: 378,
  bookingDate: '2026-03-05',
  status: 'pending',
  // ... other fields
});
// ✅ First insert: SUCCESS

await db.insert(paymentIntents).values({
  slotId: 378,
  bookingDate: '2026-03-05',
  status: 'pending',
  // ... other fields
});
// ❌ Second insert: UNIQUE VIOLATION ERROR
```

---

## 📍 Files Changed

1. **`models/schema.js`** - Added unique index to paymentIntents table

---

## 🔄 Migration Commands Used

```bash
# Applied changes directly to database
npm run db:push
```

**Output:**
```
[✓] Pulling schema from database...
[✓] Changes applied
```

---

## ⚠️ Important Notes

### 1. Lock Duration Changed
- **Before:** 2 minutes
- **After:** 1 minute
- **Reason:** Faster slot release for better UX

### 2. Partial Index Behavior
- The index ONLY applies to rows where `status='pending'`
- Completed, failed, or expired intents don't count
- This means: One active lock per slot, but unlimited historical records

### 3. Backward Compatibility
- ✅ Existing payment_intents with status != 'pending' are unaffected
- ✅ New constraint applies only to new inserts
- ✅ No data migration needed

---

## 🎉 What's Next?

**Phase 2:** Refactor Payment Controller to Use Optimistic Locking

Now that we have a database constraint, we'll:
1. Remove the "check existing intents" logic
2. Try to insert directly and handle unique violation
3. Add proper error handling with human-friendly messages
4. Fix the `paymentIntent is not defined` error

---

## 📞 Contact

For questions or issues with Phase 1, check:
- Schema file: `models/schema.js` (lines 185-202)
- Migration history: `drizzle/` directory
