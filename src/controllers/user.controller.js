const User = require("../models/User");
const EmployeeRequest = require("../models/EmployeeRequest");
const Department = require("../models/Department");
const Designation = require("../models/Designation");
const Company = require("../models/Company");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { getAccessRole } = require("../utils/roleAccess");
const { resolveEmployeeSystemRole } = require("../utils/employeeRole");
const { validateReportingManagerAssignment } = require("../services/reporting.service");
const { canViewUserNode } = require("../services/orgTree.service");
const {
    isDepartmentHeadDesignation,
    transitionRequestStatus,
    assertRequestSetupOwner,
} = require("../services/employeeRequest.service");
const { invalidateOrgTreeCache } = require("../services/orgTree.service");
const { evaluateSalesPlacementAfterOnboarding } = require("../services/salesPlacement.service");
const { processSalesEmployeeOffboarding } = require("../services/salesEmployeeLifecycle.service");
const {
    PERMISSION_SCOPES,
    canAssignReportingManager,
    canManageEmployeeRecords,
    sanitizePermissions,
} = require("../services/permission.service");

const SYSTEM_ROLE_VALUES = [
    "super_admin",
    "company_admin",
    "sub_admin",
    "hr_head",
    "hr_manager",
    "hr_general",
    "hr_executive",
    "manager",
    "sales_head",
    "sales_manager",
    "sales_executive",
    "employee",
    "user",
];

const COMPANY_STAFF_ROLES = [
    "sub_admin",
    "hr_head",
    "hr_manager",
    "hr_general",
    "hr_executive",
    "manager",
    "employee",
    "user",
];

const HR_STAFF_ROLES = [
    "hr_head",
    "hr_manager",
    "hr_general",
    "hr_executive",
];

const EMPLOYEE_ROLES = [
    "employee",
    "manager",
    "user",
];

const isHumanResourceDepartmentName = (value = "") =>
    /^(hr|human resources?)$/i.test(String(value || "").trim().replace(/\s+/g, " "));

const getObjectId = (value) => {
    if (!value) return "";
    if (value._id) return String(value._id);
    if (value.id) return String(value.id);
    return String(value);
};

const HR_HEAD_DIRECT_CREATE_ROLES = [
    "employee",
];

const HR_HEAD_EMPLOYEE_UPDATE_FIELDS = [
    "phone",
    "employeeId",
    "reportingManagerId",
    "managerId",
    "joiningDate",
    "status",
];

const HR_HEAD_LOCKED_EMPLOYEE_FIELDS = [
    "email",
    "role",
    "systemRole",
    "department",
    "departmentId",
    "designation",
    "designationId",
    "password",
    "passwordHash",
    "permissionScope",
    "customPermissions",
    "fullName",
    "name",
];

const assertCanAssignAccessFields = (actor) => {
    if (!["super_admin", "company_admin"].includes(actor.role)) {
        throw new ApiError(403, "Only company admin can update access permissions");
    }
};

const assertCanManageEmployeeFields = (actor) => {
    if (!canManageEmployeeRecords(actor)) {
        throw new ApiError(403, "You do not have permission to manage employee records");
    }
};

const assertCanAssignManagerField = (actor) => {
    if (!canAssignReportingManager(actor)) {
        throw new ApiError(403, "You do not have permission to assign reporting managers");
    }
};

const hasAnyField = (body = {}, fields = []) =>
    fields.some((field) => body[field] !== undefined);

const isHrHeadActor = (actor) => getAccessRole(actor) === "hr_head";

const getCompanyAdminForCompany = async (companyId) => {
    const company = await Company.findById(companyId).select("ownerUserId");
    const query = {
        companyId,
        role: "company_admin",
        status: "active",
        deletedAt: null,
    };

    if (company?.ownerUserId) {
        query._id = company.ownerUserId;
    }

    return User.findOne(query).select("_id fullName email role systemRole");
};

const getDepartmentHeadDesignationIds = async ({ companyId, departmentId }) => {
    const designations = await Designation.find({
        companyId,
        departmentId,
        status: "active",
        isArchived: { $ne: true },
        deletedAt: null,
    }).select("_id title name mappedRole hierarchyLevel isDepartmentHead isHead canManagePeople isLeadership");

    const ids = [];
    for (const designation of designations) {
        if (await isDepartmentHeadDesignation({ companyId, departmentId, designation })) {
            ids.push(designation._id);
        }
    }

    return ids;
};

