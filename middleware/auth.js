const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET;
const auth = (req, res, next) => {
  // Skip auth for cron endpoints
  if (req.path.startsWith("/cron")) {
    console.log("⏰ Skipping auth for cron endpoint:", req.path);
    return next();
  }

  console.log(
    "🔍 Auth middleware called for path:",
    req.path,
    "method:",
    req.method,
  );
  try {
    let token = null;
    let tokenSource = "";

    // Check Authorization header first (for cross-domain requests)
    const bearerHeader = req.headers["authorization"];
    if (typeof bearerHeader !== "undefined") {
      const bearer = bearerHeader.split(" ");
      if (bearer.length === 2 && bearer[0] === "Bearer") {
        token = bearer[1];
        tokenSource = "Authorization header";
      }
    }

    // Fall back to cookies (for same-domain requests)
    if (!token && req.cookies.token) {
      token = req.cookies.token;
      tokenSource = "Cookie";
    }

    console.log(
      "🔑 Auth middleware - Token found:",
      !!token,
      "Source:",
      tokenSource,
    );

    if (token) {
      const user = jwt.verify(token, JWT_SECRET);
      console.log("✅ Token verified, user:", {
        id: user.id,
        email: user.email,
        roleId: user.roleId,
      });
      req.token = user;
      next();
    } else {
      console.log("❌ No token in Authorization header or cookies");
      res.status(401).json({ message: "No Token Provided" });
    }
  } catch (error) {
    console.log("❌ Token verification failed:", error.message);
    res.status(401).json({ message: "Invalid or Expired Token" });
  }
};
module.exports = auth;
