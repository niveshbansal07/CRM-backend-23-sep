const mongoose = require("mongoose");
const User = require("../models/User");
const Department = require("../models/Department");
const Designation = require("../models/Designation");
const EmployeeRequest = require("../models/EmployeeRequest");
const ApiError = require("../utils/ApiError");
const { cleanString, normalizeName, normalizeCode, slugify } = require("../utils/normalize");
const {
  ORG_PERMISSIONS,
  getSystemRole,
  hasExplicitPermission,
} = require("./permission.service");

const HR_DEPARTMENT_NAMES = ["human resource", "human resources"];
const HR_DEPARTMENT_SLUGS = ["human-resource", "human-resources"];
const HR_HEAD_TITLES = ["head of hr", "hr head"];
const ADMIN_TREE_ROLES = new Set(["super_admin", "company_admin", "sub_admin"]);
const LOCKED_DESIGNATION_FIELDS = [
  "name",
  "title",
  "code",
  "departmentId",
  "hierarchyLevel",
  "mappedRole",
  "allowedRoles",
  "allowedParentLevels",
  "canManagePeople",
  "isLeadership",
  "source",
  "isDefaultSeed",
  "slug",
  "normalizedName",
  "normalizedTitle",
];

const toId = (value) => String(value?._id || value || "");

const normalizeText = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const isAdminTreeRole = (member) =>
  ADMIN_TREE_ROLES.has(member?.role) || ADMIN_TREE_ROLES.has(member?.systemRole);

const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const mapDepartment = (department) =>
  department
    ? {
        _id: department._id,
        id: department._id,
        name: department.name,
        code: department.code || "",
        slug: department.slug || "",
        status: department.status,
      }
    : null;

const mapDesignation = (designation) =>
  designation
    ? {
        _id: designation._id,
        id: designation._id,
        name: designation.name,
        title: designation.title || designation.name,
        code: designation.code || "",
        description: designation.description || "",
        hierarchyLevel: designation.hierarchyLevel,
        status: designation.status,
        isActive: designation.isActive !== false && designation.status === "active",
        isArchived: designation.isArchived === true,
        source: designation.source || "custom",
        createdAt: designation.createdAt,
        updatedAt: designation.updatedAt,
      }
    : null;

const mapManagerBasic = (user) =>
  user
    ? {
        _id: user._id,
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        workEmail: user.email,
        employeeId: user.employeeId || "",
        status: user.status,
        department: mapDepartment(user.departmentId) || user.department || "",
        designation: mapDesignation(user.designationId) || user.designation || "",
      }
    : null;

const mapTeamMember = (user, directReportCount = 0) => ({
  _id: user._id,
  id: user._id,
  fullName: user.fullName,
  name: user.fullName,
  email: user.email,
  workEmail: user.email,
  phone: user.phone || "",
  avatar: user.avatar || "",
  employeeId: user.employeeId || "",
  employeeCode: user.employeeId || "",
  role: user.role,
  systemRole: user.systemRole || user.role,
  department: mapDepartment(user.departmentId) || user.department || "",
  designation: mapDesignation(user.designationId) || user.designation || "",
  reportingManagerId: user.reportingManagerId || user.managerId || null,
  managerId: user.managerId || user.reportingManagerId || null,
  reportingManager: mapManagerBasic(user.reportingManagerId || user.managerId),
  directReportCount,
  status: user.status,
  joiningDate: user.joiningDate || null,
  lastLoginAt: user.lastLoginAt || null,
  createdAt: user.createdAt,
});

const mapRequest = (request) => ({
  _id: request._id,
  id: request._id,
  fullName: request.employeeData?.fullName || "",
  email: request.email || request.employeeData?.email || "",
  department: request.requestedDepartmentName || request.employeeData?.department || "",
  designation: request.requestedDesignationName || request.employeeData?.designation || "",
  requestedRole: request.requestedRole || "",
  status: request.status,
  isOnboarded: request.isOnboarded,
  requestedBy: mapManagerBasic(request.requestedBy),
  reviewedBy: mapManagerBasic(request.reviewedBy),
  createdAt: request.createdAt,
  updatedAt: request.updatedAt,
  reviewedAt: request.reviewedAt,
});

