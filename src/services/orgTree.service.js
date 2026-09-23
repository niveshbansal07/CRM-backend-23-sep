const mongoose = require("mongoose");
const User = require("../models/User");
const Department = require("../models/Department");
const Designation = require("../models/Designation");
const ApiError = require("../utils/ApiError");
const { DEFAULT_DEPARTMENTS } = require("../seeds/defaultDepartments");
const {
  getDefaultDesignationSeedsForDepartment,
} = require("../seeds/defaultDesignationsByDepartment");
const { slugify } = require("../utils/normalize");
const {
  ORG_PERMISSIONS,
  getSystemRole,
  hasExplicitPermission,
} = require("./permission.service");
const {
  getAllowedManagersForEmployee,
  getDownlineEmployeeIds,
} = require("./reporting.service");

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const ORG_TREE_CACHE_TTL_MS = 5 * 60 * 1000;
const orgTreeCache = new Map();

const getOrgTreeCacheKey = (companyId) => `companyOrgTree:${String(companyId || "")}`;

const getCachedOrgTree = (companyId) => {
  const cached = orgTreeCache.get(getOrgTreeCacheKey(companyId));
  if (!cached || cached.expiresAt <= Date.now()) {
    orgTreeCache.delete(getOrgTreeCacheKey(companyId));
    return null;
  }
  return cached.value;
};

const setCachedOrgTree = (companyId, value) => {
  orgTreeCache.set(getOrgTreeCacheKey(companyId), {
    value,
    expiresAt: Date.now() + ORG_TREE_CACHE_TTL_MS,
  });
};

const invalidateOrgTreeCache = (companyId) => {
  if (!companyId) return;
  orgTreeCache.delete(getOrgTreeCacheKey(companyId));
};

const normalizeTreeId = (value) => {
  const normalized = slugify(String(value || ""));
  return normalized || "node";
};

const toId = (value) => {
  if (!value) return null;
  if (value._id) return String(value._id);
  return String(value);
};

const resolveCompanyId = (actorUser, requestedCompanyId = null) => {
  const actorRole = getSystemRole(actorUser);

  if (actorRole === "super_admin") {
    const companyId = requestedCompanyId || actorUser.companyId;
    if (!companyId || !isValidObjectId(companyId)) {
      throw new ApiError(400, "Company id is required.");
    }
    return companyId;
  }

  if (!actorUser.companyId) {
    throw new ApiError(400, "Company is missing for this user.");
  }

  return actorUser.companyId;
};

const canViewFullCompanyTree = (actorUser) => {
  const role = getSystemRole(actorUser);
  const hasOrgTreePermission = hasExplicitPermission(actorUser, ORG_PERMISSIONS.VIEW_ORG_TREE);

  return (
    role === "super_admin" ||
    role === "company_admin" ||
    (role === "sub_admin" && hasOrgTreePermission) ||
    (role === "hr_manager" &&
      (hasOrgTreePermission || ["company", "global"].includes(actorUser?.permissionScope || "")))
  );
};

const hasCompanyScope = (actorUser) =>
  ["company", "global"].includes(actorUser?.permissionScope || "");

const hasDepartmentScope = (actorUser) =>
  ["department", "company", "global"].includes(actorUser?.permissionScope || "");

const hasTeamScope = (actorUser) => {
  const scope = actorUser?.permissionScope || "";
  return (
    ["team", "department", "company", "global"].includes(scope) ||
    (scope === "custom" && hasExplicitPermission(actorUser, ORG_PERMISSIONS.VIEW_ORG_TREE))
  );
};

const userQuery = ({ companyId, extra = {}, activeOnly = true }) => ({
  companyId,
  deletedAt: null,
  ...(activeOnly ? { status: "active" } : {}),
  ...extra,
});

const populateOrgRefs = (query) =>
  query
    .select(
      "fullName email phone avatar status employeeId department departmentId designation designationId reportingManagerId managerId role systemRole permissionScope employmentType"
    )
    .populate("departmentId", "name code status normalizedName headDesignationId")
    .populate("designationId", "name title code hierarchyLevel allowedParentLevels allowedParentDesignations mappedRole canManagePeople isLeadership isDepartmentHead isHead status")
    .populate({
      path: "reportingManagerId",
      select: "fullName email phone avatar status employeeId department departmentId designation designationId role systemRole",
      populate: [
        { path: "departmentId", select: "name code status" },
        { path: "designationId", select: "name title code hierarchyLevel allowedParentLevels mappedRole canManagePeople isLeadership status" },
      ],
    })
    .populate({
      path: "managerId",
      select: "fullName email phone avatar status employeeId department departmentId designation designationId role systemRole",
      populate: [
        { path: "departmentId", select: "name code status" },
        { path: "designationId", select: "name title code hierarchyLevel allowedParentLevels mappedRole canManagePeople isLeadership status" },
      ],
    });

