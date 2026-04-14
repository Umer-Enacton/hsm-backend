const db = require("../config/db");
const { eq, and, desc, sql, asc, isNull, or } = require("drizzle-orm");
const { cronJobs, cronJobLogs, users } = require("../models/schema");
const {
  createPgCronJob,
  updatePgCronJob,
  deletePgCronJob,
  intervalToCron,
} = require("../utils/pgCron");

/**
 * Get all cron jobs with latest status
 */
const getAllJobs = async (req, res) => {
  try {
    const jobs = await db
      .select({
        id: cronJobs.id,
        name: cronJobs.name,
        displayName: cronJobs.displayName,
        description: cronJobs.description,
        endpoint: cronJobs.endpoint,
        method: cronJobs.method,
        cronExpression: cronJobs.cronExpression,
        intervalMinutes: cronJobs.intervalMinutes,
        isEnabled: cronJobs.isEnabled,
        maxRetries: cronJobs.maxRetries,
        retryIntervalSeconds: cronJobs.retryIntervalSeconds,
        category: cronJobs.category,
        lastRunAt: cronJobs.lastRunAt,
        lastRunStatus: cronJobs.lastRunStatus,
        nextRunAt: cronJobs.nextRunAt,
        createdAt: cronJobs.createdAt,
        updatedAt: cronJobs.updatedAt,
        syncStatus: cronJobs.syncStatus,
        syncError: cronJobs.syncError,
        lastSyncedAt: cronJobs.lastSyncedAt,
        pgCronJobname: cronJobs.pgCronJobname,
      })
      .from(cronJobs)
      .orderBy(asc(cronJobs.category), asc(cronJobs.displayName));

    // Get latest log for each job to show recent status
    const jobsWithStats = await Promise.all(
      jobs.map(async (job) => {
        const latestLog = await db
          .select()
          .from(cronJobLogs)
          .where(eq(cronJobLogs.jobId, job.id))
          .orderBy(desc(cronJobLogs.startedAt))
          .limit(1);

        const recentLogs = await db
          .select({
            status: cronJobLogs.status,
          })
          .from(cronJobLogs)
          .where(eq(cronJobLogs.jobId, job.id))
          .orderBy(desc(cronJobLogs.startedAt))
          .limit(10);

        const successCount = recentLogs.filter(
          (log) => log.status === "success",
        ).length;
        const successRate =
          recentLogs.length > 0
            ? Math.round((successCount / recentLogs.length) * 100)
            : null;

        return {
          ...job,
          latestLog: latestLog[0] || null,
          successRate,
        };
      }),
    );

    res.status(200).json({
      success: true,
      data: jobsWithStats,
      count: jobsWithStats.length,
    });
  } catch (error) {
    console.error("Error fetching cron jobs:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch cron jobs",
      error: error.message,
    });
  }
};

/**
 * Get single job by ID
 */
const getJobById = async (req, res) => {
  try {
    const { id } = req.params;

    const [job] = await db
      .select()
      .from(cronJobs)
      .where(eq(cronJobs.id, parseInt(id)));

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Cron job not found",
      });
    }

    // Get recent logs for this job
    const recentLogs = await db
      .select()
      .from(cronJobLogs)
      .where(eq(cronJobLogs.jobId, job.id))
      .orderBy(desc(cronJobLogs.startedAt))
      .limit(20);

    // Calculate stats
    const allLogs = await db
      .select({
        status: cronJobLogs.status,
      })
      .from(cronJobLogs)
      .where(eq(cronJobLogs.jobId, job.id));

    const successCount = allLogs.filter(
      (log) => log.status === "success",
    ).length;
    const failedCount = allLogs.filter((log) => log.status === "failed").length;
    const successRate =
      allLogs.length > 0
        ? Math.round((successCount / allLogs.length) * 100)
        : null;

    res.status(200).json({
      success: true,
      data: {
        ...job,
        recentLogs,
        stats: {
          totalRuns: allLogs.length,
          successCount,
          failedCount,
          successRate,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching cron job:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch cron job",
      error: error.message,
    });
  }
};

