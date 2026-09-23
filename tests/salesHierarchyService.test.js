const test = require("node:test");
const assert = require("node:assert/strict");

const {
  previewSalesHierarchy,
  applySalesHierarchy,
} = require("../src/services/salesHierarchy.service");

const companyA = "company-a";
const companyB = "company-b";
const salesDepartmentId = "department-sales-a";
const financeDepartmentId = "department-finance-a";

const companyAdmin = { _id: "admin-a", companyId: companyA, role: "company_admin" };

const makeDesignation = (values) => ({
  status: "active",
  isActive: true,
  isArchived: false,
  deletedAt: null,
  mappedRole: "",
  allowedRoles: [],
  isHead: false,
  isDepartmentHead: false,
  ...values,
  async save() {
    this.saveCount = (this.saveCount || 0) + 1;
    return this;
  },
});

const matches = (record, query) => Object.entries(query).every(([key, value]) => {
  if (key === "$or") {
    return value.some((condition) => matches(record, condition));
  }
  if (value && typeof value === "object" && "$ne" in value) {
    return String(record[key] ?? "") !== String(value.$ne ?? "");
  }
  return String(record[key] ?? "") === String(value ?? "");
});

const createModels = ({ designations = [], users = [], departments = null } = {}) => {
  const state = {
    departments: departments || [
      {
        _id: salesDepartmentId,
        companyId: companyA,
        name: "Sales",
        normalizedName: "sales",
        slug: "sales",
        code: "SALES",
        status: "active",
        isArchived: false,
        deletedAt: null,
      },
      {
        _id: financeDepartmentId,
        companyId: companyA,
        name: "Finance",
        normalizedName: "finance",
        slug: "finance",
        code: "FINANCE",
        status: "active",
        isArchived: false,
        deletedAt: null,
      },
    ],
    designations,
    users,
    queries: { departments: [], designations: [], users: [] },
    creates: 0,
  };

  const DepartmentModel = {
    findOne: async (query) => {
      state.queries.departments.push(query);
      return state.departments.find((item) => matches(item, query)) || null;
    },
  };
  const DesignationModel = {
    find: async (query) => {
      state.queries.designations.push(query);
      return state.designations.filter((item) => matches(item, query));
    },
    create: async (payload) => {
      state.creates += 1;
      const created = makeDesignation({ _id: `created-${state.creates}`, ...payload });
      state.designations.push(created);
      return created;
    },
  };
  const UserModel = {
    find: async (query) => {
      state.queries.users.push(query);
      return state.users.filter((item) => matches(item, query));
    },
  };

  return { state, DepartmentModel, DesignationModel, UserModel };
};

const serviceArgs = (models) => ({
  user: companyAdmin,
  DepartmentModel: models.DepartmentModel,
  DesignationModel: models.DesignationModel,
  UserModel: models.UserModel,
});

test("preview is read-only, company-scoped, and reports canonical, ambiguous, and legacy records", async () => {
  const models = createModels({
    designations: [
      makeDesignation({
        _id: "head-a",
        companyId: companyA,
        departmentId: salesDepartmentId,
        title: "Head of Sales",
        name: "Head of Sales",
        code: "HEAD_OF_SALES",
        hierarchyLevel: 6,
        mappedRole: "sales_head",
        isHead: true,
        isDepartmentHead: true,
      }),
      makeDesignation({
        _id: "sales-manager-a",
        companyId: companyA,
        departmentId: salesDepartmentId,
        title: "Sales Manager",
        name: "Sales Manager",
        code: "SALES_MANAGER",
        hierarchyLevel: 5,
      }),
      makeDesignation({
        _id: "team-leader-a",
        companyId: companyA,
        departmentId: salesDepartmentId,
        title: "Team Leader Sales",
        name: "Team Leader Sales",
        code: "TEAM_LEADER_SALES",
        hierarchyLevel: 4,
      }),
      makeDesignation({
        _id: "head-b",
        companyId: companyB,
        departmentId: "department-sales-b",
        title: "Head of Sales",
        name: "Head of Sales",
        code: "HEAD_OF_SALES",
        hierarchyLevel: 6,
      }),
    ],
  });

  const preview = await previewSalesHierarchy(serviceArgs(models));

  assert.equal(preview.department.id, salesDepartmentId);
  assert.equal(preview.summary.writesPerformed, 0);
  assert.equal(models.state.creates, 0);
  assert.equal(models.state.designations.reduce((sum, item) => sum + (item.saveCount || 0), 0), 0);
  assert.equal(models.state.queries.departments[0].companyId, companyA);
  assert.equal(models.state.queries.designations[0].companyId, companyA);
  assert.equal(models.state.queries.designations[0].departmentId, salesDepartmentId);
  assert.equal(
    preview.existingDesignations.find((item) => item.id === "sales-manager-a").classification,
    "AMBIGUOUS_EXISTING_DESIGNATION"
  );
  assert.equal(
    preview.existingDesignations.find((item) => item.id === "team-leader-a").classification,
    "LEGACY_EXTRA"
  );
  assert.equal(preview.hierarchy.find((item) => item.level === 6).status, "CORRECT");
});

