const {
    createEmployeeRequest,
    getEmployeeRequests,
    getEmployeeRequestStats,
    approveEmployeeRequest,
    rejectEmployeeRequest,
} = require("../services/employeeRequest.service");

const createRequest = async (req, res, next) => {
    try {
        const request = await createEmployeeRequest({
            payload: req.validatedBody || req.body,
            user: req.user,
        });

        res.status(201).json({
            success: true,
            message: "Employee request created successfully.",
            data: request,
        });
    } catch (error) {
        next(error);
    }
};

const listRequests = async (req, res, next) => {
    try {
        const requests = await getEmployeeRequests({
            user: req.user,
            status: req.query.status,
            scope: req.query.scope,
        });

        res.status(200).json({
            success: true,
            message: "Employee requests fetched successfully.",
            data: requests,
        });
    } catch (error) {
        next(error);
    }
};

const listMyRequests = async (req, res, next) => {
    try {
        const requests = await getEmployeeRequests({
            user: req.user,
            status: req.query.status,
            scope: "my",
        });

        res.status(200).json({
            success: true,
            message: "My employee requests fetched successfully.",
            data: requests,
        });
    } catch (error) {
        next(error);
    }
};

const listAssignedRequests = async (req, res, next) => {
    try {
        const requests = await getEmployeeRequests({
            user: req.user,
            status: req.query.status,
            scope: "assigned",
        });

        res.status(200).json({
            success: true,
            message: "Assigned employee requests fetched successfully.",
            data: requests,
        });
    } catch (error) {
        next(error);
    }
};

const getRequestStats = async (req, res, next) => {
    try {
        const stats = await getEmployeeRequestStats({
            user: req.user,
        });

        res.status(200).json({
            success: true,
            message: "Employee request stats fetched successfully.",
            data: stats,
        });
    } catch (error) {
        next(error);
    }
};

const approveRequest = async (req, res, next) => {
    try {
        const result = await approveEmployeeRequest({
            requestId: req.params.id,
            user: req.user,
            comments: req.validatedBody?.comments || req.body.comments,
            internalNotes: req.validatedBody?.internalNotes || req.body.internalNotes,
        });

        res.status(200).json({
            success: true,
            message: "Employee request approved successfully.",
            data: result,
        });
    } catch (error) {
        next(error);
    }
};

const rejectRequest = async (req, res, next) => {
    try {
        const request = await rejectEmployeeRequest({
            requestId: req.params.id,
            user: req.user,
            rejectionReason:
                req.validatedBody?.rejectionReason ||
                req.body.rejectionReason ||
                req.body.reason,
            comments: req.validatedBody?.comments || req.body.comments,
            internalNotes: req.validatedBody?.internalNotes || req.body.internalNotes,
        });

        res.status(200).json({
            success: true,
            message: "Employee request rejected successfully.",
            data: request,
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    createRequest,
    listRequests,
    listMyRequests,
    listAssignedRequests,
    getRequestStats,
    approveRequest,
    rejectRequest,
};
