const mongoose = require("mongoose");

const roleSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },

        key: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            index: true,
        },

        description: {
            type: String,
            default: "",
        },

        permissions: {
            type: [String],
            default: [],
        },

        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            default: null, // null means global system role
            index: true,
        },

        isSystemRole: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true }
);

roleSchema.index({ key: 1, companyId: 1 }, { unique: true });

module.exports = mongoose.model("Role", roleSchema);