const mapDepartment = (departmentValue, fallbackName = "") => {
  if (departmentValue && typeof departmentValue === "object") {
    return {
      _id: departmentValue._id,
      name: departmentValue.name || fallbackName || "",
    };
  }

  return departmentValue || fallbackName
    ? {
        _id: departmentValue || null,
        name: fallbackName || "",
      }
    : null;
};

const mapDesignation = (designationValue, fallbackTitle = "") => {
  if (designationValue && typeof designationValue === "object") {
    return {
      _id: designationValue._id,
      title: designationValue.title || designationValue.name || fallbackTitle || "",
      name: designationValue.name || designationValue.title || fallbackTitle || "",
      code: designationValue.code || "",
      hierarchyLevel: designationValue.hierarchyLevel ?? null,
      allowedParentLevels: designationValue.allowedParentLevels || [],
      mappedRole: designationValue.mappedRole || "",
      canManagePeople: Boolean(designationValue.canManagePeople),
      isLeadership: Boolean(designationValue.isLeadership),
    };
  }

  return designationValue || fallbackTitle
    ? {
        _id: designationValue || null,
        title: fallbackTitle || "",
        name: fallbackTitle || "",
        code: "",
        hierarchyLevel: null,
        allowedParentLevels: [],
        mappedRole: "",
        canManagePeople: false,
        isLeadership: false,
      }
    : null;
};

const parseLevelToken = (value) => {
  const match = String(value || "").match(/\bL\s*([1-6])\b/i);
  return match ? Number(match[1]) : 0;
};

const normalizeDesignationLevel = (designation = null) => {
  if (!designation) return 0;

  const directLevel = Number(
    designation.hierarchyLevel ??
    designation.level ??
    designation.rank ??
    designation.order
  );
  if (Number.isInteger(directLevel) && directLevel >= 1 && directLevel <= 6) {
    return directLevel;
  }

  const gradeLevel = parseLevelToken(designation.grade || designation.label || designation.code);
  if (gradeLevel) return gradeLevel;

  return parseLevelToken(
    [
      designation.title,
      designation.name,
      typeof designation === "string" ? designation : "",
    ].join(" ")
  );
};

const formatLevelLabel = (level) => {
  const normalized = Number(level);
  return Number.isInteger(normalized) && normalized >= 1 ? `L${normalized}` : "";
};

const mapBasicUser = (user, directReportCount = 0) => ({
  _id: user._id,
  id: String(user._id),
  userId: String(user._id),
  type: "employee",
  name: user.fullName,
  fullName: user.fullName || "",
  employeeCode: user.employeeId || "",
  workEmail: user.email,
  email: user.email || "",
  phone: user.phone || "",
  role: user.systemRole || user.role || "",
  department: mapDepartment(user.departmentId, user.department),
  designation: mapDesignation(user.designationId, user.designation),
  hierarchyLevel: normalizeDesignationLevel(user.designationId || user.designation),
  employmentType: user.employmentType || "full_time",
  reportingManagerId: toId(user.reportingManagerId),
  childCount: directReportCount,
  level: normalizeDesignationLevel(user.designationId || user.designation),
  levelLabel: formatLevelLabel(normalizeDesignationLevel(user.designationId || user.designation)),
  profileImage: user.avatar || "",
  status: user.status,
  directReportCount,
});

const mapManagerInfo = (manager) => {
  if (!manager) return null;

  return {
    _id: manager._id,
    name: manager.fullName,
    workEmail: manager.email,
    phone: manager.phone || "",
    role: manager.systemRole || manager.role || "",
    designation: mapDesignation(manager.designationId, manager.designation),
    department: mapDepartment(manager.departmentId, manager.department),
    status: manager.status,
  };
};

const getUserDepartmentId = (user) => toId(user?.departmentId);

const isSameDepartment = (first, second) => {
  const firstDepartmentId = getUserDepartmentId(first);
  const secondDepartmentId = getUserDepartmentId(second);
  return Boolean(firstDepartmentId && secondDepartmentId && firstDepartmentId === secondDepartmentId);
};

const getUserLevel = (user) => normalizeDesignationLevel(user?.designationId || user?.designation);

const isDepartmentHeadCandidate = (user) => {
  const role = user?.systemRole || user?.role || "";
  const designation = user?.designationId || {};
  const title = String(designation.title || designation.name || user?.designation || "").toLowerCase();

  return (
    role === "hr_head" ||
    role === "department_head" ||
    designation.isDepartmentHead === true ||
    designation.isHead === true ||
    designation.mappedRole === "hr_head" ||
    designation.canManagePeople === true ||
    designation.isLeadership === true ||
    /\bhead\b/.test(title)
  );
};

