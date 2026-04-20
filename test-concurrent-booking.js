/**
 * Concurrency Test Script for Double-Booking Prevention
 * Usage: node test-concurrent-booking.js
 *
 * WHY "BOTH 409" ON RE-RUN:
 *   A successful run creates a pending payment_intent that locks the slot for
 *   ~90 seconds.  The capacity check counts it as "booked", so both users get
 *   409 if you re-run within that window.
 *   This script now auto-cleans stale pending intents before every run so you
 *   can re-run immediately without waiting.
 */

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:8000";

// ── DB access for pre-test cleanup ──────────────────────────────────────────
const path = require("path");
// Load env so Drizzle can reach the DB
require("dotenv").config({ path: path.join(__dirname, ".env") });
const db = require("./config/db");
const { paymentIntents } = require("./models/schema");
const { and, eq, gte, lte, sql } = require("drizzle-orm");

// TEST CONFIG
const TEST_CONFIG = {
  userA_token:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MiwiZW1haWwiOiJzYWhpbC5jdXN0b21lckBnbWFpbC5jb20iLCJuYW1lIjoiU2FoaWwgR2FyYXNpeWEiLCJyb2xlSWQiOjEsImlhdCI6MTc3NjY2NzMzNCwiZXhwIjoxNzc2NzUzNzM0fQ.VsupUWWF4tr5YdCe6UN8F3xT_sZHnlL5EEDE4I-o0a8", // Replace with actual token
  userB_token:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6OSwiZW1haWwiOiJ1bWVyLmN1c3RvbWVyQGdtYWlsLmNvbSIsIm5hbWUiOiJVbWVyIFNhaXlhZCIsInJvbGVJZCI6MSwiaWF0IjoxNzc2NjY5Mzk4LCJleHAiOjE3NzY3NTU3OTh9.lCJhuwQnnEYEKXzvEVWL8svZ89U87BtX0ynFdubZhE0", // Replace with actual token

  serviceId: 10, // Service to test
  slotId: 380, // Slot to test
  userA_addressId: 2, // User A's address ID (from addresses table)
  userB_addressId: 10, // User B's address ID (different from User A)
  bookingDate: "2026-04-25", // Date to test
};

