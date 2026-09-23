const Department = require("../models/Department");
const Designation = require("../models/Designation");
const User = require("../models/User");
const ApiError = require("../utils/ApiError");
const { normalizeCode, normalizeName, slugify } = require("../utils/normalize");
const { canManageDesignations } = require("./permission.service");
const { getCompanyIdOrThrow } = require("./tenant.service");
const {
  SALES_DEPARTMENT_IDENTIFIERS,
  SALES_HIERARCHY,
  identifySalesDesignation,
} = require("../constants/salesHierarchy");

const toId = (value) => String(value?._id || value || "");
const getTitle = (designation) => designation?.title || designation?.name || "";
const getLevel = (designation) => Number(designation?.hierarchyLevel || 0);
const isActiveRecord = (record) =>
  record?.deletedAt == null && record?.status === "active" && record?.isArchived !== true;

const getCompanyId = (user) => {
  if (!user || !canManageDesignations(user)) {
    throw new ApiError(403, "Access denied");
  }
  const company = getCompanyIdOrThrow(user);
  return company?._id || company;
};

const findSalesDepartment = async ({ companyId, DepartmentModel }) =>
  DepartmentModel.findOne({
    companyId,
    deletedAt: null,
    $or: [
      { normalizedName: SALES_DEPARTMENT_IDENTIFIERS.normalizedName },
      { slug: SALES_DEPARTMENT_IDENTIFIERS.slug },
      { code: SALES_DEPARTMENT_IDENTIFIERS.code },
    ],
  });

const findCanonicalMatches = ({ definition, designations }) => {
  const code = normalizeCode(definition.code);
  const title = normalizeName(definition.primaryTitle);
  const matches = designations.filter((designation) =>
    normalizeCode(designation.code) === code ||
    normalizeName(getTitle(designation)) === title
  );

  if (definition.level === 6) {
    const headMatches = designations.filter((designation) =>
      designation.isHead === true || designation.isDepartmentHead === true
    );
    headMatches.forEach((designation) => {
      if (!matches.some((candidate) => toId(candidate) === toId(designation))) {
        matches.push(designation);
      }
    });
  }

  return matches;
};

const buildHolderMaps = ({ users, designations }) => {
  const designationById = new Map(designations.map((item) => [toId(item), item]));
  const userById = new Map(users.map((item) => [toId(item), item]));
  const holdersByDesignation = new Map();
  const directReportsByManager = new Map();

  users.forEach((user) => {
    const designationId = toId(user.designationId);
    if (designationId) {
      const holders = holdersByDesignation.get(designationId) || [];
      holders.push(user);
      holdersByDesignation.set(designationId, holders);
    }

    const managerId = toId(user.reportingManagerId || user.managerId);
    if (managerId) {
      const reports = directReportsByManager.get(managerId) || [];
      reports.push(user);
      directReportsByManager.set(managerId, reports);
    }
  });

  return {
    designationById,
    userById,
    holdersByDesignation,
    directReportsByManager,
  };
};

const inspectLevelChange = ({
  designation,
  targetLevel,
  holderMaps,
}) => {
  if (!designation || getLevel(designation) === Number(targetLevel)) return [];

  const designationId = toId(designation);
  const holders = holderMaps.holdersByDesignation.get(designationId) || [];
  const conflicts = [];

  holders.forEach((holder) => {
    const managerId = toId(holder.reportingManagerId || holder.managerId);
    const manager = managerId ? holderMaps.userById.get(managerId) : null;
    const managerDesignation = manager
      ? holderMaps.designationById.get(toId(manager.designationId))
      : null;
    const managerLevel = getLevel(managerDesignation);

    if (manager && managerLevel && managerLevel <= Number(targetLevel)) {
      conflicts.push({
        type: "MANAGER_NOT_HIGHER_AFTER_CHANGE",
        designationId,
        employeeId: toId(holder),
        employeeName: holder.fullName || holder.email || "",
        reportingManagerId: managerId,
        reportingManagerName: manager.fullName || manager.email || "",
        currentLevel: getLevel(designation),
        targetLevel: Number(targetLevel),
        managerLevel,
      });
    }

    const directReports = holderMaps.directReportsByManager.get(toId(holder)) || [];
    directReports.forEach((report) => {
      const reportDesignation = holderMaps.designationById.get(toId(report.designationId));
      const reportLevel = getLevel(reportDesignation);
      if (reportLevel && Number(targetLevel) <= reportLevel) {
        conflicts.push({
          type: "DIRECT_REPORT_NOT_LOWER_AFTER_CHANGE",
          designationId,
          employeeId: toId(holder),
          employeeName: holder.fullName || holder.email || "",
          directReportId: toId(report),
          directReportName: report.fullName || report.email || "",
          currentLevel: getLevel(designation),
          targetLevel: Number(targetLevel),
          directReportLevel: reportLevel,
        });
      }
    });
  });

  return conflicts;
};

