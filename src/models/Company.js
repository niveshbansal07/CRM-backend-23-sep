const mongoose = require("mongoose");

const companySchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },

        legalName: {
            type: String,
            default: "",
            trim: true,
        },

        slug: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
            index: true,
        },

        domain: {
            type: String,
            default: "",
            trim: true,
            lowercase: true,
        },

        industry: {
            type: String,
            default: "Other",
            trim: true,
        },

        email: {
            type: String,
            default: "",
            lowercase: true,
            trim: true,
        },

        phone: {
            type: String,
            default: "",
            trim: true,
        },

        address: {
            type: String,
            default: "",
            trim: true,
        },

        website: {
            type: String,
            default: "",
            trim: true,
        },

        logo: {
            type: String,
            default: "",
        },

        enabledModules: {
            type: [String],
            default: [],
        },

        status: {
            type: String,
            enum: ["active", "inactive", "suspended"],
            default: "active",
            index: true,
        },

        plan: {
            type: String,
            enum: ["free", "starter", "pro", "enterprise"],
            default: "free",
        },

        ownerUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
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

module.exports = mongoose.model("Company", companySchema);