async function createOrder(token, addressId, userName) {
  try {
    console.log(`\n[${userName}] ====`);
    console.log(`[${userName}] Token: ${token.substring(0, 50)}...`);
    console.log(`[${userName}] AddressId: ${addressId}`);
    console.log(`[${userName}] Calling API...`);

    const response = await fetch(`${API_BASE_URL}/payment/create-order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `token=${token}`,
      },
      credentials: "include",
      body: JSON.stringify({
        serviceId: TEST_CONFIG.serviceId,
        slotId: TEST_CONFIG.slotId,
        addressId: addressId,
        bookingDate: TEST_CONFIG.bookingDate,
      }),
    });

    console.log(`[${userName}] Response Status: ${response.status}`);
    console.log(
      `[${userName}] Response Headers:`,
      Object.fromEntries(response.headers.entries()),
    );

    const text = await response.text();
    console.log(`[${userName}] Response Text:`, text.substring(0, 500));

    if (!response.ok) {
      return { status: response.status, error: true, text };
    }

    const data = JSON.parse(text);
    console.log(`[${userName}] JSON:`, JSON.stringify(data, null, 2));
    return { status: response.status, data };
  } catch (err) {
    console.log(`[${userName}] ERROR:`, err.message);
    return { status: 0, error: true, text: err.message };
  }
}

// ── Pre-test cleanup ─────────────────────────────────────────────────────────
/**
 * Cancel any pending payment intents for the test slot/service/date so the
 * test can be re-run immediately without waiting 90 seconds for them to expire.
 *
 * WHY: capacityCheck.js counts pending intents (expiresAt > NOW()) toward the
 * slot's capacity. If you re-run within the lock window, the slot looks full
 * and both users get 409 — which is correct production behaviour but defeats
 * repeated testing. This cleanup marks them "expired" before each run.
 */
async function cleanupPendingIntents() {
  try {
    const { start, end } = (() => {
      const d = new Date(TEST_CONFIG.bookingDate);
      const s = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      const e = new Date(s);
      e.setUTCHours(23, 59, 59, 999);
      return { start: s, end: e };
    })();

    const result = await db
      .update(paymentIntents)
      .set({ status: "expired" })
      .where(
        and(
          eq(paymentIntents.slotId, TEST_CONFIG.slotId),
          eq(paymentIntents.serviceId, TEST_CONFIG.serviceId),
          gte(paymentIntents.bookingDate, start),
          lte(paymentIntents.bookingDate, end),
          eq(paymentIntents.status, "pending"),
        ),
      );

    // Drizzle returns rowCount on postgres
    const cleaned = result?.rowCount ?? result?.count ?? "?";
    console.log(`🧹 Pre-test cleanup: cancelled ${cleaned} pending intent(s) for slot ${TEST_CONFIG.slotId} on ${TEST_CONFIG.bookingDate}`);
  } catch (err) {
    console.warn("⚠️  Cleanup failed (continuing anyway):", err.message);
  }
}

async function runTest() {
  console.log("=".repeat(60));
  console.log("CONCURRENT BOOKING TEST");
  console.log("=".repeat(60));
  console.log(`Slot:     ${TEST_CONFIG.slotId}`);
  console.log(`Service:  ${TEST_CONFIG.serviceId}`);
  console.log(`Date:     ${TEST_CONFIG.bookingDate}`);
  console.log(`User A → addressId ${TEST_CONFIG.userA_addressId}`);
  console.log(`User B → addressId ${TEST_CONFIG.userB_addressId}`);
  console.log(`API URL:  ${API_BASE_URL}/api/payment/create-order`);

  if (
    !TEST_CONFIG.userA_token ||
    !TEST_CONFIG.userB_token ||
    TEST_CONFIG.userA_token === "YOUR_USER_A_TOKEN"
  ) {
    console.log("\n❌ Add valid tokens to TEST_CONFIG in this file!");
    console.log("Login as User A → DevTools → Application → Cookies → copy 'token'");
    console.log("Login as User B → DevTools → Application → Cookies → copy 'token'");
    return;
  }

  // ── 1. Cancel leftover pending intents from previous runs ──────────────────
  await cleanupPendingIntents();

  // ── 2. Fire both requests simultaneously ────────────────────────────────────
  console.log("\n🚀 Starting concurrent requests...\n");
  const t0 = Date.now();

  const [resultA, resultB] = await Promise.all([
    createOrder(TEST_CONFIG.userA_token, TEST_CONFIG.userA_addressId, "USER A"),
    createOrder(TEST_CONFIG.userB_token, TEST_CONFIG.userB_addressId, "USER B"),
  ]);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

  // ── 3. Evaluate results ─────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log(`RESULTS  (completed in ${elapsed}s)`);
  console.log("=".repeat(60));

  const successA = resultA.status === 201;
  const successB = resultB.status === 201;
  const conflictA = resultA.status === 409;
  const conflictB = resultB.status === 409;

  const label = (ok, conflict, status) =>
    ok ? "✅ SUCCESS (201)" : conflict ? "⚠️  CONFLICT (409)" : `❌ ERROR (${status})`;

  console.log(`User A: ${label(successA, conflictA, resultA.status)}`);
  console.log(`User B: ${label(successB, conflictB, resultB.status)}`);

  console.log();
  if (successA && successB) {
    console.log("❌ FAIL — BUG: Both users succeeded with the same slot!");
    console.log("   The concurrency lock is broken — investigate capacityCheck.js.");
  } else if (successA !== successB) {
    console.log("✅ PASS — Exactly 1 success and 1 conflict. Locking works correctly.");
  } else if (conflictA && conflictB) {
    // This should no longer happen after cleanup, but explain it clearly if it does
    console.log("⚠️  BOTH CONFLICT — slot was already fully booked (confirmed booking");
    console.log("   in DB, not a pending intent). Check if a real booking exists for");
    console.log(`   slotId=${TEST_CONFIG.slotId} serviceId=${TEST_CONFIG.serviceId} on ${TEST_CONFIG.bookingDate}.`);
    console.log("   If that booking is just a test, cancel/delete it and re-run.");
  } else {
    console.log(`⚠️  Unexpected result — A:${resultA.status}, B:${resultB.status}`);
  }
}

runTest().catch(console.error);

