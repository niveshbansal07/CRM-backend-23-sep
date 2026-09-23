const mongoose = require("mongoose");

const refreshTokenSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        token: {
            type: String,
            required: true,
            index: true,
        },

        expiresAt: {
            type: Date,
            required: true,
            index: true,
        },

        isRevoked: {
            type: Boolean,
            default: false,
            index: true,
        },

        userAgent: {
            type: String,
            default: "",
        },

        ipAddress: {
            type: String,
            default: "",
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("RefreshToken", refreshTokenSchema);