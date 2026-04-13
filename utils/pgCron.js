/**
 * Supabase pg_cron Management Utility
 * Provides functions to create, update, and delete pg_cron jobs programmatically
 *
 * pg_cron stores jobs in the cron.job table
 * We can create schedules that call HTTP endpoints on our backend
 */

const db = require("../config/db");
const { sql } = require("drizzle-orm");
const { cronJobs } = require("../models/schema");
const { eq } = require("drizzle-orm");

/**
 * Create a new pg_cron job that will call an HTTP endpoint
 * @param {string} jobId - Unique job identifier (used in cron.job)
 * @param {string} cronExpression - Cron expression (e.g., every 30 min)
 * @param {string} endpoint - HTTP endpoint to call (e.g., '/cron/send-reminders')
 * @param {string} method - HTTP method (default: POST)
 * @param {string} bodyPayload - JSON payload to send in request body
 * @returns {Promise<object>} Result of pg_cron schedule creation with sync status
 */
async function createPgCronJob(jobId, cronExpression, endpoint, method = "POST", bodyPayload = null) {
  try {
    const secret = process.env.CRON_SECRET;

    // Build the request body with function name for centralized execution
    const body = bodyPayload || JSON.stringify({ function: jobId });

    // Build the HTTP POST call that pg_cron will execute
    // Using PostgreSQL's net.http_post function (available in Supabase)
    const httpCall = `
      SELECT net.http_post(
        '${process.env.API_BASE_URL || 'http://localhost:8000'}${endpoint}',
        headers: jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', '${secret}'
        ),
        body := '${body}'::jsonb,
        timeout_milliseconds := 30000
      )
    `.replace(/\s+/g, ' ').trim();

    // Create the pg_cron job
    const result = await db.execute(sql`
      SELECT cron.schedule(
        ${jobId},
        ${cronExpression},
        $$${httpCall}$$
      )
    `);

    console.log(`✅ Created pg_cron job: ${jobId} (${cronExpression})`);

    // Update sync status in cron_jobs table
    await db.update(cronJobs)
      .set({
        syncStatus: "synced",
        lastSyncedAt: new Date(),
        syncError: null,
        pgCronJobname: jobId,
      })
      .where(eq(cronJobs.name, jobId));

    return { success: true, jobId, syncStatus: "synced" };
  } catch (error) {
    console.error(`❌ Error creating pg_cron job ${jobId}:`, error);

    // Update sync status to failed
    try {
      await db.update(cronJobs)
        .set({
          syncStatus: "sync_failed",
          syncError: error.message,
        })
        .where(eq(cronJobs.name, jobId));
    } catch (updateError) {
      console.error("Failed to update sync status:", updateError);
    }

    return { success: false, jobId, error: error.message, syncStatus: "sync_failed" };
  }
}

/**
 * Update an existing pg_cron job
 * pg_cron doesn't support direct updates, so we delete and recreate
 * @param {string} jobId - Unique job identifier
 * @param {string} cronExpression - New cron expression
 * @param {string} endpoint - HTTP endpoint to call
 * @param {string} method - HTTP method
 * @param {string} bodyPayload - JSON payload to send in request body
 * @returns {Promise<object>} Result of pg_cron job update with sync status
 */
async function updatePgCronJob(jobId, cronExpression, endpoint, method = "POST", bodyPayload = null) {
  try {
    // First, delete the existing job
    await deletePgCronJob(jobId);

    // Then create a new one with updated settings
    return await createPgCronJob(jobId, cronExpression, endpoint, method, bodyPayload);
  } catch (error) {
    console.error(`❌ Error updating pg_cron job ${jobId}:`, error);

    // Update sync status to failed
    try {
      await db.update(cronJobs)
        .set({
          syncStatus: "sync_failed",
          syncError: error.message,
        })
        .where(eq(cronJobs.name, jobId));
    } catch (updateError) {
      console.error("Failed to update sync status:", updateError);
    }

    return { success: false, jobId, error: error.message, syncStatus: "sync_failed" };
  }
}

/**
 * Delete a pg_cron job
 * @param {string} jobId - Unique job identifier
 * @returns {Promise<object>} Result of pg_cron job deletion
 */
async function deletePgCronJob(jobId) {
  try {
    const result = await db.execute(sql`SELECT cron.unschedule(${jobId})`);

    console.log(`🗑️  Deleted pg_cron job: ${jobId}`);
    return { success: true, jobId };
  } catch (error) {
    console.error(`❌ Error deleting pg_cron job ${jobId}:`, error);
    // Don't throw for delete - job might not exist
    return { success: false, jobId, error: error.message };
  }
}

/**
 * Check if a pg_cron job exists
 * @param {string} jobId - Unique job identifier
 * @returns {Promise<boolean>} True if job exists
 */
async function pgCronJobExists(jobId) {
  try {
    const result = await db.execute(sql`
      SELECT jobid FROM cron.job WHERE jobname = ${jobId}
    `);

    return result && result.length > 0;
  } catch (error) {
    console.error(`❌ Error checking pg_cron job ${jobId}:`, error);
    return false;
  }
}

/**
 * Get all pg_cron jobs from the cron.job table
 * @returns {Promise<Array>} List of all pg_cron jobs
 */
async function getAllPgCronJobs() {
  try {
    const result = await db.execute(sql`
      SELECT
        jobid,
        schedule,
        command,
        nodename,
        nodeport,
        database,
        active,
        jobname
      FROM cron.job
      ORDER BY jobid
    `);

    return result || [];
  } catch (error) {
    console.error("❌ Error fetching pg_cron jobs:", error);
    return [];
  }
}

