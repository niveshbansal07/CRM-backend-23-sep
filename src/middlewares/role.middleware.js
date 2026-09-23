const COMPANY_ADMIN_ROLES = ["company_admin", "sub_admin"];
const {
    canManageDepartments,
    canManageDesignations,
    canReadOrgStructure,
    canViewOrgTree,
    canAssignReportingManager,
    canManageEmployeeRecords,
} = require("../services/permission.service");
const { getAccessRole } = require("../utils/roleAccess");
const { EMPLOYEE_ACCOUNT_ROLES } = require("../utils/employeeRole");

const HR_ROLES = ["hr_head", "hr_manager", "hr_general", "hr_executive"];

const EMPLOYEE_SELF_SERVICE_ROLES = [
    ...EMPLOYEE_ACCOUNT_ROLES,
    "company_admin",
    "sub_admin",
];

const ATTENDANCE_VIEW_ROLES = [
    "company_admin",
    "sub_admin",
    "hr_head",
    "hr_manager",
    "hr_general",
    "hr_executive",
];

const ATTENDANCE_MANAGE_ROLES = [
    "company_admin",
    "sub_admin",
    "hr_head",
    "hr_manager",
];

const ATTENDANCE_POLICY_ROLES = [
    "company_admin",
    "sub_admin",
];

const ATTENDANCE_CORRECTION_APPROVER_ROLES = [
    "company_admin",
    "sub_admin",
    "hr_head",
    "hr_manager",
];

const LEAVE_APPROVER_ROLES = [
    "company_admin",
    "sub_admin",
    "hr_head",
    "hr_manager",
];

const EMPLOYEE_REQUEST_CREATOR_ROLES = [
    "hr_executive",
    "hr_general",
    "hr_head",
    "hr_manager",
];

const EMPLOYEE_REQUEST_REVIEWER_ROLES = [
    "hr_head",
    "hr_manager",
    "hr_general",
    "sub_admin",
    "company_admin",
];

const allowRoles = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized",
            });
        }

        const accessRole = getAccessRole(req.user);

        if (!roles.includes(accessRole)) {
            return res.status(403).json({
                success: false,
                message: "Access denied",
            });
        }

        next();
    };
};

const allowWhen = (predicate, message = "Access denied") => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized",
            });
        }

        if (!predicate(req.user, req)) {
            return res.status(403).json({
                success: false,
                message,
            });
        }

        next();
    };
};

const allowCompanyAdmin = allowRoles(...COMPANY_ADMIN_ROLES);
const allowDepartmentManage = allowWhen(canManageDepartments);
const allowDesignationManage = allowWhen(canManageDesignations);
const allowOrgStructureRead = allowWhen(canReadOrgStructure);
const requireCompanyAdmin = allowRoles("super_admin", "company_admin");
const requireStructureManagePermission = allowWhen(
    (user) => canManageDepartments(user) || canManageDesignations(user)
);
const allowOrgTreeView = allowWhen((user) => canViewOrgTree(user));
const requireOrgTreeViewPermission = allowOrgTreeView;
const allowReportingManagerAssign = allowWhen(canAssignReportingManager);
const allowEmployeeRecordManage = allowWhen(canManageEmployeeRecords);

const allowEmployeeRequestCreate = allowRoles(
    ...EMPLOYEE_REQUEST_CREATOR_ROLES
);

const allowEmployeeRequestReview = allowRoles(
    ...EMPLOYEE_REQUEST_REVIEWER_ROLES
);

const allowHrManager = allowRoles("hr_head", "hr_manager");
const allowHrExecutive = allowRoles("hr_executive", "hr_general", "hr_head", "hr_manager");
const allowHrRequestViewer = allowRoles("hr_head", "hr_manager", "hr_general", "hr_executive");

module.exports = {
    allowRoles,
    allowWhen,
    allowCompanyAdmin,
    requireCompanyAdmin,
    allowDepartmentManage,
    allowDesignationManage,
    allowOrgStructureRead,
    requireStructureManagePermission,
    allowOrgTreeView,
    requireOrgTreeViewPermission,
    allowReportingManagerAssign,
    allowEmployeeRecordManage,
    allowEmployeeRequestCreate,
    allowEmployeeRequestReview,
    allowHrManager,
    allowHrExecutive,
    allowHrRequestViewer,
    COMPANY_ADMIN_ROLES,
    HR_ROLES,
    EMPLOYEE_SELF_SERVICE_ROLES,
    ATTENDANCE_VIEW_ROLES,
    ATTENDANCE_MANAGE_ROLES,
    ATTENDANCE_POLICY_ROLES,
    ATTENDANCE_CORRECTION_APPROVER_ROLES,
    LEAVE_APPROVER_ROLES,
    EMPLOYEE_REQUEST_CREATOR_ROLES,
    EMPLOYEE_REQUEST_REVIEWER_ROLES,
};
