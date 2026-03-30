const fs = require('fs');
const path = require('path');

const controllerPath = path.join(__dirname, 'controllers', 'booking.controller.js');
let content = fs.readFileSync(controllerPath, 'utf8');

const replacements = [
  {
    find: /await db\.update\(bookings\)\s*\.set\(\{\s*status:\s*"confirmed"\s*\}\)\s*\.where.*?;/gs,
    replace: (match) => match + '\n    await logBookingHistory(bookingId, "confirmed", "Booking was confirmed by provider.", "provider", userId);'
  },
  {
    find: /await db\.update\(bookings\)\s*\.set\(\{\s*status:\s*"rejected"\s*\}\)\s*\.where.*?;/gs,
    replace: (match) => match + '\n    await logBookingHistory(bookingId, "rejected", "Booking was rejected by provider.", "provider", userId);'
  },
  {
    find: /const \[updatedBooking\] = await db\s*\.update\(bookings\)\s*\.set\(cancelUpdateData\)\s*\.where\(eq\(bookings\.id,\s*bookingId\)\)\s*\.returning\(\);/gs,
    replace: (match) => match + '\n    await logBookingHistory(bookingId, "cancelled", `Booking was cancelled by ${userRole}. Reason: ${reason}`, userRole, userId);'
  },
  {
    find: /await db\.update\(bookings\)\s*\.set\(updateData\)\s*\.where\(eq\(bookings\.id,\s*bookingId\)\);/gs,
    replace: (match) => match + '\n    await logBookingHistory(bookingId, "completed", "Booking was marked as completed.", "provider", userId);'
  },
  {
    find: /const \[updatedBooking\] = await db\s*\.update\(bookings\)\s*\.set\(updateData\)\s*\.where\(eq\(bookings\.id,\s*bookingId\)\)\s*\.returning\(\);/gs,
    replace: (match) => match + '\n    if (req.body.reason) { await logBookingHistory(bookingId, "reschedule_requested", `Reschedule requested.`, "customer", userId); }'
  },
  {
    find: /await db\s*\.update\(bookings\)\s*\.set\(.*rescheduleOutcome: "accepted".*\)\s*\.where\(eq\(bookings\.id, bookingId\)\);/gs,
    replace: (match) => match + '\n    await logBookingHistory(bookingId, "reschedule_accepted", "Provider accepted the requested reschedule.", "provider", userId);'
  },
  {
    find: /await db\s*\.update\(bookings\)\s*\.set\(.*rescheduleOutcome: "rejected".*\)\s*\.where\(eq\(bookings\.id, bookingId\)\);/gs,
    replace: (match) => match + '\n    await logBookingHistory(bookingId, "reschedule_rejected", "Provider rejected the requested reschedule.", "provider", userId);'
  }
];

let changed = false;
let newContent = content;

replacements.forEach(r => {
  const before = newContent;
  newContent = newContent.replace(r.find, r.replace);
  if (before !== newContent) {
    changed = true;
    console.log("Made a replacement!");
  }
});

if (changed) {
  fs.writeFileSync(controllerPath, newContent);
  console.log("Successfully updated booking.controller.js");
} else {
  console.log("No regex matches found.");
}