const findActiveDepartmentHead = async ({ companyId, departmentId }) => {
    const headDesignationIds = await getDepartmentHeadDesignationIds({ companyId, departmentId });
    if (!headDesignationIds.length) return null;

    return User.findOne({
        companyId,
        departmentId,
        designationId: { $in: headDesignationIds },
        status: "active",
        deletedAt: null,
    }).select("_id fullName email role systemRole designationId departmentId");
};

const createUserForApprovedEmployeeRequest = async ({
    isHeadSetup,
    companyId,
    departmentId,
    userPayload,
    findActiveDepartmentHeadFn = findActiveDepartmentHead,
    UserModel = User,
}) => {
    if (isHeadSetup) {
        const activeHod = await findActiveDepartmentHeadFn({ companyId, departmentId });
        if (activeHod) {
            throw new ApiError(
                409,
                "This Department already has an active HOD. The legacy HOD request can no longer be completed."
            );
        }
    }

    return UserModel.create(userPayload);
};

const resolveSafeEmployeeRole = ({ requestedRole, designation, isDepartmentHead }) => {
    const blockedRoles = ["super_admin", "company_admin", "sub_admin"];
    const mappedRole = designation?.mappedRole || "";
    const role = requestedRole || mappedRole || "employee";

    if (blockedRoles.includes(role)) {
        throw new ApiError(400, "Privileged roles cannot be assigned through HR employee creation.");
    }

    if (role === "department_head") {
        return "employee";
    }

    if (!SYSTEM_ROLE_VALUES.includes(role)) {
        return isDepartmentHead ? "employee" : "employee";
    }

    return role;
};

const hasCompanyEmployeeDirectoryAccess = (actor) =>
    ["company", "global"].includes(actor?.permissionScope || "") ||
    (Array.isArray(actor?.customPermissions) &&
        actor.customPermissions.some((permission) => ["*", "employees.manage"].includes(permission)));

const canReadFullEmployeeDirectory = (actor) => {
    if (isHrHeadActor(actor)) {
        return hasCompanyEmployeeDirectoryAccess(actor);
    }

    return canManageEmployeeRecords(actor);
};

const mapScopedUser = (user) => ({
    id: user._id,
    _id: user._id,
    companyId: user.companyId,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone || "",
    role: user.role,
    systemRole: user.systemRole || user.role,
    department: user.department || "",
    departmentId: user.departmentId || null,
    designation: user.designation || "",
    designationId: user.designationId || null,
    employeeId: user.employeeId || "",
    managerId: user.managerId || null,
    reportingManagerId: user.reportingManagerId || user.managerId || null,
    status: user.status,
    joiningDate: user.joiningDate || null,
    setupCompleted: user.setupCompleted === true,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
});

const normalizePermissionScope = (value = "self") => {
    const scope = String(value || "self").trim().toLowerCase();
    if (!PERMISSION_SCOPES.includes(scope)) {
        throw new ApiError(400, "Invalid permission scope");
    }

    return scope;
};

const normalizeSystemRole = (value) => {
    const role = String(value || "").trim();
    if (!SYSTEM_ROLE_VALUES.includes(role)) {
        throw new ApiError(400, "Invalid system role");
    }

    return role;
};

const normalizeObjectId = (value, fieldName) => {
    if (value === undefined) {
        return undefined;
    }

    if (value === null || value === "") {
        return null;
    }

    if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new ApiError(400, `${fieldName} must be a valid ObjectId`);
    }

    return value;
};

const validateDepartmentDesignation = async ({
    companyId,
    departmentId,
    designationId,
    fallbackDepartmentId = null,
}) => {
    const normalizedDepartmentId = normalizeObjectId(departmentId, "departmentId");
    const normalizedDesignationId = normalizeObjectId(designationId, "designationId");

    if ((normalizedDepartmentId || normalizedDesignationId) && !companyId) {
        throw new ApiError(400, "Company is required to assign department or designation");
    }

    let department = null;

    if (normalizedDepartmentId) {
        department = await Department.findOne({
            _id: normalizedDepartmentId,
            companyId,
            status: "active",
            deletedAt: null,
        });

        if (!department) {
            throw new ApiError(404, "Active department not found");
        }
    }

    if (normalizedDesignationId) {
        const designationQuery = {
            _id: normalizedDesignationId,
            companyId,
            status: "active",
            deletedAt: null,
        };

        const effectiveDepartmentId = normalizedDepartmentId || fallbackDepartmentId;
        if (effectiveDepartmentId) {
            designationQuery.departmentId = effectiveDepartmentId;
        }

        const designation = await Designation.findOne(designationQuery);

        if (!designation) {
            throw new ApiError(404, "Active designation not found for this company or department");
        }
    }

    return {
        departmentId: normalizedDepartmentId,
        designationId: normalizedDesignationId,
    };
};

