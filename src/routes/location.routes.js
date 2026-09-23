const express = require("express");
const ApiResponse = require("../utils/ApiResponse");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles } = require("../middlewares/role.middleware");
const { LOCATION_ROLES, reverseGeocode } = require("../services/location.service");

const router = express.Router();

router.use(authenticate);
router.use(allowRoles(...LOCATION_ROLES));

router.get("/reverse-geocode", async (req, res, next) => {
  try {
    const location = await reverseGeocode({
      latitude: req.query.latitude,
      longitude: req.query.longitude,
    });

    return res.status(200).json(new ApiResponse(200, "Location resolved successfully", { location }));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
