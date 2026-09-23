const ApiError = require("../utils/ApiError");
const { getCompanyIdOrThrow } = require("./tenant.service");
const {
    getAllowedManagersForEmployee,
    validateReportingManagerAssignment,
} = require("./reporting.service");

const MANAGER_ROLE_HINTS = [
    "company_admin",
    "sub_admin",
    "hr_head",
    "hr_manager",
    "manager",
    "team_lead",
    "department_head",
];

const getEligibleReportingManagers = async ({
    user,
    departmentId,
    designationId,
    excludeUserId = null,
    includeCrossDepartment = false,
}) => {
    const companyId = getCompanyIdOrThrow(user);

    return getAllowedManagersForEmployee({
        companyId,
        departmentId,
        designationId,
        excludeUserId,
        actorUser: user,
        includeCrossDepartment,
    });
};

const assertEligibleReportingManager = async ({
    user,
    managerId,
    departmentId,
    designationId,
    excludeUserId = null,
    role = "employee",
}) => {
    const companyId = getCompanyIdOrThrow(user);
    const result = await validateReportingManagerAssignment({
        companyId,
        employeeId: excludeUserId,
        employeeDesignationId: designationId,
        departmentId,
        reportingManagerId: managerId,
        actorUser: user,
        employeeRole: role,
    });

    if (!result.manager) {
        throw new ApiError(400, "Reporting manager is required.");
    }

    return result.manager;
};

module.exports = {
    MANAGER_ROLE_HINTS,
    getEligibleReportingManagers,
    assertEligibleReportingManager,
};