const getRoleFallbackRank = (user) => {
  const role = user?.systemRole || user?.role || "";
  const title = String(user?.designationId?.title || user?.designation || "").toLowerCase();

  if (role === "hr_head" || role === "department_head" || title.includes("head")) return 1;
  if (role === "hr_manager" || title.includes("manager")) return 2;
  if (role === "hr_executive" || title.includes("executive")) return 3;
  if (role === "employee" || role === "user") return 4;
  return 5;
};

const sortUsersForTree = (users = []) =>
  [...users].sort((first, second) => {
    const levelRank = getUserLevel(second) - getUserLevel(first);
    if (levelRank) return levelRank;

    const roleRank = getRoleFallbackRank(first) - getRoleFallbackRank(second);
    if (roleRank) return roleRank;

    return String(first.fullName || "").localeCompare(String(second.fullName || ""));
  });

const findNearestHigherLevelUser = (user, candidates = []) => {
  const userLevel = getUserLevel(user);
  const higherUsers = candidates.filter((candidate) => {
    if (String(candidate._id) === String(user._id)) return false;
    if (!isSameDepartment(user, candidate)) return false;

    const candidateLevel = getUserLevel(candidate);
    if (userLevel && candidateLevel) return candidateLevel > userLevel;
    if (!userLevel && candidateLevel) return true;
    return getRoleFallbackRank(candidate) < getRoleFallbackRank(user);
  });

  if (!higherUsers.length) return null;

  return sortUsersForTree(higherUsers).at(-1) || null;
};

const findDepartmentHeadUser = (users = []) => {
  const explicitHeads = users.filter(isDepartmentHeadCandidate);
  if (explicitHeads.length) {
    return {
      user: sortUsersForTree(explicitHeads)[0],
      explicit: true,
    };
  }

  return {
    user: sortUsersForTree(users)[0] || null,
    explicit: false,
  };
};

const buildDepartmentEmployeeTree = (users = []) => {
  const scopedUsers = sortUsersForTree(users);
  const departmentHead = findDepartmentHeadUser(scopedUsers);
  const byId = new Map();
  const childrenByParent = new Map();
  const parentByChild = new Map();

  scopedUsers.forEach((user) => {
    byId.set(String(user._id), user);
  });

  scopedUsers.forEach((user) => {
    const managerId = toId(user.reportingManagerId || user.managerId);
    const manager = managerId ? byId.get(managerId) : null;

    if (
      manager &&
      managerId !== String(user._id) &&
      isSameDepartment(user, manager) &&
      (!getUserLevel(user) || !getUserLevel(manager) || getUserLevel(manager) > getUserLevel(user))
    ) {
      parentByChild.set(String(user._id), managerId);
      return;
    }

    const fallbackParent = findNearestHigherLevelUser(user, scopedUsers);
    if (fallbackParent) {
      parentByChild.set(String(user._id), String(fallbackParent._id));
      return;
    }

    if (
      departmentHead.user &&
      departmentHead.explicit &&
      String(departmentHead.user._id) !== String(user._id)
    ) {
      parentByChild.set(String(user._id), String(departmentHead.user._id));
    }
  });

  parentByChild.forEach((parentId, childId) => {
    const siblings = childrenByParent.get(parentId) || [];
    siblings.push(byId.get(childId));
    childrenByParent.set(parentId, siblings);
  });

  const directReportCounts = new Map();
  parentByChild.forEach((parentId) => {
    directReportCounts.set(parentId, (directReportCounts.get(parentId) || 0) + 1);
  });

  const makeNode = (user, path = new Set()) => {
    const userId = String(user._id);
    if (path.has(userId)) {
      return null;
    }

    const nextPath = new Set(path);
    nextPath.add(userId);

    const children = sortUsersForTree(childrenByParent.get(userId) || [])
      .map((child) => makeNode(child, nextPath))
      .filter(Boolean);

    return {
      ...mapBasicUser(user, directReportCounts.get(userId) || 0),
      reportingManager: mapManagerInfo(user.reportingManagerId || user.managerId),
      children,
    };
  };

  return scopedUsers
    .filter((user) => !parentByChild.has(String(user._id)))
    .map((user) => makeNode(user))
    .filter(Boolean);
};

const buildTreeFromUsers = buildDepartmentEmployeeTree;

const getUserActive = (user) => user && user.status === "active" && !user.deletedAt;

