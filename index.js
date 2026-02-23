const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/auth.route");
const addressRoutes = require("./routes/address.route");
const userRoutes = require("./routes/user.route");
const categoryRoutes = require("./routes/category.route");
const businessRoutes = require("./routes/business.route");
const servicesRoutes = require("./routes/service.route");
const slotRoutes = require("./routes/slot.route");
const bookingRoutes = require("./routes/booking.route");
const feedbackRoutes = require("./routes/feedback.route");
const uploadRoutes = require("./routes/upload.route");
const auth = require("./middleware/auth");
const app = express();
const PORT = process.env.PORT || 8000;
require("dotenv").config();
const cookieParser = require("cookie-parser");

// CORS Configuration
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
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
app.use(auth);
app.use("/", addressRoutes);
app.use("/", userRoutes);
app.use("/", categoryRoutes);
app.use("/", businessRoutes);
app.use("/", servicesRoutes);
app.use("/", slotRoutes);
app.use("/", bookingRoutes);
app.use("/", feedbackRoutes);
// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
