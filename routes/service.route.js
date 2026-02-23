const express = require("express");
const router = express.Router();
const {
  getAllServices,
  getServicesByBusiness,
  addService,
  deleteService,
  updateService,
} = require("../controllers/service.controller");
const authorizeRole = require("../middleware/roleBasedRoutes");
const { PROVIDER } = require("../config/roles");
const validate = require("../middleware/validate");
const { serviceSchema } = require("../helper/validation");

router.get("/services", getAllServices);
router.get("/services/business/:businessId", getServicesByBusiness);

router.post(
  "/services/:businessId",
  authorizeRole(PROVIDER),
  validate(serviceSchema),
  addService
);

router.put(
  "/services/:serviceId",
  authorizeRole(PROVIDER),
  validate(serviceSchema),
  updateService
);

router.delete("/services/:serviceId", authorizeRole(PROVIDER), deleteService);

module.exports = router;
