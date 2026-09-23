const ApiResponse = require("../utils/ApiResponse");
const { getEligibleReportingManagers } = require("../services/reportingManager.service");

const getEligibleReportingManagersController = async (req, res, next) => {
    try {
        const managers = await getEligibleReportingManagers({
            user: req.user,
            departmentId: req.query.departmentId,
            designationId: req.query.designationId,
            excludeUserId: req.query.excludeUserId || null,
            includeCrossDepartment: req.query.includeCrossDepartment === "true",
        });

        return res.status(200).json(
            new ApiResponse(200, "Eligible reporting managers fetched successfully", {
                count: managers.length,
                managers,
            })
        );
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getEligibleReportingManagersController,
};
