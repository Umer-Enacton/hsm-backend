const authorizeRole = (...allowedRoleIds) => {
  return (req, res, next) => {
    console.log("🔍 authorizeRole check:", {
      token: req.token,
      allowedRoleIds,
      hasRoleId: req.token?.roleId,
    });

    if (!req.token || req.token.roleId == null) {
      console.log("❌ Access denied: role not found");
      return res.status(403).json({
        message: "Access denied: role not found",
      });
    }

    if (!allowedRoleIds.includes(req.token.roleId)) {
      console.log("❌ Access denied: insufficient permissions");
      return res.status(403).json({
        message: "Access denied: insufficient permissions",
      });
    }

    console.log("✅ Access granted");
    next();
  };
};

module.exports = authorizeRole;
