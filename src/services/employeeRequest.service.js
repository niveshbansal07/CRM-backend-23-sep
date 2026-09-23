const EmployeeRequest = require("../models/EmployeeRequest");
const User = require("../models/User");
const Department = require("../models/Department");
const Designation = require("../models/Designation");
const Company = require("../models/Company");
const ApiError = require("../utils/ApiError");
const { normalizeName } = require("../utils/normalize");
const { getAccessRole } = require("../utils/roleAccess");
const {
    resolveEmployeeSystemRole,
    resolveEmployeeRoleV2,
    validateRoleAssignment,
    isEmployeeRoleAllowed,
} = require("../utils/employeeRole");
const { createNotification } = require("./notification.service");

const HR_DEPARTMENT_NAMES = ["hr", "human resource", "human resources"];
const HR_DEPARTMENT_SLUGS = ["hr", "human-resource", "human-resources"];
const ADMIN_REVIEW_ROLES = ["super_admin", "company_admin", "sub_admin"];
const HR_APPROVER_ROLES = ["hr_manager", "hr_general", "hr_head"];
const REQUEST_CREATOR_ROLES = ["hr_executive", "hr_general", "hr_manager", "hr_head"];
const BLOCKED_REQUEST_ROLES = ["super_admin", "company_admin", "sub_admin", "hr_head"];
const SETUP_SLA_DAYS = 7;
const STATUS_TRANSITIONS = {
    pending: ["approved", "declined"],
    approved: ["setup_pending", "declined"],
    setup_pending: ["completed", "declined"],
    completed: [],
    declined: [],
};

const toId = (value) => String(value?._id || value?.id || value || "");

const resolveEmployeeRequestApproverId = (approverDetails) => {
    const approverId = approverDetails?.approverId || approverDetails?.approver?._id || null;
    if (!approverId) {
        throw new ApiError(400, "No approver is available for this employee request.");
    }
    return approverId;
};

const isHrHead = (user) => getAccessRole(user) === "hr_head";

const validateStatusTransition = (fromStatus, toStatus) => {
    const from = String(fromStatus || "").trim();
    const to = String(toStatus || "").trim();
    const allowed = STATUS_TRANSITIONS[from] || [];

    if (!allowed.includes(to)) {
        throw new ApiError(400, `Invalid status transition from ${from} to ${to}`);
    }

    return true;
};

const transitionRequestStatus = (request, toStatus) => {
    validateStatusTransition(request.status, toStatus);
    request.status = toStatus;
    return request;
};

const getSetupDeadline = (approvedAt) => {
    const deadline = new Date(approvedAt || Date.now());
    deadline.setDate(deadline.getDate() + SETUP_SLA_DAYS);
    return deadline;
};

const addApprovalHistory = (request, { action, actionBy, comments = "", internalNotes = "" }) => {
    request.approvalHistory = Array.isArray(request.approvalHistory) ? request.approvalHistory : [];
    request.approvalHistory.push({
        action,
        actionBy,
        actionAt: new Date(),
        comments: String(comments || "").trim(),
        internalNotes: String(internalNotes || "").trim(),
    });
};

const isHumanResourceDepartment = (department) => {
    const normalized = normalizeName(department?.normalizedName || department?.name || department || "");
    const slug = String(department?.slug || "").trim().toLowerCase();
    return HR_DEPARTMENT_NAMES.includes(normalized) || HR_DEPARTMENT_SLUGS.includes(slug);
};

const assertInitialHodRequestPolicy = ({ department, isDepartmentHeadRequest }) => {
    if (isDepartmentHeadRequest && !isHumanResourceDepartment(department)) {
        throw new ApiError(
            400,
            "Initial Department HOD must be configured by Company Admin from HOD Setup."
        );
    }
};

const getDesignationTitle = (designation) => designation?.title || designation?.name || "";

