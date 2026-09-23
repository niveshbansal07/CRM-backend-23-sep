const ApiError = require("../utils/ApiError");

const COMPANY_SCOPED_ROLES = [
  "company_admin",
  "sub_admin",
  "hr_head",
  "hr_manager",
  "hr_general",
  "hr_executive",
  "employee",
  "user",
];

const getCompanyIdOrThrow = (user) => {
  if (!user?.companyId) {
    throw new ApiError(400, "Company is missing for this user");
  }
  return user.companyId;
};

const assertCompanyScopedUser = (user) => {
  if (!user || !COMPANY_SCOPED_ROLES.includes(user.role)) {
    throw new ApiError(403, "Access denied");
  }
  return getCompanyIdOrThrow(user);
};

const assertSameCompany = (resourceCompanyId, user) => {
  if (user?.role === "super_admin") {
    return true;
  }

  const userCompanyId = getCompanyIdOrThrow(user);
  if (String(resourceCompanyId) !== String(userCompanyId)) {
    throw new ApiError(403, "You are not allowed to access this company's data");
  }

  return true;
};

module.exports = {
  COMPANY_SCOPED_ROLES,
  getCompanyIdOrThrow,
  assertCompanyScopedUser,
  assertSameCompany,
};
