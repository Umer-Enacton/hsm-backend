const db = require("../config/db");
const { Category } = require("../models/schema");
const { eq } = require("drizzle-orm");

const getAllCategories = async (req, res) => {
  try {
    const categories = await db.select().from(Category);
    res.status(200).json({ categories });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const addCategory = async (req, res) => {
  try {
    const { name, description, image } = req.body;
    if (!name || !description) {
      return res
        .status(400)
        .json({ message: "Name and description are required" });
    }
    const [newCategory] = await db
      .insert(Category)
      .values({ name, description, image: image || null })
      .returning();
    res
      .status(201)
      .json({ message: "Category added successfully", category: newCategory });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const deleteCategory = async (req, res) => {
  try {
    const categoryId = req.params.id;
    const deletedCount = await db
      .delete(Category)
      .where(eq(Category.id, categoryId))
      .returning();
    if (deletedCount.length === 0) {
      return res.status(404).json({ message: "Category not found" });
    }
    res.status(200).json({ message: "Category deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const updateCategory = async (req, res) => {
  try {
    const categoryId = req.params.id;
    const { name, description, image } = req.body;

    // Build update object dynamically
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (image !== undefined) updateData.image = image;

    const [updatedCategory] = await db
      .update(Category)
      .set(updateData)
      .where(eq(Category.id, categoryId))
      .returning();

    if (!updatedCategory) {
      return res.status(404).json({ message: "Category not found" });
    }

    res.status(200).json({
      message: "Category updated successfully",
      category: updatedCategory,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
module.exports = {
  getAllCategories,
  addCategory,
  deleteCategory,
  updateCategory,
};
