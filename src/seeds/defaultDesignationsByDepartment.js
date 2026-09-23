const { normalizeName, normalizeCode, slugify } = require("../utils/normalize");
const {
  getSalesDesignationByTitle,
} = require("../constants/salesHierarchy");

const DEFAULT_DESIGNATIONS_BY_DEPARTMENT = {
  administration: [
    "Admin Trainee",
    "Admin Assistant",
    "Office Executive",
    "Senior Office Executive",
    "Office Coordinator",
    "Administration Executive",
    "Senior Administration Executive",
    "Facility Coordinator",
    "Facility Manager",
    "Admin Manager",
    "Senior Admin Manager",
    "Administration Head",
  ],
  "human-resource": [
    "HR Intern",
    "HR Trainee",
    "HR Executive",
    "Senior HR Executive",
    "HR Generalist",
    "HR Recruiter",
    "Talent Acquisition Executive",
    "Payroll Executive",
    "HR Operations Executive",
    "HR Coordinator",
    "Assistant HR Manager",
    "HR Manager",
    "Senior HR Manager",
    "HR Business Partner",
    "Head of HR",
  ],
  sales: [
    "Sales Trainee",
    "Sales Executive",
    "Senior Sales Executive",
    "Field Sales Executive",
    "Inside Sales Executive",
    "Business Development Executive",
    "Senior Business Development Executive",
    "Sales Coordinator",
    "Team Leader Sales",
    "Assistant Manager",
    "ASM",
    "FSD",
    "Assistant Sales Manager",
    "Area Sales Manager",
    "Sales Manager",
    "Branch Manager",
    "Regional Sales Manager",
    "Zonal Sales Manager",
    "National Sales Manager",
    "Head of Sales",
  ],
  marketing: [
    "Marketing Intern",
    "Marketing Executive",
    "Senior Marketing Executive",
    "Digital Marketing Executive",
    "SEO Executive",
    "Content Marketing Executive",
    "Social Media Executive",
    "Performance Marketing Executive",
    "Brand Executive",
    "Marketing Coordinator",
    "Assistant Marketing Manager",
    "Marketing Manager",
    "Senior Marketing Manager",
    "Brand Manager",
    "Head of Marketing",
  ],
  operations: [
    "Operations Trainee",
    "Operations Executive",
    "Senior Operations Executive",
    "Operations Coordinator",
    "Process Coordinator",
    "Team Leader Operations",
    "Assistant Operations Manager",
    "Operations Manager",
    "Senior Operations Manager",
    "Regional Operations Manager",
    "Operations Head",
    "Chief Operations Manager",
  ],
  logistics: [
    "Logistics Trainee",
    "Logistics Executive",
    "Senior Logistics Executive",
    "Dispatch Executive",
    "Transport Coordinator",
    "Fleet Coordinator",
    "Route Planner",
    "Logistics Coordinator",
    "Warehouse Logistics Executive",
    "Assistant Logistics Manager",
    "Logistics Manager",
    "Senior Logistics Manager",
    "Regional Logistics Manager",
    "Head of Logistics",
  ],
  "finance-and-accounts": [
    "Accounts Trainee",
    "Accounts Executive",
    "Senior Accounts Executive",
    "Finance Executive",
    "Billing Executive",
    "Payroll Accounts Executive",
    "Tax Executive",
    "Accounts Payable Executive",
    "Accounts Receivable Executive",
    "Finance Analyst",
    "Assistant Finance Manager",
    "Accounts Manager",
    "Finance Manager",
    "Senior Finance Manager",
    "Finance Controller",
    "Head of Finance",
  ],
  "customer-support": [
    "Support Trainee",
    "Customer Support Executive",
    "Senior Customer Support Executive",
    "Customer Care Executive",
    "Technical Support Executive",
    "Chat Support Executive",
    "Voice Support Executive",
    "Support Coordinator",
    "Team Leader Support",
    "Assistant Support Manager",
    "Support Manager",
    "Customer Success Manager",
    "Senior Support Manager",
    "Head of Customer Support",
  ],
  "it-technical": [
    "IT Intern",
    "IT Support Executive",
    "Technical Support Executive",
    "System Administrator",
    "Network Administrator",
    "Software Developer",
    "Frontend Developer",
    "Backend Developer",
    "Full Stack Developer",
    "QA Engineer",
    "DevOps Engineer",
    "Technical Lead",
    "IT Manager",
    "Engineering Manager",
    "Head of IT",
    "CTO",
  ],
  "procurement-purchase": [
    "Purchase Trainee",
    "Purchase Executive",
    "Senior Purchase Executive",
    "Procurement Executive",
    "Vendor Coordinator",
    "Sourcing Executive",
    "Purchase Coordinator",
    "Assistant Purchase Manager",
    "Purchase Manager",
    "Procurement Manager",
    "Senior Procurement Manager",
    "Head of Procurement",
  ],
  "inventory-warehouse": [
    "Warehouse Trainee",
    "Inventory Executive",
    "Warehouse Executive",
    "Stock Executive",
    "Store Executive",
    "Inventory Coordinator",
    "Warehouse Coordinator",
    "Stock Auditor",
    "Warehouse Supervisor",
    "Inventory Manager",
    "Warehouse Manager",
    "Senior Warehouse Manager",
    "Head of Warehouse",
  ],
  "supply-chain": [
    "Supply Chain Trainee",
    "Supply Chain Executive",
    "Senior Supply Chain Executive",
    "Supply Planner",
    "Demand Planner",
    "Supply Chain Coordinator",
    "Vendor Management Executive",
    "Assistant Supply Chain Manager",
    "Supply Chain Manager",
    "Senior Supply Chain Manager",
    "Regional Supply Chain Manager",
    "Head of Supply Chain",
  ],
  "field-operations": [
    "Field Trainee",
    "Field Executive",
    "Senior Field Executive",
    "Field Officer",
    "Field Coordinator",
    "Field Supervisor",
    "Territory Executive",
    "Territory Manager",
    "Area Field Manager",
    "Regional Field Manager",
    "Field Operations Manager",
    "Head of Field Operations",
  ],
  service: [
    "Service Trainee",
    "Service Executive",
    "Senior Service Executive",
    "Service Advisor",
    "Service Coordinator",
    "Service Engineer",
    "Senior Service Engineer",
    "Service Supervisor",
    "Assistant Service Manager",
    "Service Manager",
    "Regional Service Manager",
    "Head of Service",
  ],
  "project-management": [
    "Project Trainee",
    "Project Coordinator",
    "Junior Project Manager",
    "Project Executive",
    "Senior Project Executive",
    "Assistant Project Manager",
    "Project Manager",
    "Senior Project Manager",
    "Program Manager",
    "Portfolio Manager",
    "Project Management Head",
  ],
  "legal-and-compliance": [
    "Legal Intern",
    "Legal Executive",
    "Senior Legal Executive",
    "Compliance Executive",
    "Contract Executive",
    "Legal Associate",
    "Compliance Associate",
    "Legal Advisor",
    "Compliance Manager",
    "Legal Manager",
    "Senior Legal Manager",
    "Head of Legal",
    "Head of Compliance",
  ],
  quality: [
    "Quality Trainee",
    "Quality Executive",
    "Senior Quality Executive",
    "Quality Analyst",
    "QA Executive",
    "QC Executive",
    "Quality Inspector",
    "Quality Coordinator",
    "Quality Supervisor",
    "Assistant Quality Manager",
    "Quality Manager",
    "Senior Quality Manager",
    "Head of Quality",
  ],
  "data-analytics": [
    "Data Intern",
    "Data Executive",
    "Data Analyst",
    "Senior Data Analyst",
    "Business Analyst",
    "MIS Executive",
    "Reporting Analyst",
    "Analytics Executive",
    "Data Engineer",
    "BI Developer",
    "Analytics Manager",
    "Senior Analytics Manager",
    "Head of Analytics",
    "Chief Data Officer",
  ],
};

