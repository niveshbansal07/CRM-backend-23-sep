const { normalizeCode, normalizeName } = require("../utils/normalize");

const SALES_DEPARTMENT_IDENTIFIERS = Object.freeze({
  normalizedName: "sales",
  slug: "sales",
  code: "SALES",
});

const SALES_HIERARCHY = Object.freeze([
  Object.freeze({
    level: 6,
    primaryTitle: "Head of Sales",
    code: "HEAD_OF_SALES",
    technicalRole: "sales_head",
    alternativeTitles: Object.freeze([]),
  }),
  Object.freeze({
    level: 5,
    primaryTitle: "Zonal Sales Manager",
    code: "ZONAL_SALES_MANAGER",
    technicalRole: "sales_manager",
    alternativeTitles: Object.freeze([]),
  }),
  Object.freeze({
    level: 4,
    primaryTitle: "Regional Sales Manager",
    code: "REGIONAL_SALES_MANAGER",
    technicalRole: "sales_manager",
    alternativeTitles: Object.freeze([]),
  }),
  Object.freeze({
    level: 3,
    primaryTitle: "Branch Manager",
    code: "BRANCH_MANAGER",
    technicalRole: "sales_manager",
    alternativeTitles: Object.freeze(["Assistant Manager", "Sales Manager"]),
  }),
  Object.freeze({
    level: 2,
    primaryTitle: "Area Sales Manager",
    code: "AREA_SALES_MANAGER",
    technicalRole: "sales_manager",
    alternativeTitles: Object.freeze(["ASM", "Assistant Sales Manager"]),
  }),
  Object.freeze({
    level: 1,
    primaryTitle: "Field Sales Executive",
    code: "FIELD_SALES_EXECUTIVE",
    technicalRole: "sales_executive",
    alternativeTitles: Object.freeze(["FSD"]),
  }),
]);

const SALES_ALTERNATIVE_DESIGNATIONS = Object.freeze([
  Object.freeze({
    title: "Assistant Manager",
    code: "SALES_ASSISTANT_MANAGER_L3",
    level: 3,
    technicalRole: "sales_manager",
    ambiguousWhenTitleOnly: true,
  }),
  Object.freeze({
    title: "Sales Manager",
    code: "SALES_MANAGER_L3",
    level: 3,
    technicalRole: "sales_manager",
    ambiguousWhenTitleOnly: true,
  }),
  Object.freeze({
    title: "ASM",
    code: "SALES_ASM_L2",
    level: 2,
    technicalRole: "sales_manager",
    ambiguousWhenTitleOnly: true,
  }),
  Object.freeze({
    title: "Assistant Sales Manager",
    code: "ASSISTANT_SALES_MANAGER",
    level: 2,
    technicalRole: "sales_manager",
    ambiguousWhenTitleOnly: false,
  }),
  Object.freeze({
    title: "FSD",
    code: "FSD",
    level: 1,
    technicalRole: "sales_executive",
    ambiguousWhenTitleOnly: false,
  }),
]);

const PRIMARY_DEFINITIONS = SALES_HIERARCHY.map((item) => ({
  ...item,
  title: item.primaryTitle,
  isPrimary: true,
  ambiguousWhenTitleOnly: false,
}));

const ALL_SALES_DESIGNATIONS = Object.freeze([
  ...PRIMARY_DEFINITIONS,
  ...SALES_ALTERNATIVE_DESIGNATIONS.map((item) => ({
    ...item,
    primaryTitle: SALES_HIERARCHY.find((level) => level.level === item.level)?.primaryTitle || item.title,
    isPrimary: false,
    alternativeTitles: Object.freeze([]),
  })),
]);

const DEFINITIONS_BY_CODE = new Map(
  ALL_SALES_DESIGNATIONS.map((item) => [normalizeCode(item.code), item])
);
const DEFINITIONS_BY_TITLE = new Map(
  ALL_SALES_DESIGNATIONS.map((item) => [normalizeName(item.title), item])
);

const getSalesDesignationByCode = (code) =>
  DEFINITIONS_BY_CODE.get(normalizeCode(code)) || null;

const getSalesDesignationByTitle = (title) =>
  DEFINITIONS_BY_TITLE.get(normalizeName(title)) || null;

const identifySalesDesignation = (designation = {}) => {
  const byCode = getSalesDesignationByCode(designation.code);
  if (byCode) return { definition: byCode, matchedBy: "code", ambiguous: false };

  const byTitle = getSalesDesignationByTitle(designation.title || designation.name);
  if (!byTitle) return { definition: null, matchedBy: "none", ambiguous: false };

  return {
    definition: byTitle,
    matchedBy: "title",
    ambiguous: byTitle.ambiguousWhenTitleOnly === true,
  };
};

const getCanonicalSalesRole = (designation = {}) => {
  const identity = identifySalesDesignation(designation);
  if (!identity.definition || identity.ambiguous) return "";
  return identity.definition.technicalRole;
};

const isSalesDepartment = (department = {}) => {
  const value = department || {};
  return (
    normalizeName(value.normalizedName || value.name || value) === SALES_DEPARTMENT_IDENTIFIERS.normalizedName ||
    normalizeName(value.slug) === SALES_DEPARTMENT_IDENTIFIERS.slug ||
    normalizeCode(value.code) === SALES_DEPARTMENT_IDENTIFIERS.code
  );
};

module.exports = {
  SALES_DEPARTMENT_IDENTIFIERS,
  SALES_HIERARCHY,
  SALES_ALTERNATIVE_DESIGNATIONS,
  ALL_SALES_DESIGNATIONS,
  getSalesDesignationByCode,
  getSalesDesignationByTitle,
  identifySalesDesignation,
  getCanonicalSalesRole,
  isSalesDepartment,
};
