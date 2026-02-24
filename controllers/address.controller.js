const db = require("../config/db");
const { users, Address } = require("../models/schema");
const { eq, and } = require("drizzle-orm");

const addUserAddress = async (req, res) => {
  try {
    const userId = req.token.id;
    const { addressType, street, city, state, zipCode } = req.body;

    const user = await db.select().from(users).where(eq(users.id, userId));
    if (user.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    if (!street || !city || !state || !zipCode) {
      return res.status(400).json({
        message: "All address fields are required",
      });
    }

    const [newAddress] = await db
      .insert(Address)
      .values({
        userId,
        addressType: addressType || "home",
        street,
        city,
        state,
        zipCode,
      })
      .returning();

    console.log("New address created:", newAddress);

    res
      .status(201)
      .json({ message: "Address added successfully", address: newAddress });
  } catch (error) {
    console.error("Error creating address:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get all addresses for logged-in user
const getUserAddresses = async (req, res) => {
  try {
    const userId = req.token.id;
    const addresses = await db
      .select()
      .from(Address)
      .where(eq(Address.userId, userId));
    res.status(200).json({ addresses });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

//delete address by user id and address id
const deleteUserAddress = async (req, res) => {
  try {
    const userId = req.token.id;
    const addressId = req.params.addressId;
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (user.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    const deletedCount = await db
      .delete(Address)
      .where(and(eq(Address.id, addressId), eq(Address.userId, userId)))
      .returning();
    if (deletedCount.length === 0) {
      return res.status(404).json({ message: "Address not found" });
    }
    res.status(200).json({ message: "Address deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

//update address by user id and address id
const updateUserAddress = async (req, res) => {
  try {
    const userId = req.token.id;
    const addressId = req.params.addressId;
    const { addressType, street, city, state, zipCode } = req.body;

    // Verify user exists
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (user.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    // Build update object dynamically
    const updateData = {};
    if (addressType !== undefined) updateData.addressType = addressType;
    if (street !== undefined) updateData.street = street;
    if (city !== undefined) updateData.city = city;
    if (state !== undefined) updateData.state = state;
    if (zipCode !== undefined) updateData.zipCode = zipCode;

    // Update address
    const [updated] = await db
      .update(Address)
      .set(updateData)
      .where(and(eq(Address.id, addressId), eq(Address.userId, userId)))
      .returning();

    if (updated.length === 0) {
      return res.status(404).json({ message: "Address not found" });
    }

    console.log("Address updated:", updated);

    res.status(200).json({ message: "Address updated successfully", address: updated[0] });
  } catch (error) {
    console.error("Error updating address:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  addUserAddress,
  getUserAddresses,
  deleteUserAddress,
  updateUserAddress,
};
