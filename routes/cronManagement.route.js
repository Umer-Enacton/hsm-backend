const express = require("express");
const router = express.Router();
const authorizeRole = require("../middleware/roleBasedRoutes");
const { ADMIN } = require("../config/roles");
const {
  getAllJobs,
  getJobById,
  createJob,
  updateJob,
  deleteJob,
  triggerJob,
  getJobLogs,
  getAllLogs,
  getJobStats,
  syncJobToPgCron,
  syncAllJobs,
  getSyncStatus,
} = require("../controllers/cronManagement.controller");

// All routes require admin role
router.use(authorizeRole(ADMIN));

// Get all logs
router.get("/logs/all", getAllLogs);

// Get all cron jobs with stats
router.get("/jobs", getAllJobs);

// Get overall stats dashboard
router.get("/stats", getJobStats);

// Get sync status overview
router.get("/jobs/sync-status", getSyncStatus);

// Sync all enabled jobs to pg_cron
router.post("/jobs/sync-all", syncAllJobs);

// Get single job by ID with recent logs
router.get("/jobs/:id", getJobById);

// Create new cron job
router.post("/jobs", createJob);

// Update cron job
router.put("/jobs/:id", updateJob);

// Delete cron job
router.delete("/jobs/:id", deleteJob);

// Sync single job to pg_cron
router.post("/jobs/:id/sync", syncJobToPgCron);

// Trigger job manually
router.post("/jobs/:id/trigger", triggerJob);

// Get job execution logs
router.get("/jobs/:id/logs", getJobLogs);

module.exports = router;
