const SYSTEM_ROLES = new Set([
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
]);

const GENERIC_ROLES = new Set(["", "employee", "user"]);
const SALES_ROLES = new Set(["sales_head", "sales_manager", "sales_executive"]);
const {
  getCanonicalSalesRole,
  isSalesDepartment,
} = require("../constants/salesHierarchy");

const EMPLOYEE_ACCOUNT_ROLES = [
  "employee",
  "user",
  "manager",
  "sales_head",
  "sales_manager",
  "sales_executive",
  "hr_head",
  "hr_manager",
  "hr_general",
  "hr_executive",
];

const normalize = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const normalizeTitle = (value) =>
  String(value || "").trim().toLowerCase().replace(/\s+/g, " ");

const normalizeDepartmentKey = (department = {}) => {
  const raw =
    department?.normalizedName ||
    department?.slug ||
    department?.name ||
    department?.title ||
    department;

  const normalized = normalize(raw);
  if (["hr", "human_resources", "human_resource"].includes(normalized)) {
    return "human_resource";
  }
  return normalized;
};

const normalizeSupportedRole = (value) => {
  const role = normalize(value);
  if (["department_head", "team_lead", "project_manager"].includes(role)) {
    return "manager";
  }
  return SYSTEM_ROLES.has(role) ? role : "";
};

const resolveEmployeeSystemRole = ({
  requestedRole,
  designation = null,
  departmentName = "",
  isDepartmentHead = false,
} = {}) => {
  const requested = normalizeSupportedRole(requestedRole);
  const mapped = normalizeSupportedRole(designation?.mappedRole);

  const department = normalizeTitle(departmentName);
  const title = normalizeTitle(designation?.title || designation?.name);
  const isSales = /\bsales\b|business development/.test(`${department} ${title}`);
  const isHrDepartment = /^(hr|human resources?)$/.test(department);

  if (isSales) {
    // Department-head sales designations must win over a stale UI/request role
    // such as "sales_manager"; otherwise Sales Head accounts get downgraded.
    if (isDepartmentHead || /\b(head|director|chief|vp)\b/.test(title)) {
      return "sales_head";
    }
    const canonicalRole = getCanonicalSalesRole(designation);
    if (canonicalRole) return canonicalRole;
    if (mapped && SALES_ROLES.has(mapped)) return mapped;
    if (requested && !GENERIC_ROLES.has(requested)) return requested;
    if (mapped && !GENERIC_ROLES.has(mapped)) return mapped;
    if (/\b(manager|team lead)\b/.test(title)) return "sales_manager";
    return "sales_executive";
  }

  if (requested && !GENERIC_ROLES.has(requested)) return requested;
  if (mapped && !GENERIC_ROLES.has(mapped)) return mapped;

  if (isHrDepartment) {
    if (/\bmanager\b/.test(title)) return "hr_manager";
    if (/\bgeneralist\b|hr general/.test(title)) return "hr_general";
    if (/\b(executive|coordinator|recruiter|associate)\b/.test(title)) {
      return "hr_executive";
    }
  }

  if (isDepartmentHead || /\b(manager|team lead|supervisor)\b/.test(title)) {
    return "manager";
  }

  return requested || mapped || "employee";
};

const resolveEmployeeRoleV2 = ({ designation = null, department = null, companyId = null } = {}) => {
  void companyId;

  const departmentName = normalizeDepartmentKey(department);
  const hierarchyLevel = Number(designation?.hierarchyLevel || 0);
  const mappedRole = normalizeSupportedRole(designation?.mappedRole);

  if (designation?.isHead === true && departmentName === "human_resource") {
    return "hr_head";
  }

  if (designation?.isHead === true && departmentName === "sales") {
    return "sales_head";
  }

  if (departmentName === "sales" || isSalesDepartment(department)) {
    const canonicalRole = getCanonicalSalesRole(designation);
    if (canonicalRole) return canonicalRole;
    if (mappedRole && SALES_ROLES.has(mappedRole)) return mappedRole;
  }

  if (designation?.isHead === true) {
    return "manager";
  }

  if (designation?.isDepartmentHead === true && departmentName === "human_resource") {
    return "hr_manager";
  }

  if (designation?.isDepartmentHead === true) {
    return "manager";
  }

  if (mappedRole) {
    return mappedRole;
  }

  if (hierarchyLevel >= 5 && departmentName === "sales") {
    return "sales_manager";
  }

  if (hierarchyLevel >= 3 && departmentName === "human_resource") {
    return "hr_executive";
  }

  if (hierarchyLevel === 1) {
    return "employee";
  }

  return "employee";
};