test("apply reuses Head of Sales, corrects safe records, creates missing primary positions, and is idempotent", async () => {
  const head = makeDesignation({
    _id: "head-a",
    companyId: companyA,
    departmentId: salesDepartmentId,
    title: "Head of Sales",
    name: "Head of Sales",
    code: "HEAD_OF_SALES",
    hierarchyLevel: 6,
    mappedRole: "sales_head",
    allowedRoles: ["sales_head"],
    isHead: true,
    isDepartmentHead: true,
    canManagePeople: true,
    isLeadership: true,
  });
  const regional = makeDesignation({
    _id: "regional-a",
    companyId: companyA,
    departmentId: salesDepartmentId,
    title: "Regional Sales Manager",
    name: "Regional Sales Manager",
    code: "REGIONAL_SALES_MANAGER",
    hierarchyLevel: 5,
  });
  const fieldSales = makeDesignation({
    _id: "field-a",
    companyId: companyA,
    departmentId: salesDepartmentId,
    title: "Field Sales Executive",
    name: "Field Sales Executive",
    code: "FIELD_SALES_EXECUTIVE",
    hierarchyLevel: 2,
  });
  const ambiguous = makeDesignation({
    _id: "sales-manager-a",
    companyId: companyA,
    departmentId: salesDepartmentId,
    title: "Sales Manager",
    name: "Sales Manager",
    code: "SALES_MANAGER",
    hierarchyLevel: 5,
  });
  const finance = makeDesignation({
    _id: "finance-a",
    companyId: companyA,
    departmentId: financeDepartmentId,
    title: "Regional Finance Manager",
    name: "Regional Finance Manager",
    code: "REGIONAL_FINANCE_MANAGER",
    hierarchyLevel: 5,
  });
  const models = createModels({ designations: [head, regional, fieldSales, ambiguous, finance] });

  const first = await applySalesHierarchy(serviceArgs(models));
  assert.equal(first.changed, true);
  assert.equal(first.created.length, 3, "ZSM, Branch Manager, and Area Sales Manager are created");
  assert.equal(regional.hierarchyLevel, 4);
  assert.equal(regional.mappedRole, "sales_manager");
  assert.equal(fieldSales.hierarchyLevel, 1);
  assert.equal(fieldSales.mappedRole, "sales_executive");
  assert.equal(ambiguous.hierarchyLevel, 5);
  assert.equal(ambiguous.mappedRole, "");
  assert.equal(finance.hierarchyLevel, 5);
  assert.equal(head._id, "head-a");
  assert.equal(models.state.designations.filter((item) => item.isHead === true).length, 1);
  assert.equal(models.state.designations.some((item) => /ceo/i.test(item.title || "")), false);

  const firstCreateCount = models.state.creates;
  const firstSaveCount = models.state.designations.reduce((sum, item) => sum + (item.saveCount || 0), 0);
  const second = await applySalesHierarchy(serviceArgs(models));
  assert.equal(second.changed, false);
  assert.equal(models.state.creates, firstCreateCount);
  assert.equal(
    models.state.designations.reduce((sum, item) => sum + (item.saveCount || 0), 0),
    firstSaveCount
  );
});

test("active-holder reporting conflict prevents level correction and preserves reportingManagerId", async () => {
  const head = makeDesignation({
    _id: "head-a",
    companyId: companyA,
    departmentId: salesDepartmentId,
    title: "Head of Sales",
    name: "Head of Sales",
    code: "HEAD_OF_SALES",
    hierarchyLevel: 6,
    mappedRole: "sales_head",
    isHead: true,
    isDepartmentHead: true,
  });
  const regional = makeDesignation({
    _id: "regional-a",
    companyId: companyA,
    departmentId: salesDepartmentId,
    title: "Regional Sales Manager",
    name: "Regional Sales Manager",
    code: "REGIONAL_SALES_MANAGER",
    hierarchyLevel: 5,
  });
  const managerDesignation = makeDesignation({
    _id: "legacy-manager-a",
    companyId: companyA,
    departmentId: salesDepartmentId,
    title: "Team Leader Sales",
    name: "Team Leader Sales",
    code: "TEAM_LEADER_SALES",
    hierarchyLevel: 4,
  });
  const holder = {
    _id: "regional-user-a",
    companyId: companyA,
    departmentId: salesDepartmentId,
    designationId: regional._id,
    reportingManagerId: "manager-user-a",
    status: "active",
    deletedAt: null,
    role: "sales_manager",
  };
  const manager = {
    _id: "manager-user-a",
    companyId: companyA,
    departmentId: salesDepartmentId,
    designationId: managerDesignation._id,
    reportingManagerId: "head-user-a",
    status: "active",
    deletedAt: null,
    role: "sales_manager",
  };
  const models = createModels({ designations: [head, regional, managerDesignation], users: [holder, manager] });

  const preview = await previewSalesHierarchy(serviceArgs(models));
  const regionalPreview = preview.hierarchy.find((item) => item.level === 4);
  assert.equal(regionalPreview.status, "REPORTING_CONFLICT");
  assert.equal(regionalPreview.reportingConflicts[0].type, "MANAGER_NOT_HIGHER_AFTER_CHANGE");

  await applySalesHierarchy(serviceArgs(models));
  assert.equal(regional.hierarchyLevel, 5);
  assert.equal(holder.reportingManagerId, "manager-user-a");
});