/**
 * Create new cron job
 */
const createJob = async (req, res) => {
  try {
    const {
      name,
      displayName,
      description,
      cronExpression,
      intervalMinutes,
      isEnabled = true,
      maxRetries = 3,
      retryIntervalSeconds = 60,
      category,
    } = req.body;

    // Validation
    if (!name || !displayName || !category) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: name, displayName, category",
      });
    }

    // Check if name already exists
    const [existing] = await db
      .select()
      .from(cronJobs)
      .where(eq(cronJobs.name, name));

    if (existing) {
      return res.status(400).json({
        success: false,
        message: "Cron job with this name already exists",
      });
    }

    // Generate cron expression from interval if not provided
    const finalCronExpression =
      cronExpression || intervalToCron(intervalMinutes);

    // All jobs use the centralized execute endpoint
    const endpoint = "/cron/execute";
    const method = "POST";

    // Create job in database
    const [newJob] = await db
      .insert(cronJobs)
      .values({
        name,
        displayName,
        description,
        endpoint,
        method,
        cronExpression: finalCronExpression,
        intervalMinutes,
        isEnabled,
        maxRetries,
        retryIntervalSeconds,
        category,
      })
      .returning();

    // Create pg_cron job if enabled
    if (isEnabled) {
      try {
        // The pg_cron will call the centralized endpoint with function name
        const payload = JSON.stringify({ function: name });
        await createPgCronJob(
          name,
          finalCronExpression,
          endpoint,
          method,
          payload,
        );
        console.log(`✅ pg_cron job created: ${name}`);
      } catch (pgCronError) {
        console.error(`⚠️  Failed to create pg_cron job: ${name}`, pgCronError);
        // Still save the job but warn the user
        return res.status(201).json({
          success: true,
          message:
            "Cron job created but pg_cron schedule failed. Please check Supabase.",
          data: newJob,
          warning: "pg_cron schedule failed",
        });
      }
    }

    res.status(201).json({
      success: true,
      message: "Cron job created successfully",
      data: newJob,
    });
  } catch (error) {
    console.error("Error creating cron job:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create cron job",
      error: error.message,
    });
  }
};

/**
 * Update cron job
 */
const updateJob = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      displayName,
      description,
      cronExpression,
      intervalMinutes,
      isEnabled,
      maxRetries,
      retryIntervalSeconds,
      category,
    } = req.body;

    // Check if job exists
    const [existing] = await db
      .select()
      .from(cronJobs)
      .where(eq(cronJobs.id, parseInt(id)));

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Cron job not found",
      });
    }

    // Build update data object
    const updateData = {};
    if (displayName !== undefined) updateData.displayName = displayName;
    if (description !== undefined) updateData.description = description;
    if (cronExpression !== undefined)
      updateData.cronExpression = cronExpression;
    if (intervalMinutes !== undefined) {
      updateData.intervalMinutes = intervalMinutes;
      // Also update cron expression if interval changed
      if (!cronExpression) {
        updateData.cronExpression = intervalToCron(intervalMinutes);
      }
    }
    if (isEnabled !== undefined) updateData.isEnabled = isEnabled;
    if (maxRetries !== undefined) updateData.maxRetries = maxRetries;
    if (retryIntervalSeconds !== undefined)
      updateData.retryIntervalSeconds = retryIntervalSeconds;
    if (category !== undefined) updateData.category = category;
    updateData.updatedAt = new Date();

    const [updated] = await db
      .update(cronJobs)
      .set(updateData)
      .where(eq(cronJobs.id, parseInt(id)))
      .returning();

    // Update pg_cron job if schedule or enabled status changed
    const needsPgCronUpdate =
      (updateData.intervalMinutes !== undefined ||
        updateData.cronExpression !== undefined ||
        updateData.isEnabled !== undefined) &&
      existing.isEnabled;

    if (needsPgCronUpdate) {
      try {
        if (updateData.isEnabled === false || isEnabled === false) {
          // Disable = delete pg_cron job
          await deletePgCronJob(existing.name);
          console.log(`🗑️  pg_cron job disabled: ${existing.name}`);
        } else {
          // Update or create pg_cron job with function name payload
          const finalCronExpression =
            updateData.cronExpression || existing.cronExpression;
          const payload = JSON.stringify({ function: existing.name });
          await updatePgCronJob(
            existing.name,
            finalCronExpression,
            existing.endpoint,
            existing.method,
            payload,
          );
          console.log(`✅ pg_cron job updated: ${existing.name}`);
        }
      } catch (pgCronError) {
        console.error(
          `⚠️  Failed to update pg_cron job: ${existing.name}`,
          pgCronError,
        );
        return res.status(200).json({
          success: true,
          message:
            "Job updated but pg_cron schedule failed. Please check Supabase.",
          data: updated,
          warning: "pg_cron schedule update failed",
        });
      }
    }

    res.status(200).json({
      success: true,
      message: "Cron job updated successfully",
      data: updated,
    });
  } catch (error) {
    console.error("Error updating cron job:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update cron job",
      error: error.message,
    });
  }
};

