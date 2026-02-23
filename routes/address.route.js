const express = require("express");
const router = express.Router();
const {
  addUserAddress,
  getUserAddresses,
  deleteUserAddress,
} = require("../controllers/address.controller");
const validate = require("../middleware/validate");
const { addressSchema } = require("../helper/validation");

router.get("/address", getUserAddresses);
router.post("/address", validate(addressSchema), addUserAddress);
router.delete("/address/:addressId", deleteUserAddress);

module.exports = router;
