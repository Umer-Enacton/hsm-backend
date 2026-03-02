const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET;
const auth = (req, res, next) => {
  try {
    // const bearerHeader = req.headers["authorization"];
    // if (typeof bearerHeader != "undefined") {
    //   const token = bearerHeader.split(" ")[1];
    //   const user = jwt.verify(token, JWT_SECRET);
    //   req.token = user;
    //   next();
    //check from cookies
    const token = req.cookies.token;
    console.log("🔑 Auth middleware - Token found:", !!token);
    if (token) {
      const user = jwt.verify(token, JWT_SECRET);
      console.log("✅ Token verified, user:", { id: user.id, email: user.email, roleId: user.roleId });
      req.token = user;
      next();
    } else {
      console.log("❌ No token in cookies");
      res.status(401).json({ message: "No Token Provided" });
    }
  } catch (error) {
    console.log("❌ Token verification failed:", error.message);
    res.status(401).json({ message: "Invalid or Expired Token" });
  }
};
module.exports = auth;