/**
 * Delete cron job
 */
const deleteJob = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if job exists
    const [existing] = await db
      .select()
      .from(cronJobs)
      .where(eq(cronJobs.id, parseInt(id)));

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Cron job not found",
      });
    }

    // Delete pg_cron job first
    try {
      await deletePgCronJob(existing.name);
      console.log(`🗑️  pg_cron job deleted: ${existing.name}`);
    } catch (pgCronError) {
      console.warn(
        `⚠️  Failed to delete pg_cron job: ${existing.name}`,
        pgCronError,
      );
      // Continue with database deletion
    }

    // Delete job from database (logs will be cascade deleted)
    await db.delete(cronJobs).where(eq(cronJobs.id, parseInt(id)));

    res.status(200).json({
      success: true,
      message: "Cron job deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting cron job:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete cron job",
      error: error.message,
    });
  }
};

/**
 * Trigger cron job manually
 * Executes the job function directly without going through HTTP/execute endpoint
 */
const triggerJob = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.token?.id;

    // Check if job exists
    const [job] = await db
      .select()
      .from(cronJobs)
      .where(eq(cronJobs.id, parseInt(id)));

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Cron job not found",
      });
    }

    if (!job.isEnabled) {
      return res.status(400).json({
        success: false,
        message: "Cannot trigger disabled job",
      });
    }

    // Import the job handlers to execute directly
    const {
      sendUpcomingServiceReminders,
      sendDayOfReminders,
    } = require("../utils/reminderService");

    // Create a log entry for manual trigger
    const [log] = await db
      .insert(cronJobLogs)
      .values({
        jobId: job.id,
        status: "running",
        triggeredBy: "manual",
        triggeredByUserId: userId,
      })
      .returning();

    // Execute the job function directly based on job name
    // This avoids double execution through the HTTP endpoint
    executeJobFunction(job.name, log.id).catch((error) => {
      console.error(`Error executing job ${job.name}:`, error);
    });

    res.status(200).json({
      success: true,
      message: "Cron job triggered successfully",
      data: {
        jobId: job.id,
        jobName: job.name,
        logId: log.id,
        status: "running",
      },
    });
  } catch (error) {
    console.error("Error triggering cron job:", error);
    res.status(500).json({
      success: false,
      message: "Failed to trigger cron job",
      error: error.message,
    });
  }
};

/**
 * Execute job function directly (not via HTTP)
 * Used for manual triggers to avoid double logging/execution
 */