test("apply converges in one pass when lower-tier corrections make manager corrections safe", async () => {
  const head = makeDesignation({
    _id: "head-a",
    companyId: companyA,
    departmentId: salesDepartmentId,
    title: "Head of Sales",
    name: "Head of Sales",
    code: "HEAD_OF_SALES",
    hierarchyLevel: 6,
    mappedRole: "sales_head",
    isHead: true,
    isDepartmentHead: true,
  });
  const zonal = makeDesignation({
    _id: "zonal-a",
    companyId: companyA,
    departmentId: salesDepartmentId,
    title: "Zonal Sales Manager",
    name: "Zonal Sales Manager",
    code: "ZONAL_SALES_MANAGER",
    hierarchyLevel: 5,
    mappedRole: "sales_manager",
  });
  const regional = makeDesignation({
    _id: "regional-a",
    companyId: companyA,
    departmentId: salesDepartmentId,
    title: "Regional Sales Manager",
    name: "Regional Sales Manager",
    code: "REGIONAL_SALES_MANAGER",
    hierarchyLevel: 5,
  });
  const area = makeDesignation({
    _id: "area-a",
    companyId: companyA,
    departmentId: salesDepartmentId,
    title: "Area Sales Manager",
    name: "Area Sales Manager",
    code: "AREA_SALES_MANAGER",
    hierarchyLevel: 5,
  });
  const users = [
    {
      _id: "zonal-user-a",
      companyId: companyA,
      departmentId: salesDepartmentId,
      designationId: zonal._id,
      reportingManagerId: "head-user-a",
      status: "active",
      deletedAt: null,
      role: "sales_manager",
    },
    {
      _id: "regional-user-a",
      companyId: companyA,
      departmentId: salesDepartmentId,
      designationId: regional._id,
      reportingManagerId: "zonal-user-a",
      status: "active",
      deletedAt: null,
      role: "sales_manager",
    },
    {
      _id: "area-user-a",
      companyId: companyA,
      departmentId: salesDepartmentId,
      designationId: area._id,
      reportingManagerId: "regional-user-a",
      status: "active",
      deletedAt: null,
      role: "sales_manager",
    },
  ];
  const models = createModels({ designations: [head, zonal, regional, area], users });

  const initial = await previewSalesHierarchy(serviceArgs(models));
  assert.equal(initial.hierarchy.find((item) => item.level === 4).status, "REPORTING_CONFLICT");

  const result = await applySalesHierarchy(serviceArgs(models));
  assert.equal(area.hierarchyLevel, 2);
  assert.equal(regional.hierarchyLevel, 4);
  assert.equal(result.preview.hierarchy.find((item) => item.level === 4).status, "CORRECT");
  assert.equal(users[1].reportingManagerId, "zonal-user-a");
  assert.equal(users[2].reportingManagerId, "regional-user-a");

  const second = await applySalesHierarchy(serviceArgs(models));
  assert.equal(second.changed, false);
});

test("duplicate Sales heads are reported and never multiplied", async () => {
  const models = createModels({
    designations: ["a", "b"].map((suffix) => makeDesignation({
      _id: `head-${suffix}`,
      companyId: companyA,
      departmentId: salesDepartmentId,
      title: suffix === "a" ? "Head of Sales" : "Sales Head",
      name: suffix === "a" ? "Head of Sales" : "Sales Head",
      code: suffix === "a" ? "HEAD_OF_SALES" : "SALES_HEAD",
      hierarchyLevel: 6,
      mappedRole: "sales_head",
      isHead: true,
      isDepartmentHead: true,
    })),
  });

  const result = await applySalesHierarchy(serviceArgs(models));
  assert.equal(result.preview.hierarchy.find((item) => item.level === 6).status, "DUPLICATE_HEAD_RISK");
  assert.equal(models.state.designations.filter((item) => item.isHead === true).length, 2);
  assert.equal(result.skipped.some((item) => item.reason === "DUPLICATE_HEAD_RISK"), true);
  assert.equal(models.state.designations.filter((item) => item.saveCount).length, 0);
});
