const mongoose = require("mongoose");

const EMPLOYMENT_TYPES = ["full_time", "part_time", "intern", "contract", "probation"];
const INDIAN_PHONE_REGEX = /^(\+91[\-\s]?)?[6-9]\d{9}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeString = (value = "") => String(value || "").trim().replace(/\s+/g, " ");

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const validateEmployeeRequestPayload = (req, res, next) => {
    const body = req.body || {};
    const errors = [];

    const fullName = normalizeString(body.fullName);
    const email = normalizeString(body.email).toLowerCase();
    const phone = normalizeString(body.phone || body.mobile);
    const mobile = normalizeString(body.mobile || body.phone);
    const department = normalizeString(body.department || body.requestedDepartmentName);
    const designation = normalizeString(body.designation || body.requestedDesignationName);
    const departmentId = body.departmentId || body.requestedDepartmentId
        ? String(body.departmentId || body.requestedDepartmentId).trim()
        : null;
    const designationId = body.designationId || body.requestedDesignationId
        ? String(body.designationId || body.requestedDesignationId).trim()
        : null;
    const requestedRole = normalizeString(body.requestedRole || body.role);
    const managerId = body.managerId || body.reportingManagerId || body.requestedReportingManagerId
        ? String(body.managerId || body.reportingManagerId || body.requestedReportingManagerId).trim()
        : null;
    const joiningDate = body.joiningDate ? new Date(body.joiningDate) : null;
    const employmentType = body.employmentType || "full_time";

    if (!fullName || fullName.length < 2) {
        errors.push("Full name must be at least 2 characters.");
    }

    if (!email) {
        errors.push("A valid email is required.");
    } else if (!EMAIL_REGEX.test(email)) {
        errors.push("A valid email is required.");
    }

    if (phone && !INDIAN_PHONE_REGEX.test(phone.replace(/\s+/g, ""))) {
        errors.push("Phone must be a valid Indian mobile number.");
    }

    if (!department && !departmentId) {
        errors.push("Department is required.");
    }

    if (!designation && !designationId) {
        errors.push("Designation is required.");
    }

    if (departmentId && !isValidObjectId(departmentId)) {
        errors.push("Department id must be a valid ObjectId.");
    }

    if (designationId && !isValidObjectId(designationId)) {
        errors.push("Designation id must be a valid ObjectId.");
    }

    if (managerId && !isValidObjectId(managerId)) {
        errors.push("Manager id must be a valid ObjectId.");
    }

    if (joiningDate && Number.isNaN(joiningDate.getTime())) {
        errors.push("Joining date must be a valid date.");
    }

    if (!EMPLOYMENT_TYPES.includes(employmentType)) {
        errors.push("Employment type is invalid.");
    }

    if (errors.length) {
        return res.status(400).json({
            success: false,
            message: "Validation failed.",
            errors,
        });
    }

    req.validatedBody = {
        fullName,
        email,
        phone,
        mobile,
        department,
        designation,
        departmentId,
        designationId,
        requestedRole,
        employeeId: normalizeString(body.employeeId),
        managerId,
        joiningDate,
        employmentType,
        note: normalizeString(body.note || body.notes),
    };

    next();
};

const validateReviewPayload = (req, res, next) => {
    const remark = normalizeString(req.body?.remark || req.body?.approvalRemark);
    const rejectionReason = normalizeString(req.body?.reason || req.body?.rejectionReason);
    const comments = normalizeString(req.body?.comments || remark);
    const internalNotes = normalizeString(req.body?.internalNotes);

    req.validatedBody = {
        remark,
        approvalRemark: remark,
        rejectionReason,
        comments,
        internalNotes,
    };

    next();
};

module.exports = {
    validateEmployeeRequestPayload,
    validateReviewPayload,
    EMPLOYMENT_TYPES,
};