const getDesignationFlags = ({ designation, definition, reportingConflicts }) => {
  const flags = [];
  if (!isActiveRecord(designation)) flags.push("INACTIVE");
  if (getLevel(designation) !== definition.level) flags.push("WRONG_LEVEL");
  if (designation.mappedRole !== definition.technicalRole) flags.push("WRONG_ROLE_MAPPING");
  if (normalizeCode(designation.code) !== normalizeCode(definition.code)) flags.push("WRONG_CODE");
  if (
    definition.level === 6 &&
    (designation.isHead !== true || designation.isDepartmentHead !== true)
  ) {
    flags.push("WRONG_HEAD_METADATA");
  }
  if (reportingConflicts.length) {
    flags.push("ACTIVE_HOLDER_CONFLICT", "REPORTING_CONFLICT");
  }
  return flags;
};

const previewSalesHierarchy = async ({
  user,
  DepartmentModel = Department,
  DesignationModel = Designation,
  UserModel = User,
} = {}) => {
  const companyId = getCompanyId(user);
  const department = await findSalesDepartment({ companyId, DepartmentModel });

  if (!department) {
    throw new ApiError(404, "Sales Department not found");
  }

  const designations = await DesignationModel.find({
    companyId,
    departmentId: department._id,
    deletedAt: null,
  });
  const users = await UserModel.find({
    companyId,
    departmentId: department._id,
    status: "active",
    deletedAt: null,
    designationId: { $ne: null },
  });
  const holderMaps = buildHolderMaps({ users, designations });
  const duplicateHeadCandidates = designations.filter((designation) =>
    designation.isHead === true || designation.isDepartmentHead === true
  );
  const relationshipConflicts = [];

  const hierarchy = SALES_HIERARCHY.map((definition) => {
    const matches = findCanonicalMatches({ definition, designations });
    if (!matches.length) {
      return {
        level: definition.level,
        primaryTitle: definition.primaryTitle,
        alternativeTitles: definition.alternativeTitles,
        technicalRole: definition.technicalRole,
        code: definition.code,
        status: "MISSING",
        flags: ["MISSING"],
        designation: null,
        holderCount: 0,
        reportingConflicts: [],
      };
    }

    if (matches.length > 1 || (definition.level === 6 && duplicateHeadCandidates.length > 1)) {
      return {
        level: definition.level,
        primaryTitle: definition.primaryTitle,
        alternativeTitles: definition.alternativeTitles,
        technicalRole: definition.technicalRole,
        code: definition.code,
        status: definition.level === 6 ? "DUPLICATE_HEAD_RISK" : "AMBIGUOUS",
        flags: [definition.level === 6 ? "DUPLICATE_HEAD_RISK" : "AMBIGUOUS"],
        designation: null,
        matches: matches.map((item) => ({
          id: item._id,
          title: getTitle(item),
          code: item.code || "",
          hierarchyLevel: getLevel(item),
        })),
        holderCount: matches.reduce(
          (count, item) => count + (holderMaps.holdersByDesignation.get(toId(item)) || []).length,
          0
        ),
        reportingConflicts: [],
      };
    }

    const designation = matches[0];
    const reportingConflicts = inspectLevelChange({
      designation,
      targetLevel: definition.level,
      holderMaps,
    });
    relationshipConflicts.push(...reportingConflicts);
    const flags = getDesignationFlags({ designation, definition, reportingConflicts });
    const holders = holderMaps.holdersByDesignation.get(toId(designation)) || [];
    const roleConflicts = holders
      .filter((holder) => {
        const roles = new Set([holder.role, holder.systemRole].filter(Boolean));
        return roles.size > 0 && !roles.has(definition.technicalRole);
      })
      .map((holder) => ({
        userId: holder._id,
        fullName: holder.fullName || "",
        currentRole: holder.role || "",
        currentSystemRole: holder.systemRole || "",
        targetRole: definition.technicalRole,
      }));

    return {
      level: definition.level,
      primaryTitle: definition.primaryTitle,
      alternativeTitles: definition.alternativeTitles,
      technicalRole: definition.technicalRole,
      code: definition.code,
      status: flags.includes("REPORTING_CONFLICT")
        ? "REPORTING_CONFLICT"
        : flags[0] || "CORRECT",
      flags: flags.length ? flags : ["CORRECT"],
      designation: {
        id: designation._id,
        _id: designation._id,
        title: getTitle(designation),
        code: designation.code || "",
        hierarchyLevel: getLevel(designation),
        mappedRole: designation.mappedRole || "",
        status: designation.status,
        isActive: isActiveRecord(designation),
        isHead: designation.isHead === true,
        isDepartmentHead: designation.isDepartmentHead === true,
      },
      holderCount: holders.length,
      roleConflicts,
      reportingConflicts,
    };
  });

  const existingDesignations = designations.map((designation) => {
    const identity = identifySalesDesignation(designation);
    const holders = holderMaps.holdersByDesignation.get(toId(designation)) || [];
    if (!identity.definition) {
      return {
        id: designation._id,
        title: getTitle(designation),
        code: designation.code || "",
        currentLevel: getLevel(designation),
        targetLevel: null,
        technicalRole: designation.mappedRole || "",
        holderCount: holders.length,
        classification: "LEGACY_EXTRA",
        action: "RETAIN_UNCHANGED",
      };
    }

    const reportingConflicts = inspectLevelChange({
      designation,
      targetLevel: identity.definition.level,
      holderMaps,
    });
    return {
      id: designation._id,
      title: getTitle(designation),
      code: designation.code || "",
      currentLevel: getLevel(designation),
      targetLevel: identity.definition.level,
      technicalRole: identity.definition.technicalRole,
      holderCount: holders.length,
      isActive: isActiveRecord(designation),
      classification: identity.ambiguous
        ? "AMBIGUOUS_EXISTING_DESIGNATION"
        : identity.definition.isPrimary
          ? "CANONICAL_PRIMARY"
          : "APPROVED_ALTERNATIVE",
      matchedBy: identity.matchedBy,
      reportingConflicts,
      action: identity.ambiguous || reportingConflicts.length
        ? "REVIEW_REQUIRED"
        : "SAFE_TO_STANDARDIZE",
    };
  });

  const missing = hierarchy.filter((item) => item.status === "MISSING").length;
  const ambiguous = existingDesignations.filter(
    (item) => item.classification === "AMBIGUOUS_EXISTING_DESIGNATION"
  ).length;
  const legacyExtra = existingDesignations.filter(
    (item) => item.classification === "LEGACY_EXTRA"
  ).length;

  return {
    companyId,
    department: {
      id: department._id,
      _id: department._id,
      name: department.name,
      code: department.code || "",
      status: department.status,
      isArchived: department.isArchived === true,
    },
    hierarchy,
    existingDesignations,
    relationshipConflicts,
    summary: {
      canonicalLevels: SALES_HIERARCHY.length,
      correct: hierarchy.filter((item) => item.status === "CORRECT").length,
      missing,
      requiresChange: hierarchy.filter((item) => !["CORRECT", "MISSING"].includes(item.status)).length,
      ambiguous,
      legacyExtra,
      reportingConflicts: relationshipConflicts.length,
      activeEmployees: users.length,
      writesPerformed: 0,
    },
  };
};

