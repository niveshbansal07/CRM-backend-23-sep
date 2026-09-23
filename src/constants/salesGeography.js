const SALES_GEOGRAPHY_TYPES = Object.freeze(["ZONE", "REGION", "BRANCH", "AREA"]);

const SALES_GEOGRAPHY_PARENT_TYPE = Object.freeze({
  ZONE: null,
  REGION: "ZONE",
  BRANCH: "REGION",
  AREA: "BRANCH",
});

const SALES_GEOGRAPHY_CHILD_TYPE = Object.freeze({
  ZONE: "REGION",
  REGION: "BRANCH",
  BRANCH: "AREA",
  AREA: null,
});

const SALES_GEOGRAPHY_MANAGE_ROLES = Object.freeze([
  "super_admin",
  "company_admin",
  "sales_head",
]);

const normalizeGeographyType = (value) => String(value || "").trim().toUpperCase();

const isSalesGeographyType = (value) =>
  SALES_GEOGRAPHY_TYPES.includes(normalizeGeographyType(value));

const getGeographyAuditAction = (type, event) =>
  `${normalizeGeographyType(type)}_${String(event || "").trim().toUpperCase()}`;

module.exports = {
  SALES_GEOGRAPHY_TYPES,
  SALES_GEOGRAPHY_PARENT_TYPE,
  SALES_GEOGRAPHY_CHILD_TYPE,
  SALES_GEOGRAPHY_MANAGE_ROLES,
  normalizeGeographyType,
  isSalesGeographyType,
  getGeographyAuditAction,
};
