const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const SYSTEM_ROLE_VALUES = [
  "super_admin",
  "company_admin",
  "sub_admin",
  "hr_head",
  "hr_manager",
  "hr_general",
  "hr_executive",
  "manager",
  "sales_head",
  "sales_manager",
  "sales_executive",
  "employee",
  "user",
];

const userSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
      index: true,
    },

    fullName: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    email: {
      type: String,
      required: true,
      lowercase: true,
      unique: true,
      index: true,
      trim: true,
    },

    phone: {
      type: String,
      trim: true,
      default: "",
    },

    passwordHash: {
      type: String,
      required: true,
      select: false,
    },

    avatar: {
      type: String,
      default: "",
    },

    role: {
      type: String,
      enum: SYSTEM_ROLE_VALUES,
      default: "user",
      index: true,
    },

    systemRole: {
      type: String,
      enum: SYSTEM_ROLE_VALUES,
      default: null,
      index: true,
    },

    permissionScope: {
      type: String,
      enum: ["self", "team", "department", "company", "custom", "global"],
      default: "self",
      index: true,
    },

    customPermissions: {
      type: [String],
      default: [],
    },

    department: {
      type: String,
      default: "",
    },

    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
      index: true,
    },

    designation: {
      type: String,
      default: "",
    },

    designationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Designation",
      default: null,
      index: true,
    },

    employeeId: {
      type: String,
      default: "",
      index: true,
    },

    // Frontend sync
    managerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    reportingManagerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    // Employee setup flow
    joiningDate: {
      type: Date,
      default: null,
    },

    employmentType: {
      type: String,
      enum: ["full_time", "part_time", "contract", "intern", "probation"],
      default: "full_time",
    },

    probationEndDate: {
      type: Date,
      default: null,
    },

    sourceRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EmployeeRequest",
      default: null,
      index: true,
    },

    setupCompleted: {
      type: Boolean,
      default: false,
    },

    setupCompletedAt: {
      type: Date,
      default: null,
    },

    status: {
      type: String,
      enum: ["active", "invited", "suspended", "disabled"],
      default: "active",
      index: true,
    },

    isEmailVerified: {
      type: Boolean,
      default: false,
    },

    loginAttempts: {
      type: Number,
      default: 0,
    },

    lockUntil: {
      type: Date,
      default: null,
    },

    lastLoginAt: {
      type: Date,
      default: null,
    },

    lastActiveAt: {
      type: Date,
      default: null,
    },

    offboardedAt: {
      type: Date,
      default: null,
    },

    offboardedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    offboardReason: {
      type: String,
      default: null,
    },

    statusHistory: [{
      status: {
        type: String,
      },
      changedAt: {
        type: Date,
      },
      changedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      reason: {
        type: String,
      },
    }],

    profileCompletionPercent: {
      type: Number,
      default: 0,
    },

    permissionsVersion: {
      type: Number,
      default: 1,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Sanitize name
userSchema.pre("save", function (next) {
  if (this.fullName) {
    this.fullName = this.fullName.trim().replace(/\s+/g, " ");
  }
  if (!this.systemRole && this.role) {
    this.systemRole = this.role;
  }
  if (this.reportingManagerId && !this.managerId) {
    this.managerId = this.reportingManagerId;
  }
  if (this.managerId && !this.reportingManagerId) {
    this.reportingManagerId = this.managerId;
  }
  next();
});

// Password compare
userSchema.methods.comparePassword = async function (plainPassword) {
  return bcrypt.compare(plainPassword, this.passwordHash);
};

// Safe response for frontend
userSchema.methods.toSafeObject = function () {
  return {
    id: this._id,
    fullName: this.fullName,
    email: this.email,
    phone: this.phone,
    role: this.role,
    systemRole: this.systemRole || this.role,
    permissionScope: this.permissionScope,
    customPermissions: this.customPermissions || [],
    companyId: this.companyId,

    department: this.department,
    departmentId: this.departmentId,
    designation: this.designation,
    designationId: this.designationId,
    employeeId: this.employeeId,

    managerId: this.managerId,
    reportingManagerId: this.reportingManagerId || this.managerId,
    joiningDate: this.joiningDate,

    sourceRequestId: this.sourceRequestId,
    setupCompleted: this.setupCompleted,
    setupCompletedAt: this.setupCompletedAt,

    status: this.status,
    isEmailVerified: this.isEmailVerified,
    lastLoginAt: this.lastLoginAt,

    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

userSchema.index(
  { companyId: 1, employeeId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      deletedAt: null,
      employeeId: { $type: "string", $gt: "" },
    },
  }
);
userSchema.index({ companyId: 1, role: 1, status: 1 });
userSchema.index({ companyId: 1, status: 1, role: 1 });
userSchema.index({ companyId: 1, departmentId: 1, status: 1 });
userSchema.index({ companyId: 1, designationId: 1, status: 1 });
userSchema.index({ companyId: 1, reportingManagerId: 1, status: 1 });

module.exports = mongoose.model("User", userSchema);
