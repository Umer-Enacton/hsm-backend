const authorizeRole = (...allowedRoleIds) => {
  return (req, res, next) => {
    if (!req.token || req.token.roleId == null) {
      return res.status(403).json({
        message: "Access denied: role not found",
      });
    }

    if (!allowedRoleIds.includes(req.token.roleId)) {
      return res.status(403).json({
        message: "Access denied: insufficient permissions",
      });
    }

    next();
  };
};

module.exports = authorizeRole;
