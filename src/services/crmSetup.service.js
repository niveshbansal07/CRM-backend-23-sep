const LeadType = require("../models/LeadType");
const VisitType = require("../models/VisitType");
const ApiError = require("../utils/ApiError");
const { DEFAULT_LEAD_TYPES, DEFAULT_VISIT_TYPES } = require("../seeds/crmTypeDefaults");

const assertCompanyId = (companyId) => {
    if (!companyId) {
        throw new ApiError(400, "Company context is required");
    }
};

const normalizeCode = (value = "") => value.trim().toLowerCase().replace(/\s+/g, "_");

const seedModelDefaults = async (Model, defaults, companyId, createdBy = null) => {
    const operations = defaults.map((item) => ({
        updateOne: {
            filter: {
                companyId,
                code: normalizeCode(item.code),
            },
            update: {
                $setOnInsert: {
                    ...item,
                    companyId,
                    code: normalizeCode(item.code),
                    createdBy,
                    updatedBy: createdBy,
                },
            },
            upsert: true,
        },
    }));

    if (!operations.length) return { seeded: 0, skipped: 0 };

    const result = await Model.bulkWrite(operations, { ordered: false });
    const seeded = result.upsertedCount || 0;

    return {
        seeded,
        skipped: defaults.length - seeded,
    };
};

const seedCompanyCrmTypes = async (companyId, createdBy = null) => {
    assertCompanyId(companyId);

    const leadTypes = await seedDefaultLeadTypes(companyId, createdBy);
    const visitTypes = await seedDefaultVisitTypes(companyId, createdBy);

    return {
        leadTypes,
        visitTypes,
    };
};

const seedDefaultLeadTypes = async (companyId, createdBy = null) => {
    assertCompanyId(companyId);
    return seedModelDefaults(LeadType, DEFAULT_LEAD_TYPES, companyId, createdBy);
};

const seedDefaultVisitTypes = async (companyId, createdBy = null) => {
    assertCompanyId(companyId);
    return seedModelDefaults(VisitType, DEFAULT_VISIT_TYPES, companyId, createdBy);
};

const ensureCompanyCrmTypes = async (companyId, createdBy = null) => {
    assertCompanyId(companyId);

    const [leadTypeCount, visitTypeCount] = await Promise.all([
        LeadType.countDocuments({ companyId }),
        VisitType.countDocuments({ companyId }),
    ]);

    if (leadTypeCount > 0 && visitTypeCount > 0) {
        return {
            seeded: false,
            leadTypeCount,
            visitTypeCount,
        };
    }

    return {
        seeded: true,
        ...(await seedCompanyCrmTypes(companyId, createdBy)),
    };
};

const buildFilter = (companyId, filters = {}) => {
    assertCompanyId(companyId);

    const query = { companyId };
    if (filters.isActive !== undefined) {
        query.isActive = filters.isActive === true || filters.isActive === "true";
    }
    return query;
};

const getItems = async (Model, companyId, filters = {}) => {
    return Model.find(buildFilter(companyId, filters)).sort({ name: 1 }).lean();
};

const getItemById = async (Model, companyId, id, label) => {
    assertCompanyId(companyId);

    const item = await Model.findOne({ _id: id, companyId }).lean();
    if (!item) {
        throw new ApiError(404, `${label} not found`);
    }
    return item;
};

const assertUniqueCode = async (Model, companyId, code, currentId = null, label) => {
    if (!code) {
        throw new ApiError(400, `${label} code is required`);
    }

    const query = {
        companyId,
        code: normalizeCode(code),
    };

    if (currentId) {
        query._id = { $ne: currentId };
    }

    const existing = await Model.findOne(query).select("_id").lean();
    if (existing) {
        throw new ApiError(400, `${label} code already exists for this company`);
    }
};

const createItem = async (Model, companyId, data, createdBy = null, label) => {
    assertCompanyId(companyId);
    await assertUniqueCode(Model, companyId, data.code, null, label);

    return Model.create({
        ...data,
        companyId,
        createdBy,
        updatedBy: createdBy,
    });
};

const updateItem = async (Model, companyId, id, data, updatedBy = null, label) => {
    assertCompanyId(companyId);

    const item = await Model.findOne({ _id: id, companyId });
    if (!item) {
        throw new ApiError(404, `${label} not found`);
    }

    if (data.code !== undefined) {
        await assertUniqueCode(Model, companyId, data.code, id, label);
    }

    const blockedFields = ["companyId", "createdBy", "createdAt"];
    blockedFields.forEach((field) => {
        delete data[field];
    });

    Object.keys(data).forEach((field) => {
        item[field] = data[field];
    });
    item.updatedBy = updatedBy;

    await item.save();
    return item;
};

const updateItemStatus = async (Model, companyId, id, isActive, updatedBy = null, label) => {
    assertCompanyId(companyId);

    const item = await Model.findOne({ _id: id, companyId });
    if (!item) {
        throw new ApiError(404, `${label} not found`);
    }

    item.isActive = Boolean(isActive);
    item.updatedBy = updatedBy;
    await item.save();
    return item;
};

module.exports = {
    LeadType,
    VisitType,
    seedDefaultLeadTypes,
    seedDefaultVisitTypes,
    seedCompanyCrmTypes,
    ensureCompanyCrmTypes,
    getItems,
    getItemById,
    createItem,
    updateItem,
    updateItemStatus,
};