const isDepartmentHeadDesignation = async ({ companyId, departmentId, designation }) => {
    if (!designation) return false;

    const title = getDesignationTitle(designation);
    if (
        designation.isDepartmentHead === true ||
        designation.isHead === true ||
        designation.mappedRole === "department_head" ||
        /\b(head|department head|hod|director|chief|vp)\b/i.test(title)
    ) {
        return true;
    }

    const highest = await Designation.findOne({
        companyId,
        departmentId,
        status: "active",
        isArchived: { $ne: true },
        deletedAt: null,
    }).sort({ hierarchyLevel: -1, createdAt: 1 });

    return highest && toId(highest._id) === toId(designation._id);
};

const hasActiveDepartmentHead = async ({ companyId, departmentId, excludeRequestId = null }) => {
    const designations = await Designation.find({
        companyId,
        departmentId,
        status: "active",
        isArchived: { $ne: true },
        deletedAt: null,
    }).select("_id title name mappedRole hierarchyLevel isDepartmentHead isHead canManagePeople isLeadership");

    const headDesignationIds = [];
    for (const designation of designations) {
        if (await isDepartmentHeadDesignation({ companyId, departmentId, designation })) {
            headDesignationIds.push(designation._id);
        }
    }

    if (!headDesignationIds.length) return false;

    const existingUser = await User.exists({
        companyId,
        departmentId,
        designationId: { $in: headDesignationIds },
        status: "active",
        deletedAt: null,
    });

    if (existingUser) return true;

    const pendingHeadQuery = {
        companyId,
        requestedDepartmentId: departmentId,
        requestedDesignationId: { $in: headDesignationIds },
        status: { $in: ["pending", "approved", "setup_pending"] },
        deletedAt: null,
    };

    if (excludeRequestId) {
        pendingHeadQuery._id = { $ne: excludeRequestId };
    }

    return Boolean(await EmployeeRequest.exists(pendingHeadQuery));
};

const assertHrHeadCanRequestDepartment = ({ user, department }) => {
    if (!isHrHead(user)) return;

    const actorDepartmentId = user.departmentId ? String(user.departmentId) : "";
    const requestedDepartmentId = department?._id ? String(department._id) : "";

    if (actorDepartmentId && requestedDepartmentId && actorDepartmentId !== requestedDepartmentId) {
        throw new ApiError(403, "HR Head can create employee requests for Human Resource department only.");
    }

    if (!isHumanResourceDepartment(department)) {
        throw new ApiError(403, "HR Head can create employee requests for Human Resource department only.");
    }
};

const buildRequestPopulation = (query) =>
    query
        .populate("companyId", "name slug status ownerUserId")
        .populate("requestedBy", "fullName email role systemRole designationId departmentId")
        .populate("reviewedBy", "fullName email role systemRole")
        .populate("assignedTo", "fullName email role systemRole designationId departmentId")
        .populate("approvedBy", "fullName email role systemRole")
        .populate("declinedBy", "fullName email role systemRole")
        .populate("setupBy", "fullName email role systemRole")
        .populate("createdUserId", "fullName email role systemRole employeeId")
        .populate("requestedDepartmentId", "name code status allowedRoles")
        .populate(
            "requestedDesignationId",
            "name title code status mappedRole allowedRoles hierarchyLevel canManagePeople isLeadership isDepartmentHead isHead"
        )
        .populate(
            "requestedReportingManagerId",
            "fullName email role systemRole department departmentId designation designationId employeeId status"
        )
        .populate(
            "reportingManagerId",
            "fullName email role systemRole department departmentId designation designationId employeeId status"
        );

const assertCanAccessRequest = (request, user) => {
    const role = getAccessRole(user);
    const userId = toId(user?._id);

    if (role === "super_admin" || ADMIN_REVIEW_ROLES.includes(role)) return;
    if (toId(request.requestedBy) === userId) return;
    if (toId(request.assignedTo) === userId) return;
    if (isHrHead(user) && isHumanResourceDepartment(request.requestedDepartmentName || request.employeeData?.department)) return;

    throw new ApiError(403, "You do not have access to this employee request.");
};