const isCompanyAdminUser = (user) => ["company_admin", "sub_admin"].includes(user?.role);

const isDepartmentHeadUser = (user) => {
  const designation = user?.designationId || {};
  const role = user?.systemRole || user?.role || "";
  const title = String(designation.title || designation.name || user?.designation || "").toLowerCase();

  return (
    designation.isHead === true ||
    designation.isDepartmentHead === true ||
    role === "hr_head" ||
    role === "sales_head" ||
    role === "manager" && /\bhead\b/.test(title) ||
    /\b(head|hod|director|chief|vp)\b/.test(title)
  );
};

const buildDepartmentHeadMap = (users = []) => {
  const grouped = users.filter(getUserActive).reduce((groups, user) => {
    const departmentId = getUserDepartmentId(user);
    if (!departmentId || !isDepartmentHeadUser(user)) return groups;
    const list = groups.get(departmentId) || [];
    list.push(user);
    groups.set(departmentId, list);
    return groups;
  }, new Map());

  const heads = new Map();
  grouped.forEach((departmentHeads, departmentId) => {
    heads.set(departmentId, sortUsersForTree(departmentHeads)[0]);
  });
  return heads;
};

const resolveDeterministicParentId = ({ user, activeUsersById, departmentHeadsByDepartment, companyAdminId }) => {
  const userId = String(user._id);
  const reportingManagerId = toId(user.reportingManagerId);
  const activeReportingManager = reportingManagerId ? activeUsersById.get(reportingManagerId) : null;

  if (activeReportingManager && reportingManagerId !== userId) {
    return reportingManagerId;
  }

  const departmentId = getUserDepartmentId(user);
  const departmentHead = departmentId ? departmentHeadsByDepartment.get(departmentId) : null;
  if (departmentHead && String(departmentHead._id) !== userId) {
    return String(departmentHead._id);
  }

  return companyAdminId && companyAdminId !== userId ? companyAdminId : null;
};

const buildDeterministicEmployeeTree = ({ users = [], rootUser = null }) => {
  const activeUsers = users.filter(getUserActive);
  const activeUsersById = new Map(activeUsers.map((user) => [String(user._id), user]));
  const root = rootUser && getUserActive(rootUser) ? rootUser : activeUsers.find(isCompanyAdminUser) || activeUsers[0] || null;
  const companyAdminId = root ? String(root._id) : null;
  const departmentHeadsByDepartment = buildDepartmentHeadMap(activeUsers);
  const childrenByParent = new Map();
  const parentByChild = new Map();

  activeUsers.forEach((user) => {
    const userId = String(user._id);
    if (userId === companyAdminId) return;

    const parentId = resolveDeterministicParentId({
      user,
      activeUsersById,
      departmentHeadsByDepartment,
      companyAdminId,
    });

    if (!parentId || parentId === userId || !activeUsersById.has(parentId)) return;
    parentByChild.set(userId, parentId);
    const children = childrenByParent.get(parentId) || [];
    children.push(user);
    childrenByParent.set(parentId, children);
  });

  const makeNode = (user, path = new Set()) => {
    if (!user) {
      return null;
    }

    const userId = String(user._id);
    if (path.has(userId)) {
      return null;
    }

    const nextPath = new Set(path);
    nextPath.add(userId);
    const directChildren = sortUsersForTree(childrenByParent.get(userId) || []);
    const managerId = parentByChild.get(userId) || toId(user.reportingManagerId);
    const manager = managerId ? activeUsersById.get(managerId) : null;

    return {
      ...mapBasicUser(user, directChildren.length),
      reportingManagerId: managerId || null,
      reportingManager: mapManagerInfo(manager),
      children: directChildren.map((child) => makeNode(child, nextPath)).filter(Boolean),
    };
  };

  const roots = root
    ? [makeNode(root)].filter(Boolean)
    : sortUsersForTree(activeUsers.filter((user) => !parentByChild.has(String(user._id))))
      .map((user) => makeNode(user))
      .filter(Boolean);

  return {
    tree: roots,
    parentByChild,
    childrenByParent,
    activeUsers,
    activeUsersById,
  };
};

const getDepartmentStats = (users = []) => {
  const activeCount = users.filter((user) => user.status === "active").length;

  return {
    employeeCount: users.length,
    activeCount,
    inactiveCount: users.length - activeCount,
  };
};

