const bcrypt = require("bcryptjs");
const Company = require("../models/Company");
const User = require("../models/User");
const ApiError = require("../utils/ApiError");
const { seedCompanyMasters } = require("./crmMaster.service");
const { seedDefaultLeadTypes, seedDefaultVisitTypes } = require("./crmSetup.service");

const slugify = (value = "") =>
    value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");

const buildUniqueSlug = async (baseName) => {
    let baseSlug = slugify(baseName);
    if (!baseSlug) baseSlug = "company";

    let finalSlug = baseSlug;
    let counter = 1;

    while (await Company.findOne({ slug: finalSlug })) {
        finalSlug = `${baseSlug}-${counter}`;
        counter += 1;
    }

    return finalSlug;
};

const mapCompanyForFrontend = async (companyDoc) => {
    const adminUser = companyDoc.ownerUserId
        ? await User.findById(companyDoc.ownerUserId).select("fullName email")
        : null;

    const usersCount = await User.countDocuments({
        companyId: companyDoc._id,
        deletedAt: null,
    });

    return {
        id: companyDoc._id,
        _id: companyDoc._id,
        name: companyDoc.name,
        slug: companyDoc.slug,
        domain: companyDoc.domain || "",
        industry: companyDoc.industry || "Other",
        email: companyDoc.email || "",
        phone: companyDoc.phone || "",
        address: companyDoc.address || "",
        website: companyDoc.website || "",
        logo: companyDoc.logo || "",
        plan: companyDoc.plan,
        status: companyDoc.status,
        users: usersCount,
        leads: 0,
        revenue: 0,
        adminName: adminUser?.fullName || "",
        adminEmail: adminUser?.email || "",
        enabledModules: companyDoc.enabledModules || [],
        joinedDate: companyDoc.createdAt,
        createdAt: companyDoc.createdAt,
        updatedAt: companyDoc.updatedAt,
    };
};

const getCompanyForSession = async (companyId) => {
    if (!companyId) return null;
    const company = await Company.findOne({ _id: companyId, deletedAt: null });
    return company ? mapCompanyForFrontend(company) : null;
};

const createCompanyWithAdmin = async (payload, currentUser) => {
    const {
        name,
        domain,
        industry,
        plan,
        adminName,
        adminEmail,
        adminPassword,
        enabledModules,
    } = payload;

    if (!name || !adminName || !adminEmail || !adminPassword) {
        throw new ApiError(400, "Company name, admin name, admin email and admin password are required");
    }

    const normalizedAdminEmail = adminEmail.toLowerCase().trim();

    const existingAdmin = await User.findOne({
        email: normalizedAdminEmail,
        deletedAt: null,
    });

    if (existingAdmin) {
        throw new ApiError(409, "Admin user with this email already exists");
    }

    const companySlug = await buildUniqueSlug(domain || name);

    const company = await Company.create({
        name: name.trim(),
        slug: companySlug,
        domain: (domain || "").trim().toLowerCase(),
        industry: industry || "Other",
        plan: plan || "free",
        enabledModules: Array.isArray(enabledModules) ? enabledModules : [],
        status: "active",
        createdBy: currentUser?._id || null,
    });

    const passwordHash = await bcrypt.hash(adminPassword, 10);

    const adminUser = await User.create({
        fullName: adminName.trim(),
        email: normalizedAdminEmail,
        passwordHash,
        role: "company_admin",
        companyId: company._id,
        department: "Management",
        designation: "Company Admin",
        status: "active",
        isEmailVerified: true,
        createdBy: currentUser?._id || null,
        updatedBy: currentUser?._id || null,
    });

    company.ownerUserId = adminUser._id;
    await company.save();

    await seedCompanyMasters(company._id, adminUser._id);
    await seedDefaultLeadTypes(company._id, adminUser._id);
    await seedDefaultVisitTypes(company._id, adminUser._id);

    const mappedCompany = await mapCompanyForFrontend(company);

    return {
        company,
        adminUser,
        mappedCompany,
    };
};

const getAllCompanies = async () => {
    const companies = await Company.find({ deletedAt: null }).sort({ createdAt: -1 });

    const mapped = await Promise.all(companies.map(mapCompanyForFrontend));
    return mapped;
};

const updateCompanyById = async (companyId, updates, currentUser) => {
    const company = await Company.findOne({
        _id: companyId,
        deletedAt: null,
    });

    if (!company) {
        throw new ApiError(404, "Company not found");
    }

    const allowedFields = [
        "name",
        "domain",
        "industry",
        "plan",
        "status",
        "enabledModules",
        "email",
        "phone",
        "address",
        "website",
        "legalName",
        "logo",
    ];

    allowedFields.forEach((field) => {
        if (updates[field] !== undefined) {
            company[field] = updates[field];
        }
    });

    if (updates.name || updates.domain) {
        company.slug = await buildUniqueSlug(updates.domain || updates.name || company.name);
    }

    company.updatedBy = currentUser?._id || null;
    await company.save();

    return mapCompanyForFrontend(company);
};

const deleteCompanyById = async (companyId, currentUser) => {
    const company = await Company.findOne({
        _id: companyId,
        deletedAt: null,
    });

    if (!company) {
        throw new ApiError(404, "Company not found");
    }

    company.deletedAt = new Date();
    company.updatedBy = currentUser?._id || null;
    await company.save();

    return true;
};

module.exports = {
    createCompanyWithAdmin,
    getAllCompanies,
    updateCompanyById,
    deleteCompanyById,
    getCompanyForSession,
};
