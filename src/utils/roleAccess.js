const HR_ROLES = ["hr_head", "hr_manager", "hr_general", "hr_executive"];
const COMPANY_ROLES = ["company_admin", "sub_admin"];

const text = (value) => String(value || "").trim();
const lower = (value) => text(value).toLowerCase().replace(/\s+/g, " ");

const getNested = (value, keys = []) => {
    if (!value || typeof value !== "object") return "";
    for (const key of keys) {
        if (value[key]) return value[key];
    }
    return "";
};

const getDepartmentName = (user = {}) =>
    text(
        getNested(user.departmentId, ["name", "title"]) ||
        getNested(user.department, ["name", "title"]) ||
        user.departmentName ||
        user.department
    );

const getDesignationTitle = (user = {}) =>
    text(
        getNested(user.designationId, ["title", "name"]) ||
        getNested(user.designation, ["title", "name"]) ||
        user.designationName ||
        user.designation
    );

const getDesignationMappedRole = (user = {}) =>
    text(
        getNested(user.designationId, ["mappedRole", "role"]) ||
        getNested(user.designation, ["mappedRole", "role"])
    );

const getAccessRole = (user = {}) => {
    const directRole = text(user.accessRole || user.systemRole || user.role).toLowerCase();
    const mappedRole = getDesignationMappedRole(user).toLowerCase();
    const designation = lower(getDesignationTitle(user));
    const department = lower(getDepartmentName(user));
    const isHrDepartment = /^(hr|human resources?)$/.test(department);
    const hrSignal = isHrDepartment || /\bhr\b|human resource/.test(designation);

    if (directRole === "super_admin") return "super_admin";
    if (COMPANY_ROLES.includes(directRole)) return directRole;
    if (directRole === "hr_head" || mappedRole === "hr_head") return "hr_head";
    if (directRole === "hr_manager" || mappedRole === "hr_manager") return "hr_manager";
    if (directRole === "hr_general" || mappedRole === "hr_general") return "hr_general";
    if (directRole === "hr_executive" || mappedRole === "hr_executive") return "hr_executive";

    if (hrSignal) {
        if (/\bhead\b|hod|lead hr|hr head/.test(designation)) return "hr_head";
        if (/\bmanager\b|senior manager|assistant manager/.test(designation)) return "hr_manager";
        if (/\bgeneralist\b|hr general/.test(designation)) return "hr_general";
        if (/\bexecutive\b|coordinator|recruiter|associate|intern/.test(designation)) return "hr_executive";
    }

    const salesSignal = /\bsales\b|business development/.test(department) || /\bsales\b|business development/.test(designation);
    if (directRole === "sales_head" || mappedRole === "sales_head" || (salesSignal && /\bhead\b|director|vp/.test(designation))) {
        return "sales_head";
    }
    if (directRole === "sales_manager" || mappedRole === "sales_manager" || (salesSignal && /\bmanager\b|\bteam lead\b/.test(designation))) {
        return "sales_manager";
    }
    if (directRole === "sales_executive" || mappedRole === "sales_executive" || directRole === "sales" || salesSignal) {
        return "sales_executive";
    }

    return directRole || "user";
};

module.exports = {
    HR_ROLES,
    COMPANY_ROLES,
    getAccessRole,
};