async function executeJobFunction(jobName, logId) {
  const startTime = Date.now();
  let result = null;
  let status = "success";
  let errorMessage = null;
  let errorDetails = null;

  try {
    let response;
    const db = require("../config/db");
    const { eq, and, sql, lt, isNull } = require("drizzle-orm");
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
      sendAcceptReminders,
      sendUpcomingServiceReminders,
      sendDayOfReminders,
      sendPendingBookingReminders,
    } = require("../utils/reminderService");
    const notificationTemplates = require("../utils/notificationHelper");

    // Execute the appropriate job function based on name
    switch (jobName) {
      case "send_upcoming_reminders": {
        const reminderResult = await sendUpcomingServiceReminders();
        response = {
          success: true,
          message: "Upcoming service reminders completed",
          ...reminderResult,
        };
        break;
      }
      case "send_day_of_reminders": {
        const reminderResult = await sendDayOfReminders();
        response = {
          success: true,
          message: "Day-of service reminders completed",
          ...reminderResult,
        };
        break;
      }
      case "check_trials": {
        const now = new Date();
        const expiredTrials = await db
          .select()
          .from(providerSubscriptions)
          .where(
            and(
              eq(providerSubscriptions.status, "trial"),
              lt(providerSubscriptions.trialEndDate, now),
            ),
          );

        const results = {
          checked: expiredTrials.length,
          updated: 0,
          errors: [],
        };

        const [freePlan] = await db
          .select()
          .from(subscriptionPlans)
          .where(eq(subscriptionPlans.name, "Free"))
          .limit(1);

        for (const trial of expiredTrials) {
          try {
            await db
              .update(providerSubscriptions)
              .set({
                status: "trial_ended",
                autoRenew: false,
                updatedAt: now,
              })
              .where(eq(providerSubscriptions.id, trial.id));

            if (freePlan) {
              await db
                .update(providerSubscriptions)
                .set({
                  planId: freePlan.id,
                  platformFeeAtPurchase: freePlan.platformFeePercentage,
                })
                .where(eq(providerSubscriptions.id, trial.id));
            }

            try {
              await notificationTemplates.trialEnded(trial.providerId);
            } catch (notifError) {
              console.error(
                "Failed to send trial ended notification:",
                notifError,
              );
            }

            results.updated++;
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

        response = {
          success: true,
          message: "Trial check completed",
          ...results,
        };
        break;
      }
      case "auto_assign_staff": {
        const ONE_HOUR_FROM_NOW = sql`NOW() + INTERVAL '1 hour'`;
        // Combine booking date with slot time using PostgreSQL date arithmetic
        const bookingDateTime = sql`CAST(${bookings.bookingDate} AS date) + ${slots.startTime}`;
        const bookingsToAssign = await db
          .select({
            bookingId: bookings.id,
            businessProfileId: bookings.businessProfileId,
            slotId: bookings.slotId,
            bookingDate: bookings.bookingDate,
            totalPrice: bookings.totalPrice,
            slotStartTime: slots.startTime,
            providerId: businessProfiles.providerId,
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
              sql`ABS(EXTRACT(EPOCH FROM (${bookingDateTime} - ${ONE_HOUR_FROM_NOW}))) < 300`,
            ),
          );

        const results = {
          processed: bookingsToAssign.length,
          assigned: 0,
          skipped: 0,
          errors: [],
        };

        for (const booking of bookingsToAssign) {
          try {
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
              results.skipped++;
              continue;
            }

            const bookingDate = booking.bookingDate.toISOString().split("T")[0];
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
              results.skipped++;
              continue;
            }

            const staffBookingCounts = [];
            for (const s of availableStaff) {
              const [countResult] = await db
                .select({ count: require("drizzle-orm").count() })
                .from(bookings)
                .where(
                  and(
                    eq(bookings.assignedStaffId, s.id),
                    eq(bookings.bookingDate, bookingDate),
                    inArray(bookings.status, [
                      "confirmed",
                      "reschedule_pending",
                    ]),
                  ),
                );
              staffBookingCounts.push({
                staffId: s.id,
                count: countResult.count || 0,
              });
            }

            const minCount = Math.min(
              ...staffBookingCounts.map((s) => s.count),
            );
            const leastBusyStaff = staffBookingCounts.filter(
              (s) => s.count === minCount,
            );

            let selectedStaffId;

            if (leastBusyStaff.length === 1) {
              selectedStaffId = leastBusyStaff[0].staffId;
            } else {
              // Random selection among tied staff
              selectedStaffId =
                leastBusyStaff[
                  Math.floor(Math.random() * leastBusyStaff.length)
                ].staffId;
            }

            await db
              .update(bookings)
              .set({
                assignedStaffId: selectedStaffId,
                staffAssignedAt: new Date(),
              })
              .where(eq(bookings.id, booking.bookingId));

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

        response = {
          success: true,
          message: "Auto-assign completed",
          ...results,
        };
        break;
      }
      case "send_staff_reminders": {
        const TOMORROW = sql`CAST(NOW() + INTERVAL '1 day' AS date)`;
        const tomorrowBookings = await db
          .select({
            bookingId: bookings.id,
            staffUserId: users.id,
            serviceName: services.name,
            bookingDate: bookings.bookingDate,
            slotTime: slots.startTime,
          })
          .from(bookings)
          .innerJoin(staff, eq(bookings.assignedStaffId, staff.id))
          .innerJoin(users, eq(staff.userId, users.id))
          .innerJoin(services, eq(bookings.serviceId, services.id))
          .innerJoin(slots, eq(bookings.slotId, slots.id))
          .where(
            and(
              eq(bookings.status, "confirmed"),
              sql`CAST(${bookings.bookingDate} AS date) = ${TOMORROW}`,
            ),
          );

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
              message: `You have a booking for ${booking.serviceName} tomorrow at ${booking.slotTime}.`,
              data: JSON.stringify({
                bookingId: booking.bookingId,
                actionUrl: "/staff/bookings",
              }),
            });
            results.reminded++;
          } catch (error) {
            console.error(
              `Error sending reminder to staff ${booking.staffUserId}:`,
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
          message: "Staff booking reminders completed",
          ...results,
        };
        break;
      }
      case "send_no_staff_reminders": {
        const THREE_HOURS_FROM_NOW = sql`NOW() + INTERVAL '3 hours'`;
        // Combine booking date with slot time using PostgreSQL date arithmetic
        const bookingDateTime = sql`CAST(${bookings.bookingDate} AS date) + ${slots.startTime}`;
        const bookingsToRemind = await db
          .select({
            bookingId: bookings.id,
            businessProfileId: bookings.businessProfileId,
            providerId: businessProfiles.providerId,
            serviceName: services.name,
            bookingDate: bookings.bookingDate,
            slotStartTime: slots.startTime,
          })
          .from(bookings)
          .innerJoin(slots, eq(bookings.slotId, slots.id))
          .innerJoin(
            businessProfiles,
            eq(bookings.businessProfileId, businessProfiles.id),
          )
          .innerJoin(services, eq(bookings.serviceId, services.id))
          .where(
            and(
              eq(bookings.status, "confirmed"),
              isNull(bookings.assignedStaffId),
              sql`ABS(EXTRACT(EPOCH FROM (${bookingDateTime} - ${THREE_HOURS_FROM_NOW}))) < 300`,
            ),
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
              message: `Booking #${booking.bookingId} for ${booking.serviceName} on ${booking.bookingDate.toISOString().split("T")[0]} at ${booking.slotStartTime} has no staff assigned.`,
              data: JSON.stringify({
                bookingId: booking.bookingId,
                actionUrl: `/provider/bookings?booking=${booking.bookingId}`,
              }),
            });
            results.reminded++;
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

        response = {
          success: true,
          message: "No staff assigned reminders completed",
          ...results,
        };
        break;
      }
      default:
        throw new Error(`Unknown job function: ${jobName}`);
    }

    result = JSON.stringify(response);
    status = response.success === false ? "partial_success" : "success";
  } catch (error) {
    console.error(`Error executing job function ${jobName}:`, error);
    status = "failed";
    errorMessage = error.message;
    errorDetails = JSON.stringify({
      stack: error.stack,
      message: error.message,
    });
  }

  const durationMs = Date.now() - startTime;

  // Update the log entry
  await db
    .update(cronJobLogs)
    .set({
      completedAt: new Date(),
      status,
      result,
      errorMessage,
      errorDetails,
      durationMs,
    })
    .where(eq(cronJobLogs.id, logId));

  // Update job's last run info
  const [jobData] = await db
    .select()
    .from(cronJobs)
    .where(eq(cronJobs.name, jobName));
  if (jobData) {
    await db
      .update(cronJobs)
      .set({
        lastRunAt: new Date(),
        lastRunStatus: status,
        nextRunAt: jobData.intervalMinutes
          ? new Date(Date.now() + jobData.intervalMinutes * 60 * 1000)
          : null,
      })
      .where(eq(cronJobs.id, jobData.id));
  }
}

