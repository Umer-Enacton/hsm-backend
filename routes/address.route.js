const express = require("express");
const router = express.Router();
const {
  addUserAddress,
  getUserAddresses,
  deleteUserAddress,
  updateUserAddress,
} = require("../controllers/address.controller");
const validate = require("../middleware/validate");
const { addressSchema } = require("../helper/validation");

router.get("/address", getUserAddresses);
router.post("/address", validate(addressSchema), addUserAddress);
router.put("/address/:addressId", updateUserAddress);
router.delete("/address/:addressId", deleteUserAddress);

module.exports = router;
