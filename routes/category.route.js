const express = require("express");
const router = express.Router();
const {
  getAllCategories,
  addCategory,
  deleteCategory,
  updateCategory,
} = require("../controllers/category.controller");
const authorizeRole = require("../middleware/roleBasedRoutes");
const { ADMIN } = require("../config/roles");

router.get("/categories", getAllCategories);
router.post("/categories", authorizeRole(ADMIN), addCategory);
router.put("/categories/:id", authorizeRole(ADMIN), updateCategory);
router.delete("/categories/:id", authorizeRole(ADMIN), deleteCategory);

module.exports = router;
