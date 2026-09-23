const mongoose = require("mongoose");

const visitTypeSchema = new mongoose.Schema(
    {
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            required: true,
            index: true,
        },

        name: {
            type: String,
            required: true,
            trim: true,
        },

        code: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },

        description: {
            type: String,
            default: "",
            trim: true,
        },

        allowedEntityTypes: {
            type: [String],
            enum: ["Lead", "Account", "Dealer", "Distributor", "Customer"],
            default: ["Lead"],
        },

        expectedDurationMinutes: {
            type: Number,
            default: 15,
            min: 0,
        },

        requiresCheckInLocation: {
            type: Boolean,
            default: true,
        },

        requiresCheckOutLocation: {
            type: Boolean,
            default: true,
        },

        requiresPhoto: {
            type: Boolean,
            default: false,
        },

        requiresOutcome: {
            type: Boolean,
            default: true,
        },

        requiresNextFollowUp: {
            type: Boolean,
            default: false,
        },

        requiresProductDiscussion: {
            type: Boolean,
            default: false,
        },

        allowsOrderCreation: {
            type: Boolean,
            default: false,
        },

        formLayoutId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "CustomFormLayout",
            default: null,
        },

        color: {
            type: String,
            default: "",
            trim: true,
        },

        isActive: {
            type: Boolean,
            default: true,
            index: true,
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
    },
    {
        timestamps: true,
    }
);

visitTypeSchema.pre("validate", function (next) {
    if (this.name) this.name = this.name.trim().replace(/\s+/g, " ");
    if (this.code) this.code = this.code.trim().toLowerCase().replace(/\s+/g, "_");
    next();
});

visitTypeSchema.index({ companyId: 1, code: 1 }, { unique: true });
visitTypeSchema.index({ companyId: 1, isActive: 1 });

module.exports = mongoose.model("VisitType", visitTypeSchema);