const applyDefinitionToDesignation = async ({ designation, definition, actorId }) => {
  designation.code = definition.code;
  designation.hierarchyLevel = definition.level;
  designation.mappedRole = definition.technicalRole;
  designation.allowedRoles = [definition.technicalRole];
  designation.canManagePeople = ["sales_head", "sales_manager"].includes(definition.technicalRole);
  designation.isLeadership = ["sales_head", "sales_manager"].includes(definition.technicalRole);
  if (definition.level === 6) {
    designation.isHead = true;
    designation.isDepartmentHead = true;
  }
  designation.updatedBy = actorId;
  designation.lastModifiedBy = actorId;
  await designation.save({ validateModifiedOnly: true });
};

const createCanonicalDesignation = async ({
  companyId,
  department,
  definition,
  actorId,
  DesignationModel,
}) => DesignationModel.create({
  companyId,
  departmentId: department._id,
  name: definition.primaryTitle,
  title: definition.primaryTitle,
  normalizedName: normalizeName(definition.primaryTitle),
  normalizedTitle: normalizeName(definition.primaryTitle),
  slug: slugify(definition.primaryTitle),
  code: definition.code,
  description: "",
  mappedRole: definition.technicalRole,
  allowedRoles: [definition.technicalRole],
  hierarchyLevel: definition.level,
  allowedParentLevels: [],
  canManagePeople: ["sales_head", "sales_manager"].includes(definition.technicalRole),
  isLeadership: ["sales_head", "sales_manager"].includes(definition.technicalRole),
  isDepartmentHead: definition.level === 6,
  isHead: definition.level === 6,
  status: "active",
  source: "default",
  isDefaultSeed: true,
  isActive: true,
  isArchived: false,
  createdBy: actorId,
  updatedBy: actorId,
  lastModifiedBy: actorId,
});

