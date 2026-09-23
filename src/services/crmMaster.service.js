const mongoose = require("mongoose");
const CrmMaster = require("../models/CrmMaster");
const ApiError = require("../utils/ApiError");
const { DEFAULT_CRM_MASTERS } = require("../seeds/crmMasterDefaults");

const normalizeName = (value = "") => value.trim().toLowerCase().replace(/\s+/g, " ");

const assertCompanyId = (companyId) => {
    if (!companyId) {
        throw new ApiError(400, "Company context is required");
    }
};

const buildFilter = (companyId, filters = {}) => {
    assertCompanyId(companyId);

    const query = { companyId };

    if (filters.module) query.module = String(filters.module).trim().toLowerCase();
    if (filters.type) query.type = String(filters.type).trim().toLowerCase();
    if (filters.isActive !== undefined) {
        query.isActive = filters.isActive === true || filters.isActive === "true";
    }

    return query;
};

const seedCompanyMasters = async (companyId, createdBy = null) => {
    assertCompanyId(companyId);

    const operations = DEFAULT_CRM_MASTERS.map((master) => ({
        updateOne: {
            filter: {
                companyId,
                module: master.module,
                type: master.type,
                normalizedName: normalizeName(master.name),
            },
            update: {
                $setOnInsert: {
                    ...master,
                    companyId,
                    normalizedName: normalizeName(master.name),
                    createdBy,
                    updatedBy: createdBy,
                },
            },
            upsert: true,
        },
    }));

    if (!operations.length) return { inserted: 0 };

    const result = await CrmMaster.bulkWrite(operations, { ordered: false });
    const seeded = result.upsertedCount || 0;

    return {
        seeded,
        skipped: DEFAULT_CRM_MASTERS.length - seeded,
    };
};

const ensureCompanyMasters = async (companyId, createdBy = null) => {
    assertCompanyId(companyId);
    const count = await CrmMaster.countDocuments({ companyId });
    if (count > 0) return { seeded: false, count };

    const result = await seedCompanyMasters(companyId, createdBy);
    return { seeded: true, ...result };
};

const getMasters = async (companyId, filters = {}) => {
    const query = buildFilter(companyId, filters);
    return CrmMaster.find(query).sort({ module: 1, type: 1, sortOrder: 1, name: 1 }).lean();
};

const getMasterTypes = async (companyId) => {
    assertCompanyId(companyId);

    const rows = await CrmMaster.aggregate([
        { $match: { companyId: new mongoose.Types.ObjectId(companyId) } },
        {
            $group: {
                _id: { module: "$module", type: "$type" },
                total: { $sum: 1 },
                active: {
                    $sum: {
                        $cond: ["$isActive", 1, 0],
                    },
                },
            },
        },
        { $sort: { "_id.module": 1, "_id.type": 1 } },
    ]);

    return rows.map((row) => ({
        module: row._id.module,
        type: row._id.type,
        total: row.total,
        active: row.active,
    }));
};

const createMaster = async (companyId, data, createdBy = null) => {
    assertCompanyId(companyId);

    if (data.isSystem === true) {
        throw new ApiError(403, "System masters cannot be created from API");
    }

    return CrmMaster.create({
        ...data,
        companyId,
        isSystem: false,
        createdBy,
        updatedBy: createdBy,
    });
};

const updateMaster = async (id, companyId, data, updatedBy = null) => {
    assertCompanyId(companyId);

    const master = await CrmMaster.findOne({ _id: id, companyId });
    if (!master) {
        throw new ApiError(404, "CRM master not found");
    }

    if (master.isSystem && data.name !== undefined && data.name !== master.name) {
        throw new ApiError(403, "System master name cannot be changed");
    }

    const blockedFields = ["companyId", "module", "type", "isSystem", "createdBy", "createdAt"];
    blockedFields.forEach((field) => {
        delete data[field];
    });

    Object.keys(data).forEach((field) => {
        master[field] = data[field];
    });
    master.updatedBy = updatedBy;

    await master.save();
    return master;
};

const deactivateMaster = async (id, companyId, isActive, updatedBy = null) => {
    assertCompanyId(companyId);

    const master = await CrmMaster.findOne({ _id: id, companyId });
    if (!master) {
        throw new ApiError(404, "CRM master not found");
    }

    if (master.isSystem) {
        throw new ApiError(403, "System masters cannot be activated or deactivated");
    }

    master.isActive = Boolean(isActive);
    master.updatedBy = updatedBy;
    await master.save();
    return master;
};

const getOptionalModel = (modelName) => {
    if (mongoose.models[modelName]) return mongoose.models[modelName];

    try {
        return require(`../models/${modelName}`);
    } catch (error) {
        return null;
    }
};

const countMasterUsage = async (master) => {
    const referenceMap = [
        { model: "Lead", fields: ["sourceMasterId", "statusMasterId", "priorityMasterId", "lostReasonMasterId"] },
        { model: "Account", fields: ["accountTypeMasterId", "dealerTypeMasterId", "distributorTypeMasterId"] },
        { model: "Visit", fields: ["purposeMasterId", "outcomeMasterId"] },
        {
            model: "Product",
            fields: [
                "materialTypeId",
                "materialGroupId",
                "divisionId",
                "purchasingGroupId",
                "procurementTypeId",
                "mrpTypeId",
                "taxClassificationId",
                "priceControlId",
                "countryOfOriginId",
            ],
        },
        { model: "Order", fields: ["orderStatus", "paymentStatus"] },
        { model: "OrderItem", fields: ["discountTypeId"] },
    ];

    let usageCount = 0;

    for (const reference of referenceMap) {
        const Model = getOptionalModel(reference.model);
        if (!Model) continue;

        const schemaPaths = Model.schema?.paths || {};
        const usableFields = reference.fields.filter((field) => schemaPaths[field]);
        if (!usableFields.length) continue;

        const count = await Model.countDocuments({
            companyId: master.companyId,
            $or: usableFields.map((field) => ({ [field]: master._id })),
        });
        usageCount += count;
    }

    return usageCount;
};

const deleteMaster = async (id, companyId) => {
    assertCompanyId(companyId);

    const master = await CrmMaster.findOne({ _id: id, companyId });
    if (!master) {
        throw new ApiError(404, "CRM master not found");
    }

    if (master.isSystem) {
        throw new ApiError(403, "System masters cannot be deleted");
    }

    const usageCount = await countMasterUsage(master);
    if (usageCount > 0) {
        master.isActive = false;
        await master.save();

        return {
            deleted: false,
            reason: "In use",
            usageCount,
        };
    }

    await master.deleteOne();
    return {
        deleted: true,
        usageCount: 0,
    };
};

module.exports = {
    seedCompanyMasters,
    ensureCompanyMasters,
    getMasters,
    getMasterTypes,
    createMaster,
    updateMaster,
    deactivateMaster,
    deleteMaster,
};