const findHumanResourceDepartment = (companyId) =>
  Department.findOne({
    companyId,
    deletedAt: null,
    status: "active",
    isArchived: { $ne: true },
    $or: [
      { normalizedName: { $in: HR_DEPARTMENT_NAMES } },
      { slug: { $in: HR_DEPARTMENT_SLUGS } },
      { name: /^human resources?$/i },
    ],
  });

const isHrDepartmentValue = (value) => {
  const normalized = normalizeText(value?.name || value);
  const slug = normalizeText(value?.slug || "").replace(/\s+/g, "-");
  return HR_DEPARTMENT_NAMES.includes(normalized) || HR_DEPARTMENT_SLUGS.includes(slug);
};

const isHrHeadDesignationValue = (value) => {
  const title = normalizeText(value?.title || value?.name || value);
  return HR_HEAD_TITLES.includes(title);
};

const loadActor = async (user) => {
  if (!user?._id) {
    throw new ApiError(401, "Authentication required.");
  }

  const actor = await User.findOne({
    _id: user._id,
    deletedAt: null,
    status: "active",
  })
    .select("-passwordHash")
    .populate("departmentId", "name normalizedName slug code status isArchived")
    .populate("designationId", "name title normalizedName normalizedTitle code hierarchyLevel status isArchived");

  if (!actor) {
    throw new ApiError(401, "Authenticated user not found.");
  }

  return actor;
};

const hasHrHeadPermission = (user) =>
  hasExplicitPermission(user, "hr.department.head") ||
  (hasExplicitPermission(user, ORG_PERMISSIONS.MANAGE_EMPLOYEE_RECORDS) &&
    hasExplicitPermission(user, ORG_PERMISSIONS.VIEW_ORG_TREE));

const isHrHeadUser = (user) => {
  const role = getSystemRole(user);
  if (role !== "hr_head") return false;

  const inHrDepartment =
    isHrDepartmentValue(user.departmentId) || isHrDepartmentValue(user.department);
  if (!inHrDepartment) return false;

  const hasHeadDesignation =
    isHrHeadDesignationValue(user.designationId) || isHrHeadDesignationValue(user.designation);

  return hasHeadDesignation || hasHrHeadPermission(user);
};

const getHrHeadContext = async (user) => {
  const actor = await loadActor(user);
  if (!actor.companyId) {
    throw new ApiError(400, "Company context is missing.");
  }

  const hrDepartment = await findHumanResourceDepartment(actor.companyId);
  if (!hrDepartment) {
    throw new ApiError(404, "Active Human Resource department was not found.");
  }

  if (!isHrHeadUser(actor)) {
    throw new ApiError(403, "Only HR Head can access this HR department workspace.");
  }

  if (actor.departmentId && toId(actor.departmentId) !== toId(hrDepartment._id)) {
    throw new ApiError(403, "HR Head access is limited to the Human Resource department.");
  }

  return {
    actor,
    companyId: actor.companyId,
    hrDepartment,
  };
};

const buildDirectReportCounts = (team) =>
  team.reduce((acc, user) => {
    const managerId = toId(user.reportingManagerId || user.managerId);
    if (managerId) acc.set(managerId, (acc.get(managerId) || 0) + 1);
    return acc;
  }, new Map());

const parseLevelToken = (value) => {
  const match = String(value || "").match(/\bL\s*([1-6])\b/i);
  return match ? Number(match[1]) : 0;
};