const buildDepartmentNode = ({ department, users = [] }) => {
  const departmentId = toId(department);
  const stats = getDepartmentStats(users);

  return {
    id: `department-${departmentId || normalizeTreeId(department?.name || "unassigned")}`,
    _id: departmentId || null,
    type: "department",
    name: department?.name || "Unassigned Department",
    label: department?.name || "Unassigned Department",
    title: department?.name || "Unassigned Department",
    department: department
      ? {
          _id: department._id || departmentId || null,
          name: department.name || "Unassigned Department",
          code: department.code || "",
          status: department.status || "active",
        }
      : {
          _id: null,
          name: "Unassigned Department",
          code: "",
          status: "active",
        },
    status: department?.status || "active",
    role: "department",
    level: null,
    levelLabel: "",
    directReportCount: users.length,
    ...stats,
    children: buildDepartmentEmployeeTree(users),
  };
};

const buildCompanyOrgTree = ({ actorUser, users = [], departments = [] }) => {
  const companyAdminUsers = sortUsersForTree(
    users.filter((user) => ["company_admin", "sub_admin"].includes(user.role))
  );
  const rootUser =
    companyAdminUsers.find((user) => String(user._id) === String(actorUser?._id)) ||
    companyAdminUsers[0] ||
    actorUser;

  return buildDeterministicEmployeeTree({
    users: users.filter((user) => user.role !== "super_admin"),
    rootUser,
  }).tree;
};

const getDesignationSortRank = (designation, fallbackIndex) => {
  const hierarchyLevel = Number(designation?.hierarchyLevel);
  if (Number.isFinite(hierarchyLevel) && hierarchyLevel > 0) {
    return hierarchyLevel;
  }

  const sortOrder = Number(designation?.sortOrder);
  if (Number.isFinite(sortOrder) && sortOrder > 0) {
    return sortOrder;
  }

  return fallbackIndex + 1;
};

const buildDesignationChain = (departmentKey, designations = []) => {
  const designationNodes = designations
    .map((designation, index) => ({
      ...designation,
      originalIndex: index,
      sortRank: getDesignationSortRank(designation, index),
    }))
    .sort((first, second) => {
      if (first.sortRank !== second.sortRank) {
        return first.sortRank - second.sortRank;
      }

      const firstSortOrder = Number(first.sortOrder || 0);
      const secondSortOrder = Number(second.sortOrder || 0);
      if (firstSortOrder !== secondSortOrder) {
        return firstSortOrder - secondSortOrder;
      }

      return first.originalIndex - second.originalIndex;
    })
    .map((designation) => ({
      id: `desig-${normalizeTreeId(departmentKey)}-${normalizeTreeId(
        designation.key || designation.slug || designation.title || designation.name
      )}`,
      type: "designation",
      label: designation.title || designation.name,
      title: designation.title || designation.name,
      meta: {
        departmentKey,
        hierarchyLevel: designation.hierarchyLevel ?? null,
        levelLabel: formatLevelLabel(designation.hierarchyLevel),
        source: "default",
        code: designation.code || "",
        slug: designation.slug || "",
        sortOrder: designation.sortOrder || null,
        description: designation.description || "",
      },
      children: [],
    }));

  const designationsByLevel = designationNodes.reduce((groups, designation) => {
    const level = Number(designation.meta.hierarchyLevel || 1);
    const normalizedLevel = Number.isInteger(level) && level >= 1 && level <= 6 ? level : 1;
    const current = groups.get(normalizedLevel) || [];
    current.push(designation);
    groups.set(normalizedLevel, current);
    return groups;
  }, new Map());

  return [6, 5, 4, 3, 2, 1]
    .filter((level) => designationsByLevel.has(level))
    .map((level) => ({
      id: `level-${normalizeTreeId(departmentKey)}-${formatLevelLabel(level).toLowerCase()}`,
      type: "level",
      label: formatLevelLabel(level),
      title: formatLevelLabel(level),
      meta: {
        departmentKey,
        hierarchyLevel: level,
        levelLabel: formatLevelLabel(level),
        source: "default",
        designationCount: designationsByLevel.get(level).length,
      },
      children: designationsByLevel.get(level),
    }));
};

const buildDefaultOrgTree = () => {
  let designationCount = 0;

  const departmentNodes = DEFAULT_DEPARTMENTS.map((department) => {
    const departmentKey = normalizeTreeId(department.key || department.slug || department.name);
    const designations = getDefaultDesignationSeedsForDepartment(department);
    designationCount += designations.length;

    return {
      id: `dept-${departmentKey}`,
      type: "department",
      label: department.name,
      title: department.name,
      meta: {
        source: "default",
        departmentKey,
        normalizedName: department.normalizedName,
        code: department.code || "",
        slug: department.slug || departmentKey,
        description: department.description || "",
        designationCount: designations.length,
      },
      children: buildDesignationChain(departmentKey, designations),
    };
  });

  return {
    treeType: "default",
    root: {
      id: "default-root",
      type: "root",
      label: "CEO/Head",
      title: "CEO/Head",
      meta: {
        source: "default",
        description: "Default organization structure reference",
      },
      children: [
        {
          id: "default-all-departments",
          type: "group",
          label: "All Departments",
          title: "All Departments",
          meta: {
            source: "default",
            departmentCount: DEFAULT_DEPARTMENTS.length,
            designationCount,
          },
          children: departmentNodes,
        },
      ],
    },
    stats: {
      departmentCount: DEFAULT_DEPARTMENTS.length,
      designationCount,
    },
  };
};

