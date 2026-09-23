const SalesGeography = require("../models/SalesGeography");
const ApiError = require("../utils/ApiError");
const { normalizeName, normalizeCode } = require("../utils/normalize");
const { getAccessRole } = require("../utils/roleAccess");
const { getCompanyIdOrThrow } = require("./tenant.service");
const { writeAuditLog } = require("./auditLog.service");
const INDIA_STATE_DISTRICTS = require("../data/indiaStateDistricts.json");
const {
  SALES_GEOGRAPHY_TYPES,
  SALES_GEOGRAPHY_PARENT_TYPE,
  SALES_GEOGRAPHY_CHILD_TYPE,
  SALES_GEOGRAPHY_MANAGE_ROLES,
  normalizeGeographyType,
  getGeographyAuditAction,
} = require("../constants/salesGeography");

const toId = (value) => String(value?._id || value || "");
const isDuplicateKeyError = (error) => error?.code === 11000;

const assertCanManageSalesGeography = (user) => {
  const role = getAccessRole(user);
  if (!user || !SALES_GEOGRAPHY_MANAGE_ROLES.includes(role)) {
    throw new ApiError(403, "Only Head of Sales or platform administrators can manage Sales Geography");
  }
  const company = getCompanyIdOrThrow(user);
  return company?._id || company;
};

