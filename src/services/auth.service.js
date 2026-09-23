const bcrypt = require("bcryptjs");
const User = require("../models/User");
const RefreshToken = require("../models/RefreshToken");
const ApiError = require("../utils/ApiError");
const { generateAccessToken, generateRefreshToken } = require("../utils/generateToken");
const env = require("../config/env");
const {
    PERMISSION_SCOPES,
    sanitizePermissions,
    getDefaultPermissionsForRole,
} = require("./permission.service");
const { validateReportingManagerAssignment } = require("./reporting.service");

const buildRefreshExpiryDate = () => {
    const now = new Date();
    now.setDate(now.getDate() + 7);
    return now;
};

const registerUser = async (payload, creator = null) => {
    const {
        fullName,
        email,
        password,
        phone,
        role,
        systemRole,
        permissionScope,
        customPermissions,
        companyId,
        department,
        departmentId,
        designation,
        designationId,
        employeeId,
        managerId,
        reportingManagerId,
        joiningDate,
        sourceRequestId,
        setupCompleted,
        setupCompletedAt,
    } = payload;

    if (!fullName || !email || !password) {
        throw new ApiError(400, "Full name, email and password are required");
    }

    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await User.findOne({
        email: normalizedEmail,
        deletedAt: null,
    });

    if (existingUser) {
        throw new ApiError(409, "User already exists");
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const safePermissionScope = String(permissionScope || "self").trim().toLowerCase();
    const resolvedRole = systemRole || role || "user";
    const resolvedPermissions = Array.isArray(customPermissions) && customPermissions.length
        ? customPermissions
        : getDefaultPermissionsForRole(resolvedRole);

    if (!PERMISSION_SCOPES.includes(safePermissionScope)) {
        throw new ApiError(400, "Invalid permission scope");
    }

    let assignment = { reportingManagerId: null };
    if (companyId || departmentId || designationId || reportingManagerId || managerId) {
        assignment = await validateReportingManagerAssignment({
            companyId: companyId || null,
            employeeDesignationId: designationId || null,
            departmentId: departmentId || null,
            reportingManagerId: reportingManagerId || managerId || null,
            actorUser: creator,
            employeeRole: systemRole || role || "user",
        });
    }

    const user = await User.create({
        fullName: fullName.trim(),
        email: normalizedEmail,
        phone: phone || "",
        passwordHash,
        role: role || "user",
        systemRole: resolvedRole,
        permissionScope: safePermissionScope,
        customPermissions: sanitizePermissions(resolvedPermissions),
        companyId: companyId || null,
        department: department || "",
        departmentId: departmentId || null,
        designation: designation || "",
        designationId: designationId || null,
        employeeId: employeeId || "",
        managerId: assignment.reportingManagerId,
        reportingManagerId: assignment.reportingManagerId,
        joiningDate: joiningDate || null,
        sourceRequestId: sourceRequestId || null,
        setupCompleted: Boolean(setupCompleted),
        setupCompletedAt: setupCompletedAt || null,
        status: "active",
        isEmailVerified: true,
        createdBy: creator?._id || null,
        updatedBy: creator?._id || null,
    });

    return user;
};

const loginUser = async ({ email, password, userAgent = "", ipAddress = "" }) => {
    if (!email || !password) {
        throw new ApiError(400, "Email and password are required");
    }

    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({
        email: normalizedEmail,
        deletedAt: null,
    }).select("+passwordHash");

    if (!user) {
        throw new ApiError(401, "Invalid credentials");
    }

    if (user.status !== "active") {
        throw new ApiError(403, `User account is ${user.status}`);
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
        throw new ApiError(401, "Invalid credentials");
    }

    user.lastLoginAt = new Date();
    user.lastActiveAt = new Date();
    user.loginAttempts = 0;
    await user.save();

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    await RefreshToken.create({
        userId: user._id,
        token: refreshToken,
        expiresAt: buildRefreshExpiryDate(),
        userAgent,
        ipAddress,
    });

    await user.populate([
        { path: "departmentId", select: "name code slug normalizedName status allowedRoles" },
        { path: "designationId", select: "name title code mappedRole allowedRoles hierarchyLevel status isDepartmentHead isHead" },
    ]);

    return {
        user,
        accessToken,
        refreshToken,
        company: user.companyId ? { id: user.companyId } : null,
    };
};

const ensureDefaultSuperAdmin = async () => {
    const existing = await User.findOne({
        role: "super_admin",
        deletedAt: null,
    });

    if (existing) {
        return existing;
    }

    const passwordHash = await bcrypt.hash(env.defaultSuperAdminPassword, 10);

    const superAdmin = await User.create({
        fullName: env.defaultSuperAdminName,
        email: env.defaultSuperAdminEmail,
        passwordHash,
        role: "super_admin",
        companyId: null,
        status: "active",
        isEmailVerified: true,
    });

    console.log(`Default super admin created: ${superAdmin.email}`);
    return superAdmin;
};

module.exports = {
    registerUser,
    loginUser,
    ensureDefaultSuperAdmin,
};