const getCompanyUsers = async ({ companyId, extra = {}, activeOnly = true }) =>
  populateOrgRefs(User.find(userQuery({ companyId, extra, activeOnly })).sort({ fullName: 1 }));

const assertSameCompany = (actorUser, companyId) => {
  if (getSystemRole(actorUser) === "super_admin") return;
  if (String(actorUser.companyId) !== String(companyId)) {
    throw new ApiError(403, "Access denied for this company.");
  }
};

const assertCompanyTreeAccess = (actorUser) => {
  const role = getSystemRole(actorUser);
  const allowedScopedSubAdmin = role === "sub_admin" && hasCompanyScope(actorUser);

  if (!canViewFullCompanyTree(actorUser) && !allowedScopedSubAdmin) {
    throw new ApiError(403, "You do not have permission to view the full organization tree.");
  }
};

const assertOrgTreeExportAccess = (actorUser) => {
  const role = getSystemRole(actorUser);
  if (!["company_admin", "sub_admin", "hr_head"].includes(role)) {
    throw new ApiError(403, "You do not have permission to export organization tree data.");
  }
};

const canViewDepartmentTree = (actorUser, departmentId) => {
  if (getSystemRole(actorUser) === "hr_head") {
    return String(toId(actorUser.departmentId) || "") === String(departmentId);
  }
  if (canViewFullCompanyTree(actorUser) || hasCompanyScope(actorUser)) return true;
  return hasDepartmentScope(actorUser) && String(actorUser.departmentId || "") === String(departmentId);
};

const isTargetCoveredByActorScope = async ({ actorUser, targetUser, companyId }) => {
  if (String(actorUser._id) === String(targetUser._id)) return true;
  if (canViewFullCompanyTree(actorUser) || hasCompanyScope(actorUser)) return true;

  if (
    hasDepartmentScope(actorUser) &&
    actorUser.departmentId &&
    targetUser.departmentId &&
    String(actorUser.departmentId) === String(targetUser.departmentId)
  ) {
    return true;
  }

  if (hasTeamScope(actorUser)) {
    const downlineIds = await getDownlineEmployeeIds({
      companyId,
      employeeId: actorUser._id,
    });
    return downlineIds.some((id) => String(id) === String(targetUser._id));
  }

  return false;
};

const canViewUserNode = isTargetCoveredByActorScope;

const canViewDownline = async ({ actorUser, targetUser, companyId }) => {
  if (String(actorUser._id) === String(targetUser._id)) return true;
  return isTargetCoveredByActorScope({ actorUser, targetUser, companyId });
};

const getMeOrgTree = async ({ actorUser }) => {
  const companyId = resolveCompanyId(actorUser);
  const [currentUser] = await populateOrgRefs(
    User.find({
      _id: actorUser._id,
      companyId,
      deletedAt: null,
      status: "active",
    })
  );

  if (!currentUser) {
    throw new ApiError(404, "Current user not found.");
  }

  const directReports = await getCompanyUsers({
    companyId,
    extra: {
      $or: [
        { reportingManagerId: currentUser._id },
        { managerId: currentUser._id },
      ],
    },
  });

  let downlineTree = directReports.map((user) => ({
    ...mapBasicUser(user),
    reportingManager: mapManagerInfo(user.reportingManagerId || user.managerId),
    children: [],
  }));

  if (hasTeamScope(actorUser) || canViewFullCompanyTree(actorUser)) {
    const downlineIds = await getDownlineEmployeeIds({
      companyId,
      employeeId: currentUser._id,
    });

    if (downlineIds.length) {
      const downlineUsers = await getCompanyUsers({
        companyId,
        extra: { _id: { $in: downlineIds } },
      });
      downlineTree = buildTreeFromUsers(downlineUsers);
    }
  }

  return {
    profile: {
      ...mapBasicUser(currentUser, directReports.length),
      reportingManager: mapManagerInfo(currentUser.reportingManagerId || currentUser.managerId),
    },
    reportingManager: mapManagerInfo(currentUser.reportingManagerId || currentUser.managerId),
    downlineTree,
  };
};