/**
 * Sync a single job from cron_jobs table to pg_cron
 * This function checks if the job exists in pg_cron and creates/updates accordingly
 * @param {number} jobId - Internal cron_jobs table ID
 * @returns {Promise<object>} Result of sync operation
 */
async function syncJobToPgCron(jobId) {
  try {
    // Fetch job from cron_jobs table
    const [job] = await db.select().from(cronJobs).where(eq(cronJobs.id, jobId));

    if (!job) {
      return { success: false, error: "Job not found in database" };
    }

    // Set status to pending
    await db.update(cronJobs)
      .set({ syncStatus: "sync_pending" })
      .where(eq(cronJobs.id, jobId));

    // Check if job exists in pg_cron
    const exists = await pgCronJobExists(job.name);

    // Use cronExpression if available, otherwise convert intervalMinutes
    const cronExpression = job.cronExpression || intervalToCron(job.intervalMinutes);

    let result;
    if (exists) {
      // Update existing job
      result = await updatePgCronJob(job.name, cronExpression, job.endpoint, job.method);
    } else {
      // Create new job
      result = await createPgCronJob(job.name, cronExpression, job.endpoint, job.method);
    }

    return result;
  } catch (error) {
    console.error(`❌ Error syncing job ${jobId} to pg_cron:`, error);

    // Update sync status to failed
    try {
      await db.update(cronJobs)
        .set({
          syncStatus: "sync_failed",
          syncError: error.message,
        })
        .where(eq(cronJobs.id, jobId));
    } catch (updateError) {
      console.error("Failed to update sync status:", updateError);
    }

    return { success: false, error: error.message, syncStatus: "sync_failed" };
  }
}

/**
 * Sync all enabled jobs to pg_cron
 * @returns {Promise<object>} Summary of sync operation
 */
async function syncAllJobsToPgCron() {
  try {
    // Fetch all enabled jobs
    const jobs = await db.select().from(cronJobs).where(eq(cronJobs.isEnabled, true));

    const results = {
      total: jobs.length,
      synced: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    };

    for (const job of jobs) {
      try {
        const result = await syncJobToPgCron(job.id);
        if (result.success) {
          results.synced++;
        } else {
          results.failed++;
          results.errors.push({ jobId: job.id, name: job.name, error: result.error });
        }
      } catch (error) {
        results.failed++;
        results.errors.push({ jobId: job.id, name: job.name, error: error.message });
      }
    }

    return results;
  } catch (error) {
    console.error("❌ Error syncing all jobs to pg_cron:", error);
    throw error;
  }
}

/**
 * Get sync status overview - compares cron_jobs with pg_cron.job
 * @returns {Promise<object>} Sync status overview
 */
async function getSyncStatus() {
  try {
    // Get all jobs from cron_jobs table
    const dbJobs = await db.select({
      id: cronJobs.id,
      name: cronJobs.name,
      isEnabled: cronJobs.isEnabled,
      syncStatus: cronJobs.syncStatus,
      pgCronJobname: cronJobs.pgCronJobname,
    }).from(cronJobs);

    // Get all jobs from pg_cron
    const pgCronJobs = await getAllPgCronJobs();
    const pgCronJobNames = new Set(pgCronJobs.map((j) => j.jobname));

    // Compare and categorize
    const synced = [];
    const notSynced = [];
    const mismatched = [];

    for (const job of dbJobs) {
      if (!job.isEnabled) continue; // Skip disabled jobs

      const existsInPgCron = pgCronJobNames.has(job.name);

      if (existsInPgCron && job.syncStatus === "synced") {
        synced.push(job);
      } else if (existsInPgCron && job.syncStatus !== "synced") {
        // Exists in pg_cron but status not updated
        mismatched.push({ ...job, issue: "Status mismatch" });
      } else if (!existsInPgCron) {
        // Doesn't exist in pg_cron
        notSynced.push(job);
      }
    }

    return {
      total: dbJobs.filter((j) => j.isEnabled).length,
      synced: synced.length,
      notSynced: notSynced.length,
      mismatched: mismatched.length,
      details: {
        synced,
        notSynced,
        mismatched,
      },
    };
  } catch (error) {
    console.error("❌ Error getting sync status:", error);
    throw error;
  }
}

/**
 * Convert interval in minutes to cron expression
 * @param {number} intervalMinutes - Interval in minutes
 * @returns {string} Cron expression
 */
function intervalToCron(intervalMinutes) {
  if (!intervalMinutes || intervalMinutes < 1) return "* * * * *"; // Every minute

  const minutes = intervalMinutes % 60;
  const hours = Math.floor(intervalMinutes / 60) % 24;
  const days = Math.floor(intervalMinutes / (60 * 24));

  if (days > 0) {
    // Daily or more
    if (days === 1) return "0 0 * * *"; // Daily at midnight
    return `0 0 */${days} * *`; // Every N days
  }

  if (hours > 0 && minutes === 0) {
    // Every hour
    return `0 */${hours} * * *`;
  }

  if (hours > 0 && minutes > 0) {
    // Every X hours Y minutes
    return `${minutes} */${hours} * * *`;
  }

  // Every N minutes
  return `*/${intervalMinutes} * * * *`;
}

module.exports = {
  createPgCronJob,
  updatePgCronJob,
  deletePgCronJob,
  pgCronJobExists,
  getAllPgCronJobs,
  syncJobToPgCron,
  syncAllJobsToPgCron,
  getSyncStatus,
  intervalToCron,
};