const getUsersController = async (req, res, next) => {
    try {
        const query = { deletedAt: null };
        const canReadFullDirectory = canReadFullEmployeeDirectory(req.user);

        if (req.user.role !== "super_admin") {
            query.companyId = req.user.companyId;
        }

        if (!canReadFullDirectory) {
            const scopedOr = [
                { _id: req.user._id },
                { reportingManagerId: req.user._id },
                { managerId: req.user._id },
            ];

            if (["team", "department", "company", "global"].includes(req.user.permissionScope || "")) {
                if (req.user.permissionScope === "department" && req.user.departmentId) {
                    scopedOr.push({ departmentId: req.user.departmentId });
                }
            }

            if (isHrHeadActor(req.user) && req.user.departmentId) {
                scopedOr.push({ departmentId: req.user.departmentId });
            }

            query.$or = scopedOr;
        }

        const users = await User.find(query)
            .select("-passwordHash")
            .sort({ createdAt: -1 });

        return res.status(200).json(
            new ApiResponse(200, "Users fetched successfully", {
                count: users.length,
                users: users.map((user) =>
                    canReadFullDirectory ? user.toSafeObject() : mapScopedUser(user)
                ),
            })
        );
    } catch (error) {
        next(error);
    }
};

const getUserByIdController = async (req, res, next) => {
    try {
        const { id } = req.params;

        const query = { _id: id, deletedAt: null };

        if (req.user.role !== "super_admin") {
            query.companyId = req.user.companyId;
        }

        const user = await User.findOne(query).select("-passwordHash");

        if (!user) {
            throw new ApiError(404, "User not found");
        }
        const canReadFullDirectory = canReadFullEmployeeDirectory(req.user);
        if (!canReadFullDirectory) {
            const allowed = await canViewUserNode({
                actorUser: req.user,
                targetUser: user,
                companyId: user.companyId || req.user.companyId,
            });

            if (!allowed) {
                throw new ApiError(403, "You do not have permission to view this user");
            }
        }

        return res.status(200).json(
            new ApiResponse(200, "User fetched successfully", {
                user: canReadFullDirectory ? user.toSafeObject() : mapScopedUser(user),
            })
        );
    } catch (error) {
        next(error);
    }
};

