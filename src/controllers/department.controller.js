const ApiResponse = require("../utils/ApiResponse");
const {
  listDepartments,
  getAvailableDefaultDepartments,
  getDepartmentById,
  createDepartment,
  updateDepartment,
  updateDepartmentStatus,
  bulkCreateDefaultDepartments,
  archiveDepartment,
} = require("../services/department.service");
const { invalidateOrgTreeCache } = require("../services/orgTree.service");

const listDepartmentsController = async (req, res, next) => {
  try {
    const departments = await listDepartments({
      user: req.user,
      activeOnly: false,
    });

    return res.status(200).json(
      new ApiResponse(200, "Departments fetched successfully", {
        count: departments.length,
        departments,
      })
    );
  } catch (error) {
    next(error);
  }
};

const listActiveDepartmentsController = async (req, res, next) => {
  try {
    const departments = await listDepartments({
      user: req.user,
      activeOnly: true,
    });

    return res.status(200).json(
      new ApiResponse(200, "Active departments fetched successfully", {
        count: departments.length,
        departments,
      })
    );
  } catch (error) {
    next(error);
  }
};

const listDefaultDepartmentSeedsController = async (req, res, next) => {
  try {
    const departments = await getAvailableDefaultDepartments({
      user: req.user,
    });

    return res.status(200).json(
      new ApiResponse(200, "Default department seeds fetched successfully", {
        count: departments.length,
        departments,
      })
    );
  } catch (error) {
    next(error);
  }
};

const getDepartmentController = async (req, res, next) => {
  try {
    const department = await getDepartmentById({
      departmentId: req.params.id,
      user: req.user,
    });

    return res.status(200).json(
      new ApiResponse(200, "Department fetched successfully", {
        department,
      })
    );
  } catch (error) {
    next(error);
  }
};

const createDepartmentController = async (req, res, next) => {
  try {
    const department = await createDepartment({
      payload: req.validatedBody,
      user: req.user,
    });
    invalidateOrgTreeCache(req.user.companyId);

    return res.status(201).json(
      new ApiResponse(201, "Department created successfully", {
        department,
      })
    );
  } catch (error) {
    next(error);
  }
};

const bulkCreateDefaultDepartmentsController = async (req, res, next) => {
  try {
    const result = await bulkCreateDefaultDepartments({
      departmentKeys: req.validatedBody.departmentKeys,
      user: req.user,
    });
    invalidateOrgTreeCache(req.user.companyId);

    return res.status(201).json(
      new ApiResponse(201, "Default departments created successfully", result)
    );
  } catch (error) {
    next(error);
  }
};

const updateDepartmentController = async (req, res, next) => {
  try {
    const department = await updateDepartment({
      departmentId: req.params.id,
      payload: req.validatedBody,
      user: req.user,
    });
    invalidateOrgTreeCache(req.user.companyId);

    return res.status(200).json(
      new ApiResponse(200, "Department updated successfully", {
        department,
      })
    );
  } catch (error) {
    next(error);
  }
};

const updateDepartmentStatusController = async (req, res, next) => {
  try {
    const department = await updateDepartmentStatus({
      departmentId: req.params.id,
      status: req.validatedBody.status,
      user: req.user,
    });
    invalidateOrgTreeCache(req.user.companyId);

    return res.status(200).json(
      new ApiResponse(200, "Department status updated successfully", {
        department,
      })
    );
  } catch (error) {
    next(error);
  }
};

const archiveDepartmentController = async (req, res, next) => {
  try {
    const department = await archiveDepartment({
      departmentId: req.params.id,
      isArchived: req.validatedBody.isArchived,
      user: req.user,
    });
    invalidateOrgTreeCache(req.user.companyId);

    return res.status(200).json(
      new ApiResponse(
        200,
        department.isArchived
          ? "Department archived successfully"
          : "Department restored successfully",
        { department }
      )
    );
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listDepartmentsController,
  listActiveDepartmentsController,
  listDefaultDepartmentSeedsController,
  getDepartmentController,
  createDepartmentController,
  bulkCreateDefaultDepartmentsController,
  updateDepartmentController,
  updateDepartmentStatusController,
  archiveDepartmentController,
};
