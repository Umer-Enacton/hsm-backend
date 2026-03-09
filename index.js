const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/auth.route");
const googleAuthRoutes = require("./routes/googleAuth.route");
const invoiceRoutes = require("./routes/invoice.route");
const addressRoutes = require("./routes/address.route");
const userRoutes = require("./routes/user.route");
const categoryRoutes = require("./routes/category.route");
const businessRoutes = require("./routes/business.route");
const servicesRoutes = require("./routes/service.route");
const slotRoutes = require("./routes/slot.route");
const bookingRoutes = require("./routes/booking.route");
const feedbackRoutes = require("./routes/feedback.route");
const uploadRoutes = require("./routes/upload.route");
const paymentRoutes = require("./routes/payment.route");
const adminBookingsRoutes = require("./routes/adminBookings.route");
const cronRoutes = require("./routes/cron.route");
const auth = require("./middleware/auth");
const { startPeriodicCleanup } = require("./utils/cleanupExpiredIntents");
const app = express();
const PORT = process.env.PORT || 8000;
require("dotenv").config();
const cookieParser = require("cookie-parser");

// CORS Configuration
const allowedOrigins = [
  "http://localhost:3000",
  "https://homefixcare.vercel.app",
  process.env.FRONTEND_URL,
].filter(Boolean);

console.log("=== CORS Configuration ===");
console.log("Allowed origins:", allowedOrigins);
console.log("========================");

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps, curl, Postman, server-to-server)
      if (!origin) {
        console.log("CORS: Allowing request with no origin");
        return callback(null, true);
      }

      console.log("CORS: Request from origin:", origin);

      if (allowedOrigins.indexOf(origin) !== -1) {
        console.log("CORS: ✅ Allowed");
        callback(null, true);
      } else {
        console.log("CORS: ❌ Blocked - Origin not in allowed list");
        console.log("CORS: Allowed origins are:", allowedOrigins);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["Set-Cookie"],
  }),
);

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

// Upload routes (must come before global auth middleware to avoid body-parser conflicts)
app.use("/", uploadRoutes);
// Root route
app.get("/", (req, res) => {
  res.json({
    message: "Welcome to HSM Backend API",
  });
});

app.use("/", authRoutes);
app.use("/auth", googleAuthRoutes);
app.use("/cron", cronRoutes);
app.use(auth);
app.use("/payment", paymentRoutes);
app.use("/invoice", invoiceRoutes);
app.use("/admin", adminBookingsRoutes);
app.use("/", addressRoutes);
app.use("/", userRoutes);
app.use("/", categoryRoutes);
app.use("/", businessRoutes);
app.use("/", servicesRoutes);
app.use("/", slotRoutes);
app.use("/", bookingRoutes);
app.use("/", feedbackRoutes);

// Start server (only for local development)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);

    // Start periodic cleanup of expired payment intents
    startPeriodicCleanup();
  });
}

// Export for Vercel serverless deployment
module.exports = app;
