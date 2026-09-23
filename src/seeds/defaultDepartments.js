const { normalizeName, slugify, normalizeCode } = require("../utils/normalize");

const DEFAULT_DEPARTMENT_NAMES = [
  "Administration",
  "Human Resource",
  "Sales",
  "Marketing",
  "Operations",
  "Logistics",
  "Finance & Accounts",
  "Customer Support",
  "IT / Technical",
  "Procurement / Purchase",
  "Inventory / Warehouse",
  "Supply Chain",
  "Field Operations",
  "Service",
  "Project Management",
  "Legal & Compliance",
  "Quality",
  "Data / Analytics",
];

const DEFAULT_DEPARTMENTS = DEFAULT_DEPARTMENT_NAMES.map((name, index) => {
  const slug = slugify(name);

  return {
    key: slug,
    name,
    normalizedName: normalizeName(name),
    slug,
    code: normalizeCode(name).slice(0, 24),
    description: "",
    source: "default",
    isDefaultSeed: true,
    sortOrder: index + 1,
  };
});

module.exports = {
  DEFAULT_DEPARTMENT_NAMES,
  DEFAULT_DEPARTMENTS,
};