const normalizeMemberLevel = (member) => {
  const designation = member?.designation || {};
  const directLevel = Number(
    designation.hierarchyLevel ??
    designation.level ??
    designation.rank ??
    designation.order
  );

  if (Number.isInteger(directLevel) && directLevel > 0) return directLevel;

  const tokenLevel = parseLevelToken(
    [
      designation.grade,
      designation.label,
      designation.code,
      designation.title,
      designation.name,
      typeof designation === "string" ? designation : "",
    ].join(" ")
  );

  if (tokenLevel) return tokenLevel;

  const role = String(member?.systemRole || member?.role || "").toLowerCase();
  const mappedRole = String(designation?.mappedRole || "").toLowerCase();
  const title = normalizeText([
    designation?.title,
    designation?.name,
    typeof designation === "string" ? designation : "",
  ].join(" "));
  const roleText = `${role} ${mappedRole} ${title}`;

  if (
    designation?.isDepartmentHead === true ||
    designation?.isHead === true ||
    /\b(hr_head|department_head|head of department|head|hod)\b/.test(roleText)
  ) return 6;
  if (/\b(hr_manager|manager)\b/.test(roleText)) return 5;
  if (/\b(team_lead|team lead|senior|lead|supervisor)\b/.test(roleText)) return 4;
  if (/\b(hr_executive|executive|coordinator|associate)\b/.test(roleText)) return 2;
  if (/\b(intern|trainee|assistant)\b/.test(roleText)) return 1;
  if (role === "employee" || role === "user") return 1;

  return 0;
};

const isHrHeadMember = (member) => {
  const role = member?.systemRole || member?.role || "";
  const designation = member?.designation || {};
  const title = normalizeText(designation.title || designation.name || designation);

  return (
    role === "hr_head" ||
    designation.mappedRole === "hr_head" ||
    designation.isDepartmentHead === true ||
    designation.isHead === true ||
    title.includes("head")
  );
};

const sortMembersForTree = (members = []) =>
  [...members].sort((first, second) => {
    const levelDiff = normalizeMemberLevel(second) - normalizeMemberLevel(first);
    if (levelDiff) return levelDiff;
    if (isHrHeadMember(first) && !isHrHeadMember(second)) return -1;
    if (!isHrHeadMember(first) && isHrHeadMember(second)) return 1;
    return String(first.fullName || "").localeCompare(String(second.fullName || ""));
  });

const sameDepartment = (first, second) =>
  Boolean(
    toId(first?.department?._id || first?.department?.id || first?.departmentId) &&
      toId(first?.department?._id || first?.department?.id || first?.departmentId) ===
        toId(second?.department?._id || second?.department?.id || second?.departmentId)
  );

const loadHrTeam = async ({ companyId, hrDepartment }) => {
  const team = await User.find({
    companyId,
    departmentId: hrDepartment._id,
    deletedAt: null,
  })
    .select("fullName email phone avatar employeeId role systemRole department departmentId designation designationId reportingManagerId managerId status joiningDate lastLoginAt createdAt")
    .populate("departmentId", "name code slug status")
    .populate("designationId", "name title code hierarchyLevel status")
    .populate("reportingManagerId", "fullName email employeeId status department departmentId designation designationId")
    .populate("managerId", "fullName email employeeId status department departmentId designation designationId")
    .sort({ role: 1, fullName: 1 });

  const counts = buildDirectReportCounts(team);
  return team
    .map((user) => mapTeamMember(user, counts.get(toId(user._id)) || 0))
    .filter((member) => !isAdminTreeRole(member));
};

const loadHrDesignations = async ({ companyId, hrDepartment }) => {
  const designations = await Designation.find({
    companyId,
    departmentId: hrDepartment._id,
    deletedAt: null,
  }).sort({ hierarchyLevel: -1, name: 1 });

  return designations.map(mapDesignation);
};

const buildHrRequestQuery = ({ companyId, hrDepartment }) => ({
  companyId,
  deletedAt: null,
  $or: [
    { requestedDepartmentId: hrDepartment._id },
    { requestedDepartmentName: /^human resources?$/i },
    { "employeeData.department": /^human resources?$/i },
  ],
});

const loadHrRequests = async ({ companyId, hrDepartment, limit = 8 }) => {
  const requests = await EmployeeRequest.find(buildHrRequestQuery({ companyId, hrDepartment }))
    .populate("requestedBy reviewedBy", "fullName email employeeId status department departmentId designation designationId")
    .sort({ createdAt: -1 })
    .limit(limit);

  return requests.map(mapRequest);
};

