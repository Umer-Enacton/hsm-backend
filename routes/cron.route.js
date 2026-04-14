const express = require("express");
const router = express.Router();
const db = require("../config/db");
const {
  bookings,
  payments,
  services,
  users,
  slots,
  providerSubscriptions,
  subscriptionPlans,
  staff,
  staffLeave,
  staffAssignmentTracking,
  businessProfiles,
  address,
  cronJobs,
  cronJobLogs,
} = require("../models/schema");
const {
  eq,
  and,
  lt,
  sql,
  desc,
  isNull,
  inArray,
  count,
} = require("drizzle-orm");
const { initiateRefund } = require("../utils/razorpay");
const {
  sendAcceptReminders,
  sendUpcomingServiceReminders,
  sendDayOfReminders,
  sendPendingBookingReminders,
} = require("../utils/reminderService");
const {
  createNotification,
  notificationTemplates,
} = require("../utils/notificationHelper");
const { cronLogger } = require("../middleware/cronLogger");

// Secret key for cron job authentication
const CRON_SECRET =
  process.env.CRON_SECRET || "default-cron-secret-change-in-production";

// Middleware to verify cron secret
const verifyCronSecret = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const cronSecretHeader = req.headers["x-cron-secret"];
  const expectedAuth = `Bearer ${CRON_SECRET}`;

  // Accept either:
  //   Authorization: Bearer <secret>  — used by manual triggers & admin UI
  //   x-cron-secret: <secret>         — used by pg_cron (Supabase net.http_post)
  if (authHeader === expectedAuth || cronSecretHeader === CRON_SECRET) {
    return next();
  }

  return res.status(401).json({ message: "Unauthorized: Invalid cron secret" });
};

// ============================================================
// Reusable Cron Job Handlers (for centralized execution)
// ============================================================

