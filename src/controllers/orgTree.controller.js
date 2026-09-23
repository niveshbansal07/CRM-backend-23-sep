const ApiResponse = require("../utils/ApiResponse");
const {
    buildDefaultOrgTree,
    getMeOrgTree,
    getCompanyOrgTree,
    getCompanyOrgTreeExport,
    getOrgTreeGaps,
    getDepartmentOrgTree,
    getUserDownlineTree,
    getAllowedManagers,
} = require("../services/orgTree.service");

const getDefaultOrgTreeController = async (req, res, next) => {
    try {
        const data = buildDefaultOrgTree();

        return res.status(200).json(
            new ApiResponse(200, "Default organization tree fetched successfully", data)
        );
    } catch (error) {
        next(error);
    }
};

const getMyOrgTreeController = async (req, res, next) => {
    try {
        const data = await getMeOrgTree({ actorUser: req.user });

        return res.status(200).json(
            new ApiResponse(200, "My organization tree fetched successfully", data)
        );
    } catch (error) {
        next(error);
    }
};

const getCompanyOrgTreeController = async (req, res, next) => {
    try {
        const data = await getCompanyOrgTree({
            actorUser: req.user,
            companyId: req.query.companyId || null,
        });

        return res.status(200).json(
            new ApiResponse(200, "Company organization tree fetched successfully", data)
        );
    } catch (error) {
        next(error);
    }
};

const exportCompanyOrgTreeController = async (req, res, next) => {
    try {
        const data = await getCompanyOrgTreeExport({
            actorUser: req.user,
            companyId: req.query.companyId || null,
        });

        return res.status(200).json(
            new ApiResponse(200, "Company organization tree export fetched successfully", {
                count: data.length,
                items: data,
            })
        );
    } catch (error) {
        next(error);
    }
};

const getOrgTreeGapsController = async (req, res, next) => {
    try {
        const data = await getOrgTreeGaps({
            actorUser: req.user,
            companyId: req.query.companyId || null,
        });

        return res.status(200).json(
            new ApiResponse(200, "Organization tree gaps fetched successfully", data)
        );
    } catch (error) {
        next(error);
    }
};

const getDepartmentOrgTreeController = async (req, res, next) => {
    try {
        const data = await getDepartmentOrgTree({
            actorUser: req.user,
            departmentId: req.params.departmentId,
        });

        return res.status(200).json(
            new ApiResponse(200, "Department organization tree fetched successfully", data)
        );
    } catch (error) {
        next(error);
    }
};

const getUserDownlineTreeController = async (req, res, next) => {
    try {
        const data = await getUserDownlineTree({
            actorUser: req.user,
            userId: req.params.userId,
        });

        return res.status(200).json(
            new ApiResponse(200, "User downline fetched successfully", data)
        );
    } catch (error) {
        next(error);
    }
};

const getAllowedManagersController = async (req, res, next) => {
    try {
        const managers = await getAllowedManagers({
            actorUser: req.user,
            departmentId: req.query.departmentId,
            designationId: req.query.designationId,
            excludeUserId: req.query.excludeUserId || null,
            includeCrossDepartment: req.query.includeCrossDepartment === "true",
        });

        return res.status(200).json(
            new ApiResponse(200, "Allowed reporting managers fetched successfully", {
                count: managers.length,
                managers,
            })
        );
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getDefaultOrgTreeController,
    getMyOrgTreeController,
    getCompanyOrgTreeController,
    exportCompanyOrgTreeController,
    getOrgTreeGapsController,
    getDepartmentOrgTreeController,
    getUserDownlineTreeController,
    getAllowedManagersController,
};