const assertAssignedApprover = (request, user) => {
    if (["super_admin", "company_admin"].includes(getAccessRole(user))) return;

    if (toId(request.assignedTo) !== toId(user._id)) {
        throw new ApiError(403, "This employee request is assigned to another approver.");
    }
};

const assertRequestSetupOwner = (request, user) => {
    const role = getAccessRole(user);
    if (!["hr_head", "hr_executive"].includes(role)) {
        throw new ApiError(403, "Only HR Head or HR Executive can setup employee details.");
    }

    if (toId(request.requestedBy) !== toId(user._id)) {
        throw new ApiError(403, "Only the request creator can setup this employee.");
    }
};

const findCompanyAdminApprover = async (companyId) => {
    const company = await Company.findById(companyId).select("ownerUserId");
    const query = {
        companyId,
        status: "active",
        deletedAt: null,
        role: "company_admin",
    };

    if (company?.ownerUserId) {
        query._id = company.ownerUserId;
    }

    return User.findOne(query).select("_id fullName email role systemRole");
};

const findRoleApprover = async (companyId, roles = []) => {
    const candidates = await User.find({
        companyId,
        status: "active",
        deletedAt: null,
        $or: [
            { role: { $in: roles } },
            { systemRole: { $in: roles } },
        ],
    })
        .select("_id fullName email role systemRole departmentId designationId")
        .populate("departmentId", "name slug normalizedName")
        .populate("designationId", "title name mappedRole hierarchyLevel isHead isDepartmentHead")
        .sort({ fullName: 1 });

    return candidates.find((candidate) => roles.includes(getAccessRole(candidate))) || null;
};

const resolveApprover = async (companyId, requestedRole, requestedDesignationId) => {
    if (!companyId) {
        throw new ApiError(400, "Company is required to resolve request approver.");
    }

    const designation = requestedDesignationId
        ? await Designation.findOne({
            _id: requestedDesignationId,
            companyId,
            deletedAt: null,
        }).select("_id isDepartmentHead isHead mappedRole title name")
        : null;

    let approver = null;
    let approverRole = "";
    let approverReason = "";

    if (requestedRole === "hr_head") {
        approver = await findCompanyAdminApprover(companyId);
        approverRole = "company_admin";
        approverReason = "HR Head request assigned to Company Admin";
    } else if (designation?.isDepartmentHead === true || designation?.isHead === true) {
        approver = await findRoleApprover(companyId, ["hr_head"]);
        approverRole = "hr_head";
        approverReason = "Department Head request assigned to HR Head";
    } else {
        approver = await findRoleApprover(companyId, ["hr_manager"]) || await findRoleApprover(companyId, ["hr_head"]);
        approverRole = approver ? getAccessRole(approver) : "";
        approverReason = approverRole === "hr_manager"
            ? "Employee request assigned to HR Manager"
            : "No HR Manager found; assigned to HR Head";
    }

    if (!approver) {
        approver = await findCompanyAdminApprover(companyId);
        approverRole = approver ? getAccessRole(approver) : approverRole;
        approverReason = "No HR approver found; assigned to Company Admin fallback";
    }

    if (!approver) {
        throw new ApiError(400, "No approver is available for this employee request.");
    }

    return {
        approver,
        approverId: approver._id,
        approverRole,
        approvalLevel: Number(approver.designationId?.hierarchyLevel || 0) || null,
        approverReason,
    };
};

const findCompanyScopedRequest = async ({ requestId, user }) => {
    const query = {
        _id: requestId,
        deletedAt: null,
    };

    if (getAccessRole(user) !== "super_admin") {
        if (!user.companyId) {
            throw new ApiError(400, "Company is missing for this user.");
        }
        query.companyId = user.companyId;
    }

    const request = await EmployeeRequest.findOne(query);

    if (!request) {
        throw new ApiError(404, "Employee request not found.");
    }

    assertCanAccessRequest(request, user);
    return request;
};

