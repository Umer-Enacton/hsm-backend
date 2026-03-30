const fs = require('fs');
let c = fs.readFileSync('controllers/booking.controller.js', 'utf8');

if (!c.includes('getBookingHistory')) {
  const newFunc = `

const { bookingHistory } = require("../models/schema");

const getBookingHistory = async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    const userId = req.token.id;
    if (!bookingId) return res.status(400).json({ message: "Booking ID is required" });
    const [booking] = await db.select({ booking: bookings, business: businessProfiles }).from(bookings).leftJoin(businessProfiles, eq(bookings.businessProfileId, businessProfiles.id)).where(eq(bookings.id, bookingId));
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    if (booking.booking.customerId !== userId && (!booking.business || booking.business.providerId !== userId)) return res.status(403).json({ message: "Not authorized" });
    const history = await db.select().from(bookingHistory).where(eq(bookingHistory.bookingId, bookingId)).orderBy(bookingHistory.createdAt);
    return res.status(200).json({ history });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};
`;

  // Append function
  c += newFunc;
  
  // Update export
  c = c.replace(/uploadCompletionPhotos,\s*};/m, "uploadCompletionPhotos,\n  getBookingHistory,\n};");
  
  fs.writeFileSync('controllers/booking.controller.js', c);
  console.log("Fixed export and appended function.");
} else {
  console.log("Already has it.");
}