const updateUserController = async (req, res, next) => {
    try {
        const { id } = req.params;

        const query = { _id: id, deletedAt: null };

        if (req.user.role !== "super_admin") {
            query.companyId = req.user.companyId;
        }

        const user = await User.findOne(query).select("-passwordHash");

        if (!user) {
            throw new ApiError(404, "User not found");
        }
        const previousStatus = user.status;

        if (isHrHeadActor(req.user)) {
            const actorDepartmentId = req.user.departmentId ? String(req.user.departmentId) : "";
            const targetDepartmentId = user.departmentId ? String(user.departmentId) : "";

            if (
                (!actorDepartmentId || !targetDepartmentId || actorDepartmentId !== targetDepartmentId) &&
                !isHumanResourceDepartmentName(user.department)
            ) {
                throw new ApiError(403, "HR Head can manage Human Resource employees only");
            }
        }

        if (user.setupCompleted && req.user.role === "hr_executive") {
            throw new ApiError(403, "Employee details are locked after setup");
        }

        const allowedFields = [
            "phone",
            "department",
            "designation",
            "status",
            "employeeId",
            "joiningDate",
        ];

        if (hasAnyField(req.body, allowedFields)) {
            assertCanManageEmployeeFields(req.user);
        }

        allowedFields.forEach((field) => {
            if (req.body[field] !== undefined) {
                user[field] = field === "status" && req.body[field] === "inactive"
                    ? "disabled"
                    : req.body[field];
            }
        });

        const targetCompanyId = user.companyId || req.user.companyId;

        if (hasAnyField(req.body, ["departmentId", "designationId"])) {
            assertCanManageEmployeeFields(req.user);
        }

        const orgRefs = await validateDepartmentDesignation({
            companyId: targetCompanyId,
            departmentId: req.body.departmentId,
            designationId: req.body.designationId,
            fallbackDepartmentId: user.departmentId,
        });

        if (orgRefs.departmentId !== undefined) {
            user.departmentId = orgRefs.departmentId;
        }

        if (orgRefs.designationId !== undefined) {
            user.designationId = orgRefs.designationId;
        }

        const incomingManagerId =
            req.body.reportingManagerId !== undefined
                ? req.body.reportingManagerId
                : req.body.managerId;

        if (incomingManagerId !== undefined) {
            assertCanAssignManagerField(req.user);
            const assignment = await validateReportingManagerAssignment({
                companyId: targetCompanyId,
                employeeId: user._id,
                employeeDesignationId:
                    orgRefs.designationId !== undefined ? orgRefs.designationId : user.designationId,
                departmentId:
                    orgRefs.departmentId !== undefined ? orgRefs.departmentId : user.departmentId,
                reportingManagerId: incomingManagerId,
                actorUser: req.user,
                employeeRole: user.role,
            });

            const reportingManagerId = assignment.reportingManagerId;
            user.managerId = reportingManagerId;
            user.reportingManagerId = reportingManagerId;
        }

        const incomingRole = req.body.systemRole || req.body.role;
        if (incomingRole !== undefined) {
            assertCanAssignAccessFields(req.user);
            const systemRole = normalizeSystemRole(incomingRole);
            user.role = systemRole;
            user.systemRole = systemRole;
        }

        if (req.body.permissionScope !== undefined) {
            assertCanAssignAccessFields(req.user);
            user.permissionScope = normalizePermissionScope(req.body.permissionScope);
        }

        if (req.body.customPermissions !== undefined) {
            assertCanAssignAccessFields(req.user);
            user.customPermissions = sanitizePermissions(req.body.customPermissions);
        }

        user.updatedBy = req.user._id;
        let salesOffboarding = null;
        if (req.body.status !== undefined && previousStatus !== user.status) {
            salesOffboarding = await processSalesEmployeeOffboarding({
                employee: user,
                previousStatus,
                targetStatus: user.status,
                reason: req.body.offboardReason || req.body.reason || "",
                user: req.user,
                req,
            });
        }
        if (!salesOffboarding?.handled) await user.save();
        invalidateOrgTreeCache(user.companyId || req.user.companyId);

        return res.status(200).json(
            new ApiResponse(200, "User updated successfully", {
                user: user.toSafeObject(),
                ...(salesOffboarding?.handled ? { salesOffboarding: salesOffboarding.preview } : {}),
            })
        );
    } catch (error) {
        next(error);
    }
};

const deleteUserController = async (req, res, next) => {
    try {
        const { id } = req.params;

        const query = { _id: id, deletedAt: null };

        if (req.user.role !== "super_admin") {
            query.companyId = req.user.companyId;
        }

        const user = await User.findOne(query);

        if (!user) {
            throw new ApiError(404, "User not found");
        }

        assertCanManageEmployeeFields(req.user);
        const salesOffboarding = await processSalesEmployeeOffboarding({
            employee: user,
            previousStatus: user.status,
            targetStatus: "deleted",
            reason: req.body?.offboardReason || req.body?.reason || "",
            user: req.user,
            req,
            deletion: true,
        });
        if (!salesOffboarding?.handled) {
            user.deletedAt = new Date();
            user.updatedBy = req.user._id;
            await user.save();
        }
        invalidateOrgTreeCache(user.companyId || req.user.companyId);

        return res.status(200).json(
            new ApiResponse(200, "User deleted successfully", null)
        );
    } catch (error) {
        next(error);
    }
};