const applySalesHierarchy = async ({
  user,
  DepartmentModel = Department,
  DesignationModel = Designation,
  UserModel = User,
} = {}) => {
  const preview = await previewSalesHierarchy({
    user,
    DepartmentModel,
    DesignationModel,
    UserModel,
  });

  if (preview.department.status !== "active" || preview.department.isArchived) {
    throw new ApiError(400, "Sales Department must be active before applying its hierarchy");
  }

  const companyId = preview.companyId;
  const department = await findSalesDepartment({ companyId, DepartmentModel });
  const designations = await DesignationModel.find({
    companyId,
    departmentId: department._id,
    deletedAt: null,
  });
  const designationById = new Map(designations.map((item) => [toId(item), item]));
  const created = [];
  const updated = [];
  const skipped = [];
  const processed = new Set();
  const refreshPreview = () => previewSalesHierarchy({
    user,
    DepartmentModel,
    DesignationModel,
    UserModel,
  });

  // Approved corrections lower legacy tiers. Processing L1 upward means a
  // manager-level correction is evaluated after its canonical direct reports,
  // so a single apply converges without ever rewriting reporting relationships.
  for (const initialRow of [...preview.hierarchy].sort((first, second) => first.level - second.level)) {
    let row = initialRow;
    const definition = SALES_HIERARCHY.find((item) => item.level === row.level);
    if (row.status === "MISSING") {
      try {
        const designation = await createCanonicalDesignation({
          companyId,
          department,
          definition,
          actorId: user._id,
          DesignationModel,
        });
        created.push({ id: designation._id, title: getTitle(designation), level: definition.level });
      } catch (error) {
        if (error?.code !== 11000) throw error;
        skipped.push({
          title: definition.primaryTitle,
          level: definition.level,
          reason: "CONCURRENT_DUPLICATE_DETECTED",
        });
      }
      continue;
    }

    const currentPreview = await refreshPreview();
    row = currentPreview.hierarchy.find((item) => item.level === definition.level) || row;

    if (!row.designation) {
      skipped.push({
        title: definition.primaryTitle,
        level: definition.level,
        reason: row.status,
      });
      continue;
    }

    const designation = designationById.get(toId(row.designation.id));
    processed.add(toId(row.designation.id));
    if (!designation || !row.designation.isActive || row.reportingConflicts?.length) {
      skipped.push({
        id: row.designation.id,
        title: row.designation.title,
        level: definition.level,
        reason: row.reportingConflicts?.length
          ? "REPORTING_CONFLICT"
          : !row.designation.isActive
            ? "INACTIVE"
            : "DESIGNATION_NOT_FOUND",
      });
      continue;
    }

    if (row.status !== "CORRECT") {
      await applyDefinitionToDesignation({ designation, definition, actorId: user._id });
      updated.push({
        id: designation._id,
        title: getTitle(designation),
        oldLevel: row.designation.hierarchyLevel,
        level: definition.level,
      });
    }
  }

  for (const initialRow of [...preview.existingDesignations].sort(
    (first, second) => Number(first.targetLevel || 99) - Number(second.targetLevel || 99)
  )) {
    let row = initialRow;
    if (processed.has(toId(row.id)) || row.classification === "LEGACY_EXTRA") continue;
    const designation = designationById.get(toId(row.id));
    const identity = identifySalesDesignation(designation);

    // Primary definitions are handled exclusively by the hierarchy loop above.
    // This prevents duplicate/ambiguous primary matches (especially HODs) from
    // being standardized independently after the preview deliberately blocked them.
    if (identity.definition?.isPrimary) continue;

    const currentPreview = await refreshPreview();
    row = currentPreview.existingDesignations.find((item) => toId(item.id) === toId(initialRow.id)) || row;

    if (!designation || !row.isActive || !identity.definition || identity.ambiguous || row.reportingConflicts?.length) {
      skipped.push({
        id: row.id,
        title: row.title,
        level: row.targetLevel,
        reason: identity.ambiguous
          ? "AMBIGUOUS_EXISTING_DESIGNATION"
          : !row.isActive
            ? "INACTIVE"
          : row.reportingConflicts?.length
            ? "REPORTING_CONFLICT"
            : "REVIEW_REQUIRED",
      });
      continue;
    }

    const definition = identity.definition;
    const alreadyCorrect =
      getLevel(designation) === definition.level &&
      designation.mappedRole === definition.technicalRole &&
      normalizeCode(designation.code) === normalizeCode(definition.code);
    if (!alreadyCorrect) {
      await applyDefinitionToDesignation({ designation, definition, actorId: user._id });
      updated.push({
        id: designation._id,
        title: getTitle(designation),
        oldLevel: row.currentLevel,
        level: definition.level,
      });
    }
  }

  const after = await previewSalesHierarchy({
    user,
    DepartmentModel,
    DesignationModel,
    UserModel,
  });

  return {
    changed: created.length > 0 || updated.length > 0,
    created,
    updated,
    skipped,
    preview: after,
  };
};

module.exports = {
  previewSalesHierarchy,
  applySalesHierarchy,
  inspectLevelChange,
};