const resolveRequestedRole = ({ requestedRole, department, designation, isDepartmentHead = false }) => {
    const requestedRoleValidation = validateRoleAssignment(requestedRole, designation, department);
    if (!requestedRoleValidation.valid) {
        throw new ApiError(400, requestedRoleValidation.reason);
    }

    const role = resolveEmployeeRoleV2({
        designation,
        department,
        companyId: department?.companyId,
    }) || resolveEmployeeSystemRole({
        requestedRole,
        designation,
        departmentName: department?.name || department?.title || "",
        isDepartmentHead,
    });
    const roleValidation = validateRoleAssignment(role, designation, department);
    const departmentRoles = department.allowedRoles || [];
    const designationRoles = designation.mappedRole
        ? [designation.mappedRole]
        : designation.allowedRoles?.length
            ? designation.allowedRoles
            : departmentRoles;
    const isCorrectedSalesHead = isDepartmentHead && role === "sales_head";
    const isResolvedHrHead = role === "hr_head" && roleValidation.valid;

    if (!roleValidation.valid) {
        throw new ApiError(400, roleValidation.reason || "Resolved role is not valid for this department or designation.");
    }

    if (BLOCKED_REQUEST_ROLES.includes(role) && !isResolvedHrHead) {
        throw new ApiError(400, "Privileged roles cannot be assigned through employee request flow.");
    }

    if (!isCorrectedSalesHead && !isResolvedHrHead && !isEmployeeRoleAllowed(role, departmentRoles)) {
        throw new ApiError(400, "Requested role is not allowed for this department.");
    }

    if (!isCorrectedSalesHead && !isResolvedHrHead && !isEmployeeRoleAllowed(role, designationRoles)) {
        throw new ApiError(400, "Requested role is not allowed for the selected designation.");
    }

    return role;
};

const findRequestApprover = async ({ user, UserModel = User, CompanyModel = Company }) => {
    const companyId = user.companyId;
    const requester = await UserModel.findById(user._id)
        .select("fullName email role systemRole companyId departmentId designationId reportingManagerId managerId")
        .populate("departmentId", "name slug normalizedName")
        .populate("designationId", "title name mappedRole hierarchyLevel");

    const directManagerId = requester?.reportingManagerId || requester?.managerId;

    if (directManagerId) {
        const manager = await UserModel.findOne({
            _id: directManagerId,
            companyId,
            status: "active",
            deletedAt: null,
        })
            .select("fullName email role systemRole departmentId designationId status")
            .populate("departmentId", "name slug normalizedName")
            .populate("designationId", "title name mappedRole hierarchyLevel");

        const managerRole = manager ? getAccessRole(manager) : "";
        const canReviewRequest = HR_APPROVER_ROLES.includes(managerRole) || ADMIN_REVIEW_ROLES.includes(managerRole);

        if (manager && canReviewRequest) {
            return {
                approver: manager,
                approverId: manager._id,
                approverRole: managerRole,
                approvalLevel: Number(manager.designationId?.hierarchyLevel || 0) || null,
                approverReason: "Assigned to requester reporting manager",
            };
        }
    }

    const hrCandidates = await UserModel.find({
        companyId,
        status: "active",
        deletedAt: null,
        _id: { $ne: user._id },
    })
        .select("fullName email role systemRole departmentId designationId status")
        .populate("departmentId", "name slug normalizedName")
        .populate("designationId", "title name mappedRole hierarchyLevel")
        .sort({ fullName: 1 });

    const hrHead = hrCandidates.find((candidate) => getAccessRole(candidate) === "hr_head");

    if (hrHead) {
        return {
            approver: hrHead,
            approverId: hrHead._id,
            approverRole: "hr_head",
            approvalLevel: Number(hrHead.designationId?.hierarchyLevel || 0) || null,
            approverReason: "Requester has no reporting manager; assigned to HR Head fallback",
        };
    }

    const company = await CompanyModel.findById(companyId).select("ownerUserId");
    const companyAdminQuery = {
        companyId,
        status: "active",
        deletedAt: null,
        role: "company_admin",
    };

    if (company?.ownerUserId) {
        companyAdminQuery._id = company.ownerUserId;
    }

    const companyAdmin = await UserModel.findOne(companyAdminQuery)
        .select("fullName email role systemRole designationId")
        .populate("designationId", "title name mappedRole hierarchyLevel");

    if (companyAdmin) {
        return {
            approver: companyAdmin,
            approverId: companyAdmin._id,
            approverRole: getAccessRole(companyAdmin),
            approvalLevel: null,
            approverReason: "No HR Head found; assigned to Company Admin fallback",
        };
    }

    throw new ApiError(400, "No reporting manager, HR Head, or Company Admin is available for this request.");
};

