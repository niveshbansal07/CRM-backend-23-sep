const ApiResponse = require("../utils/ApiResponse");
const {
    createCompanyWithAdmin,
    getAllCompanies,
    updateCompanyById,
    deleteCompanyById,
} = require("../services/company.service");

const createCompanyController = async (req, res, next) => {
    try {
        const result = await createCompanyWithAdmin(req.body, req.user);

        return res.status(201).json(
            new ApiResponse(201, "Company created successfully", {
                company: result.mappedCompany,
                adminUser: result.adminUser.toSafeObject(),
            })
        );
    } catch (error) {
        next(error);
    }
};

const getCompaniesController = async (req, res, next) => {
    try {
        const companies = await getAllCompanies();

        return res.status(200).json(
            new ApiResponse(200, "Companies fetched successfully", {
                companies,
            })
        );
    } catch (error) {
        next(error);
    }
};

const updateCompanyController = async (req, res, next) => {
    try {
        const company = await updateCompanyById(req.params.id, req.body, req.user);

        return res.status(200).json(
            new ApiResponse(200, "Company updated successfully", {
                company,
            })
        );
    } catch (error) {
        next(error);
    }
};

const deleteCompanyController = async (req, res, next) => {
    try {
        await deleteCompanyById(req.params.id, req.user);

        return res.status(200).json(
            new ApiResponse(200, "Company deleted successfully", null)
        );
    } catch (error) {
        next(error);
    }
};

module.exports = {
    createCompanyController,
    getCompaniesController,
    updateCompanyController,
    deleteCompanyController,
};