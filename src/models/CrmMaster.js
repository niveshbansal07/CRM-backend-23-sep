const mongoose = require("mongoose");
const ApiError = require("../utils/ApiError");

const crmMasterSchema = new mongoose.Schema(
    {
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            required: true,
            index: true,
        },

        module: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },

        type: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },

        name: {
            type: String,
            required: true,
            trim: true,
        },

        normalizedName: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            default: function () {
                return normalizeName(this.name || "");
            },
        },

        code: {
            type: String,
            trim: true,
            uppercase: true,
        },

        description: {
            type: String,
            default: "",
            trim: true,
        },

        color: {
            type: String,
            default: "",
            trim: true,
        },

        sortOrder: {
            type: Number,
            default: 0,
        },

        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },

        isDefault: {
            type: Boolean,
            default: false,
        },

        isSystem: {
            type: Boolean,
            default: false,
        },

        isActive: {
            type: Boolean,
            default: true,
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

const normalizeName = (value = "") => value.trim().toLowerCase().replace(/\s+/g, " ");

crmMasterSchema.pre("validate", function (next) {
    if (this.module) this.module = this.module.trim().toLowerCase();
    if (this.type) this.type = this.type.trim().toLowerCase();
    if (this.name) this.normalizedName = normalizeName(this.name);
    if (this.code) {
        this.code = this.code.trim().toUpperCase();
    } else {
        this.code = undefined;
    }
    next();
});

crmMasterSchema.pre("save", async function (next) {
    try {
        const query = {
            companyId: this.companyId,
            module: this.module,
            type: this.type,
            normalizedName: this.normalizedName,
            _id: { $ne: this._id },
        };

        const existingName = await this.constructor.findOne(query).select("_id").lean();
        if (existingName) {
            throw new ApiError(400, "Master name already exists for this company, module and type");
        }

        if (this.code) {
            const existingCode = await this.constructor
                .findOne({
                    companyId: this.companyId,
                    module: this.module,
                    type: this.type,
                    code: this.code,
                    _id: { $ne: this._id },
                })
                .select("_id")
                .lean();

            if (existingCode) {
                throw new ApiError(400, "Master code already exists for this company, module and type");
            }
        }

        next();
    } catch (error) {
        next(error);
    }
});

crmMasterSchema.index({ companyId: 1, module: 1, type: 1, isActive: 1 });
crmMasterSchema.index(
    { companyId: 1, module: 1, type: 1, code: 1 },
    {
        unique: true,
        sparse: true,
    }
);
crmMasterSchema.index(
    { companyId: 1, module: 1, type: 1, normalizedName: 1 },
    {
        unique: true,
    }
);

module.exports = mongoose.model("CrmMaster", crmMasterSchema);