const resolveRequestedOrgDetails = async ({
    payload,
    user,
    DepartmentModel = Department,
    DesignationModel = Designation,
    isDepartmentHeadDesignationFn = isDepartmentHeadDesignation,
    hasActiveDepartmentHeadFn = hasActiveDepartmentHead,
}) => {
    if (!payload.departmentId || !payload.designationId) {
        throw new ApiError(400, "Department and designation are both required.");
    }

    const department = await DepartmentModel.findOne({
        _id: payload.departmentId,
        companyId: user.companyId,
        status: "active",
        deletedAt: null,
    });

    if (!department) {
        throw new ApiError(404, "Active department not found.");
    }

    assertHrHeadCanRequestDepartment({ user, department });

    const designation = await DesignationModel.findOne({
        _id: payload.designationId,
        companyId: user.companyId,
        departmentId: department._id,
        status: "active",
        isArchived: { $ne: true },
        deletedAt: null,
    });

    if (!designation) {
        throw new ApiError(404, "Active designation not found for this department.");
    }

    const isDepartmentHeadRequest = await isDepartmentHeadDesignationFn({
        companyId: user.companyId,
        departmentId: department._id,
        designation,
    });
    assertInitialHodRequestPolicy({ department, isDepartmentHeadRequest });
    const requestedRole = resolveRequestedRole({
        requestedRole: payload.requestedRole,
        department,
        designation,
        isDepartmentHead: isDepartmentHeadRequest,
    });
    const departmentHasHead = await hasActiveDepartmentHeadFn({
        companyId: user.companyId,
        departmentId: department._id,
    });

    if (!isDepartmentHeadRequest && !departmentHasHead) {
        throw new ApiError(400, `Please create Head of ${department.name} before requesting other ${department.name} employees.`);
    }

    if (isDepartmentHeadRequest && departmentHasHead) {
        throw new ApiError(400, "This department already has an active Head of Department.");
    }

    return {
        department,
        designation,
        employeeDepartment: department.name,
        employeeDesignation: designation.title || designation.name,
        requestedDepartmentId: department._id,
        requestedDepartmentName: department.name,
        requestedDesignationId: designation._id,
        requestedDesignationName: designation.title || designation.name,
        requestedRole,
        requestedReportingManagerId: null,
        requestedHierarchyLevel: designation.hierarchyLevel,
        requestType: isDepartmentHeadRequest ? "department_head_create" : "employee_create",
    };
};

