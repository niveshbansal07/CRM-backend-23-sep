const ApiResponse = require("../utils/ApiResponse");
const {
  listDesignations,
  getAvailableDefaultDesignations,
  getDesignationById,
  createDesignation,
  updateDesignation,
  updateDesignationStatus,
  bulkCreateDefaultDesignations,
  archiveDesignation,
} = require("../services/designation.service");
const {
  previewSalesHierarchy,
  applySalesHierarchy,
} = require("../services/salesHierarchy.service");
const { invalidateOrgTreeCache } = require("../services/orgTree.service");

const listDesignationsController = async (req, res, next) => {
  try {
    const designations = await listDesignations({
      user: req.user,
      activeOnly: req.query.active === "true",
    });

    return res.status(200).json(
      new ApiResponse(200, "Designations fetched successfully", {
        count: designations.length,
        designations,
      })
    );
  } catch (error) {
    next(error);
  }
};

const listDesignationsByDepartmentController = async (req, res, next) => {
  try {
    const designations = await listDesignations({
      user: req.user,
      departmentId: req.params.departmentId,
      activeOnly: true,
    });

    return res.status(200).json(
      new ApiResponse(200, "Department designations fetched successfully", {
        count: designations.length,
        designations,
      })
    );
  } catch (error) {
    next(error);
  }
};

const listDefaultDesignationSeedsController = async (req, res, next) => {
  try {
    const result = await getAvailableDefaultDesignations({
      departmentId: req.params.departmentId,
      user: req.user,
    });

    return res.status(200).json(
      new ApiResponse(200, "Default designation seeds fetched successfully", {
        department: result.department,
        count: result.designations.length,
        designations: result.designations,
      })
    );
  } catch (error) {
    next(error);
  }
};

const getDesignationController = async (req, res, next) => {
  try {
    const designation = await getDesignationById({
      designationId: req.params.id,
      user: req.user,
    });

    return res.status(200).json(
      new ApiResponse(200, "Designation fetched successfully", {
        designation,
      })
    );
  } catch (error) {
    next(error);
  }
};

const createDesignationController = async (req, res, next) => {
  try {
    const designation = await createDesignation({
      payload: req.validatedBody,
      user: req.user,
    });
    invalidateOrgTreeCache(req.user.companyId);

    return res.status(201).json(
      new ApiResponse(201, "Designation created successfully", {
        designation,
      })
    );
  } catch (error) {
    next(error);
  }
};

const bulkCreateDefaultDesignationsController = async (req, res, next) => {
  try {
    const result = await bulkCreateDefaultDesignations({
      departmentId: req.validatedBody.departmentId,
      designationKeys: req.validatedBody.designationKeys,
      user: req.user,
    });
    invalidateOrgTreeCache(req.user.companyId);

    return res.status(201).json(
      new ApiResponse(201, "Default designations created successfully", result)
    );
  } catch (error) {
    next(error);
  }
};

const updateDesignationController = async (req, res, next) => {
  try {
    const designation = await updateDesignation({
      designationId: req.params.id,
      payload: req.validatedBody,
      user: req.user,
    });
    invalidateOrgTreeCache(req.user.companyId);

    return res.status(200).json(
      new ApiResponse(200, "Designation updated successfully", {
        designation,
      })
    );
  } catch (error) {
    next(error);
  }
};

const updateDesignationStatusController = async (req, res, next) => {
  try {
    const designation = await updateDesignationStatus({
      designationId: req.params.id,
      status: req.validatedBody.status,
      user: req.user,
    });
    invalidateOrgTreeCache(req.user.companyId);

    return res.status(200).json(
      new ApiResponse(200, "Designation status updated successfully", {
        designation,
      })
    );
  } catch (error) {
    next(error);
  }
};

const archiveDesignationController = async (req, res, next) => {
  try {
    const designation = await archiveDesignation({
      designationId: req.params.id,
      isArchived: req.validatedBody.isArchived,
      user: req.user,
    });
    invalidateOrgTreeCache(req.user.companyId);

    return res.status(200).json(
      new ApiResponse(
        200,
        designation.isArchived
          ? "Designation archived successfully"
          : "Designation restored successfully",
        { designation }
      )
    );
  } catch (error) {
    next(error);
  }
};

const previewSalesHierarchyController = async (req, res, next) => {
  try {
    const preview = await previewSalesHierarchy({ user: req.user });
    return res.status(200).json(
      new ApiResponse(200, "Sales hierarchy preview generated successfully", preview)
    );
  } catch (error) {
    next(error);
  }
};

const applySalesHierarchyController = async (req, res, next) => {
  try {
    const result = await applySalesHierarchy({ user: req.user });
    if (result.changed) invalidateOrgTreeCache(req.user.companyId);
    return res.status(200).json(
      new ApiResponse(200, "Sales hierarchy applied safely", result)
    );
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listDesignationsController,
  listDesignationsByDepartmentController,
  listDefaultDesignationSeedsController,
  getDesignationController,
  createDesignationController,
  bulkCreateDefaultDesignationsController,
  updateDesignationController,
  updateDesignationStatusController,
  archiveDesignationController,
  previewSalesHierarchyController,
  applySalesHierarchyController,
};
