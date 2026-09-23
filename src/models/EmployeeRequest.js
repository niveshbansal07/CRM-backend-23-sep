const mongoose = require("mongoose");

const employeeRequestSchema = new mongoose.Schema(
    {
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            required: true,
            index: true,
        },

        requestNumber: {
            type: String,
            trim: true,
        },

        requestedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        reviewedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },

        assignedTo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
            index: true,
        },

        approverRole: {
            type: String,
            trim: true,
            default: "",
        },

        approvalLevel: {
            type: Number,
            default: null,
        },

        approvalHistory: [{
            action: {
                type: String,
                trim: true,
            },
            actionBy: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User",
            },
            actionAt: {
                type: Date,
            },
            comments: {
                type: String,
                trim: true,
            },
            internalNotes: {
                type: String,
                trim: true,
            },
        }],

        approverReason: {
            type: String,
            trim: true,
            default: "",
        },

        createdUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },

        employeeData: {
            fullName: {
                type: String,
                required: true,
                trim: true,
            },
            email: {
                type: String,
                trim: true,
                lowercase: true,
                default: "",
            },
            phone: {
                type: String,
                trim: true,
                default: "",
            },
            mobile: {
                type: String,
                trim: true,
                default: "",
            },
            department: {
                type: String,
                required: true,
                trim: true,
            },
            designation: {
                type: String,
                required: true,
                trim: true,
            },
        },

        email: {
            type: String,
            trim: true,
            lowercase: true,
            default: "",
        },

        phone: {
            type: String,
            trim: true,
            default: "",
        },

        mobile: {
            type: String,
            trim: true,
            default: "",
        },

        requestedDepartmentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Department",
            default: null,
            index: true,
        },

        requestedDepartmentName: {
            type: String,
            trim: true,
            default: "",
        },

        requestedDesignationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Designation",
            default: null,
            index: true,
        },

        requestedDesignationName: {
            type: String,
            trim: true,
            default: "",
        },

        requestedRole: {
            type: String,
            trim: true,
            default: "",
            index: true,
        },

        requestedReportingManagerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },

        requestedHierarchyLevel: {
            type: Number,
            default: null,
        },

        requestType: {
            type: String,
            enum: ["employee_create", "department_head_create"],
            default: "employee_create",
            index: true,
        },

        status: {
            type: String,
            enum: ["pending", "approved", "setup_pending", "completed", "rejected", "declined", "cancelled"],
            default: "pending",
            index: true,
        },

        note: {
            type: String,
            trim: true,
            default: "",
        },

        rejectionReason: {
            type: String,
            trim: true,
            default: "",
        },

        reviewedAt: {
            type: Date,
            default: null,
        },

        approvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },

        approvedAt: {
            type: Date,
            default: null,
        },

        declinedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },

        declinedAt: {
            type: Date,
            default: null,
        },

        setupBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },

        setupDeadline: {
            type: Date,
        },

        setupAt: {
            type: Date,
            default: null,
        },

        isUrgent: {
            type: Boolean,
            default: false,
        },

        isOverdue: {
            type: Boolean,
            default: false,
            index: true,
        },

        setupCompleted: {
            type: Boolean,
            default: false,
            index: true,
        },

        setupCompletedAt: {
            type: Date,
            default: null,
        },

        employeeId: {
            type: String,
            trim: true,
            default: "",
        },

        reportingManagerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },

        joiningDate: {
            type: Date,
            default: null,
        },

        setupNote: {
            type: String,
            trim: true,
            default: "",
        },

        isOnboarded: {
            type: Boolean,
            default: false,
            index: true,
        },

        onboardedAt: {
            type: Date,
            default: null,
        },

        deletedAt: {
            type: Date,
            default: null,
            index: true,
        },
    },
    { timestamps: true }
);

employeeRequestSchema.pre("save", async function (next) {
    if (this.requestNumber) {
        return next();
    }

    try {
        const year = (this.createdAt || new Date()).getFullYear();
        const prefix = `ER-${year}-`;
        const count = await this.constructor.countDocuments({
            requestNumber: { $regex: `^${prefix}` },
        });
        this.requestNumber = `${prefix}${String(count + 1).padStart(3, "0")}`;
        return next();
    } catch (error) {
        return next(error);
    }
});

employeeRequestSchema.index({
    companyId: 1,
    status: 1,
});

employeeRequestSchema.index({
    companyId: 1,
    status: 1,
    requestedBy: 1,
});

employeeRequestSchema.index({
    companyId: 1,
    status: 1,
    assignedTo: 1,
});

employeeRequestSchema.index({
    companyId: 1,
    status: 1,
    isOnboarded: 1,
});

employeeRequestSchema.index({
    companyId: 1,
    requestedDepartmentId: 1,
    requestedDesignationId: 1,
    status: 1,
});

employeeRequestSchema.index({ assignedTo: 1, status: 1 });

module.exports = mongoose.model("EmployeeRequest", employeeRequestSchema);
