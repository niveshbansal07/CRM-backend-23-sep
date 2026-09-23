const mongoose = require("mongoose");

const leadTypeSchema = new mongoose.Schema(
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

        defaultStatusCode: {
            type: String,
            default: "new",
            trim: true,
            lowercase: true,
        },

        expectedConversionDays: {
            type: Number,
            default: 30,
            min: 0,
        },

        requiresDistributorLink: {
            type: Boolean,
            default: false,
        },

        requiresDealerLink: {
            type: Boolean,
            default: false,
        },

        requiresLocationCapture: {
            type: Boolean,
            default: true,
        },

        requiresProductInterest: {
            type: Boolean,
            default: false,
        },

        requiresCompanyName: {
            type: Boolean,
            default: false,
        },

        requiresGSTNumber: {
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

leadTypeSchema.pre("validate", function (next) {
    if (this.name) this.name = this.name.trim().replace(/\s+/g, " ");
    if (this.code) this.code = this.code.trim().toLowerCase().replace(/\s+/g, "_");
    if (this.defaultStatusCode) {
        this.defaultStatusCode = this.defaultStatusCode.trim().toLowerCase().replace(/\s+/g, "_");
    }
    next();
});

leadTypeSchema.index({ companyId: 1, code: 1 }, { unique: true });
leadTypeSchema.index({ companyId: 1, isActive: 1 });

module.exports = mongoose.model("LeadType", leadTypeSchema);