const createEmployeeRequest = async ({ payload, user }) => {
    if (!user.companyId) {
        throw new ApiError(400, "Company is missing for this user.");
    }

    if (!REQUEST_CREATOR_ROLES.includes(getAccessRole(user))) {
        throw new ApiError(403, "Only HR users can create employee requests.");
    }

    if (!payload.fullName) {
        throw new ApiError(400, "Full name is required.");
    }

    const normalizedEmail = String(payload.email || "").trim().toLowerCase();
    if (normalizedEmail) {
        const existingUser = await User.exists({ email: normalizedEmail, deletedAt: null });
        if (existingUser) {
            throw new ApiError(409, "A user already exists with this email.");
        }

        const existingRequest = await EmployeeRequest.exists({
            companyId: user.companyId,
            email: normalizedEmail,
            status: { $in: ["pending", "approved", "setup_pending"] },
            deletedAt: null,
        });
        if (existingRequest) {
            throw new ApiError(409, "An active employee request already exists for this email.");
        }
    }

    const orgDetails = await resolveRequestedOrgDetails({ payload, user });
    const approverDetails = await findRequestApprover({ user });
    const approverId = resolveEmployeeRequestApproverId(approverDetails);
    const phone = payload.phone || payload.mobile || "";
    const mobile = payload.mobile || payload.phone || "";

    const request = await EmployeeRequest.create({
        companyId: user.companyId,
        requestedBy: user._id,
        assignedTo: approverId,
        approverRole: approverDetails.approverRole,
        approvalLevel: approverDetails.approvalLevel,
        approverReason: approverDetails.approverReason,
        email: normalizedEmail,
        phone,
        mobile,

        employeeData: {
            fullName: payload.fullName,
            email: normalizedEmail,
            phone,
            mobile,
            department: orgDetails.employeeDepartment,
            designation: orgDetails.employeeDesignation,
        },

        requestedDepartmentId: orgDetails.requestedDepartmentId,
        requestedDepartmentName: orgDetails.requestedDepartmentName,
        requestedDesignationId: orgDetails.requestedDesignationId,
        requestedDesignationName: orgDetails.requestedDesignationName,
        requestedRole: orgDetails.requestedRole,
        requestedReportingManagerId: orgDetails.requestedReportingManagerId,
        requestedHierarchyLevel: orgDetails.requestedHierarchyLevel,
        requestType: orgDetails.requestType,

        note: payload.note || "",
    });

    await createNotification({
        receiverId: approverId,
        companyId: user.companyId,
        senderId: user._id,
        type: "employee_request_created",
        title: "Employee Request Approval",
        message: `${user.fullName} requested approval for ${payload.fullName}.`,
        data: { requestId: request._id },
    });

    return buildRequestPopulation(EmployeeRequest.findById(request._id));
};

const getEmployeeRequests = async ({ user, status, scope }) => {
    const query = { deletedAt: null };
    const role = getAccessRole(user);

    if (status) query.status = status;

    if (role !== "super_admin") {
        query.companyId = user.companyId;
    }

    if (scope === "my") {
        query.requestedBy = user._id;
    } else if (scope === "assigned") {
        query.assignedTo = user._id;
    } else if (role === "hr_executive") {
        query.requestedBy = user._id;
    } else if (HR_APPROVER_ROLES.includes(role)) {
        query.$or = [{ assignedTo: user._id }, { requestedBy: user._id }];
    } else if (!ADMIN_REVIEW_ROLES.includes(role)) {
        query.requestedBy = user._id;
    }

    return buildRequestPopulation(EmployeeRequest.find(query)).sort({ createdAt: -1 });
};

const approveEmployeeRequest = async ({ requestId, user, comments = "", internalNotes = "" }) => {
    const request = await findCompanyScopedRequest({ requestId, user });
    assertAssignedApprover(request, user);

    transitionRequestStatus(request, "approved");
    request.reviewedBy = user._id;
    request.reviewedAt = new Date();
    request.approvedBy = user._id;
    request.approvedAt = new Date();
    request.setupDeadline = getSetupDeadline(request.approvedAt);
    request.isOverdue = false;
    addApprovalHistory(request, {
        action: "approved",
        actionBy: user._id,
        comments,
        internalNotes,
    });
    transitionRequestStatus(request, "setup_pending");

    await request.save();

    await createNotification({
        companyId: request.companyId,
        receiverId: request.requestedBy,
        senderId: user._id,
        type: "employee_request_approved",
        title: "Employee Request Approved",
        message: `${request.employeeData.fullName} request approved. You can now setup the employee.`,
        data: { requestId: request._id },
    });

    return buildRequestPopulation(EmployeeRequest.findById(request._id));
};