/**
 * Get job logs
 */
const getJobLogs = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      limit = 50,
      offset = 0,
      status,
      startDate,
      endDate,
      triggeredBy,
    } = req.query;

    // Check if job exists
    const [job] = await db
      .select()
      .from(cronJobs)
      .where(eq(cronJobs.id, parseInt(id)));

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Cron job not found",
      });
    }

    // Build conditions
    const conditions = [eq(cronJobLogs.jobId, parseInt(id))];

    if (status) {
      conditions.push(eq(cronJobLogs.status, status));
    }

    if (triggeredBy) {
      conditions.push(eq(cronJobLogs.triggeredBy, triggeredBy));
    }

    if (startDate) {
      conditions.push(
        sql`${cronJobLogs.startedAt} >= ${new Date(startDate).toISOString()}::timestamp`,
      );
    }

    if (endDate) {
      conditions.push(
        sql`${cronJobLogs.startedAt} <= ${new Date(endDate).toISOString()}::timestamp`,
      );
    }

    // Get logs with user info for manual triggers
    const logs = await db
      .select({
        id: cronJobLogs.id,
        startedAt: cronJobLogs.startedAt,
        completedAt: cronJobLogs.completedAt,
        status: cronJobLogs.status,
        result: cronJobLogs.result,
        errorMessage: cronJobLogs.errorMessage,
        errorDetails: cronJobLogs.errorDetails,
        triggeredBy: cronJobLogs.triggeredBy,
        triggeredByUserId: cronJobLogs.triggeredByUserId,
        durationMs: cronJobLogs.durationMs,
        retryCount: cronJobLogs.retryCount,
        createdAt: cronJobLogs.createdAt,
      })
      .from(cronJobLogs)
      .where(and(...conditions))
      .orderBy(desc(cronJobLogs.startedAt))
      .limit(parseInt(limit))
      .offset(parseInt(offset));

    // Get total count
    const [{ count }] = await db
      .select({ count: sql`count(*)` })
      .from(cronJobLogs)
      .where(and(...conditions));

    res.status(200).json({
      success: true,
      data: logs,
      pagination: {
        total: parseInt(count),
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: parseInt(offset) + parseInt(limit) < parseInt(count),
      },
    });
  } catch (error) {
    console.error("Error fetching job logs:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch job logs",
      error: error.message,
    });
  }
};

