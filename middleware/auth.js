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
    console.log(token);
    if (token) {
      const user = jwt.verify(token, JWT_SECRET);
      req.token = user;
      next();
    } else {
      res.status(401).json({ message: "No Token Provided" });
    }
  } catch (error) {
    res.status(401).json({ message: "Invalid or Expired Token" });
  }
};
module.exports = auth;