const countBy = (items, getter) =>
  items.reduce((acc, item) => {
    const key = getter(item) || "Unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

const countHrRequestsByStatus = async ({ companyId, hrDepartment }) => {
  const rows = await EmployeeRequest.aggregate([
    { $match: buildHrRequestQuery({ companyId, hrDepartment }) },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  return rows.reduce((acc, row) => {
    acc[row._id || "unknown"] = row.count;
    return acc;
  }, {});
};

const buildHrStructure = (team, actorId) => {
  const sorted = sortMembersForTree(team);
  const byId = new Map(sorted.map((user) => [toId(user._id), user]));
  const explicitHead =
    sorted.find((member) => toId(member._id) === toId(actorId)) ||
    sortMembersForTree(sorted.filter(isHrHeadMember))[0] ||
    sorted[0] ||
    null;
  const parentByChild = new Map();

  sorted.forEach((member) => {
    const memberId = toId(member._id);
    const memberLevel = normalizeMemberLevel(member);
    const managerId = toId(member.reportingManagerId || member.managerId);
    const manager = byId.get(managerId);

    if (
      manager &&
      managerId !== memberId &&
      sameDepartment(manager, member) &&
      normalizeMemberLevel(manager) > memberLevel
    ) {
      parentByChild.set(memberId, managerId);
      return;
    }

    const nearestHigher = sorted
      .filter((candidate) => {
        if (toId(candidate._id) === memberId) return false;
        if (!sameDepartment(candidate, member)) return false;
        return normalizeMemberLevel(candidate) > memberLevel;
      })
      .sort((first, second) => {
        const firstLevel = normalizeMemberLevel(first);
        const secondLevel = normalizeMemberLevel(second);
        if (firstLevel !== secondLevel) return firstLevel - secondLevel;
        return String(first.fullName || "").localeCompare(String(second.fullName || ""));
      })[0];

    if (nearestHigher) {
      parentByChild.set(memberId, toId(nearestHigher._id));
      return;
    }

    if (explicitHead && toId(explicitHead._id) !== memberId && isHrHeadMember(explicitHead)) {
      parentByChild.set(memberId, toId(explicitHead._id));
    }
  });

  const childrenByParent = new Map();
  parentByChild.forEach((parentId, childId) => {
    const child = byId.get(childId);
    if (!child) return;
    const siblings = childrenByParent.get(parentId) || [];
    siblings.push(child);
    childrenByParent.set(parentId, siblings);
  });

  const makeNode = (member, path = new Set()) => {
    const memberId = toId(member._id);
    if (!memberId || path.has(memberId)) return null;

    const nextPath = new Set(path);
    nextPath.add(memberId);
    const children = sortMembersForTree(childrenByParent.get(memberId) || [])
      .map((child) => makeNode(child, nextPath))
      .filter(Boolean);
    const level = normalizeMemberLevel(member);

    return {
      ...member,
      level,
      levelLabel: level ? `L${level}` : "",
      directReportCount: children.length,
      children,
    };
  };

  return sorted
    .filter((member) => !parentByChild.has(toId(member._id)))
    .map((member) => makeNode(member))
    .filter(Boolean);
};

const getDashboard = async ({ user }) => {
  const { actor, companyId, hrDepartment } = await getHrHeadContext(user);
  const [team, designations, requests, requestCounts] = await Promise.all([
    loadHrTeam({ companyId, hrDepartment }),
    loadHrDesignations({ companyId, hrDepartment }),
    loadHrRequests({ companyId, hrDepartment, limit: 10 }),
    countHrRequestsByStatus({ companyId, hrDepartment }),
  ]);

  const activeEmployees = team.filter((member) => member.status === "active").length;
  const inactiveEmployees = team.filter((member) => member.status !== "active").length;
  const pendingRequests = (requestCounts.pending || 0) + (requestCounts.submitted || 0);
  const activeDesignations = designations.filter((designation) => designation.status === "active" && !designation.isArchived).length;
  const usedDesignationIds = new Set(team.map((member) => toId(member.designation?._id || member.designation?.id)).filter(Boolean));
  const vacantDesignations = designations.filter(
    (designation) =>
      designation.status === "active" &&
      !designation.isArchived &&
      !usedDesignationIds.has(toId(designation._id || designation.id))
  ).length;
  const directReportsCount = team.filter(
    (member) => toId(member.reportingManagerId) === toId(actor._id)
  ).length;

  return {
    hrHead: mapTeamMember(actor, directReportsCount),
    department: mapDepartment(hrDepartment),
    stats: {
      totalHrEmployees: team.length,
      activeHrEmployees: activeEmployees,
      inactiveHrEmployees: inactiveEmployees,
      pendingHrRequests: pendingRequests,
      openFollowUps: pendingRequests,
      activeHrDesignations: activeDesignations,
      vacantHrDesignations: vacantDesignations,
      directReportsCount,
    },
    structure: buildHrStructure(team, actor._id),
    team,
    designations,
    requests,
    reportsPreview: {
      employeesByDesignation: countBy(team, (member) => member.designation?.title || member.designation || "Unassigned"),
      requestsByStatus: countBy(requests, (request) => request.status),
    },
  };
};

const getTeam = async ({ user }) => {
  const { actor, companyId, hrDepartment } = await getHrHeadContext(user);
  const team = await loadHrTeam({ companyId, hrDepartment });

  return {
    department: mapDepartment(hrDepartment),
    hrHead: mapTeamMember(actor, team.filter((member) => toId(member.reportingManagerId) === toId(actor._id)).length),
    team,
    structure: buildHrStructure(team, actor._id),
  };
};

const getDesignations = async ({ user }) => {
  const { companyId, hrDepartment } = await getHrHeadContext(user);
  return {
    department: mapDepartment(hrDepartment),
    designations: await loadHrDesignations({ companyId, hrDepartment }),
  };
};

const createDesignation = async ({ user, payload }) => {
  const { companyId, hrDepartment, actor } = await getHrHeadContext(user);
  const title = cleanString(payload?.title || payload?.name);
  const hierarchyLevel = Number(payload?.hierarchyLevel);
  const status = payload?.status ? cleanString(payload.status).toLowerCase() : "active";

  if (!title || title.length < 2) {
    throw new ApiError(400, "Designation title is required.");
  }

  if (!Number.isInteger(hierarchyLevel) || hierarchyLevel < 1 || hierarchyLevel > 6) {
    throw new ApiError(400, "Hierarchy level must be between L1 and L6.");
  }

  if (!["active", "inactive"].includes(status)) {
    throw new ApiError(400, "Status must be active or inactive.");
  }

  const normalizedTitle = normalizeName(title);
  const slug = slugify(title);

  if (!normalizedTitle) {
    throw new ApiError(400, "Designation title must include at least one letter or number.");
  }

  const duplicate = await Designation.findOne({
    companyId,
    departmentId: hrDepartment._id,
    deletedAt: null,
    $or: [
      { normalizedTitle },
      { normalizedName: normalizedTitle },
      { slug },
    ],
  });

  if (duplicate) {
    throw new ApiError(409, "Designation already exists in the Human Resource department.", [
      { field: "title", existing: mapDesignation(duplicate) },
    ]);
  }

  let designation;
  try {
    designation = await Designation.create({
      companyId,
      departmentId: hrDepartment._id,
      name: title,
      title,
      normalizedName: normalizedTitle,
      normalizedTitle,
      slug,
      code: normalizeCode(payload?.code || title).slice(0, 24),
      description: cleanString(payload?.description),
      mappedRole: "",
      allowedRoles: [],
      hierarchyLevel,
      allowedParentLevels: [],
      canManagePeople: false,
      isLeadership: false,
      status,
      source: "custom",
      isDefaultSeed: false,
      isActive: status === "active",
      isArchived: status !== "active",
      createdBy: actor._id,
      updatedBy: actor._id,
    });
  } catch (error) {
    if (error?.code === 11000) {
      throw new ApiError(409, "Designation already exists in the Human Resource department.");
    }
    throw error;
  }

  return {
    department: mapDepartment(hrDepartment),
    designation: mapDesignation(designation),
  };
};

const updateDesignation = async ({ user, designationId, payload }) => {
  if (!mongoose.Types.ObjectId.isValid(designationId)) {
    throw new ApiError(400, "Designation id must be valid.");
  }

  const attemptedLockedFields = LOCKED_DESIGNATION_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(payload || {}, field)
  );

  if (attemptedLockedFields.length) {
    throw new ApiError(
      400,
      `Designation identity fields cannot be changed after creation: ${attemptedLockedFields.join(", ")}.`
    );
  }

  const { companyId, hrDepartment, actor } = await getHrHeadContext(user);
  const designation = await Designation.findOne({
    _id: designationId,
    companyId,
    departmentId: hrDepartment._id,
    deletedAt: null,
  });

  if (!designation) {
    throw new ApiError(404, "HR designation not found.");
  }

  if (Object.prototype.hasOwnProperty.call(payload || {}, "description")) {
    designation.description = cleanString(payload.description);
  }

  const nextStatus =
    payload?.status !== undefined
      ? cleanString(payload.status).toLowerCase()
      : payload?.isActive !== undefined
        ? payload.isActive
          ? "active"
          : "inactive"
        : payload?.isArchived !== undefined
          ? payload.isArchived
            ? "inactive"
            : "active"
          : null;

  if (nextStatus) {
    if (!["active", "inactive"].includes(nextStatus)) {
      throw new ApiError(400, "Status must be active or inactive.");
    }
    designation.status = nextStatus;
    designation.isActive = nextStatus === "active";
    designation.isArchived = nextStatus !== "active";
    designation.archivedAt = nextStatus === "active" ? null : new Date();
  }

  designation.updatedBy = actor._id;
  await designation.save({ validateModifiedOnly: true });

  return {
    department: mapDepartment(hrDepartment),
    designation: mapDesignation(designation),
  };
};

const getReports = async ({ user }) => {
  const { companyId, hrDepartment } = await getHrHeadContext(user);
  const [team, designations, requests] = await Promise.all([
    loadHrTeam({ companyId, hrDepartment }),
    loadHrDesignations({ companyId, hrDepartment }),
    loadHrRequests({ companyId, hrDepartment, limit: 100 }),
  ]);

  const activeEmployees = team.filter((member) => member.status === "active").length;
  const inactiveEmployees = team.length - activeEmployees;
  const activeDesignations = designations.filter((designation) => designation.status === "active" && !designation.isArchived);
  const usedDesignationIds = new Set(team.map((member) => toId(member.designation?._id || member.designation?.id)).filter(Boolean));
  const vacantDesignations = activeDesignations.filter(
    (designation) => !usedDesignationIds.has(toId(designation._id || designation.id))
  );

  return {
    department: mapDepartment(hrDepartment),
    cards: {
      totalHrEmployees: team.length,
      activeHrEmployees: activeEmployees,
      inactiveHrEmployees: inactiveEmployees,
      pendingRequests: requests.filter((request) => ["pending", "submitted"].includes(request.status)).length,
      approvedRequests: requests.filter((request) => request.status === "approved").length,
      rejectedRequests: requests.filter((request) => request.status === "rejected").length,
      activeHrDesignations: activeDesignations.length,
      vacantHrDesignations: vacantDesignations.length,
    },
    employeesByDesignation: Object.entries(
      countBy(team, (member) => member.designation?.title || member.designation || "Unassigned")
    ).map(([designation, count]) => ({ designation, count })),
    requestsByStatus: Object.entries(countBy(requests, (request) => request.status)).map(
      ([status, count]) => ({ status, count })
    ),
    reportingSummary: team.map((member) => ({
      _id: member._id,
      name: member.fullName,
      designation: member.designation?.title || member.designation || "",
      manager: member.reportingManager?.fullName || "",
      directReportCount: member.directReportCount,
      status: member.status,
    })),
    vacantDesignations,
    recentRequests: requests.slice(0, 12),
  };
};

module.exports = {
  isHrHeadUser,
  getDashboard,
  getTeam,
  getDesignations,
  createDesignation,
  updateDesignation,
  getReports,
};