/**
 * Get overall cron job stats
 */
const getJobStats = async (req, res) => {
  try {
    // Get job counts by status
    const [{ total: totalJobs }] = await db
      .select({ total: sql`count(*)` })
      .from(cronJobs);

    const [{ total: enabledJobs }] = await db
      .select({ total: sql`count(*)` })
      .from(cronJobs)
      .where(eq(cronJobs.isEnabled, true));

    // Get log stats for last 24 hours
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const yesterdayStr = yesterday.toISOString();

    const [{ total: recentRuns }] = await db
      .select({ total: sql`count(*)` })
      .from(cronJobLogs)
      .where(sql`${cronJobLogs.startedAt} >= ${yesterdayStr}::timestamp`);

    const [{ total: recentSuccess }] = await db
      .select({ total: sql`count(*)` })
      .from(cronJobLogs)
      .where(
        and(
          sql`${cronJobLogs.startedAt} >= ${yesterdayStr}::timestamp`,
          eq(cronJobLogs.status, "success"),
        ),
      );

    const [{ total: recentFailed }] = await db
      .select({ total: sql`count(*)` })
      .from(cronJobLogs)
      .where(
        and(
          sql`${cronJobLogs.startedAt} >= ${yesterdayStr}::timestamp`,
          eq(cronJobLogs.status, "failed"),
        ),
      );

    // Get jobs by category
    const jobsByCategory = await db
      .select({
        category: cronJobs.category,
        count: sql`count(*)`,
      })
      .from(cronJobs)
      .groupBy(cronJobs.category);

    // Get currently running jobs
    const [{ total: runningJobs }] = await db
      .select({ total: sql`count(*)` })
      .from(cronJobLogs)
      .where(eq(cronJobLogs.status, "running"));

    // Get jobs that need attention (last run failed in last 24 hours)
    const failedJobs = await db
      .select({
        id: cronJobs.id,
        name: cronJobs.name,
        displayName: cronJobs.displayName,
        lastRunAt: cronJobs.lastRunAt,
        lastRunStatus: cronJobs.lastRunStatus,
      })
      .from(cronJobs)
      .where(
        and(
          eq(cronJobs.isEnabled, true),
          eq(cronJobs.lastRunStatus, "failed"),
          sql`${cronJobs.lastRunAt} >= ${yesterdayStr}::timestamp`,
        ),
      )
      .orderBy(desc(cronJobs.lastRunAt))
      .limit(5);

    res.status(200).json({
      success: true,
      data: {
        summary: {
          totalJobs,
          enabledJobs,
          runningJobs,
          recentRuns,
          recentSuccess,
          recentFailed,
          recentSuccessRate:
            recentRuns > 0 ? Math.round((recentSuccess / recentRuns) * 100) : 0,
        },
        jobsByCategory,
        failedJobs,
      },
    });
  } catch (error) {
    console.error("Error fetching cron stats:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch cron stats",
      error: error.message,
    });
  }
};

