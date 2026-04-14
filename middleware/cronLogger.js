const db = require("../config/db");
const { eq, and } = require("drizzle-orm");
const { cronJobs, cronJobLogs } = require("../models/schema");

/**
 * Middleware to log cron job executions
 * Wraps cron endpoints to automatically create log entries
 *
 * Usage:
 * router.post("/my-cron", cronLogger("my_cron_job_name"), myControllerFunction);
 */
const cronLogger = (jobName) => {
  return async (req, res, next) => {
    // Skip logging if CRON_SECRET is not being used (direct testing)
    const cronSecret = req.headers["x-cron-secret"] || req.headers["authorization"];
    if (!cronSecret && process.env.NODE_ENV === "production") {
      return next();
    }

    const startTime = Date.now();
    let logId = null;

    try {
      // Find the job in database
      const [job] = await db
        .select()
        .from(cronJobs)
        .where(eq(cronJobs.name, jobName));

      if (!job) {
        console.warn(`Cron job "${jobName}" not found in database, skipping logging`);
        return next();
      }

      // Create log entry
      const [log] = await db
        .insert(cronJobLogs)
        .values({
          jobId: job.id,
          status: "running",
          triggeredBy: "schedule",
        })
        .returning();

      logId = log.id;

      // Store log info on request for controller to use
      req.cronLogId = logId;
      req.cronJobId = job.id;

      // Intercept res.json to capture response
      const originalJson = res.json.bind(res);
      const originalSend = res.send.bind(res);

      let responseData = null;

      res.json = function (data) {
        responseData = data;
        return originalJson(data);
      };

      res.send = function (data) {
        responseData = data;
        return originalSend(data);
      };

      // Continue to controller
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
        if (responseData && typeof responseData === "object") {
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

      next();
    } catch (error) {
      console.error(`Cron logger error for "${jobName}":`, error);

      // Create error log entry if we have a logId
      if (logId) {
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
      }

      next();
    }
  };
};

/**
 * Helper function to manually log a cron job execution
 * Use this inside controllers that need custom logging
 *
 * @param {string} jobName - Name of the cron job
 * @param {object} result - Result object from the job execution
 * @returns {Promise<object>} The created log entry
 */
const logCronExecution = async (jobName, result) => {
  try {
    const [job] = await db
      .select()
      .from(cronJobs)
      .where(eq(cronJobs.name, jobName));

    if (!job) {
      console.warn(`Cron job "${jobName}" not found in database`);
      return null;
    }

    const status = result.success === false ? "failed" : "success";

    const [log] = await db
      .insert(cronJobLogs)
      .values({
        jobId: job.id,
        startedAt: result.startedAt || new Date(),
        completedAt: new Date(),
        status,
        result: JSON.stringify(result.data || result),
        errorMessage: result.error,
        errorDetails: result.errorDetails
          ? JSON.stringify(result.errorDetails)
          : null,
        triggeredBy: result.triggeredBy || "schedule",
        triggeredByUserId: result.triggeredByUserId,
        durationMs: result.durationMs || 0,
      })
      .returning();

    // Update job's last run info
    await db
      .update(cronJobs)
      .set({
        lastRunAt: new Date(),
        lastRunStatus: status,
        nextRunAt: job.intervalMinutes
          ? new Date(Date.now() + job.intervalMinutes * 60 * 1000)
          : null,
      })
      .where(eq(cronJobs.id, job.id));

    return log;
  } catch (error) {
    console.error(`Error logging cron execution for "${jobName}":`, error);
    return null;
  }
};

/**
 * Get recent logs for a specific job
 * @param {string} jobName - Name of the cron job
 * @param {number} limit - Number of logs to return
 */
const getJobRecentLogs = async (jobName, limit = 10) => {
  try {
    const [job] = await db
      .select()
      .from(cronJobs)
      .where(eq(cronJobs.name, jobName));

    if (!job) {
      return [];
    }

    const logs = await db
      .select()
      .from(cronJobLogs)
      .where(eq(cronJobLogs.jobId, job.id))
      .orderBy(require("drizzle-orm").desc(cronJobLogs.startedAt))
      .limit(limit);

    return logs;
  } catch (error) {
    console.error(`Error getting logs for "${jobName}":`, error);
    return [];
  }
};

module.exports = {
  cronLogger,
  logCronExecution,
  getJobRecentLogs,
};