const createCompanyStaffController = async (req, res, next) => {
    try {
        const {
            fullName,
            email,
            password,
            phone = "",
            role,
            department = "",
            designation = "",
            departmentId,
            designationId,
            employeeId = "",
            managerId = null,
            reportingManagerId = null,
            permissionScope = "self",
            customPermissions = [],
        } = req.body;

        if (!fullName || !email || !password || !role) {
            throw new ApiError(400, "Full name, email, password and role are required");
        }

        if (String(password).length < 6) {
            throw new ApiError(400, "Password must be at least 6 characters");
        }

        if (!COMPANY_STAFF_ROLES.includes(role)) {
            throw new ApiError(400, "Invalid staff role");
        }

        if (HR_STAFF_ROLES.includes(role)) {
            throw new ApiError(
                400,
                "HR users must be created through HR Head setup or HR onboarding flow"
            );
        }

        if (!req.user.companyId) {
            throw new ApiError(400, "Company admin must belong to a company");
        }

        assertCanAssignAccessFields(req.user);
        assertCanManageEmployeeFields(req.user);

        const normalizedEmail = email.toLowerCase().trim();

        const existingUser = await User.findOne({
            email: normalizedEmail,
            deletedAt: null,
        });

        if (existingUser) {
            throw new ApiError(409, "User already exists with this email");
        }

        const cleanEmployeeId = String(employeeId || "").trim();
        if (cleanEmployeeId) {
            const existingEmployeeId = await User.findOne({
                companyId: req.user.companyId,
                employeeId: cleanEmployeeId,
                deletedAt: null,
            });

            if (existingEmployeeId) {
                throw new ApiError(409, "Employee ID already exists in this company");
            }
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const safePermissionScope = normalizePermissionScope(permissionScope);
        const safeCustomPermissions = sanitizePermissions(customPermissions);
        const orgRefs = await validateDepartmentDesignation({
            companyId: req.user.companyId,
            departmentId,
            designationId,
        });
        const assignment = await validateReportingManagerAssignment({
            companyId: req.user.companyId,
            employeeDesignationId: orgRefs.designationId,
            departmentId: orgRefs.departmentId,
            reportingManagerId: reportingManagerId || managerId,
            actorUser: req.user,
            employeeRole: role,
        });
        const effectiveReportingManagerId = assignment.reportingManagerId;

        const user = await User.create({
            fullName: fullName.trim(),
            email: normalizedEmail,
            phone,
            passwordHash,
            role,
            systemRole: role,
            permissionScope: safePermissionScope,
            customPermissions: safeCustomPermissions,
            companyId: req.user.companyId,
            department,
            departmentId: orgRefs.departmentId || null,
            designation,
            designationId: orgRefs.designationId || null,
            employeeId: cleanEmployeeId,
            managerId: effectiveReportingManagerId,
            reportingManagerId: effectiveReportingManagerId,
            status: "active",
            isEmailVerified: true,
            createdBy: req.user._id,
            updatedBy: req.user._id,
        });
        invalidateOrgTreeCache(user.companyId || req.user.companyId);

        return res.status(201).json(
            new ApiResponse(201, "Company staff created successfully", {
                user: user.toSafeObject(),
            })
        );
    } catch (error) {
        next(error);
    }
};

const createHrDepartmentEmployeeController = async (req, res, next) => {
    try {
        if (!isHrHeadActor(req.user)) {
            throw new ApiError(403, "Only HR Head can directly add employees");
        }

        if (!req.user.companyId) {
            throw new ApiError(400, "Company is missing for this user");
        }

        const {
            fullName,
            email,
            password,
            phone = "",
            role = "employee",
            departmentId,
            designationId,
            employeeId = "",
            managerId = null,
            reportingManagerId = null,
            joiningDate = null,
            status = "active",
        } = req.body;

        if (!fullName || !email || !password || !departmentId || !designationId || !role) {
            throw new ApiError(400, "Full name, email, password, department, designation and role are required");
        }

        if (String(password).length < 6) {
            throw new ApiError(400, "Password must be at least 6 characters");
        }

        const safeStatus = status === "inactive" ? "disabled" : status;
        if (!["active", "disabled"].includes(safeStatus)) {
            throw new ApiError(400, "Status must be active or inactive");
        }

        const department = await Department.findOne({
            _id: departmentId,
            companyId: req.user.companyId,
            status: "active",
            deletedAt: null,
        });

        if (!department) {
            throw new ApiError(404, "Active department not found");
        }

        const designation = await Designation.findOne({
            _id: designationId,
            companyId: req.user.companyId,
            departmentId: department._id,
            status: "active",
            deletedAt: null,
        });

        if (!designation) {
            throw new ApiError(404, "Active designation not found for this department");
        }

        const isHeadDesignation = await isDepartmentHeadDesignation({
            companyId: req.user.companyId,
            departmentId: department._id,
            designation,
        });
        const safeRole = resolveSafeEmployeeRole({
            requestedRole: role,
            designation,
            isDepartmentHead: isHeadDesignation,
        });

        if (!HR_HEAD_DIRECT_CREATE_ROLES.includes(safeRole)) {
            throw new ApiError(400, "Selected role is not allowed for HR direct employee creation");
        }

        const designationRoles = [
            designation.mappedRole,
            ...(Array.isArray(designation.allowedRoles) ? designation.allowedRoles : []),
        ].filter(Boolean);

        if (
            designationRoles.length &&
            role !== "employee" &&
            safeRole !== "employee" &&
            !designationRoles.includes(role) &&
            !designationRoles.includes(safeRole) &&
            !(isHeadDesignation && designationRoles.includes("department_head"))
        ) {
            throw new ApiError(400, "Selected role is not allowed for this designation");
        }

        const normalizedEmail = email.toLowerCase().trim();
        const existingUser = await User.findOne({
            email: normalizedEmail,
            deletedAt: null,
        });

        if (existingUser) {
            throw new ApiError(409, "User already exists with this email");
        }

        const cleanEmployeeId = String(employeeId || "").trim();
        if (cleanEmployeeId) {
            const existingEmployeeId = await User.findOne({
                companyId: req.user.companyId,
                employeeId: cleanEmployeeId,
                deletedAt: null,
            });

            if (existingEmployeeId) {
                throw new ApiError(409, "Employee ID already exists in this company");
            }
        }

        const activeDepartmentHead = await findActiveDepartmentHead({
            companyId: req.user.companyId,
            departmentId: department._id,
        });

        let effectiveReportingManagerId = reportingManagerId || managerId || null;

        if (isHeadDesignation) {
            if (activeDepartmentHead) {
                throw new ApiError(409, "This department already has an active Head of Department.");
            }

            const companyAdmin = await getCompanyAdminForCompany(req.user.companyId);
            if (!companyAdmin) {
                throw new ApiError(400, "Active Company Admin is required as reporting manager for Head of Department");
            }

            effectiveReportingManagerId = companyAdmin._id;
        } else {
            if (!activeDepartmentHead) {
                throw new ApiError(400, `Please create Head of ${department.name} before creating other ${department.name} employees.`);
            }

            if (!effectiveReportingManagerId) {
                throw new ApiError(400, "Reporting manager is required for this designation");
            }

            const assignment = await validateReportingManagerAssignment({
                companyId: req.user.companyId,
                employeeDesignationId: designation._id,
                departmentId: department._id,
                reportingManagerId: effectiveReportingManagerId,
                actorUser: req.user,
                employeeRole: safeRole,
            });
            effectiveReportingManagerId = assignment.reportingManagerId;
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const user = await User.create({
            companyId: req.user.companyId,
            fullName: fullName.trim(),
            email: normalizedEmail,
            phone: String(phone || "").trim(),
            passwordHash,
            role: safeRole,
            systemRole: safeRole,
            permissionScope: "self",
            customPermissions: [],
            department: department.name,
            departmentId: department._id,
            designation: designation.title || designation.name,
            designationId: designation._id,
            employeeId: cleanEmployeeId,
            managerId: effectiveReportingManagerId,
            reportingManagerId: effectiveReportingManagerId,
            joiningDate,
            setupCompleted: true,
            setupCompletedAt: new Date(),
            status: safeStatus,
            isEmailVerified: true,
            createdBy: req.user._id,
            updatedBy: req.user._id,
        });
        invalidateOrgTreeCache(user.companyId || req.user.companyId);

        return res.status(201).json(
            new ApiResponse(201, "Employee created successfully", {
                user: user.toSafeObject(),
            })
        );
    } catch (error) {
        next(error);
    }
};

const updateHrDepartmentEmployeeController = async (req, res, next) => {
    try {
        if (!isHrHeadActor(req.user)) {
            throw new ApiError(403, "Only HR Head can edit HR department employees");
        }

        if (!req.user.companyId) {
            throw new ApiError(400, "Company is missing for this user");
        }

        const attemptedLockedFields = HR_HEAD_LOCKED_EMPLOYEE_FIELDS.filter((field) =>
            Object.prototype.hasOwnProperty.call(req.body || {}, field)
        );

        if (attemptedLockedFields.length) {
            throw new ApiError(
                400,
                `These employee fields cannot be changed by HR Head after creation: ${attemptedLockedFields.join(", ")}`
            );
        }

        const hasEditableField = HR_HEAD_EMPLOYEE_UPDATE_FIELDS.some((field) =>
            Object.prototype.hasOwnProperty.call(req.body || {}, field)
        );

        if (!hasEditableField) {
            throw new ApiError(400, "No editable employee fields were provided");
        }

        const user = await User.findOne({
            _id: req.params.id,
            companyId: req.user.companyId,
            deletedAt: null,
        }).select("-passwordHash");

        if (!user) {
            throw new ApiError(404, "HR employee not found");
        }

        const actorDepartmentId = getObjectId(req.user.departmentId);
        const targetDepartmentId = getObjectId(user.departmentId);

        if (
            (actorDepartmentId && actorDepartmentId !== targetDepartmentId) ||
            (!actorDepartmentId && !isHumanResourceDepartmentName(user.department))
        ) {
            throw new ApiError(403, "HR Head can edit only their Human Resource department employees");
        }

        const department = await Department.findOne({
            _id: user.departmentId,
            companyId: req.user.companyId,
            deletedAt: null,
        });

        if (!department || !isHumanResourceDepartmentName(department.name)) {
            throw new ApiError(403, "Target employee is not in the Human Resource department");
        }

        if (req.body.phone !== undefined) {
            user.phone = String(req.body.phone || "").trim();
        }

        if (req.body.employeeId !== undefined) {
            const cleanEmployeeId = String(req.body.employeeId || "").trim();

            if (cleanEmployeeId) {
                const existingEmployeeId = await User.findOne({
                    _id: { $ne: user._id },
                    companyId: req.user.companyId,
                    employeeId: cleanEmployeeId,
                    deletedAt: null,
                });

                if (existingEmployeeId) {
                    throw new ApiError(409, "Employee ID already exists in this company");
                }
            }

            user.employeeId = cleanEmployeeId;
        }

        if (req.body.joiningDate !== undefined) {
            user.joiningDate = req.body.joiningDate || null;
        }

        if (req.body.status !== undefined) {
            const safeStatus = req.body.status === "inactive" ? "disabled" : req.body.status;
            if (!["active", "disabled", "suspended"].includes(safeStatus)) {
                throw new ApiError(400, "Status must be active, inactive, or suspended");
            }
            user.status = safeStatus;
        }

        const incomingManagerId =
            req.body.reportingManagerId !== undefined
                ? req.body.reportingManagerId
                : req.body.managerId;

        if (incomingManagerId !== undefined) {
            if (user.role === "hr_head" && incomingManagerId) {
                throw new ApiError(400, "HR Head reporting manager cannot be changed here");
            }

            const assignment = await validateReportingManagerAssignment({
                companyId: req.user.companyId,
                employeeId: user._id,
                employeeDesignationId: user.designationId,
                departmentId: user.departmentId,
                reportingManagerId: incomingManagerId || null,
                actorUser: req.user,
                employeeRole: user.role,
            });

            user.managerId = assignment.reportingManagerId;
            user.reportingManagerId = assignment.reportingManagerId;
        }

        user.updatedBy = req.user._id;
        await user.save();
        invalidateOrgTreeCache(user.companyId || req.user.companyId);

        return res.status(200).json(
            new ApiResponse(200, "HR employee updated successfully", {
                user: user.toSafeObject(),
            })
        );
    } catch (error) {
        next(error);
    }
};

const setupEmployeeFromRequestController = async (req, res, next) => {
    try {
        const actorRole = getAccessRole(req.user);

        if (!["hr_head", "hr_executive"].includes(actorRole)) {
            throw new ApiError(403, "Only HR Head or HR Executive can setup employee details");
        }

        if (!req.user.companyId) {
            throw new ApiError(400, "Company is missing for this user");
        }

        const {
            sourceRequestId,
            email,
            password,
            phone,
            role = "employee",
            department,
            designation,
            employeeId,
            managerId,
            joiningDate,
        } = req.body;

        if (
            !sourceRequestId ||
            !email ||
            !password ||
            !phone ||
            !department ||
            !designation ||
            !employeeId ||
            !joiningDate
        ) {
            throw new ApiError(
                400,
                "Request, work email, password, company number, department, designation, employee ID and joining date are required"
            );
        }

        const request = await EmployeeRequest.findOne({
            _id: sourceRequestId,
            companyId: req.user.companyId,
            status: { $in: ["approved", "setup_pending"] },
            deletedAt: null,
        });

        if (!request) {
            throw new ApiError(404, "Approved employee request not found");
        }

        if (request.isOnboarded || request.setupCompleted || request.createdUserId) {
            throw new ApiError(409, "Employee is already setup for this request");
        }

        assertRequestSetupOwner(request, req.user);

        const normalizedEmail = email.toLowerCase().trim();

        const existingEmail = await User.findOne({
            email: normalizedEmail,
            deletedAt: null,
        });

        if (existingEmail) {
            throw new ApiError(409, "User already exists with this work email");
        }

        const existingEmployeeId = await User.findOne({
            companyId: req.user.companyId,
            employeeId: employeeId.trim(),
            deletedAt: null,
        });

        if (existingEmployeeId) {
            throw new ApiError(409, "Employee ID already exists in this company");
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const structuredDepartmentId = request.requestedDepartmentId || null;
        const structuredDesignationId = request.requestedDesignationId || null;
        if (!structuredDepartmentId || !structuredDesignationId) {
            throw new ApiError(400, "Approved request must have a valid department and designation");
        }

        const selectedDesignation = structuredDesignationId
            ? await Designation.findOne({
                _id: structuredDesignationId,
                companyId: req.user.companyId,
                departmentId: structuredDepartmentId,
                status: "active",
                isArchived: { $ne: true },
                deletedAt: null,
            })
            : null;
        if (!selectedDesignation) {
            throw new ApiError(404, "Active designation from the approved request was not found");
        }
        const isHeadSetup = selectedDesignation
            ? await isDepartmentHeadDesignation({
                companyId: req.user.companyId,
                departmentId: structuredDepartmentId,
                designation: selectedDesignation,
            })
            : request.requestType === "department_head_create";
        const requestedRole = request.requestedRole || role || "employee";
        const safeLoginRole = resolveEmployeeSystemRole({
            requestedRole,
            designation: selectedDesignation,
            departmentName: request.requestedDepartmentName || department,
            isDepartmentHead: isHeadSetup,
        });
        let reportingManagerId = managerId || null;

        if (isHeadSetup) {
            const companyAdmin = await getCompanyAdminForCompany(req.user.companyId);

            if (!companyAdmin) {
                throw new ApiError(400, "Active Company Admin is required as reporting manager for Department Head");
            }

            reportingManagerId = companyAdmin._id;
        } else {
            const activeDepartmentHead = await findActiveDepartmentHead({
                companyId: req.user.companyId,
                departmentId: structuredDepartmentId,
            });

            if (!activeDepartmentHead) {
                throw new ApiError(400, `Please create Head of ${request.requestedDepartmentName || department} before creating other ${request.requestedDepartmentName || department} employees.`);
            }

            if (!reportingManagerId) {
                throw new ApiError(400, "Reporting manager is required for this designation");
            }

            const assignment = await validateReportingManagerAssignment({
                companyId: req.user.companyId,
                employeeDesignationId: structuredDesignationId,
                departmentId: structuredDepartmentId,
                reportingManagerId,
                actorUser: req.user,
                employeeRole: safeLoginRole,
            });
            reportingManagerId = assignment.reportingManagerId;
        }

        const user = await createUserForApprovedEmployeeRequest({
            isHeadSetup,
            companyId: req.user.companyId,
            departmentId: structuredDepartmentId,
            userPayload: {
                companyId: req.user.companyId,
                fullName: request.employeeData.fullName,
                email: normalizedEmail,
                phone: phone.trim(),
                passwordHash,
                role: safeLoginRole,
                systemRole: safeLoginRole,
                permissionScope: "self",
                customPermissions: [],
                department: request.requestedDepartmentName || department.trim(),
                departmentId: structuredDepartmentId,
                designation: selectedDesignation.title || selectedDesignation.name || designation.trim(),
                designationId: structuredDesignationId,
                employeeId: employeeId.trim(),
                managerId: reportingManagerId,
                reportingManagerId,
                joiningDate,
                sourceRequestId: request._id,
                setupCompleted: true,
                setupCompletedAt: new Date(),
                status: "active",
                isEmailVerified: true,
                createdBy: req.user._id,
                updatedBy: req.user._id,
            },
        });

        if (request.status === "approved") {
            transitionRequestStatus(request, "setup_pending");
        }
        transitionRequestStatus(request, "completed");

        request.createdUserId = user._id;
        request.isOnboarded = true;
        request.onboardedAt = new Date();
        request.setupCompleted = true;
        request.setupCompletedAt = new Date();
        request.setupBy = req.user._id;
        request.setupAt = new Date();
        request.employeeId = employeeId.trim();
        request.reportingManagerId = reportingManagerId;
        request.joiningDate = joiningDate;
        request.setupNote = req.body.setupNote || "";
        await request.save();
        invalidateOrgTreeCache(user.companyId || req.user.companyId);

        const { salesPlacement, warning: salesPlacementWarning } =
            await evaluateSalesPlacementAfterOnboarding({
                employee: user,
                department: {
                    _id: structuredDepartmentId,
                    name: request.requestedDepartmentName || department.trim(),
                },
                companyId: user.companyId || req.user.companyId,
            });

        return res.status(201).json(
            new ApiResponse(201, "Employee setup completed successfully", {
                user: user.toSafeObject(),
                request,
                salesPlacement,
                ...(salesPlacementWarning ? { salesPlacementWarning } : {}),
            })
        );
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getUsersController,
    getUserByIdController,
    updateUserController,
    deleteUserController,
    createCompanyStaffController,
    createHrDepartmentEmployeeController,
    updateHrDepartmentEmployeeController,
    setupEmployeeFromRequestController,
    createUserForApprovedEmployeeRequest,
};
