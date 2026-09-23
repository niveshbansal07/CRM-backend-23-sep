const ApiResponse = require("../utils/ApiResponse");
const {
  createSalesGeography,
  listSalesGeographies,
  listSalesGeographyChildren,
  buildSalesGeographyTree,
  getSalesGeographyById,
  updateSalesGeography,
  updateSalesGeographyStatus,
} = require("../services/salesGeography.service");

const includeInactive = (req) => req.query.includeInactive === "true";

const getTreeController = async (req, res, next) => {
  try {
    const tree = await buildSalesGeographyTree({
      user: req.user,
      includeInactive: includeInactive(req),
    });
    return res.status(200).json(new ApiResponse(200, "Sales Geography tree fetched successfully", { tree }));
  } catch (error) {
    next(error);
  }
};

const listZonesController = async (req, res, next) => {
  try {
    const zones = await listSalesGeographies({
      user: req.user,
      type: "ZONE",
      parentId: null,
      includeInactive: includeInactive(req),
    });
    return res.status(200).json(new ApiResponse(200, "Zones fetched successfully", { zones }));
  } catch (error) {
    next(error);
  }
};

const listChildrenController = ({ parentType, childType, responseKey }) => async (req, res, next) => {
  try {
    const records = await listSalesGeographyChildren({
      user: req.user,
      parentId: req.params.parentId,
      parentType,
      childType,
      includeInactive: includeInactive(req),
    });
    return res.status(200).json(
      new ApiResponse(200, `${responseKey} fetched successfully`, { [responseKey]: records })
    );
  } catch (error) {
    next(error);
  }
};

const getGeographyController = async (req, res, next) => {
  try {
    const geography = await getSalesGeographyById({ id: req.params.id, user: req.user });
    return res.status(200).json(new ApiResponse(200, "Sales Geography fetched successfully", { geography }));
  } catch (error) {
    next(error);
  }
};

const createGeographyController = async (req, res, next) => {
  try {
    const geography = await createSalesGeography({
      payload: req.validatedBody,
      user: req.user,
      req,
    });
    return res.status(201).json(new ApiResponse(201, `${geography.type} created successfully`, { geography }));
  } catch (error) {
    next(error);
  }
};

const updateGeographyController = async (req, res, next) => {
  try {
    const geography = await updateSalesGeography({
      id: req.params.id,
      payload: req.validatedBody,
      user: req.user,
      req,
    });
    return res.status(200).json(new ApiResponse(200, `${geography.type} updated successfully`, { geography }));
  } catch (error) {
    next(error);
  }
};

const updateGeographyStatusController = async (req, res, next) => {
  try {
    const geography = await updateSalesGeographyStatus({
      id: req.params.id,
      status: req.validatedBody.status,
      user: req.user,
      req,
    });
    return res.status(200).json(
      new ApiResponse(200, `${geography.type} status updated successfully`, { geography })
    );
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTreeController,
  listZonesController,
  listRegionsController: listChildrenController({ parentType: "ZONE", childType: "REGION", responseKey: "regions" }),
  listBranchesController: listChildrenController({ parentType: "REGION", childType: "BRANCH", responseKey: "branches" }),
  listAreasController: listChildrenController({ parentType: "BRANCH", childType: "AREA", responseKey: "areas" }),
  getGeographyController,
  createGeographyController,
  updateGeographyController,
  updateGeographyStatusController,
};
