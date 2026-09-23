const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SALES_HIERARCHY,
  identifySalesDesignation,
} = require("../src/constants/salesHierarchy");
const {
  getDefaultDesignationSeedsForDepartment,
  inferHierarchyLevel,
} = require("../src/seeds/defaultDesignationsByDepartment");
const {
  resolveEmployeeRoleV2,
  resolveEmployeeSystemRole,
} = require("../src/utils/employeeRole");

test("canonical Sales hierarchy defines exactly L6 through L1 without a CEO role", () => {
  assert.deepEqual(SALES_HIERARCHY.map((item) => item.level), [6, 5, 4, 3, 2, 1]);
  assert.deepEqual(
    SALES_HIERARCHY.map((item) => item.code),
    [
      "HEAD_OF_SALES",
      "ZONAL_SALES_MANAGER",
      "REGIONAL_SALES_MANAGER",
      "BRANCH_MANAGER",
      "AREA_SALES_MANAGER",
      "FIELD_SALES_EXECUTIVE",
    ]
  );
  assert.equal(SALES_HIERARCHY.some((item) => /ceo/i.test(item.primaryTitle)), false);
});

test("Sales default seeds use explicit canonical metadata while global inference stays unchanged", () => {
  const salesSeeds = getDefaultDesignationSeedsForDepartment({ name: "Sales" });
  const byTitle = new Map(salesSeeds.map((seed) => [seed.title, seed]));

  assert.equal(byTitle.get("Head of Sales").hierarchyLevel, 6);
  assert.equal(byTitle.get("Zonal Sales Manager").hierarchyLevel, 5);
  assert.equal(byTitle.get("Regional Sales Manager").hierarchyLevel, 4);
  assert.equal(byTitle.get("Branch Manager").hierarchyLevel, 3);
  assert.equal(byTitle.get("Area Sales Manager").hierarchyLevel, 2);
  assert.equal(byTitle.get("Assistant Sales Manager").hierarchyLevel, 2);
  assert.equal(byTitle.get("Field Sales Executive").hierarchyLevel, 1);
  assert.equal(byTitle.get("Sales Manager").hierarchyLevel, 3);
  assert.equal(byTitle.get("Field Sales Executive").mappedRole, "sales_executive");
  assert.equal(byTitle.get("Regional Sales Manager").mappedRole, "sales_manager");

  assert.equal(inferHierarchyLevel("Regional Operations Manager"), 5);
  const operationsSeed = getDefaultDesignationSeedsForDepartment({ name: "Operations" })
    .find((seed) => seed.title === "Regional Operations Manager");
  assert.equal(operationsSeed.hierarchyLevel, 5);
  assert.equal(operationsSeed.mappedRole, "");
});

test("all canonical Sales levels resolve to existing technical roles by stable code", () => {
  const department = { name: "Sales", normalizedName: "sales" };
  const expected = new Map([
    [6, "sales_head"],
    [5, "sales_manager"],
    [4, "sales_manager"],
    [3, "sales_manager"],
    [2, "sales_manager"],
    [1, "sales_executive"],
  ]);

  SALES_HIERARCHY.forEach((item) => {
    const designation = {
      title: `Localized title ${item.level}`,
      code: item.code,
      hierarchyLevel: item.level,
      mappedRole: item.technicalRole,
      isHead: item.level === 6,
    };
    assert.equal(
      resolveEmployeeRoleV2({ department, designation }),
      expected.get(item.level)
    );
    assert.equal(
      resolveEmployeeSystemRole({ departmentName: "Sales", designation }),
      expected.get(item.level)
    );
  });
});

test("approved alternative Sales designations share level and technical access families", () => {
  const alternatives = [
    ["SALES_ASSISTANT_MANAGER_L3", 3, "sales_manager"],
    ["SALES_MANAGER_L3", 3, "sales_manager"],
    ["SALES_ASM_L2", 2, "sales_manager"],
    ["ASSISTANT_SALES_MANAGER", 2, "sales_manager"],
    ["FSD", 1, "sales_executive"],
  ];

  alternatives.forEach(([code, level, role]) => {
    const identity = identifySalesDesignation({ code, title: "Custom display title" });
    assert.equal(identity.definition.level, level);
    assert.equal(identity.definition.technicalRole, role);
    assert.equal(identity.ambiguous, false);
    assert.equal(
      resolveEmployeeRoleV2({
        department: { name: "Sales" },
        designation: { code, hierarchyLevel: level },
      }),
      role
    );
  });
});

test("title-only ambiguous legacy Sales Manager and ASM are not canonical authority", () => {
  assert.equal(identifySalesDesignation({ title: "Sales Manager" }).ambiguous, true);
  assert.equal(identifySalesDesignation({ title: "Assistant Manager" }).ambiguous, true);
  assert.equal(identifySalesDesignation({ title: "ASM" }).ambiguous, true);

  assert.equal(
    resolveEmployeeSystemRole({
      departmentName: "Sales",
      designation: { title: "Sales Manager", hierarchyLevel: 5 },
    }),
    "sales_manager",
    "legacy manager-title fallback remains available"
  );
  assert.equal(
    resolveEmployeeSystemRole({
      departmentName: "Sales",
      designation: { title: "Field Sales Executive", hierarchyLevel: 2 },
    }),
    "sales_executive",
    "legacy executive fallback remains available"
  );
});