const mapGeography = (record) => ({
  id: record._id,
  _id: record._id,
  companyId: record.companyId,
  type: record.type,
  name: record.name,
  code: record.code,
  parentId: record.parentId || null,
  stateNames: Array.from(record.stateNames || []).map(String),
  stateName: record.stateName || "",
  districtName: record.districtName || "",
  description: record.description || "",
  status: record.status,
  isActive: record.isActive !== false && record.status === "active",
  isArchived: record.isArchived === true,
  createdBy: record.createdBy,
  updatedBy: record.updatedBy,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const writeGeographyAudit = async ({
  geography,
  event,
  actor,
  companyId,
  metadata = {},
  req = null,
  auditFn = writeAuditLog,
}) => auditFn({
  companyId,
  actorId: actor._id,
  action: getGeographyAuditAction(geography.type, event),
  entityType: "SalesGeography",
  entityId: geography._id,
  metadata: {
    type: geography.type,
    name: geography.name,
    code: geography.code,
    parentId: geography.parentId || null,
    ...metadata,
  },
  req,
});

const findScopedGeography = async ({ id, companyId, GeographyModel, activeOnly = false }) => {
  const query = { _id: id, companyId, deletedAt: null };
  if (activeOnly) {
    query.status = "active";
    query.isArchived = { $ne: true };
  }
  return GeographyModel.findOne(query);
};

const assertValidParent = async ({
  type,
  parentId,
  companyId,
  GeographyModel,
  activeOnly = true,
}) => {
  const expectedParentType = SALES_GEOGRAPHY_PARENT_TYPE[type];
  if (expectedParentType === null) {
    if (parentId) throw new ApiError(400, "Zone cannot have a geography parent");
    return null;
  }
  if (!parentId) throw new ApiError(400, `${type} requires a ${expectedParentType} parent`);

  const query = {
    _id: parentId,
    companyId,
    type: expectedParentType,
    deletedAt: null,
  };
  if (activeOnly) {
    query.status = "active";
    query.isArchived = { $ne: true };
  }
  const parent = await GeographyModel.findOne(query);
  if (!parent) {
    throw new ApiError(404, `Active ${expectedParentType} parent not found`);
  }
  return parent;
};

const findDuplicate = async ({
  companyId,
  type,
  parentId,
  normalizedName,
  code,
  excludeId = null,
  GeographyModel,
}) => {
  const query = {
    companyId,
    type,
    parentId: parentId || null,
    deletedAt: null,
    $or: [
      { normalizedName: normalizeName(normalizedName) },
      { code: normalizeCode(code) },
    ],
  };
  if (excludeId) query._id = { $ne: excludeId };
  return GeographyModel.findOne(query);
};

const duplicateError = (type) =>
  new ApiError(409, `${type} name or code already exists in this parent scope`);

const createSalesGeography = async ({
  payload,
  user,
  req = null,
  GeographyModel = SalesGeography,
  auditFn = writeAuditLog,
}) => {
  const companyId = assertCanManageSalesGeography(user);
  const type = normalizeGeographyType(payload.type);
  if (!SALES_GEOGRAPHY_TYPES.includes(type)) throw new ApiError(400, "Invalid Sales Geography type");

  const parent = await assertValidParent({
    type,
    parentId: payload.parentId || null,
    companyId,
    GeographyModel,
  });

  if (type === "REGION" && parent?.stateNames?.length && !parent.stateNames.includes(payload.name)) {
    throw new ApiError(400, "Selected State / UT is not mapped to the selected Zone");
  }
  if (type === "BRANCH") {
    const districts = INDIA_STATE_DISTRICTS[parent?.name] || [];
    if (districts.length && !districts.includes(payload.name)) {
      throw new ApiError(400, "Selected District does not belong to the selected Region State / UT");
    }
  }

  const duplicate = await findDuplicate({
    companyId,
    type,
    parentId: payload.parentId || null,
    normalizedName: payload.normalizedName || payload.name,
    code: payload.code,
    GeographyModel,
  });
  if (duplicate) throw duplicateError(type);

  if (type === "ZONE" && payload.stateNames?.length) {
    const otherZones = await GeographyModel.find({ companyId, type: "ZONE", deletedAt: null });
    const usedStates = new Set(otherZones.flatMap((zone) => zone.stateNames || []));
    const conflict = payload.stateNames.find((state) => usedStates.has(state));
    if (conflict) throw new ApiError(409, `${conflict} is already mapped to another Zone`);
  }

  const stateName = type === "REGION"
    ? payload.name
    : type === "BRANCH" || type === "AREA"
      ? parent?.stateName || (type === "BRANCH" ? parent?.name : "") || ""
      : "";
  const districtName = type === "BRANCH"
    ? payload.name
    : type === "AREA"
      ? parent?.districtName || parent?.name || ""
      : "";

  let geography;
  try {
    geography = await GeographyModel.create({
      companyId,
      type,
      name: payload.name,
      normalizedName: normalizeName(payload.normalizedName || payload.name),
      code: normalizeCode(payload.code),
      parentId: payload.parentId || null,
      stateNames: type === "ZONE" ? payload.stateNames || [] : [],
      stateName,
      districtName,
      description: payload.description || "",
      status: "active",
      isActive: true,
      isArchived: false,
      createdBy: user._id,
      updatedBy: user._id,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) throw duplicateError(type);
    throw error;
  }

  await writeGeographyAudit({
    geography,
    event: "CREATED",
    actor: user,
    companyId,
    metadata: { status: geography.status },
    req,
    auditFn,
  });

  return mapGeography(geography);
};

const listSalesGeographies = async ({
  user,
  type = null,
  parentId = undefined,
  includeInactive = false,
  GeographyModel = SalesGeography,
}) => {
  const companyId = assertCanManageSalesGeography(user);
  const query = { companyId, deletedAt: null };
  if (type) query.type = normalizeGeographyType(type);
  if (parentId !== undefined) query.parentId = parentId || null;
  if (!includeInactive) {
    query.status = "active";
    query.isArchived = { $ne: true };
  }
  const records = await GeographyModel.find(query);
  return records
    .map(mapGeography)
    .sort((first, second) => first.name.localeCompare(second.name));
};

const listSalesGeographyChildren = async ({
  user,
  parentId,
  parentType,
  childType,
  includeInactive = false,
  GeographyModel = SalesGeography,
}) => {
  const companyId = assertCanManageSalesGeography(user);
  const normalizedParentType = normalizeGeographyType(parentType);
  const normalizedChildType = normalizeGeographyType(childType);
  if (SALES_GEOGRAPHY_CHILD_TYPE[normalizedParentType] !== normalizedChildType) {
    throw new ApiError(400, "Invalid Sales Geography lookup relationship");
  }

  const parent = await findScopedGeography({
    id: parentId,
    companyId,
    GeographyModel,
    activeOnly: !includeInactive,
  });
  if (!parent || parent.type !== normalizedParentType) {
    throw new ApiError(404, `${normalizedParentType} not found`);
  }

  return listSalesGeographies({
    user,
    type: normalizedChildType,
    parentId,
    includeInactive,
    GeographyModel,
  });
};

const buildSalesGeographyTree = async ({
  user,
  includeInactive = false,
  GeographyModel = SalesGeography,
}) => {
  const records = await listSalesGeographies({ user, includeInactive, GeographyModel });
  const childrenByParent = new Map();
  records.forEach((record) => {
    const parentKey = toId(record.parentId);
    const children = childrenByParent.get(parentKey) || [];
    children.push(record);
    childrenByParent.set(parentKey, children);
  });

  const mapNode = (record) => {
    const children = childrenByParent.get(toId(record.id)) || [];
    if (record.type === "ZONE") return { ...record, regions: children.map(mapNode) };
    if (record.type === "REGION") return { ...record, branches: children.map(mapNode) };
    if (record.type === "BRANCH") return { ...record, areas: children.map(mapNode) };
    return { ...record };
  };

  return records.filter((record) => record.type === "ZONE" && !record.parentId).map(mapNode);
};

const getSalesGeographyById = async ({
  id,
  user,
  GeographyModel = SalesGeography,
}) => {
  const companyId = assertCanManageSalesGeography(user);
  const record = await findScopedGeography({ id, companyId, GeographyModel });
  if (!record) throw new ApiError(404, "Sales Geography record not found");
  return mapGeography(record);
};

const updateSalesGeography = async ({
  id,
  payload,
  user,
  req = null,
  GeographyModel = SalesGeography,
  auditFn = writeAuditLog,
}) => {
  const companyId = assertCanManageSalesGeography(user);
  const geography = await findScopedGeography({ id, companyId, GeographyModel });
  if (!geography) throw new ApiError(404, "Sales Geography record not found");
  if (geography.type !== "ZONE" && Object.prototype.hasOwnProperty.call(payload, "stateNames")) {
    throw new ApiError(400, "State / UT mappings can only be changed for a Zone");
  }

  const changes = {};
  if (Object.prototype.hasOwnProperty.call(payload, "name")) {
    const normalizedName = normalizeName(payload.normalizedName || payload.name);
    if (normalizedName !== geography.normalizedName) {
      const duplicate = await findDuplicate({
        companyId,
        type: geography.type,
        parentId: geography.parentId,
        normalizedName,
        code: geography.code,
        excludeId: geography._id,
        GeographyModel,
      });
      if (duplicate) throw duplicateError(geography.type);
      changes.name = { from: geography.name, to: payload.name };
      geography.name = payload.name;
      geography.normalizedName = normalizedName;
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, "description") &&
    payload.description !== geography.description
  ) {
    changes.descriptionChanged = true;
    geography.description = payload.description;
  }
  if (geography.type === "ZONE" && Object.prototype.hasOwnProperty.call(payload, "stateNames")) {
    const otherZones = await GeographyModel.find({
      companyId,
      type: "ZONE",
      _id: { $ne: geography._id },
      deletedAt: null,
    });
    const usedStates = new Set(otherZones.flatMap((zone) => zone.stateNames || []));
    const conflict = payload.stateNames.find((state) => usedStates.has(state));
    if (conflict) throw new ApiError(409, `${conflict} is already mapped to another Zone`);
    const activeRegions = await GeographyModel.find({
      companyId,
      parentId: geography._id,
      type: "REGION",
      status: "active",
      deletedAt: null,
    });
    const removedUsedState = activeRegions.find((region) => !payload.stateNames.includes(region.name));
    if (removedUsedState) {
      throw new ApiError(409, `Cannot remove ${removedUsedState.name} while its Region is active`);
    }
    const previous = Array.isArray(geography.stateNames) ? geography.stateNames : [];
    if (JSON.stringify(previous) !== JSON.stringify(payload.stateNames)) {
      changes.stateNames = { from: previous, to: payload.stateNames };
      geography.stateNames = payload.stateNames;
    }
  }

  if (!Object.keys(changes).length) return mapGeography(geography);
  geography.updatedBy = user._id;
  try {
    await geography.save({ validateModifiedOnly: true });
  } catch (error) {
    if (isDuplicateKeyError(error)) throw duplicateError(geography.type);
    throw error;
  }

  await writeGeographyAudit({
    geography,
    event: "UPDATED",
    actor: user,
    companyId,
    metadata: { changes },
    req,
    auditFn,
  });
  return mapGeography(geography);
};

const updateSalesGeographyStatus = async ({
  id,
  status,
  user,
  req = null,
  GeographyModel = SalesGeography,
  auditFn = writeAuditLog,
}) => {
  const companyId = assertCanManageSalesGeography(user);
  const geography = await findScopedGeography({ id, companyId, GeographyModel });
  if (!geography) throw new ApiError(404, "Sales Geography record not found");
  if (geography.status === status) return mapGeography(geography);

  if (status === "inactive") {
    const activeChild = await GeographyModel.findOne({
      companyId,
      parentId: geography._id,
      status: "active",
      isArchived: { $ne: true },
      deletedAt: null,
    });
    if (activeChild) {
      throw new ApiError(
        409,
        `${geography.type} cannot be deactivated while active ${activeChild.type} records exist`
      );
    }
  } else {
    await assertValidParent({
      type: geography.type,
      parentId: geography.parentId,
      companyId,
      GeographyModel,
    });
  }

  const previousStatus = geography.status;
  geography.status = status;
  geography.isActive = status === "active";
  geography.isArchived = false;
  geography.archivedAt = null;
  geography.updatedBy = user._id;
  await geography.save({ validateModifiedOnly: true });

  await writeGeographyAudit({
    geography,
    event: "STATUS_CHANGED",
    actor: user,
    companyId,
    metadata: { previousStatus, status },
    req,
    auditFn,
  });
  return mapGeography(geography);
};

module.exports = {
  assertCanManageSalesGeography,
  mapGeography,
  createSalesGeography,
  listSalesGeographies,
  listSalesGeographyChildren,
  buildSalesGeographyTree,
  getSalesGeographyById,
  updateSalesGeography,
  updateSalesGeographyStatus,
};