const getCompanyOrgTree = async ({ actorUser, companyId: requestedCompanyId = null }) => {
  const companyId = resolveCompanyId(actorUser, requestedCompanyId);
  assertSameCompany(actorUser, companyId);
  assertCompanyTreeAccess(actorUser);

  const cached = getCachedOrgTree(companyId);
  if (cached) {
    return cached;
  }

  const [users, departments] = await Promise.all([
    getCompanyUsers({ companyId, activeOnly: false }),
    Department.find({
      companyId,
      deletedAt: null,
      status: "active",
    }).select("name code status").sort({ name: 1 }),
  ]);

  const result = {
    companyId,
    count: users.filter((user) => !["super_admin", "company_admin", "sub_admin"].includes(user.role)).length,
    tree: buildCompanyOrgTree({ actorUser, users, departments }),
  };

  setCachedOrgTree(companyId, result);
  return result;
};

const getCompanyOrgTreeExport = async ({ actorUser, companyId: requestedCompanyId = null }) => {
  const companyId = resolveCompanyId(actorUser, requestedCompanyId);
  assertSameCompany(actorUser, companyId);
  assertOrgTreeExportAccess(actorUser);

  const [users] = await Promise.all([
    getCompanyUsers({ companyId, activeOnly: true }),
  ]);
  const rootUser = sortUsersForTree(users.filter(isCompanyAdminUser))[0] || actorUser;
  const { activeUsers, activeUsersById, parentByChild, childrenByParent } = buildDeterministicEmployeeTree({
    users: users.filter((user) => user.role !== "super_admin"),
    rootUser,
  });

  return sortUsersForTree(activeUsers).map((user) => {
    const userId = String(user._id);
    const reportingManagerId = parentByChild.get(userId) || toId(user.reportingManagerId);
    const manager = reportingManagerId ? activeUsersById.get(reportingManagerId) : null;

    return {
      userId,
      fullName: user.fullName || "",
      email: user.email || "",
      designation: mapDesignation(user.designationId, user.designation)?.title || "",
      department: mapDepartment(user.departmentId, user.department)?.name || "",
      hierarchyLevel: normalizeDesignationLevel(user.designationId || user.designation),
      reportingManagerName: manager?.fullName || "",
      reportingManagerId: reportingManagerId || null,
      directReports: (childrenByParent.get(userId) || []).length,
    };
  });
};

const getOrgTreeGaps = async ({ actorUser, companyId: requestedCompanyId = null }) => {
  const companyId = resolveCompanyId(actorUser, requestedCompanyId);
  assertSameCompany(actorUser, companyId);
  assertOrgTreeExportAccess(actorUser);

  const [users, departments, designations] = await Promise.all([
    getCompanyUsers({ companyId, activeOnly: true }),
    Department.find({
      companyId,
      deletedAt: null,
      status: "active",
    }).select("_id name headDesignationId"),
    Designation.find({
      companyId,
      deletedAt: null,
      status: "active",
      isArchived: { $ne: true },
    }).select("_id departmentId title name hierarchyLevel allowedParentLevels allowedParentDesignations isHead isDepartmentHead"),
  ]);

  const activeUsersById = new Map(users.map((user) => [String(user._id), user]));
  const departmentHeadsByDepartment = buildDepartmentHeadMap(users);
  const noManager = [];

  users.forEach((user) => {
    if (isCompanyAdminUser(user)) return;
    const managerId = toId(user.reportingManagerId);
    if (managerId && activeUsersById.has(managerId)) return;
    const departmentId = getUserDepartmentId(user);
    if (departmentId && departmentHeadsByDepartment.has(departmentId)) return;
    noManager.push(String(user._id));
  });

  const designationById = new Map(designations.map((designation) => [String(designation._id), designation]));
  const noDeptHead = departments
    .filter((department) => {
      if (department.headDesignationId && designationById.has(String(department.headDesignationId))) {
        return false;
      }
      return !designations.some((designation) =>
        String(designation.departmentId || "") === String(department._id) &&
        (designation.isHead === true || designation.isDepartmentHead === true)
      );
    })
    .map((department) => String(department._id));

  const hierarchyGaps = [];
  designations.forEach((designation) => {
    const level = Number(designation.hierarchyLevel || 0);
    const allowedParentLevels = designation.allowedParentLevels || [];
    const allowedParentDesignations = designation.allowedParentDesignations || [];

    if (level > 1 && !allowedParentLevels.length && !allowedParentDesignations.length) {
      hierarchyGaps.push({
        designationId: String(designation._id),
        departmentId: String(designation.departmentId || ""),
        hierarchyLevel: level,
        issue: "Missing explicit parent designation or parent level rule.",
      });
      return;
    }

    if (allowedParentLevels.some((parentLevel) => Number(parentLevel) <= level)) {
      hierarchyGaps.push({
        designationId: String(designation._id),
        departmentId: String(designation.departmentId || ""),
        hierarchyLevel: level,
        allowedParentLevels,
        issue: "Parent hierarchy level must be higher than child hierarchy level.",
      });
    }
  });

  return {
    noManager,
    noDeptHead,
    hierarchyGaps,
  };
};

