const ORG_PERMISSIONS = {
  MANAGE_DEPARTMENTS: "org.departments.manage",
  MANAGE_DESIGNATIONS: "org.designations.manage",
  VIEW_ORG_TREE: "org.tree.view",
  ASSIGN_REPORTING_MANAGER: "org.reportingManager.assign",
  MANAGE_EMPLOYEE_RECORDS: "employees.manage",
};

const PERMISSION_SCOPES = ["self", "team", "department", "company", "custom", "global"];
const { getAccessRole } = require("../utils/roleAccess");
const { PERMISSION_CATALOG, DEFAULT_ROLE_PERMISSIONS } = require("../constants/permissionCatalog");

const getSystemRole = (user) => getAccessRole(user);

const getCustomPermissions = (user) =>
  Array.isArray(user?.customPermissions) ? user.customPermissions : [];

const hasExplicitPermission = (user, permission) => {
  const permissions = getCustomPermissions(user);
  return permissions.includes("*") || permissions.includes(permission);
};

const isCompanyAdmin = (user) => getSystemRole(user) === "company_admin";

const isSuperAdmin = (user) => getSystemRole(user) === "super_admin";

const isSubAdmin = (user) => getSystemRole(user) === "sub_admin";

const isHrHead = (user) => getSystemRole(user) === "hr_head";

const isHrManager = (user) => getSystemRole(user) === "hr_manager";

const isHrGeneral = (user) => getSystemRole(user) === "hr_general";

const isHrExecutive = (user) => getSystemRole(user) === "hr_executive";

const canManageCompanyWide = (user) => isSuperAdmin(user) || isCompanyAdmin(user);

const canReadOrgStructure = (user) =>
  canManageCompanyWide(user) ||
  isSubAdmin(user) ||
  isHrHead(user) ||
  isHrManager(user) ||
  isHrGeneral(user) ||
  isHrExecutive(user);

const canManageDepartments = (user) =>
  canManageCompanyWide(user) ||
  (isSubAdmin(user) && hasExplicitPermission(user, ORG_PERMISSIONS.MANAGE_DEPARTMENTS));

const canManageDesignations = (user) =>
  canManageCompanyWide(user) ||
  (isSubAdmin(user) && hasExplicitPermission(user, ORG_PERMISSIONS.MANAGE_DESIGNATIONS));

const canViewOrgTree = (user, targetUser = null) => {
  const scope = user?.permissionScope || "self";
  const hasOrgTreePermission = hasExplicitPermission(user, ORG_PERMISSIONS.VIEW_ORG_TREE);

  if (canManageCompanyWide(user)) return true;
  if (isHrManager(user) && (hasOrgTreePermission || ["company", "global"].includes(scope))) return true;
  if (isHrHead(user) && targetUser && user?.departmentId && targetUser?.departmentId) {
    return String(user.departmentId) === String(targetUser.departmentId);
  }
  if (isSubAdmin(user) && hasOrgTreePermission) return true;
  if (!targetUser) return false;

  if (scope === "company" && isSubAdmin(user)) return true;
  if (scope === "department" && user?.departmentId && targetUser?.departmentId) {
    return String(user.departmentId) === String(targetUser.departmentId);
  }
  if (scope === "team") {
    return (
      String(targetUser.reportingManagerId || targetUser.managerId || "") === String(user._id)
    );
  }

  return String(user?._id || "") === String(targetUser?._id || "");
};

const canAssignReportingManager = (user) =>
  canManageCompanyWide(user) ||
  isHrHead(user) ||
  isHrManager(user) ||
  isHrExecutive(user) ||
  (isSubAdmin(user) && hasExplicitPermission(user, ORG_PERMISSIONS.ASSIGN_REPORTING_MANAGER));

const canManageEmployeeRecords = (user) =>
  canManageCompanyWide(user) ||
  isHrHead(user) ||
  isHrManager(user) ||
  (isHrGeneral(user) && hasExplicitPermission(user, ORG_PERMISSIONS.MANAGE_EMPLOYEE_RECORDS)) ||
  (isSubAdmin(user) && hasExplicitPermission(user, ORG_PERMISSIONS.MANAGE_EMPLOYEE_RECORDS));

const sanitizePermissions = (permissions = []) => {
  if (!Array.isArray(permissions)) return [];
  const allowed = new Set(["*", ...Object.values(ORG_PERMISSIONS), ...Object.keys(PERMISSION_CATALOG)]);
  return [...new Set(permissions.map((item) => String(item || "").trim()).filter(Boolean))]
    .filter(
      (permission) =>
        allowed.has(permission) ||
        /^crm\.[a-zA-Z0-9.*_-]+(?:\.[a-zA-Z0-9.*_-]+)*$/.test(permission)
    );
};

const getDefaultPermissionsForRole = (role) => {
  const normalizedRole = String(role || "").trim();
  return DEFAULT_ROLE_PERMISSIONS[normalizedRole] || [];
};

module.exports = {
  ORG_PERMISSIONS,
  PERMISSION_CATALOG,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_SCOPES,
  getSystemRole,
  hasExplicitPermission,
  canReadOrgStructure,
  canManageDepartments,
  canManageDesignations,
  canViewOrgTree,
  canAssignReportingManager,
  canManageEmployeeRecords,
  sanitizePermissions,
  getDefaultPermissionsForRole,
};
