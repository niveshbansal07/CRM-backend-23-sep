const { isSalesDepartment } = require("../constants/salesHierarchy");
const {
  evaluateSalesPlacementForEmployee,
} = require("./salesGeographyAssignment.service");

const evaluateSalesPlacementAfterOnboarding = async ({
  employee,
  department,
  companyId,
  dependencies = {},
}) => {
  if (!isSalesDepartment(department)) {
    return {
      salesPlacement: {
        applicable: false,
        hierarchyLevel: null,
        designation: null,
        technicalRole: employee?.systemRole || employee?.role || null,
        geographyType: null,
        status: "NOT_APPLICABLE",
        currentGeography: null,
      },
      warning: null,
    };
  }

  const evaluatePlacement = dependencies.evaluateSalesPlacement || evaluateSalesPlacementForEmployee;
  const logger = dependencies.logger || console;
  try {
    return {
      salesPlacement: await evaluatePlacement({
        employeeId: employee?._id,
        companyId,
        dependencies: dependencies.assignmentDependencies || {},
      }),
      warning: null,
    };
  } catch (error) {
    logger.warn?.("Sales placement readiness evaluation failed after employee setup", {
      employeeId: employee?._id,
      companyId,
      error: error?.message,
    });
    return {
      salesPlacement: null,
      warning: "Employee created successfully, but Sales Geography placement readiness could not be evaluated yet",
    };
  }
};

module.exports = {
  evaluateSalesPlacementAfterOnboarding,
};