/**
 * Sync a single job to pg_cron
 * POST /admin/cron-jobs/jobs/:id/sync
 */
const syncJobToPgCron = async (req, res) => {
  try {
    const { id } = req.params;
    const { syncJobToPgCron } = require("../utils/pgCron");

    const result = await syncJobToPgCron(parseInt(id));

    res.status(200).json({
      success: result.success,
      message: result.success
        ? "Job synced to pg_cron successfully"
        : "Failed to sync job to pg_cron",
      data: result,
    });
  } catch (error) {
    console.error("Error syncing job to pg_cron:", error);
    res.status(500).json({
      success: false,
      message: "Failed to sync job to pg_cron",
      error: error.message,
    });
  }
};

/**
 * Sync all enabled jobs to pg_cron
 * POST /admin/cron-jobs/jobs/sync-all
 */
const syncAllJobs = async (req, res) => {
  try {
    const { syncAllJobsToPgCron } = require("../utils/pgCron");

    const result = await syncAllJobsToPgCron();

    res.status(200).json({
      success: true,
      message: "Sync all jobs completed",
      data: result,
    });
  } catch (error) {
    console.error("Error syncing all jobs to pg_cron:", error);
    res.status(500).json({
      success: false,
      message: "Failed to sync all jobs",
      error: error.message,
    });
  }
};

/**
 * Get sync status overview
 * GET /admin/cron-jobs/jobs/sync-status
 */
const getSyncStatus = async (req, res) => {
  try {
    const { getSyncStatus } = require("../utils/pgCron");

    const status = await getSyncStatus();

    res.status(200).json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error("Error getting sync status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get sync status",
      error: error.message,
    });
  }
};

module.exports = {
  getAllJobs,
  getJobById,
  createJob,
  updateJob,
  deleteJob,
  triggerJob,
  getJobLogs,
  getJobStats,
  syncJobToPgCron,
  syncAllJobs,
  getSyncStatus,
};
