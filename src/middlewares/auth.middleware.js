const jwt = require("jsonwebtoken");
const User = require("../models/User");
const env = require("../config/env");
const { getAccessRole } = require("../utils/roleAccess");

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Access denied. Token missing.",
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, env.jwtAccessSecret);

    const user = await User.findOne({
      _id: decoded.userId,
      deletedAt: null,
    })
      .select("-passwordHash")
      .populate("departmentId", "name code slug normalizedName status allowedRoles")
      .populate("designationId", "name title code mappedRole allowedRoles hierarchyLevel status isDepartmentHead isHead");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found or deleted.",
      });
    }

    if (user.status !== "active") {
      return res.status(403).json({
        success: false,
        message: `Account is ${user.status}.`,
      });
    }

    user.accessRole = getAccessRole(user);
    req.user = user;
    req.auth = decoded;
    next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      message: "Invalid or expired token.",
    });
  }
};

module.exports = {
  authenticate,
};