const validateRoleAssignment = (role, designation = null, department = null) => {
  const normalizedRole = normalize(role);
  const departmentName = normalizeDepartmentKey(department);
  const hierarchyLevel = Number(designation?.hierarchyLevel || 0);

  if (["company_admin", "super_admin"].includes(normalizedRole)) {
    return {
      valid: false,
      reason: "Company Admin and Super Admin cannot be assigned through employee role resolution.",
    };
  }

  if (normalizedRole === "sub_admin") {
    return {
      valid: false,
      reason: "Sub Admin cannot be assigned through employee role resolution.",
    };
  }

  if (normalizedRole === "hr_head" && departmentName !== "human_resource") {
    return {
      valid: false,
      reason: "HR Head can only be assigned in the Human Resource department.",
    };
  }

  if (normalizedRole === "sales_head" && departmentName !== "sales") {
    return {
      valid: false,
      reason: "Sales Head can only be assigned in the Sales department.",
    };
  }

  if (["hr_manager", "hr_general", "hr_executive"].includes(normalizedRole) && departmentName !== "human_resource") {
    return {
      valid: false,
      reason: "HR roles can only be assigned in the Human Resource department.",
    };
  }

  if (["sales_manager", "sales_executive"].includes(normalizedRole) && departmentName !== "sales") {
    return {
      valid: false,
      reason: "Sales roles can only be assigned in the Sales department.",
    };
  }

  const managerOrHeadRoles = new Set([
    "manager",
    "hr_head",
    "hr_manager",
    "sales_head",
    "sales_manager",
  ]);

  if (hierarchyLevel === 1 && managerOrHeadRoles.has(normalizedRole)) {
    return {
      valid: false,
      reason: "Intern or trainee level designations cannot receive manager or head roles.",
    };
  }

  return {
    valid: true,
    reason: "",
  };
};

const isEmployeeRoleAllowed = (role, allowedRoles = []) => {
  const normalizedRole = normalize(role);
  const normalizedAllowedRoles = (Array.isArray(allowedRoles) ? allowedRoles : [])
    .map(normalize)
    .filter(Boolean);

  if (!normalizedAllowedRoles.length || normalizedAllowedRoles.includes(normalizedRole)) {
    return true;
  }

  const allowsGenericEmployee = normalizedAllowedRoles.some((allowedRole) => GENERIC_ROLES.has(allowedRole));
  return allowsGenericEmployee && EMPLOYEE_ACCOUNT_ROLES.includes(normalizedRole);
};

// Inline role-resolution test cases:
// resolveEmployeeRoleV2({ department: { normalizedName: "human_resource" }, designation: { isHead: true, hierarchyLevel: 6 } }) -> "hr_head"
// resolveEmployeeRoleV2({ department: { normalizedName: "sales" }, designation: { hierarchyLevel: 5 } }) -> "sales_manager"
// resolveEmployeeRoleV2({ department: { normalizedName: "it" }, designation: { title: "Software Developer", hierarchyLevel: 2 } }) -> "employee"
// resolveEmployeeRoleV2({ department: { normalizedName: "finance" }, designation: { isHead: true, hierarchyLevel: 6 } }) -> "manager"
// resolveEmployeeRoleV2({ department: { normalizedName: "sales" }, designation: { title: "Intern", hierarchyLevel: 1 } }) -> "employee"
// resolveEmployeeRoleV2({ department: { normalizedName: "sales" }, designation: { mappedRole: "sales_executive", hierarchyLevel: 2 } }) -> "sales_executive"

module.exports = {
  EMPLOYEE_ACCOUNT_ROLES,
  resolveEmployeeSystemRole,
  resolveEmployeeRoleV2,
  validateRoleAssignment,
  isEmployeeRoleAllowed,
};
