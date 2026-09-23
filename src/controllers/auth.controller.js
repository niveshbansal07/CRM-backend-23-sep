const ApiResponse = require("../utils/ApiResponse");
const { registerUser, loginUser } = require("../services/auth.service");
const { getCompanyForSession } = require("../services/company.service");

const loginController = async (req, res) => {
  try {
    const result = await loginUser({
      email: req.body.email,
      password: req.body.password,
      userAgent: req.headers["user-agent"] || "",
      ipAddress: req.ip || "",
    });
    const company = result.user.companyId
      ? await getCompanyForSession(result.user.companyId)
      : null;

    return res.status(200).json(
      new ApiResponse(200, "Login successful", {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        role: result.user.role,
        user: result.user.toSafeObject(),
        company,
      })
    );
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal server error",
    });
  }
};

const registerController = async (req, res, next) => {
  try {
    const payload = { ...req.body };
    if (req.user?.role !== "super_admin") {
      payload.companyId = req.user.companyId;
      const requestedRole = payload.systemRole || payload.role || "user";
      if (!["employee", "manager", "user"].includes(requestedRole)) {
        return res.status(400).json({
          success: false,
          message: "Use staff management APIs to create admin or HR users",
        });
      }
    }
    const user = await registerUser(payload, req.user || null);
    return res.status(201).json(
      new ApiResponse(201, "User registered successfully", {
        user: user.toSafeObject(),
      })
    );
  } catch (error) {
    next(error);
  }
};

const meController = async (req, res) => {
  try {
    const company = req.user.companyId
      ? await getCompanyForSession(req.user.companyId)
      : null;
    return res.status(200).json({
      success: true,
      message: "Current user fetched successfully",
      data: {
        user: req.user.toSafeObject ? req.user.toSafeObject() : req.user,
        company,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch current user",
    });
  }
};

module.exports = {
  loginController,
  registerController,
  meController,
};