const rejectEmployeeRequest = async ({ requestId, user, rejectionReason, comments = "", internalNotes = "" }) => {
    const request = await findCompanyScopedRequest({ requestId, user });
    assertAssignedApprover(request, user);

    if (!String(rejectionReason || "").trim()) {
        throw new ApiError(400, "Decline reason is required.");
    }

    transitionRequestStatus(request, "declined");
    request.reviewedBy = user._id;
    request.reviewedAt = new Date();
    request.declinedBy = user._id;
    request.declinedAt = new Date();
    request.rejectionReason = String(rejectionReason || "").trim();
    addApprovalHistory(request, {
        action: "declined",
        actionBy: user._id,
        comments: comments || rejectionReason,
        internalNotes,
    });

    await request.save();

    await createNotification({
        companyId: request.companyId,
        receiverId: request.requestedBy,
        senderId: user._id,
        type: "employee_request_rejected",
        title: "Employee Request Declined",
        message: `${request.employeeData.fullName}'s request was declined.`,
        data: { requestId: request._id },
    });

    return buildRequestPopulation(EmployeeRequest.findById(request._id));
};

const checkOverdueRequests = async () => {
    const now = new Date();
    const overdueRequests = await EmployeeRequest.find({
        status: "setup_pending",
        setupDeadline: { $lt: now },
        isOverdue: { $ne: true },
        deletedAt: null,
    }).select("_id companyId employeeData requestedBy setupDeadline");

    let updated = 0;

    for (const request of overdueRequests) {
        request.isOverdue = true;
        await request.save({ validateModifiedOnly: true });
        updated += 1;

        const hrHead = await findRoleApprover(request.companyId, ["hr_head"]);
        if (hrHead) {
            await createNotification({
                companyId: request.companyId,
                receiverId: hrHead._id,
                type: "employee_request_overdue",
                title: "Employee Setup SLA Overdue",
                message: `${request.employeeData?.fullName || "Employee"} setup is overdue.`,
                data: {
                    requestId: request._id,
                    setupDeadline: request.setupDeadline,
                },
            });
        }
    }

    return { checked: overdueRequests.length, updated };
};

const getEmployeeRequestStats = async ({ user }) => {
    const role = getAccessRole(user);
    if (!["hr_head", "hr_manager", "company_admin", "sub_admin"].includes(role)) {
        throw new ApiError(403, "You do not have permission to view employee request stats.");
    }

    const query = { deletedAt: null };
    if (role !== "super_admin") {
        query.companyId = user.companyId;
    }

    const requests = await EmployeeRequest.find(query)
        .select("status isOverdue approvedAt setupCompletedAt onboardedAt updatedAt")
        .lean();

    const stats = {
        total: requests.length,
        pending: 0,
        approved: 0,
        setup_pending: 0,
        completed: 0,
        declined: 0,
        overdue: 0,
        avgCompletionDays: 0,
    };

    let completionDaysTotal = 0;
    let completionCount = 0;

    requests.forEach((request) => {
        if (Object.prototype.hasOwnProperty.call(stats, request.status)) {
            stats[request.status] += 1;
        }
        if (request.isOverdue === true) {
            stats.overdue += 1;
        }
        if (request.status === "completed" && request.approvedAt) {
            const completedAt = request.setupCompletedAt || request.onboardedAt || request.updatedAt;
            if (completedAt) {
                completionDaysTotal += Math.max(0, new Date(completedAt) - new Date(request.approvedAt)) / (1000 * 60 * 60 * 24);
                completionCount += 1;
            }
        }
    });

    stats.avgCompletionDays = completionCount
        ? Math.round((completionDaysTotal / completionCount) * 100) / 100
        : 0;

    return stats;
};

module.exports = {
    STATUS_TRANSITIONS,
    createEmployeeRequest,
    getEmployeeRequests,
    getEmployeeRequestStats,
    approveEmployeeRequest,
    rejectEmployeeRequest,
    validateStatusTransition,
    transitionRequestStatus,
    resolveApprover,
    resolveRequestedRole,
    resolveRequestedOrgDetails,
    findRequestApprover,
    assertAssignedApprover,
    assertRequestSetupOwner,
    checkOverdueRequests,
    assertInitialHodRequestPolicy,
    resolveEmployeeRequestApproverId,
    isDepartmentHeadDesignation,
    hasActiveDepartmentHead,
};