// Handler: Send upcoming reminders
const sendUpcomingRemindersHandler = async (req, res) => {
  console.log("Cron job: Sending upcoming service reminders...");

  try {
    const result = await sendUpcomingServiceReminders();

    console.log("Cron job completed:", result);
    res.status(200).json({
      success: true,
      message: "Upcoming service reminders completed",
      ...result,
    });
  } catch (error) {
    console.error("Cron job error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// Handler: Send day-of reminders
const sendDayOfRemindersHandler = async (req, res) => {
  console.log("Cron job: Sending day-of service reminders...");

  try {
    const result = await sendDayOfReminders();

    console.log("Cron job completed:", result);
    res.status(200).json({
      success: true,
      message: "Day-of service reminders completed",
      ...result,
    });
  } catch (error) {
    console.error("Cron job error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// Handler: Check trials
const checkTrialsHandler = async (req, res) => {
  console.log("Cron job: Checking expired trials...");

  try {
    const now = new Date();

    // Find all trial subscriptions that have ended
    const expiredTrials = await db
      .select()
      .from(providerSubscriptions)
      .where(
        and(
          eq(providerSubscriptions.status, "trial"),
          lt(providerSubscriptions.trialEndDate, now),
        ),
      );

    console.log(
      `🔍 Checking trials: found ${expiredTrials.length} expired trials`,
    );

    let updatedCount = 0;
    const results = {
      checked: expiredTrials.length,
      updated: 0,
      errors: [],
    };

    // Get Free plan for downgrade
    const [freePlan] = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.name, "Free"))
      .limit(1);

    for (const trial of expiredTrials) {
      try {
        // Update subscription status
        await db
          .update(providerSubscriptions)
          .set({
            status: "trial_ended",
            autoRenew: false,
            updatedAt: now,
          })
          .where(eq(providerSubscriptions.id, trial.id));

        // Downgrade to Free plan if available
        if (freePlan) {
          await db
            .update(providerSubscriptions)
            .set({
              planId: freePlan.id,
              platformFeeAtPurchase: freePlan.platformFeePercentage,
            })
            .where(eq(providerSubscriptions.id, trial.id));
        }

        // Send notification to provider
        try {
          await notificationTemplates.trialEnded(trial.providerId);
        } catch (notifError) {
          console.error("Failed to send trial ended notification:", notifError);
        }

        updatedCount++;
        console.log("✅ Trial ended for provider:", trial.providerId);
      } catch (error) {
        console.error(
          "Error ending trial for provider:",
          trial.providerId,
          error,
        );
        results.errors.push({
          providerId: trial.providerId,
          subscriptionId: trial.id,
          error: error.message,
        });
      }
    }

    results.updated = updatedCount;

    console.log("Cron job completed:", results);
    res.status(200).json({
      success: true,
      message: "Trial check completed",
      ...results,
    });
  } catch (error) {
    console.error("Cron job error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// Handler: Auto assign staff
const autoAssignStaffHandler = async (req, res) => {
  console.log("Cron job: Auto-assigning staff to bookings...");

  try {
    const ONE_HOUR_FROM_NOW = sql`NOW() + INTERVAL '1 hour'`;
    const FIVE_MINUTES_FROM_NOW = sql`NOW() + INTERVAL '5 minutes'`;

    // Combine booking date with slot time using PostgreSQL date arithmetic
    const bookingDateTime = sql`CAST(${bookings.bookingDate} AS date) + ${slots.startTime}`;

    // Get confirmed bookings without staff, starting in ~1 hour (within 5 min window)
    const bookingsToAssign = await db
      .select({
        bookingId: bookings.id,
        businessProfileId: bookings.businessProfileId,
        slotId: bookings.slotId,
        bookingDate: bookings.bookingDate,
        serviceName: services.name,
        slotStartTime: slots.startTime,
        serviceDuration: services.duration,
      })
      .from(bookings)
      .innerJoin(slots, eq(bookings.slotId, slots.id))
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .where(
        and(
          eq(bookings.status, "confirmed"),
          isNull(bookings.assignedStaffId),
          // Booking time is approximately 1 hour from now (within 5 min window)
          sql`ABS(EXTRACT(EPOCH FROM (${bookingDateTime} - ${ONE_HOUR_FROM_NOW}))) < 300`,
        ),
      );

    console.log(
      `Found ${bookingsToAssign.length} bookings to auto-assign staff`,
    );

    const results = {
      processed: bookingsToAssign.length,
      assigned: 0,
      errors: [],
    };

    for (const booking of bookingsToAssign) {
      try {
        // Get available staff for this business
        const availableStaff = await db
          .select({
            staffId: staff.id,
            staffName: staff.name,
          })
          .from(staff)
          .where(eq(staff.businessProfileId, booking.businessProfileId));

        if (availableStaff.length === 0) {
          results.errors.push({
            bookingId: booking.bookingId,
            error: "No staff available for this business",
          });
          continue;
        }

        // Check which staff are on leave
        const staffOnLeave = await db
          .select({ staffId: staffLeave.staffId })
          .from(staffLeave)
          .where(
            and(
              inArray(
                staffLeave.staffId,
                availableStaff.map((s) => s.staffId),
              ),
              eq(staffLeave.status, "approved"),
              sql`${staffLeave.startDate} <= ${booking.bookingDate}::date`,
              sql`${staffLeave.endDate} >= ${booking.bookingDate}::date`,
            ),
          );

        const staffOnLeaveIds = new Set(staffOnLeave.map((s) => s.staffId));
        const availableStaffList = availableStaff.filter(
          (s) => !staffOnLeaveIds.has(s.staffId),
        );

        if (availableStaffList.length === 0) {
          results.errors.push({
            bookingId: booking.bookingId,
            error: "All staff are on leave",
          });
          continue;
        }

        // Get current assignment counts for load balancing
        const assignmentCounts = await db
          .select({
            staffId: staffAssignmentTracking.staffId,
            count: count(),
          })
          .from(staffAssignmentTracking)
          .where(
            and(
              inArray(
                staffAssignmentTracking.staffId,
                availableStaffList.map((s) => s.staffId),
              ),
              sql`${staffAssignmentTracking.date} = ${booking.bookingDate}::date`,
            ),
          )
          .groupBy(staffAssignmentTracking.staffId);

        const countMap = new Map(
          assignmentCounts.map((c) => [c.staffId, c.count]),
        );

        // Select staff with least assignments (round-robin load balancing)
        let selectedStaff = availableStaffList[0];
        let minAssignments = countMap.get(selectedStaff.staffId) || 0;

        for (const s of availableStaffList) {
          const assignments = countMap.get(s.staffId) || 0;
          if (assignments < minAssignments) {
            selectedStaff = s;
            minAssignments = assignments;
          }
        }

        // Assign staff to booking
        await db
          .update(bookings)
          .set({ assignedStaffId: selectedStaff.staffId })
          .where(eq(bookings.id, booking.bookingId));

        // Update or insert assignment tracking
        const existingTracking = await db
          .select()
          .from(staffAssignmentTracking)
          .where(
            and(
              eq(staffAssignmentTracking.staffId, selectedStaff.staffId),
              sql`${staffAssignmentTracking.date} = ${booking.bookingDate}::date`,
            ),
          )
          .limit(1);

        if (existingTracking.length > 0) {
          await db
            .update(staffAssignmentTracking)
            .set({
              assignmentsCount: existingTracking[0].assignmentsCount + 1,
            })
            .where(eq(staffAssignmentTracking.id, existingTracking[0].id));
        } else {
          await db.insert(staffAssignmentTracking).values({
            staffId: selectedStaff.staffId,
            date: booking.bookingDate,
            assignmentsCount: 1,
          });
        }

        results.assigned++;
        console.log(
          `Assigned staff ${selectedStaff.staffId} to booking ${booking.bookingId}`,
        );
      } catch (error) {
        console.error(
          `Error assigning staff for booking ${booking.bookingId}:`,
          error,
        );
        results.errors.push({
          bookingId: booking.bookingId,
          error: error.message,
        });
      }
    }

    console.log("Cron job completed:", results);
    res.status(200).json({
      success: true,
      message: "Auto-assign staff completed",
      ...results,
    });
  } catch (error) {
    console.error("Cron job error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// Handler: Send staff reminders
const sendStaffRemindersHandler = async (req, res) => {
  console.log("Cron job: Sending staff booking reminders...");

  try {
    const TOMORROW = sql`CURRENT_DATE + INTERVAL '1 day'`;

    // Get bookings scheduled for tomorrow that have staff assigned
    const tomorrowBookings = await db
      .select({
        bookingId: bookings.id,
        bookingDate: bookings.bookingDate,
        slotStartTime: slots.startTime,
        serviceName: services.name,
        staffId: staff.id,
        staffName: staff.name,
        staffUserId: staff.userId,
        staffEmail: users.email,
      })
      .from(bookings)
      .innerJoin(slots, eq(bookings.slotId, slots.id))
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .innerJoin(staff, eq(bookings.assignedStaffId, staff.id))
      .innerJoin(users, eq(staff.userId, users.id))
      .where(
        and(
          eq(bookings.status, "confirmed"),
          sql`${bookings.bookingDate} = ${TOMORROW}`,
        ),
      );

    console.log(`Found ${tomorrowBookings.length} staff bookings for tomorrow`);

    const results = {
      processed: tomorrowBookings.length,
      reminded: 0,
      errors: [],
    };

    for (const booking of tomorrowBookings) {
      try {
        await notificationTemplates.sendNotification(booking.staffUserId, {
          type: "staff_booking_reminder",
          title: "Upcoming Booking Reminder",
          message: `You have a booking for ${booking.serviceName} tomorrow at ${booking.slotStartTime}. Please ensure you are available.`,
          data: JSON.stringify({
            bookingId: booking.bookingId,
            serviceName: booking.serviceName,
            bookingDate: booking.bookingDate,
            slotTime: booking.slotStartTime,
            actionUrl: "/staff/bookings",
          }),
        });

        results.reminded++;
        console.log(
          `Sent reminder to staff ${booking.staffId} for booking ${booking.bookingId}`,
        );
      } catch (error) {
        console.error(
          `Error sending reminder to staff ${booking.staffId}:`,
          error,
        );
        results.errors.push({
          bookingId: booking.bookingId,
          staffId: booking.staffId,
          error: error.message,
        });
      }
    }

    console.log("Cron job completed:", results);
    res.status(200).json({
      success: true,
      message: "Staff booking reminders completed",
      ...results,
    });
  } catch (error) {
    console.error("Cron job error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// Handler: Send no staff assigned reminders
const sendNoStaffRemindersHandler = async (req, res) => {
  console.log("Cron job: Sending no staff assigned reminders...");

  try {
    const THREE_HOURS_FROM_NOW = sql`NOW() + INTERVAL '3 hours'`;

    // Combine booking date with slot time using PostgreSQL date arithmetic
    const bookingDateTime = sql`CAST(${bookings.bookingDate} AS date) + ${slots.startTime}`;

    // Get confirmed bookings without staff assigned, starting in ~3 hours
    const bookingsToRemind = await db
      .select({
        bookingId: bookings.id,
        businessProfileId: bookings.businessProfileId,
        slotId: bookings.slotId,
        bookingDate: bookings.bookingDate,
        serviceName: services.name,
        slotStartTime: slots.startTime,
        providerId: businessProfiles.providerId,
        providerName: users.name,
        providerEmail: users.email,
      })
      .from(bookings)
      .innerJoin(slots, eq(bookings.slotId, slots.id))
      .innerJoin(
        businessProfiles,
        eq(bookings.businessProfileId, businessProfiles.id),
      )
      .innerJoin(users, eq(businessProfiles.providerId, users.id))
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .where(
        and(
          eq(bookings.status, "confirmed"),
          isNull(bookings.assignedStaffId),
          // Booking time is approximately 3 hours from now (within 5 min window)
          sql`ABS(EXTRACT(EPOCH FROM (${bookingDateTime} - ${THREE_HOURS_FROM_NOW}))) < 300`,
        ),
      );

    console.log(
      `Found ${bookingsToRemind.length} bookings without staff assigned`,
    );

    const results = {
      processed: bookingsToRemind.length,
      reminded: 0,
      errors: [],
    };

    for (const booking of bookingsToRemind) {
      try {
        await notificationTemplates.sendNotification(booking.providerId, {
          type: "no_staff_assigned_reminder",
          title: "Staff Assignment Required",
          message: `Booking #${booking.bookingId} for ${booking.serviceName} on ${booking.bookingDate.toISOString().split("T")[0]} at ${booking.slotStartTime} (3 hours from now) has no staff assigned. Please assign staff manually or ensure auto-assign is working.`,
          data: JSON.stringify({
            bookingId: booking.bookingId,
            serviceName: booking.serviceName,
            bookingDate: booking.bookingDate,
            slotTime: booking.slotStartTime,
            actionUrl: `/provider/bookings?booking=${booking.bookingId}`,
          }),
        });

        results.reminded++;
        console.log(`Sent reminder for booking ${booking.bookingId}`);
      } catch (error) {
        console.error(
          `Error sending reminder for booking ${booking.bookingId}:`,
          error,
        );
        results.errors.push({
          bookingId: booking.bookingId,
          error: error.message,
        });
      }
    }

    console.log("Cron job completed:", results);
    res.status(200).json({
      success: true,
      message: "No staff assigned reminders completed",
      ...results,
    });
  } catch (error) {
    console.error("Cron job error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * POST /cron/auto-reject-bookings
 * Internal endpoint for cron jobs to process expired bookings
 * Protected by CRON_SECRET
 */
router.post(
  "/auto-reject-bookings",
  verifyCronSecret,
  cronLogger("auto_reject_bookings"),
  async (req, res) => {
    console.log("Cron job: Processing expired bookings...");

    try {
      // Combine booking date with slot time using PostgreSQL date arithmetic
      const bookingDateTime = sql`CAST(${bookings.bookingDate} AS date) + ${slots.startTime}`;

      // Get pending bookings where scheduled time has passed
      // Need to join with slots to get the time for accurate comparison
      const expiredBookings = await db
        .select({
          bookingId: bookings.id,
          customerId: bookings.customerId,
          bookingDate: bookings.bookingDate,
          slotId: bookings.slotId,
          totalPrice: bookings.totalPrice,
          paymentId: payments.id,
          razorpayPaymentId: payments.razorpayPaymentId,
          customerName: users.name,
          customerEmail: users.email,
          serviceName: services.name,
        })
        .from(bookings)
        .innerJoin(slots, eq(bookings.slotId, slots.id))
        .innerJoin(services, eq(bookings.serviceId, services.id))
        .innerJoin(payments, eq(bookings.id, payments.bookingId))
        .innerJoin(users, eq(bookings.customerId, users.id))
        .where(
          and(
            eq(bookings.status, "pending"),
            // Compare actual booking time (date + slot time) - reject exactly when slot starts
            sql`${bookingDateTime} < NOW()`,
          ),
        );

      console.log(`Found ${expiredBookings.length} expired pending bookings`);

      const results = {
        processed: 0,
        rejected: 0,
        refunded: 0,
        errors: [],
      };

      for (const booking of expiredBookings) {
        try {
          // Update booking status to rejected
          await db
            .update(bookings)
            .set({
              status: "rejected",
              isRefunded: sql`CASE WHEN ${booking.razorpayPaymentId} IS NOT NULL THEN true ELSE false END`,
              cancelledAt: new Date(),
              cancellationReason:
                "Auto-rejected: Booking time expired - Provider did not respond",
              cancelledBy: "system",
            })
            .where(eq(bookings.id, booking.bookingId));

          console.log(`Booking ${booking.bookingId} marked as rejected`);

          // Initiate refund if payment exists
          if (booking.razorpayPaymentId) {
            try {
              const refundResult = await initiateRefund(
                booking.razorpayPaymentId,
                booking.totalPrice,
                "Auto-refund: Booking time expired",
              );

              // Update payment status
              await db
                .update(payments)
                .set({
                  status: "refunded",
                  refundId: refundResult.id,
                  refundAmount: booking.totalPrice,
                  refundReason:
                    "Auto-refund: Booking time expired - Provider did not respond",
                  refundedAt: new Date(),
                })
                .where(eq(payments.id, booking.paymentId));

              console.log(`Refund initiated for booking ${booking.bookingId}`);
              results.refunded++;
            } catch (refundError) {
              console.error(
                `Refund failed for booking ${booking.bookingId}:`,
                refundError,
              );
              results.errors.push({
                bookingId: booking.bookingId,
                error: "Refund failed",
                details: refundError.message,
              });
            }
          }

          results.rejected++;
          results.processed++;
        } catch (error) {
          console.error(
            `Error processing booking ${booking.bookingId}:`,
            error,
          );
          results.errors.push({
            bookingId: booking.bookingId,
            error: "Processing failed",
            details: error.message,
          });
        }
      }

      console.log("Cron job completed:", results);
      res.status(200).json({
        message: "Auto-reject completed",
        ...results,
      });
    } catch (error) {
      console.error("Cron job error:", error);
      res.status(500).json({
        message: "Server error",
        error: error.message,
      });
    }
  },
);

/**
 * POST /cron/auto-handle-reschedule-requests
 * Internal endpoint for cron jobs to auto-revert expired reschedule requests
 * If provider doesn't respond to reschedule request within 30 minutes, revert to original slot
 * Protected by CRON_SECRET
 */
router.post(
  "/auto-handle-reschedule-requests",
  verifyCronSecret,
  cronLogger("auto_handle_reschedule"),
  async (req, res) => {
    console.log("Cron job: Processing expired reschedule requests...");

    try {
      // Get reschedule_pending bookings where rescheduledAt is older than 30 minutes
      const THIRTY_MINUTES_AGO = sql`NOW() - INTERVAL '30 minutes'`;

      const expiredRescheduleRequests = await db
        .select({
          bookingId: bookings.id,
          customerId: bookings.customerId,
          customerName: users.name,
          customerEmail: users.email,
          serviceName: services.name,
          currentSlotId: bookings.slotId,
          currentBookingDate: bookings.bookingDate,
          previousSlotId: bookings.previousSlotId,
          previousBookingDate: bookings.previousBookingDate,
          rescheduleReason: bookings.rescheduleReason,
          rescheduledAt: bookings.rescheduledAt,
          paymentId: payments.id,
          razorpayPaymentId: payments.razorpayPaymentId,
          amount: payments.amount,
        })
        .from(bookings)
        .innerJoin(users, eq(bookings.customerId, users.id))
        .innerJoin(services, eq(bookings.serviceId, services.id))
        .leftJoin(payments, eq(bookings.id, payments.bookingId))
        .where(
          and(
            eq(bookings.status, "reschedule_pending"),
            lt(bookings.rescheduledAt, THIRTY_MINUTES_AGO),
          ),
        );

      console.log(
        `Found ${expiredRescheduleRequests.length} expired reschedule requests`,
      );

      const results = {
        processed: 0,
        reverted: 0,
        refunded: 0,
        errors: [],
      };

      for (const booking of expiredRescheduleRequests) {
        try {
          // Validate that we have previous slot info to restore
          if (!booking.previousSlotId || !booking.previousBookingDate) {
            console.error(
              `Booking ${booking.bookingId} has no previous slot info, skipping`,
            );
            results.errors.push({
              bookingId: booking.bookingId,
              error: "No previous slot info available",
              details: "Cannot revert reschedule request",
            });
            continue;
          }

          // Revert booking to original slot
          const [updatedBooking] = await db
            .update(bookings)
            .set({
              slotId: booking.previousSlotId,
              bookingDate: booking.previousBookingDate,
              status: "confirmed",
              // Clear reschedule tracking fields
              previousSlotId: null,
              previousBookingDate: null,
              rescheduleReason: null,
              rescheduledBy: null,
              rescheduledAt: null,
            })
            .where(eq(bookings.id, booking.bookingId))
            .returning();

          console.log(
            `Booking ${booking.bookingId} reverted to original slot (slot ${booking.previousSlotId} → ${booking.currentSlotId})`,
          );

          // Refund reschedule fee if there's a separate payment for it
          // Look for payments where is_reschedule = true (reschedule fee)
          if (booking.paymentId && booking.razorpayPaymentId) {
            try {
              const refundResult = await initiateRefund(
                booking.razorpayPaymentId,
                booking.amount,
                "Auto-refund: Reschedule request expired - Provider did not respond",
              );

              // Update payment status
              await db
                .update(payments)
                .set({
                  status: "refunded",
                  refundId: refundResult.id,
                  refundAmount: booking.amount,
                  refundReason:
                    "Auto-refund: Reschedule request expired - Provider did not respond in time",
                  refundedAt: new Date(),
                })
                .where(eq(payments.id, booking.paymentId));

              console.log(
                `Refund processed for reschedule fee of booking ${booking.bookingId}`,
              );
              results.refunded++;
            } catch (refundError) {
              console.error(
                `Refund failed for booking ${booking.bookingId}:`,
                refundError,
              );
              results.errors.push({
                bookingId: booking.bookingId,
                error: "Refund failed",
                details: refundError.message,
              });
            }
          }

          results.reverted++;
          results.processed++;
        } catch (error) {
          console.error(
            `Error processing booking ${booking.bookingId}:`,
            error,
          );
          results.errors.push({
            bookingId: booking.bookingId,
            error: "Processing failed",
            details: error.message,
          });
        }
      }

      console.log("Cron job completed:", results);
      res.status(200).json({
        message: "Auto-handle reschedule requests completed",
        ...results,
      });
    } catch (error) {
      console.error("Cron job error:", error);
      res.status(500).json({
        message: "Server error",
        error: error.message,
      });
    }
  },
);

/**
 * POST /cron/send-accept-reminders
 * Internal endpoint for cron jobs to send accept reminders to providers
 * Protected by CRON_SECRET
 */
router.post(
  "/send-accept-reminders",
  verifyCronSecret,
  cronLogger("send_accept_reminders"),
  async (req, res) => {
    console.log("Cron job: Sending accept reminders...");

    try {
      const result = await sendAcceptReminders();

      console.log("Cron job completed:", result);
      res.status(200).json({
        message: "Accept reminders completed",
        ...result,
      });
    } catch (error) {
      console.error("Cron job error:", error);
      res.status(500).json({
        message: "Server error",
        error: error.message,
      });
    }
  },
);

/**
 * POST /cron/send-upcoming-reminders
 * Internal endpoint for cron jobs to send upcoming service reminders to customers
 * Protected by CRON_SECRET
 */
router.post(
  "/send-upcoming-reminders",
  verifyCronSecret,
  cronLogger("send_upcoming_reminders"),
  sendUpcomingRemindersHandler,
);

/**
 * POST /cron/send-day-of-reminders
 * Internal endpoint for cron jobs to send day-of service reminders
 * Protected by CRON_SECRET
 */
router.post(
  "/send-day-of-reminders",
  verifyCronSecret,
  cronLogger("send_day_of_reminders"),
  sendDayOfRemindersHandler,
);

/**
 * POST /cron/send-pending-reminders
 * Internal endpoint for cron jobs to send repeated pending action reminders to providers
 * Protected by CRON_SECRET
 */
router.post(
  "/send-pending-reminders",
  verifyCronSecret,
  cronLogger("send_pending_reminders"),
  async (req, res) => {
    console.log("Cron job: Sending pending action reminders...");

    try {
      const result = await sendPendingBookingReminders();

      console.log("Cron job completed:", result);
      res.status(200).json({
        message: "Pending action reminders completed",
        ...result,
      });
    } catch (error) {
      console.error("Cron job error:", error);
      res.status(500).json({
        message: "Server error",
        error: error.message,
      });
    }
  },
);

/**
 * POST /cron/check-trials
 * Check and expire trial subscriptions
 * Runs nightly at 12 AM
 * Protected by CRON_SECRET
 */
router.post(
  "/check-trials",
  verifyCronSecret,
  cronLogger("check_trials"),
  checkTrialsHandler,
);

/**
 * POST /cron/auto-assign-staff
 * Auto-assign unassigned confirmed bookings 1 hour before slot time
 * Protected by CRON_SECRET
 */
router.post(
  "/auto-assign-staff",
  verifyCronSecret,
  cronLogger("auto_assign_staff"),
  async (req, res) => {
    console.log("Cron job: Auto-assigning staff to bookings...");

    try {
      const ONE_HOUR_FROM_NOW = sql`NOW() + INTERVAL '1 hour'`;

      // Combine booking date with slot time using PostgreSQL date arithmetic
      const bookingDateTime = sql`CAST(${bookings.bookingDate} AS date) + ${slots.startTime}`;

      // Get confirmed bookings without staff assigned, starting in ~1 hour
      const bookingsToAssign = await db
        .select({
          bookingId: bookings.id,
          businessProfileId: bookings.businessProfileId,
          slotId: bookings.slotId,
          bookingDate: bookings.bookingDate,
          totalPrice: bookings.totalPrice,
          slotStartTime: slots.startTime,
          providerId: businessProfiles.providerId,
          providerName: users.name,
          providerEmail: users.email,
          serviceName: services.name,
        })
        .from(bookings)
        .innerJoin(slots, eq(bookings.slotId, slots.id))
        .innerJoin(
          businessProfiles,
          eq(bookings.businessProfileId, businessProfiles.id),
        )
        .innerJoin(users, eq(businessProfiles.providerId, users.id))
        .innerJoin(services, eq(bookings.serviceId, services.id))
        .where(
          and(
            eq(bookings.status, "confirmed"),
            isNull(bookings.assignedStaffId),
            // Booking time is approximately 1 hour from now (within 5 min window)
            sql`ABS(EXTRACT(EPOCH FROM (${bookingDateTime} - ${ONE_HOUR_FROM_NOW}))) < 300`,
          ),
        );

      console.log(`Found ${bookingsToAssign.length} bookings to auto-assign`);

      const results = {
        processed: 0,
        assigned: 0,
        skipped: 0,
        notifiedProvider: 0,
        errors: [],
      };

      for (const booking of bookingsToAssign) {
        try {
          // Get active staff for this business
          const activeStaff = await db
            .select()
            .from(staff)
            .where(
              and(
                eq(staff.businessProfileId, booking.businessProfileId),
                eq(staff.status, "active"),
              ),
            );

          if (activeStaff.length === 0) {
            // No staff at all - notify provider
            try {
              await notificationTemplates.sendNotification(booking.providerId, {
                type: "no_staff_available",
                title: "Staff Assignment Required",
                message: `Booking #${booking.bookingId} for ${booking.serviceName} on ${booking.bookingDate.toISOString().split("T")[0]} at ${booking.slotStartTime} could not be auto-assigned: No active staff in your business. Please assign manually.`,
                data: JSON.stringify({
                  bookingId: booking.bookingId,
                  reason: "No active staff",
                  actionUrl: `/provider/bookings?booking=${booking.bookingId}`,
                }),
              });
            } catch (notifError) {
              console.error(
                "Failed to send no-staff notification:",
                notifError,
              );
            }
            results.skipped++;
            results.notifiedProvider++;
            console.log(
              `No active staff for booking ${booking.bookingId} - notified provider`,
            );
            continue;
          }

          const bookingDate = booking.bookingDate.toISOString().split("T")[0];

          // Filter out staff on leave
          const staffOnLeave = await db
            .select({ staffId: staffLeave.staffId })
            .from(staffLeave)
            .where(
              and(
                eq(staffLeave.businessProfileId, booking.businessProfileId),
                eq(staffLeave.status, "approved"),
                sql`${staffLeave.startDate} <= ${bookingDate} AND ${staffLeave.endDate} >= ${bookingDate}`,
              ),
            );

          const leaveStaffIds = new Set(staffOnLeave.map((l) => l.staffId));
          const availableStaff = activeStaff.filter(
            (s) => !leaveStaffIds.has(s.id),
          );

          if (availableStaff.length === 0) {
            // All staff on leave - notify provider
            try {
              await notificationTemplates.sendNotification(booking.providerId, {
                type: "no_staff_available",
                title: "Staff Assignment Required",
                message: `Booking #${booking.bookingId} for ${booking.serviceName} on ${bookingDate} at ${booking.slotStartTime} could not be auto-assigned: All staff are on leave for this date. Please assign manually.`,
                data: JSON.stringify({
                  bookingId: booking.bookingId,
                  reason: "All staff on leave",
                  actionUrl: `/provider/bookings?booking=${booking.bookingId}`,
                }),
              });
            } catch (notifError) {
              console.error(
                "Failed to send all-on-leave notification:",
                notifError,
              );
            }
            results.skipped++;
            results.notifiedProvider++;
            console.log(
              `All staff on leave for booking ${booking.bookingId} - notified provider`,
            );
            continue;
          }

          // Count today's bookings for each available staff
          const staffBookingCounts = [];
          for (const s of availableStaff) {
            const [countResult] = await db
              .select({ count: count() })
              .from(bookings)
              .where(
                and(
                  eq(bookings.assignedStaffId, s.id),
                  eq(bookings.bookingDate, bookingDate),
                  inArray(bookings.status, ["confirmed", "reschedule_pending"]),
                ),
              );
            staffBookingCounts.push({
              staffId: s.id,
              count: countResult.count || 0,
            });
          }

          // Find staff with minimum bookings
          const minCount = Math.min(...staffBookingCounts.map((s) => s.count));
          const leastBusyStaff = staffBookingCounts.filter(
            (s) => s.count === minCount,
          );

          let selectedStaffId;

          if (leastBusyStaff.length === 1) {
            selectedStaffId = leastBusyStaff[0].staffId;
          } else {
            // Tie-breaker: Round-robin
            const [lastAssigned] = await db
              .select()
              .from(staffAssignmentTracking)
              .where(
                eq(
                  staffAssignmentTracking.businessProfileId,
                  booking.businessProfileId,
                ),
              )
              .orderBy(desc(staffAssignmentTracking.assignedAt))
              .limit(1);

            const roundRobinCandidates = lastAssigned
              ? leastBusyStaff.filter(
                  (s) => s.staffId !== lastAssigned.lastAssignedStaffId,
                )
              : leastBusyStaff;

            selectedStaffId =
              roundRobinCandidates.length > 0
                ? roundRobinCandidates[0].staffId
                : leastBusyStaff[0].staffId;

            // Update tracking
            if (lastAssigned) {
              await db
                .update(staffAssignmentTracking)
                .set({
                  lastAssignedStaffId: selectedStaffId,
                  assignedAt: new Date(),
                })
                .where(eq(staffAssignmentTracking.id, lastAssigned.id));
            } else {
              await db.insert(staffAssignmentTracking).values({
                businessProfileId: booking.businessProfileId,
                lastAssignedStaffId: selectedStaffId,
                assignedAt: new Date(),
              });
            }
          }

          // Assign staff with default commission (10%)
          await db
            .update(bookings)
            .set({
              assignedStaffId: selectedStaffId,
              staffEarningType: "commission",
              staffCommissionPercent: 10,
              staffAssignedAt: new Date(),
            })
            .where(eq(bookings.id, booking.bookingId));

          // Get staff user details for notification
          const [staffMember] = await db
            .select()
            .from(staff)
            .leftJoin(users, eq(staff.userId, users.id))
            .where(eq(staff.id, selectedStaffId))
            .limit(1);

          // Send notification to staff
          if (staffMember) {
            try {
              await notificationTemplates.sendNotification(staffMember.userId, {
                type: "booking_assigned",
                title: "New Booking Assigned",
                message: `You have been auto-assigned a booking: ${booking.serviceName} on ${booking.bookingDate.toISOString().split("T")[0]} at ${booking.slotStartTime}. Earning: 10% commission.`,
                data: JSON.stringify({
                  bookingId: booking.bookingId,
                  actionUrl: "/staff/bookings",
                }),
              });
            } catch (notifError) {
              console.error("Failed to send staff notification:", notifError);
            }
          }

          // Log history
          const { logBookingHistory } = require("../utils/historyHelper");
          await logBookingHistory(
            booking.bookingId,
            "staff_auto_assigned",
            `Booking auto-assigned to staff via cron (least bookings: ${minCount})`,
            "system",
            null,
          );

          results.assigned++;
        } catch (error) {
          console.error(
            `Error auto-assigning booking ${booking.bookingId}:`,
            error,
          );
          results.errors.push({
            bookingId: booking.bookingId,
            error: error.message,
          });
        }

        results.processed++;
      }

      console.log("Cron job completed:", results);
      res.status(200).json({
        message: "Auto-assign completed",
        ...results,
      });
    } catch (error) {
      console.error("Cron job error:", error);
      res.status(500).json({
        message: "Server error",
        error: error.message,
      });
    }
  },
);

/**
 * POST /cron/send-staff-booking-reminders
 * Internal endpoint for cron jobs to send reminders to staff about their upcoming bookings (day before)
 * Protected by CRON_SECRET
 */
router.post(
  "/send-staff-booking-reminders",
  verifyCronSecret,
  cronLogger("send_staff_reminders"),
  async (req, res) => {
    console.log("Cron job: Sending staff booking reminders...");

    try {
      const TOMORROW = sql`DATE(NOW() + INTERVAL '1 day')`;

      // Get bookings assigned to staff scheduled for tomorrow
      const tomorrowBookings = await db
        .select({
          bookingId: bookings.id,
          staffUserId: users.id,
          serviceName: services.name,
          bookingDate: bookings.bookingDate,
          slotTime: slots.startTime,
          address: address.street,
          city: address.city,
          customerName: sql.string`${users.name}`.as("customerName"),
        })
        .from(bookings)
        .innerJoin(staff, eq(bookings.assignedStaffId, staff.id))
        .innerJoin(users, eq(staff.userId, users.id))
        .innerJoin(services, eq(bookings.serviceId, services.id))
        .innerJoin(slots, eq(bookings.slotId, slots.id))
        .innerJoin(address, eq(bookings.addressId, address.id))
        .where(
          and(
            eq(bookings.status, "confirmed"),
            sql`DATE(${bookings.bookingDate}) = ${TOMORROW}`,
            sql`${bookings.upcomingReminderSent} = false`,
          ),
        );

      console.log(`Found ${tomorrowBookings.length} staff bookings to remind`);

      let sentCount = 0;

      for (const booking of tomorrowBookings) {
        try {
          await notificationTemplates.staffBookingReminder(
            booking.staffUserId,
            {
              serviceName: booking.serviceName,
              bookingDate: booking.bookingDate,
              slotTime: booking.slotTime,
              address: `${booking.address}, ${booking.city}`,
              customerName: booking.customerName,
            },
          );

          // Mark reminder as sent
          await db
            .update(bookings)
            .set({ upcomingReminderSent: true })
            .where(eq(bookings.id, booking.bookingId));

          sentCount++;
        } catch (error) {
          console.error(
            `Error sending reminder for booking ${booking.bookingId}:`,
            error,
          );
        }
      }

      res.status(200).json({
        message: "Staff booking reminders completed",
        sent: sentCount,
      });
    } catch (error) {
      console.error("Cron job error:", error);
      res.status(500).json({
        message: "Server error",
        error: error.message,
      });
    }
  },
);

/**
 * POST /cron/send-no-staff-reminders
 * Internal endpoint for cron jobs to send reminders to providers about bookings without staff assigned
 * Protected by CRON_SECRET
 */
router.post(
  "/send-no-staff-reminders",
  verifyCronSecret,
  cronLogger("send_no_staff_reminders"),
  async (req, res) => {
    console.log("Cron job: Sending no staff assigned reminders...");

    try {
      const THREE_HOURS_FROM_NOW = sql`NOW() + INTERVAL '3 hours'`;

      // Combine booking date with slot time using PostgreSQL date arithmetic
      const bookingDateTime = sql`CAST(${bookings.bookingDate} AS date) + ${slots.startTime}`;

      // Get confirmed bookings without staff assigned, starting in ~3 hours
      const bookingsToRemind = await db
        .select({
          bookingId: bookings.id,
          businessProfileId: bookings.businessProfileId,
          slotId: bookings.slotId,
          bookingDate: bookings.bookingDate,
          serviceName: services.name,
          slotStartTime: slots.startTime,
          providerId: businessProfiles.providerId,
          providerName: users.name,
          providerEmail: users.email,
          customerName: sql.string`${users.name}`.as("customerName"),
        })
        .from(bookings)
        .innerJoin(slots, eq(bookings.slotId, slots.id))
        .innerJoin(
          businessProfiles,
          eq(bookings.businessProfileId, businessProfiles.id),
        )
        .innerJoin(users, eq(businessProfiles.providerId, users.id))
        .innerJoin(services, eq(bookings.serviceId, services.id))
        .where(
          and(
            eq(bookings.status, "confirmed"),
            isNull(bookings.assignedStaffId),
            // Booking time is approximately 3 hours from now (within 5 min window)
            sql`ABS(EXTRACT(EPOCH FROM (${bookingDateTime} - ${THREE_HOURS_FROM_NOW}))) < 300`,
          ),
        );

      console.log(
        `Found ${bookingsToRemind.length} bookings without staff assigned`,
      );

      let sentCount = 0;
      const results = {
        processed: bookingsToRemind.length,
        reminded: 0,
        errors: [],
      };

      for (const booking of bookingsToRemind) {
        try {
          await notificationTemplates.sendNotification(booking.providerId, {
            type: "no_staff_assigned_reminder",
            title: "Staff Assignment Required",
            message: `Booking #${booking.bookingId} for ${booking.serviceName} on ${booking.bookingDate.toISOString().split("T")[0]} at ${booking.slotStartTime} (3 hours from now) has no staff assigned. Please assign staff manually or ensure auto-assign is working.`,
            data: JSON.stringify({
              bookingId: booking.bookingId,
              serviceName: booking.serviceName,
              bookingDate: booking.bookingDate,
              slotTime: booking.slotStartTime,
              actionUrl: `/provider/bookings?booking=${booking.bookingId}`,
            }),
          });

          results.reminded++;
          sentCount++;
          console.log(`Sent reminder for booking ${booking.bookingId}`);
        } catch (error) {
          console.error(
            `Error sending reminder for booking ${booking.bookingId}:`,
            error,
          );
          results.errors.push({
            bookingId: booking.bookingId,
            error: error.message,
          });
        }
      }

      console.log("Cron job completed:", results);
      res.status(200).json({
        message: "No staff assigned reminders completed",
        ...results,
      });
    } catch (error) {
      console.error("Cron job error:", error);
      res.status(500).json({
        message: "Server error",
        error: error.message,
      });
    }
  },
);

/**
 * GET /cron/health
 * Health check endpoint for cron jobs
 */
router.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

// Handler: Check and mark missed bookings
const checkMissedBookingsHandler = async (req, res) => {
  console.log("Cron job: Checking for missed bookings...");

  try {
    // Get businessProfiles for provider info and users for names
    const {
      businessProfiles: businessProfilesTable,
    } = require("../models/schema");

    // Find confirmed bookings where scheduled time + 2 hours has passed
    // Using raw SQL fragment for the date comparison
    const missedBookings = await db
      .select({
        bookingId: bookings.id,
        customerId: bookings.customerId,
        customerName: sql`customer_users.name`,
        businessProfileId: bookings.businessProfileId,
        providerId: businessProfilesTable.providerId,
        providerName: sql`provider_users.name`,
        serviceName: services.name,
        bookingDate: bookings.bookingDate,
        slotTime: slots.startTime,
        assignedStaffId: bookings.assignedStaffId,
      })
      .from(bookings)
      .innerJoin(slots, eq(bookings.slotId, slots.id))
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .innerJoin(
        businessProfilesTable,
        eq(bookings.businessProfileId, businessProfilesTable.id),
      )
      .innerJoin(
        sql`${users} AS customer_users`,
        eq(bookings.customerId, sql`customer_users.id`),
      )
      .innerJoin(
        sql`${users} AS provider_users`,
        eq(businessProfilesTable.providerId, sql`provider_users.id`),
      )
      .where(
        and(
          eq(bookings.status, "confirmed"),
          // Raw SQL: booking_date (cast to date) + slot.start_time < NOW() - INTERVAL '2 hours'
          sql`(bookings.booking_date::date + slots.start_time) < (NOW() - INTERVAL '2 hours')`,
        ),
      );

    console.log(`Found ${missedBookings.length} missed bookings`);

    const results = {
      processed: missedBookings.length,
      markedMissed: 0,
      notified: [],
      errors: [],
    };

    for (const booking of missedBookings) {
      try {
        // Mark booking as missed
        await db
          .update(bookings)
          .set({
            status: "missed",
            missedAt: new Date(),
          })
          .where(eq(bookings.id, booking.bookingId));

        console.log(`Booking ${booking.bookingId} marked as missed`);

        // Notify customer about delay (friendly message)
        await createNotification({
          userId: booking.customerId,
          type: "booking_delayed",
          title: "Booking Update",
          message: `Due to some technical issues or unforeseen circumstances, your ${booking.serviceName} booking has been delayed. The provider will notify you soon about the new schedule. We apologize for the inconvenience.`,
          data: {
            bookingId: booking.bookingId.toString(),
            actionUrl: "/customer/bookings",
          },
        });

        // Notify provider about missed booking
        await createNotification({
          userId: booking.providerId,
          type: "booking_missed_provider",
          title: "Action Required: Missed Booking",
          message: `Booking #${booking.bookingId} for ${booking.serviceName} was not completed on time. Please contact the customer to reschedule and ensure timely completion.`,
          data: {
            bookingId: booking.bookingId.toString(),
            actionUrl: "/provider/bookings",
          },
        });

        // Notify admin about missed booking
        const adminUsers = await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(eq(users.roleId, 3)); // Admin role

        for (const admin of adminUsers) {
          await createNotification({
            userId: admin.id,
            type: "booking_missed_admin",
            title: "Missed Booking Alert",
            message: `Booking #${booking.bookingId} by ${booking.customerName} for ${booking.serviceName} was missed. Provider: ${booking.providerName} | Staff: ${booking.assignedStaffId ? "Assigned" : "Not assigned"}. Please follow up.`,
            data: {
              bookingId: booking.bookingId.toString(),
              actionUrl: "/admin/bookings",
            },
          });
        }

        results.markedMissed++;
        results.notified.push({
          bookingId: booking.bookingId,
          serviceName: booking.serviceName,
          customer: {
            id: booking.customerId,
            name: booking.customerName,
            role: "customer",
          },
          provider: {
            id: booking.providerId,
            name: booking.providerName,
            role: "provider",
          },
          staffAssigned: !!booking.assignedStaffId,
        });
      } catch (error) {
        console.error(
          `Error processing missed booking ${booking.bookingId}:`,
          error,
        );
        results.errors.push({
          bookingId: booking.bookingId,
          error: error.message,
        });
      }
    }

    response = {
      success: true,
      message: "Missed bookings check completed",
      ...results,
    };
  } catch (error) {
    console.error("Cron job error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
    return;
  }

  res.status(200).json(response);
};

// Handler: Auto-cancel missed bookings after 2 days with full refund
const autoCancelMissedBookingsHandler = async (req, res) => {
  console.log("Cron job: Auto-cancelling missed bookings older than 2 days...");

  try {
    const {
      businessProfiles: businessProfilesTable,
    } = require("../models/schema");
    const { initiateRefund } = require("../utils/razorpay");

    // Find missed bookings where missed_at > 2 days ago
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    const missedBookings = await db
      .select({
        bookingId: bookings.id,
        customerId: bookings.customerId,
        customerName: sql`customer_users.name`,
        customerEmail: sql`customer_users.email`,
        businessProfileId: bookings.businessProfileId,
        providerId: businessProfilesTable.providerId,
        providerName: sql`provider_users.name`,
        serviceName: services.name,
        bookingDate: bookings.bookingDate,
        slotTime: slots.startTime,
        totalPrice: bookings.totalPrice,
        missedAt: bookings.missedAt,
        razorpayPaymentId: paymentDetails.razorpayPaymentId,
        paymentId: paymentDetails.id,
      })
      .from(bookings)
      .innerJoin(slots, eq(bookings.slotId, slots.id))
      .innerJoin(services, eq(bookings.serviceId, services.id))
      .innerJoin(
        businessProfilesTable,
        eq(bookings.businessProfileId, businessProfilesTable.id),
      )
      .innerJoin(paymentDetails, eq(bookings.id, paymentDetails.bookingId))
      .innerJoin(
        sql`${users} AS customer_users`,
        eq(bookings.customerId, sql`customer_users.id`),
      )
      .innerJoin(
        sql`${users} AS provider_users`,
        eq(businessProfilesTable.providerId, sql`provider_users.id`),
      )
      .where(
        and(
          eq(bookings.status, "missed"),
          sql`${bookings.missedAt} < ${twoDaysAgo}`,
          eq(bookings.isRefunded, false),
        ),
      );

    console.log(
      `Found ${missedBookings.length} missed bookings eligible for auto-cancellation`,
    );

    const results = {
      processed: missedBookings.length,
      cancelled: 0,
      refunded: 0,
      notified: [],
      errors: [],
    };

    for (const booking of missedBookings) {
      try {
        let refundProcessed = false;
        let refundId = null;

        // Process refund via Razorpay
        if (booking.razorpayPaymentId) {
          try {
            const refund = await initiateRefund(
              booking.razorpayPaymentId,
              booking.totalPrice, // Full refund
              "Auto-refund: Booking cancelled after being missed for 2 days",
            );
            refundProcessed = true;
            refundId = refund.id;
            console.log(
              `Refund ${refundId} processed for booking ${booking.bookingId}`,
            );
          } catch (refundError) {
            console.error(
              `Refund failed for booking ${booking.bookingId}:`,
              refundError.message,
            );
            // Continue with cancellation even if refund fails
          }
        }

        // Update booking status
        await db
          .update(bookings)
          .set({
            status: "cancelled",
            isRefunded: refundProcessed,
            refundAmount: refundProcessed ? booking.totalPrice : null,
            cancelledAt: new Date(),
            cancellationReason:
              "Auto-cancelled: Booking was missed for more than 2 days",
            cancelledBy: "system",
          })
          .where(eq(bookings.id, booking.bookingId));

        console.log(`Booking ${booking.bookingId} auto-cancelled`);

        // Notify customer about cancellation and refund
        await createNotification({
          userId: booking.customerId,
          type: "booking_cancelled_refund",
          title: "Booking Cancelled - Refund Initiated",
          message: `Your ${booking.serviceName} booking has been automatically cancelled as it remained unresolved for 2 days. A full refund of ₹${booking.totalPrice / 100} has been initiated and will be credited to your original payment method within 5-7 business days.`,
          data: {
            bookingId: booking.bookingId.toString(),
            refundAmount: booking.totalPrice.toString(),
            actionUrl: "/customer/bookings",
          },
        });

        // Notify provider about cancellation
        await createNotification({
          userId: booking.providerId,
          type: "booking_auto_cancelled",
          title: "Booking Auto-Cancelled",
          message: `Booking #${booking.bookingId} for ${booking.serviceName} has been automatically cancelled as it remained missed for more than 2 days. A full refund has been processed to the customer.`,
          data: {
            bookingId: booking.bookingId.toString(),
            actionUrl: "/provider/bookings",
          },
        });

        // Notify admin about auto-cancellation
        const adminUsers = await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(eq(users.roleId, 3));

        for (const admin of adminUsers) {
          await createNotification({
            userId: admin.id,
            type: "booking_auto_cancelled_admin",
            title: "Auto-Cancelled Booking Alert",
            message: `Booking #${booking.bookingId} by ${booking.customerName} for ${booking.serviceName} was auto-cancelled after being missed for 2 days. Refund ${refundProcessed ? `processed (${refundId})` : `failed`}. Amount: ₹${booking.totalPrice / 100}`,
            data: {
              bookingId: booking.bookingId.toString(),
              refundId: refundId || null,
              actionUrl: "/admin/bookings",
            },
          });
        }

        results.cancelled++;
        if (refundProcessed) results.refunded++;
        results.notified.push({
          bookingId: booking.bookingId,
          serviceName: booking.serviceName,
          customer: {
            id: booking.customerId,
            name: booking.customerName,
            role: "customer",
          },
          provider: {
            id: booking.providerId,
            name: booking.providerName,
            role: "provider",
          },
          refundProcessed,
          refundId,
        });
      } catch (error) {
        console.error(
          `Error processing auto-cancellation for booking ${booking.bookingId}:`,
          error,
        );
        results.errors.push({
          bookingId: booking.bookingId,
          error: error.message,
        });
      }
    }

    const response = {
      success: true,
      message: "Auto-cancellation of missed bookings completed",
      ...results,
    };

    res.status(200).json(response);
  } catch (error) {
    console.error("Cron job error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * POST /cron/execute
 * Centralized cron execution endpoint
 * Routes to the appropriate cron job function based on the 'function' parameter
 * Protected by CRON_SECRET
 */
router.post("/execute", verifyCronSecret, async (req, res) => {
  const { function: funcName } = req.body;

  if (!funcName) {
    return res.status(400).json({
      success: false,
      message: "Missing 'function' parameter",
    });
  }

  console.log(`Cron execute: Routing to function '${funcName}'`);

  // Find the job in database for logging
  const [job] = await db
    .select()
    .from(cronJobs)
    .where(eq(cronJobs.name, funcName));

  if (!job) {
    return res.status(404).json({
      success: false,
      message: `Cron job '${funcName}' not found in database`,
    });
  }

  // Create log entry
  const startTime = Date.now();
  const [log] = await db
    .insert(cronJobLogs)
    .values({
      jobId: job.id,
      status: "running",
      triggeredBy: "schedule",
    })
    .returning();

  const logId = log.id;
  let responseData = null;

  // Intercept res.json to capture response
  const originalJson = res.json.bind(res);
  res.json = function (data) {
    responseData = data;
    return originalJson(data);
  };

  // Handle response finish
  res.on("finish", async () => {
    const durationMs = Date.now() - startTime;
    const completedAt = new Date();

    let status = "success";
    let errorMessage = null;
    let errorDetails = null;
    let result = null;

    // Determine status based on response
    if (res.statusCode >= 400) {
      status = "failed";
      errorMessage = responseData?.message || `HTTP ${res.statusCode}`;
      errorDetails = JSON.stringify(responseData || {});
    } else if (responseData?.success === false) {
      status = "partial_success";
      errorMessage = responseData?.message;
    }

    // Store result data (sanitize large objects)
    if (responseData) {
      const { data, ...rest } = responseData;
      result = JSON.stringify({
        ...rest,
        dataCount: Array.isArray(data) ? data.length : data ? 1 : 0,
      });
    }

    // Update log entry
    await db
      .update(cronJobLogs)
      .set({
        completedAt,
        status,
        result,
        errorMessage,
        errorDetails,
        durationMs,
      })
      .where(eq(cronJobLogs.id, logId));

    // Update job's last run info
    await db
      .update(cronJobs)
      .set({
        lastRunAt: completedAt,
        lastRunStatus: status,
        nextRunAt: job.intervalMinutes
          ? new Date(completedAt.getTime() + job.intervalMinutes * 60 * 1000)
          : null,
      })
      .where(eq(cronJobs.id, job.id));
  });

  try {
    // Route to the appropriate handler based on function name
    switch (funcName) {
      case "send_upcoming_reminders":
        return sendUpcomingRemindersHandler(req, res);
      case "send_day_of_reminders":
        return sendDayOfRemindersHandler(req, res);
      case "check_trials":
        return checkTrialsHandler(req, res);
      case "auto_assign_staff":
        return autoAssignStaffHandler(req, res);
      case "send_staff_reminders":
        return sendStaffRemindersHandler(req, res);
      case "send_no_staff_reminders":
        return sendNoStaffRemindersHandler(req, res);
      case "check_missed_bookings":
        return checkMissedBookingsHandler(req, res);
      case "auto_cancel_missed_bookings":
        return autoCancelMissedBookingsHandler(req, res);
      default:
        return res.status(404).json({
          success: false,
          message: `Unknown cron function: ${funcName}`,
        });
    }
  } catch (error) {
    console.error(`Cron execute error for '${funcName}':`, error);

    // Update log with error
    await db
      .update(cronJobLogs)
      .set({
        completedAt: new Date(),
        status: "failed",
        errorMessage: error.message,
        errorDetails: JSON.stringify({
          stack: error.stack,
          message: error.message,
        }),
        durationMs: Date.now() - startTime,
      })
      .where(eq(cronJobLogs.id, logId));

    res.status(500).json({
      success: false,
      message: "Cron execution failed",
      error: error.message,
    });
  }
});

module.exports = router;