const inferHierarchyLevel = (title) => {
  const value = normalizeName(title);

  if (
    value.includes("chief") ||
    value === "cto" ||
    value.includes("director") ||
    value.includes("vp") ||
    value.includes("head of") ||
    value.endsWith(" head") ||
    value.includes("department head") ||
    value.includes("business head")
  ) {
    return 6;
  }

  if (
    value.includes("team leader") ||
    value.includes("lead") ||
    value.includes("supervisor") ||
    value.includes("assistant manager") ||
    (value.includes("assistant") && value.includes("manager")) ||
    value.includes("deputy manager") ||
    (value.includes("deputy") && value.includes("manager")) ||
    value.includes("project manager") ||
    value.includes("junior project manager")
  ) {
    return 4;
  }

  if (
    value.includes("national") ||
    value.includes("zonal") ||
    value.includes("regional") ||
    value.includes("area") ||
    value.includes("senior manager") ||
    value.includes("manager") ||
    value.includes("controller") ||
    value.includes("portfolio manager")
  ) {
    return 5;
  }

  if (
    value.includes("senior") ||
    value.includes("specialist") ||
    value.includes("analyst") ||
    value.includes("engineer") ||
    value.includes("developer") ||
    value.includes("administrator")
  ) {
    return 3;
  }

  if (
    value.includes("executive") ||
    value.includes("coordinator") ||
    value.includes("associate") ||
    value.includes("officer") ||
    value.includes("representative") ||
    value.includes("technician") ||
    value.includes("planner") ||
    value.includes("advisor") ||
    value.includes("auditor")
  ) {
    return 2;
  }

  if (
    value.includes("intern") ||
    value.includes("trainee") ||
    value.includes("assistant") ||
    value.includes("junior") ||
    value.includes("helper")
  ) {
    return 1;
  }

  return 1;
};

const getDefaultDesignationSeedsForDepartment = (department) => {
  const key = slugify(department?.slug || department?.name || department || "");
  const titles = DEFAULT_DESIGNATIONS_BY_DEPARTMENT[key] || [];

  return titles.map((title, index) => {
    const salesDefinition = key === "sales" ? getSalesDesignationByTitle(title) : null;
    const technicalRole = salesDefinition?.technicalRole || "";

    return {
      key: slugify(title),
      title,
      name: title,
      normalizedTitle: normalizeName(title),
      normalizedName: normalizeName(title),
      slug: slugify(title),
      code: salesDefinition?.code || normalizeCode(title).slice(0, 24),
      hierarchyLevel: salesDefinition?.level || inferHierarchyLevel(title),
      mappedRole: technicalRole,
      allowedRoles: technicalRole ? [technicalRole] : [],
      allowedParentLevels: [],
      canManagePeople: ["sales_head", "sales_manager"].includes(technicalRole),
      isLeadership: ["sales_head", "sales_manager"].includes(technicalRole),
      isDepartmentHead: technicalRole === "sales_head",
      isHead: technicalRole === "sales_head",
      source: "default",
      isDefaultSeed: true,
      sortOrder: index + 1,
    };
  });
};

module.exports = {
  DEFAULT_DESIGNATIONS_BY_DEPARTMENT,
  getDefaultDesignationSeedsForDepartment,
  inferHierarchyLevel,
};
