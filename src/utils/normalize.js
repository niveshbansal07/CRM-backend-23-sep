const cleanString = (value = "") =>
  String(value || "").trim().replace(/\s+/g, " ");

const normalizeName = (value = "") =>
  cleanString(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

const slugify = (value = "") =>
  normalizeName(value)
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");

const normalizeCode = (value = "") =>
  cleanString(value)
    .toUpperCase()
    .replace(/&/g, "AND")
    .replace(/[^A-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

const generateSlug = slugify;
const generateCode = normalizeCode;

const RESERVED_SYSTEM_NAMES = new Set([
  "super admin",
  "company admin",
  "sub admin",
  "system admin",
  "root",
  "system",
]);

const hasMeaningfulName = (value = "") => /[A-Za-z0-9]/.test(cleanString(value));

const validateCustomName = (value, label = "Name") => {
  const name = cleanString(value);
  const errors = [];

  if (!name) {
    errors.push(`${label} is required.`);
    return { name, normalizedName: "", slug: "", errors };
  }

  if (name.length < 2) {
    errors.push(`${label} must be at least 2 characters.`);
  }

  if (name.length > 80) {
    errors.push(`${label} must be 80 characters or less.`);
  }

  if (!hasMeaningfulName(name)) {
    errors.push(`${label} must include at least one letter or number.`);
  }

  const normalized = normalizeName(name);
  if (!normalized || RESERVED_SYSTEM_NAMES.has(normalized)) {
    errors.push(`${label} is reserved. Choose a business-specific name.`);
  }

  return {
    name,
    normalizedName: normalized,
    slug: generateSlug(name),
    errors,
  };
};

const isValidCustomName = (value = "") =>
  validateCustomName(value).errors.length === 0;

module.exports = {
  cleanString,
  normalizeName,
  slugify,
  normalizeCode,
  generateSlug,
  generateCode,
  hasMeaningfulName,
  isValidCustomName,
  validateCustomName,
};