const getDepartmentOrgTree = async ({ actorUser, departmentId }) => {
  if (!departmentId || !isValidObjectId(departmentId)) {
    throw new ApiError(400, "Department id must be a valid ObjectId.");
  }

  const companyId = resolveCompanyId(actorUser);
  if (!canViewDepartmentTree(actorUser, departmentId)) {
    throw new ApiError(403, "You do not have permission to view this department tree.");
  }

  const department = await Department.findOne({
    _id: departmentId,
    companyId,
    deletedAt: null,
  }).select("name code status");

  if (!department) {
    throw new ApiError(404, "Department not found.");
  }

  const users = await getCompanyUsers({
    companyId,
    extra: { departmentId },
  });

  return {
    department: {
      _id: department._id,
      name: department.name,
      code: department.code || "",
      status: department.status,
    },
    count: users.length,
    tree: buildDepartmentEmployeeTree(users),
  };
};

const getUserDownlineTree = async ({ actorUser, userId }) => {
  if (!userId || !isValidObjectId(userId)) {
    throw new ApiError(400, "User id must be a valid ObjectId.");
  }

  const companyId = resolveCompanyId(actorUser);
  const [targetUser] = await populateOrgRefs(
    User.find({
      _id: userId,
      companyId,
      deletedAt: null,
      status: "active",
    })
  );

  if (!targetUser) {
    throw new ApiError(404, "User not found.");
  }

  const canViewTarget = await isTargetCoveredByActorScope({
    actorUser,
    targetUser,
    companyId,
  });

  if (!canViewTarget) {
    throw new ApiError(403, "You do not have permission to view this user's downline.");
  }

  const targetIsSelf = String(actorUser._id) === String(targetUser._id);
  const includeIndirect =
    !targetIsSelf || hasTeamScope(actorUser) || canViewFullCompanyTree(actorUser);

  if (!includeIndirect) {
    const directReports = await getCompanyUsers({
      companyId,
      extra: {
        $or: [
          { reportingManagerId: targetUser._id },
          { managerId: targetUser._id },
        ],
      },
    });

    return {
      user: {
        ...mapBasicUser(targetUser, directReports.length),
        reportingManager: targetIsSelf
          ? mapManagerInfo(targetUser.reportingManagerId || targetUser.managerId)
          : null,
      },
      count: directReports.length,
      tree: directReports.map((user) => ({
        ...mapBasicUser(user),
        reportingManager: mapManagerInfo(user.reportingManagerId || user.managerId),
        children: [],
      })),
    };
  }

  const downlineIds = await getDownlineEmployeeIds({
    companyId,
    employeeId: targetUser._id,
  });
  const downlineUsers = downlineIds.length
    ? await getCompanyUsers({
        companyId,
        extra: { _id: { $in: downlineIds } },
      })
    : [];

  return {
    user: {
      ...mapBasicUser(targetUser, downlineUsers.filter((user) => String(toId(user.reportingManagerId || user.managerId)) === String(targetUser._id)).length),
      reportingManager: targetIsSelf || canViewFullCompanyTree(actorUser)
        ? mapManagerInfo(targetUser.reportingManagerId || targetUser.managerId)
        : null,
    },
    count: downlineUsers.length,
    tree: buildTreeFromUsers(downlineUsers),
  };
};

const getAllowedManagers = async ({
  actorUser,
  departmentId,
  designationId,
  excludeUserId = null,
  includeCrossDepartment = false,
}) => {
  const companyId = resolveCompanyId(actorUser);

  return getAllowedManagersForEmployee({
    companyId,
    departmentId,
    designationId,
    excludeUserId,
    actorUser,
    includeCrossDepartment,
  });
};

module.exports = {
  buildDefaultOrgTree,
  normalizeTreeId,
  buildDesignationChain,
  getMeOrgTree,
  getCompanyOrgTree,
  getCompanyOrgTreeExport,
  getOrgTreeGaps,
  getDepartmentOrgTree,
  getUserDownlineTree,
  getAllowedManagers,
  canViewFullCompanyTree,
  canViewUserNode,
  canViewDownline,
  invalidateOrgTreeCache,
};
