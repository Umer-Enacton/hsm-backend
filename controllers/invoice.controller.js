const PDFDocument = require("pdfkit");
const db = require("../config/db");
const {
  bookings,
  users,
  businessProfiles,
  services,
  slots,
  Address,
} = require("../models/schema");
const { eq, and } = require("drizzle-orm");

/**
 * Generate Invoice PDF for a booking
 * GET /invoice/booking/:id
 */
const generateInvoice = async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    const userId = req.token.id;
    const userRoleId = req.token.roleId;

    if (!bookingId) {
      return res.status(400).json({ message: "Booking ID is required" });
    }

    // Check if user has customer role (roleId === 1)
    if (userRoleId !== 1) {
      return res.status(403).json({
        message: "Access denied: Only customers can download invoices",
      });
    }

    // Fetch booking with all related data
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId));

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // Verify user owns this booking (security check)
    if (booking.customerId !== userId) {
      return res
        .status(403)
        .json({ message: "You are not authorized to access this invoice" });
    }

    // Fetch customer details
    const [customer] = await db
      .select()
      .from(users)
      .where(eq(users.id, booking.customerId))
      .limit(1);

    // Fetch service details
    const [service] = await db
      .select()
      .from(services)
      .where(eq(services.id, booking.serviceId))
      .limit(1);

    // Fetch business profile details
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, booking.businessProfileId))
      .limit(1);

    // Fetch slot details
    const [slot] = await db
      .select()
      .from(slots)
      .where(eq(slots.id, booking.slotId))
      .limit(1);

    // Fetch address details
    const [address] = await db
      .select()
      .from(Address)
      .where(eq(Address.id, booking.addressId))
      .limit(1);

    // Generate invoice number: INV-YYYY-{bookingId}
    const date = new Date(
      booking.createdAt || booking.bookingDate || Date.now(),
    );
    const year = date.getFullYear();
    const invoiceNumber = `INV-${year}-${bookingId.toString().padStart(4, "0")}`;

    // Format helpers
    const formatDate = (dateObj) => {
      if (!dateObj) return "N/A";
      const d = new Date(dateObj);
      if (isNaN(d.getTime())) return "N/A";
      const months = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];
      return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    };

    const formatTime = (timeStr) => {
      if (!timeStr) return "N/A";
      const [hours, minutes] = timeStr.split(":").map(Number);
      const period = hours >= 12 ? "PM" : "AM";
      const displayHours = hours % 12 || 12;
      const displayMinutes = minutes.toString().padStart(2, "0");
      return `${displayHours}:${displayMinutes} ${period}`;
    };

    // const formatCurrency = (amount) => {
    //   return `₹${Number(amount).toLocaleString("en-IN")}`;
    // };
    function formatCurrency(amount) {
      return `Rs. ${Number(amount).toLocaleString("en-IN")}`;
    }
    // Create PDF document
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      bufferPages: true,
    });

    // Collect PDF chunks
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="invoice-${invoiceNumber}.pdf"`,
      );
      res.send(pdfBuffer);
    });

    // ============================================
    // HELPER FUNCTIONS FOR LAYOUT
    // ============================================
    const marginLeft = 50;
    const marginRight = 50;
    const pageWidth = 595.28; // A4 width in points
    const pageHeight = 841.89; // A4 height in points
    const contentWidth = pageWidth - marginLeft - marginRight;
    const columnWidth = (contentWidth - 30) / 2; // 30px gap between columns

    let currentY = 50;

    // // ============================================
    // // HEADER SECTION
    // // ============================================
    // // Logo and Business Name (Left)
    // const logoSize = 55;
    // doc
    //   .rect(marginLeft, currentY, logoSize, logoSize)
    //   .fillAndStroke("#ec5b13", "#ec5b13");
    // doc
    //   .fontSize(20)
    //   .fillColor("white")
    //   .text("HSM", marginLeft + 12, currentY + 18);

    // doc.fontSize(16).fillColor("#0f172a").font("Helvetica-Bold");
    // doc.text(
    //   business?.businessName || "Home Service Pro",
    //   marginLeft + 65,
    //   currentY + 8,
    // );

    // doc.fontSize(9).fillColor("#64748b").font("Helvetica");
    // doc.text(
    //   business?.description || "Quality Service Solutions",
    //   marginLeft + 65,
    //   currentY + 30,
    // );

    // // Invoice Info (Right)
    // const invoiceInfoX = pageWidth - marginRight - 100;
    // doc.fontSize(24).fillColor("#0f172a").font("Helvetica-Bold");
    // doc.text("INVOICE", invoiceInfoX, currentY + 5);

    // doc.fontSize(11).fillColor("#64748b").font("Helvetica-Bold");
    // doc.text(`#${invoiceNumber}`, invoiceInfoX, currentY + 32);

    // doc.fontSize(8).fillColor("#64748b").font("Helvetica");
    // doc.text(
    //   `Issued: ${formatDate(booking.createdAt || booking.bookingDate)}`,
    //   invoiceInfoX,
    //   currentY + 50,
    // );

    // // PAID Badge - Position below invoice info with proper spacing
    // const badgeY = currentY + 70;
    // const badgeWidth = 55;
    // const badgeHeight = 20;
    // doc
    //   .roundedRect(invoiceInfoX, badgeY, badgeWidth, badgeHeight, 3)
    //   .fillAndStroke("#bbf7d0", "#15803d");
    // doc.fontSize(10).fillColor("#15803d").font("Helvetica-Bold");
    // doc.text("PAID", invoiceInfoX + badgeWidth / 2, badgeY + 6, {
    //   width: badgeWidth,
    //   align: "center",
    // });

    // // Divider line
    // currentY += 105;
    // doc
    //   .moveTo(marginLeft, currentY)
    //   .lineTo(pageWidth - marginRight, currentY)
    //   .lineWidth(1)
    //   .strokeColor("#e2e8f0")
    //   .stroke();

    // // ============================================
    // // ADDRESSES SECTION
    // // ============================================
    // currentY += 115;

    // const addressBoxHeight = 90;
    // doc
    //   .roundedRect(marginLeft, currentY, contentWidth, addressBoxHeight, 6)
    //   .fill("#f8fafc");

    // // Bill To (Left) - Constrain width to prevent overflow
    // doc
    //   .fontSize(9)
    //   .fillColor("#94a3b8")
    //   .font("Helvetica-Bold")
    //   .text("BILL TO", marginLeft + 10, currentY + 10);

    // doc.fontSize(12).fillColor("#0f172a").font("Helvetica-Bold");
    // const customerName = customer?.name || "N/A";
    // doc.text(customerName, marginLeft + 10, currentY + 25, {
    //   width: columnWidth,
    //   ellipsis: true,
    // });

    // doc.fontSize(9).fillColor("#64748b").font("Helvetica");
    // doc.text(address?.street || "N/A", marginLeft + 10, currentY + 42, {
    //   width: columnWidth,
    //   ellipsis: true,
    // });
    // doc.text(
    //   address ? `${address.city}, ${address.state} ${address.zipCode}` : "N/A",
    //   marginLeft + 10,
    //   currentY + 56,
    //   { width: columnWidth, ellipsis: true },
    // );
    // if (customer?.phone) {
    //   doc.text(customer.phone, marginLeft + 10, currentY + 70, {
    //     width: columnWidth,
    //   });
    // }

    // // Service Address (Right) - Constrain width to prevent overflow
    // const addressRightX = marginLeft + columnWidth + 25;
    // doc
    //   .fontSize(9)
    //   .fillColor("#94a3b8")
    //   .font("Helvetica-Bold")
    //   .text("SERVICE ADDRESS", addressRightX, currentY + 10);

    // doc.fontSize(12).fillColor("#0f172a").font("Helvetica-Bold");
    // const serviceStreet = address ? `${address.street},` : "N/A";
    // doc.text(serviceStreet, addressRightX, currentY + 25, {
    //   width: columnWidth,
    //   ellipsis: true,
    // });

    // doc.fontSize(9).fillColor("#64748b").font("Helvetica");
    // const serviceCityState = address
    //   ? `${address.city}, ${address.state} ${address.zipCode}`
    //   : "N/A";
    // doc.text(serviceCityState, addressRightX, currentY + 42, {
    //   width: columnWidth,
    //   ellipsis: true,
    // });

    // // ============================================
    // // SERVICE TABLE
    // // ============================================
    // currentY += addressBoxHeight + 20;

    // // Define column widths and positions with better spacing
    // const colDescX = marginLeft + 10;
    // const colDescWidth = 160;
    // const colDateTimeX = colDescX + colDescWidth + 10;
    // const colDateTimeWidth = 140;
    // const colDurationX = colDateTimeX + colDateTimeWidth + 10;
    // const colDurationWidth = 80;
    // const colAmountX = colDurationX + colDurationWidth + 10;
    // const colAmountWidth = 85;

    // // Table Header
    // const tableHeaderHeight = 26;
    // doc
    //   .fillColor("#f1f5f9")
    //   .rect(marginLeft, currentY, contentWidth, tableHeaderHeight)
    //   .fill();

    // doc.fontSize(8).fillColor("#94a3b8").font("Helvetica-Bold");
    // doc.text("DESCRIPTION", colDescX, currentY + 9, { width: colDescWidth });
    // doc.text("DATE & TIME", colDateTimeX, currentY + 9, {
    //   width: colDateTimeWidth,
    // });
    // doc.text("DURATION", colDurationX, currentY + 9, {
    //   width: colDurationWidth,
    // });
    // doc.text("AMOUNT", colAmountX, currentY + 9, {
    //   width: colAmountWidth,
    //   align: "right",
    // });

    // // Table Row
    // currentY += tableHeaderHeight;
    // const rowHeight = 50;
    // doc
    //   .fillColor("#f8fafc")
    //   .rect(marginLeft, currentY, contentWidth, rowHeight)
    //   .fill();

    // // Description - with width constraint
    // doc.fontSize(11).fillColor("#0f172a").font("Helvetica-Bold");
    // doc.text(service?.name || "Service", colDescX, currentY + 10, {
    //   width: colDescWidth,
    //   ellipsis: true,
    // });

    // if (service?.description) {
    //   doc.fontSize(8).fillColor("#64748b").font("Helvetica");
    //   const truncatedDesc =
    //     service.description.length > 50
    //       ? service.description.substring(0, 50) + "..."
    //       : service.description;
    //   doc.text(truncatedDesc, colDescX, currentY + 26, {
    //     width: colDescWidth,
    //     ellipsis: true,
    //   });
    // }

    // // Date & Time - with width constraint
    // doc.fontSize(9).fillColor("#64748b").font("Helvetica");
    // const dateTimeText = `${formatDate(booking.bookingDate)} at ${formatTime(slot?.startTime)}`;
    // doc.text(dateTimeText, colDateTimeX, currentY + 20, {
    //   width: colDateTimeWidth,
    //   ellipsis: true,
    // });

    // // Duration - with width constraint
    // const duration = service?.EstimateDuration || service?.duration || 0;
    // const hours = Math.floor(duration / 60);
    // const mins = duration % 60;
    // const durationText =
    //   duration > 0 ? (hours > 0 ? `${hours}h ${mins}m` : `${mins}m`) : "N/A";
    // doc.text(durationText, colDurationX, currentY + 20, {
    //   width: colDurationWidth,
    // });

    // // Amount - right aligned
    // doc.fontSize(11).fillColor("#0f172a").font("Helvetica-Bold");
    // doc.text(
    //   formatCurrency(service?.price || booking.totalPrice),
    //   colAmountX,
    //   currentY + 20,
    //   { width: colAmountWidth, align: "right" },
    // );

    // // ============================================
    // // TOTALS & NOTES SECTION
    // // ============================================
    // currentY += rowHeight + 25;

    // // Notes (Left) - Constrain width
    // doc
    //   .fontSize(9)
    //   .fillColor("#94a3b8")
    //   .font("Helvetica-Bold")
    //   .text("NOTES & TERMS", marginLeft, currentY);

    // doc.fontSize(9).fillColor("#64748b").font("Helvetica");
    // const notes = [
    //   `Payment received on ${formatDate(booking.createdAt || booking.bookingDate)} via ${booking.status === "completed" ? "service completion" : "booking"}.`,
    //   "All service parts include a 90-day labor guarantee.",
    //   "For queries, contact support or call business directly.",
    // ];

    // const notesWidth = contentWidth - 170; // Leave space for totals box
    // let noteY = currentY + 15;
    // notes.forEach((note) => {
    //   doc.text(note, marginLeft, noteY, { width: notesWidth, ellipsis: true });
    //   noteY += 16;
    // });

    // // Totals Box (Right) - Fixed position and size
    // const totalsBoxX = pageWidth - marginRight - 155;
    // const totalsBoxWidth = 155;
    // const totalsBoxHeight = 115;

    // doc
    //   .roundedRect(totalsBoxX, currentY - 5, totalsBoxWidth, totalsBoxHeight, 6)
    //   .fillAndStroke("#f1f5f9", "#e2e8f0");

    // let totalsY = currentY + 8;

    // // Subtotal
    // doc.fontSize(10).fillColor("#64748b").font("Helvetica");
    // doc.text("Subtotal", totalsBoxX + 10, totalsY);
    // doc.text(
    //   formatCurrency(booking.totalPrice),
    //   totalsBoxX + totalsBoxWidth - 10,
    //   totalsY,
    //   { width: 0, align: "right" },
    // );

    // totalsY += 22;

    // // Tax
    // doc.text("Tax (Included)", totalsBoxX + 10, totalsY);
    // doc
    //   .fillColor("#cbd5e1")
    //   .text("Included in subtotal", totalsBoxX + totalsBoxWidth - 10, totalsY, {
    //     width: 0,
    //     align: "right",
    //   });

    // totalsY += 25;

    // // Total divider
    // doc
    //   .moveTo(totalsBoxX, totalsY)
    //   .lineTo(totalsBoxX + totalsBoxWidth, totalsY)
    //   .lineWidth(1)
    //   .strokeColor("#e2e8f0")
    //   .stroke();

    // totalsY += 12;

    // // Total Amount
    // doc.fontSize(12).fillColor("#0f172a").font("Helvetica-Bold");
    // doc.text("TOTAL AMOUNT", totalsBoxX + 10, totalsY);
    // doc
    //   .fontSize(18)
    //   .fillColor("#ec5b13")
    //   .text(
    //     formatCurrency(booking.totalPrice),
    //     totalsBoxX + totalsBoxWidth - 10,
    //     totalsY,
    //     { width: 0, align: "right" },
    //   );

    // // ============================================
    // // FOOTER
    // // ============================================
    // currentY = pageHeight - 65;

    // doc.fontSize(9).fillColor("#64748b").font("Helvetica");
    // doc.text(
    //   "For questions, contact support@homeservice.com or call +91 9876543210",
    //   marginLeft,
    //   currentY,
    //   { width: contentWidth, align: "center" },
    // );

    // currentY += 18;

    // // Footer divider lines
    // const lineWidth = 50;
    // const lineX = (pageWidth - lineWidth) / 2;
    // doc
    //   .moveTo(lineX, currentY)
    //   .lineTo(lineX + lineWidth, currentY)
    //   .lineWidth(1)
    //   .strokeColor("#94a3b8")
    //   .stroke();

    // currentY += 12;

    // doc.fontSize(8).fillColor("#94a3b8").font("Helvetica-Bold");
    // doc.text("HOME SERVICE MANAGEMENT", marginLeft, currentY, {
    //   width: contentWidth,
    //   align: "center",
    // });

    // // Finalize PDF
    // doc.end();
    // ============================================
    // HEADER SECTION
    // ============================================
    const logoSize = 55;
    doc
      .rect(marginLeft, currentY, logoSize, logoSize)
      .fillAndStroke("#ec5b13", "#ec5b13");
    doc
      .fontSize(20)
      .fillColor("white")
      .text("HSM", marginLeft + 12, currentY + 18);

    doc.fontSize(16).fillColor("#0f172a").font("Helvetica-Bold");
    doc.text(
      business?.businessName || "Home Service Pro",
      marginLeft + 65,
      currentY + 8,
    );

    doc.fontSize(9).fillColor("#64748b").font("Helvetica");
    doc.text(
      business?.description || "Quality Service Solutions",
      marginLeft + 65,
      currentY + 30,
    );

    // Invoice Info (Right) — use a fixed-width block for right alignment
    const invoiceBlockWidth = 150;
    const invoiceInfoX = pageWidth - marginRight - invoiceBlockWidth;

    doc.fontSize(24).fillColor("#0f172a").font("Helvetica-Bold");
    doc.text("INVOICE", invoiceInfoX, currentY + 5, {
      width: invoiceBlockWidth,
      align: "right",
    });

    doc.fontSize(11).fillColor("#64748b").font("Helvetica-Bold");
    doc.text(`#${invoiceNumber}`, invoiceInfoX, currentY + 32, {
      width: invoiceBlockWidth,
      align: "right",
    });

    doc.fontSize(8).fillColor("#64748b").font("Helvetica");
    doc.text(
      `Issued: ${formatDate(booking.createdAt || booking.bookingDate)}`,
      invoiceInfoX,
      currentY + 48,
      { width: invoiceBlockWidth, align: "right" },
    );

    // PAID Badge — right-aligned below "Issued" date
    const badgeY = currentY + 62;
    const badgeWidth = 55;
    const badgeHeight = 20;
    const badgeX = pageWidth - marginRight - badgeWidth; // flush right
    doc
      .roundedRect(badgeX, badgeY, badgeWidth, badgeHeight, 3)
      .fillAndStroke("#bbf7d0", "#15803d");
    doc.fontSize(10).fillColor("#15803d").font("Helvetica-Bold");
    doc.text("PAID", badgeX, badgeY + 6, {
      width: badgeWidth,
      align: "center",
    });

    // Divider line
    currentY += 95;
    doc
      .moveTo(marginLeft, currentY)
      .lineTo(pageWidth - marginRight, currentY)
      .lineWidth(1)
      .strokeColor("#e2e8f0")
      .stroke();

    // ============================================
    // ADDRESSES SECTION
    // ============================================
    currentY += 15; // <-- FIX: was 115, caused huge gap

    const addressBoxHeight = 90;
    doc
      .roundedRect(marginLeft, currentY, contentWidth, addressBoxHeight, 6)
      .fill("#f8fafc");

    // Bill To (Left)
    doc
      .fontSize(9)
      .fillColor("#94a3b8")
      .font("Helvetica-Bold")
      .text("BILL TO", marginLeft + 10, currentY + 10);

    doc.fontSize(12).fillColor("#0f172a").font("Helvetica-Bold");
    doc.text(customer?.name || "N/A", marginLeft + 10, currentY + 25, {
      width: columnWidth,
      ellipsis: true,
    });

    doc.fontSize(9).fillColor("#64748b").font("Helvetica");
    doc.text(address?.street || "N/A", marginLeft + 10, currentY + 42, {
      width: columnWidth,
      ellipsis: true,
    });
    doc.text(
      address ? `${address.city}, ${address.state} ${address.zipCode}` : "N/A",
      marginLeft + 10,
      currentY + 56,
      { width: columnWidth, ellipsis: true },
    );
    if (customer?.phone) {
      doc.text(customer.phone, marginLeft + 10, currentY + 70, {
        width: columnWidth,
      });
    }

    // Service Address (Right)
    const addressRightX = marginLeft + columnWidth + 25;
    doc
      .fontSize(9)
      .fillColor("#94a3b8")
      .font("Helvetica-Bold")
      .text("SERVICE ADDRESS", addressRightX, currentY + 10);

    doc.fontSize(12).fillColor("#0f172a").font("Helvetica-Bold");
    doc.text(
      address ? `${address.street},` : "N/A",
      addressRightX,
      currentY + 25,
      { width: columnWidth, ellipsis: true },
    );

    doc.fontSize(9).fillColor("#64748b").font("Helvetica");
    doc.text(
      address ? `${address.city}, ${address.state} ${address.zipCode}` : "N/A",
      addressRightX,
      currentY + 42,
      { width: columnWidth, ellipsis: true },
    );

    // ============================================
    // SERVICE TABLE
    // ============================================
    currentY += addressBoxHeight + 20;

    // Define column widths — FIX: ensure they fit within contentWidth
    const colDescX = marginLeft + 10;
    const colDescWidth = 150; // was 160
    const colDateTimeX = colDescX + colDescWidth + 10;
    const colDateTimeWidth = 130; // was 140
    const colDurationX = colDateTimeX + colDateTimeWidth + 10;
    const colDurationWidth = 70; // was 80
    const colAmountX = colDurationX + colDurationWidth + 10;
    const colAmountWidth = pageWidth - marginRight - colAmountX - 30; // added -10 for right padding    // Table Header
    const tableHeaderHeight = 26;
    doc
      .fillColor("#f1f5f9")
      .rect(marginLeft, currentY, contentWidth, tableHeaderHeight)
      .fill();

    doc.fontSize(8).fillColor("#94a3b8").font("Helvetica-Bold");
    doc.text("DESCRIPTION", colDescX, currentY + 9, { width: colDescWidth });
    doc.text("DATE & TIME", colDateTimeX, currentY + 9, {
      width: colDateTimeWidth,
    });
    doc.text("DURATION", colDurationX, currentY + 9, {
      width: colDurationWidth,
    });
    doc.text("AMOUNT", colAmountX, currentY + 9, {
      width: colAmountWidth,
      align: "right",
    });

    // Table Row
    currentY += tableHeaderHeight;
    const rowHeight = 50;
    doc
      .fillColor("#f8fafc")
      .rect(marginLeft, currentY, contentWidth, rowHeight)
      .fill();

    doc.fontSize(11).fillColor("#0f172a").font("Helvetica-Bold");
    doc.text(service?.name || "Service", colDescX, currentY + 10, {
      width: colDescWidth,
      ellipsis: true,
    });

    if (service?.description) {
      doc.fontSize(8).fillColor("#64748b").font("Helvetica");
      const truncatedDesc =
        service.description.length > 50
          ? service.description.substring(0, 50) + "..."
          : service.description;
      doc.text(truncatedDesc, colDescX, currentY + 26, {
        width: colDescWidth,
        ellipsis: true,
      });
    }

    doc.fontSize(9).fillColor("#64748b").font("Helvetica");
    doc.text(
      `${formatDate(booking.bookingDate)} at ${formatTime(slot?.startTime)}`,
      colDateTimeX,
      currentY + 20,
      { width: colDateTimeWidth, ellipsis: true },
    );

    const duration = service?.EstimateDuration || service?.duration || 0;
    const hours = Math.floor(duration / 60);
    const mins = duration % 60;
    const durationText =
      duration > 0 ? (hours > 0 ? `${hours}h ${mins}m` : `${mins}m`) : "N/A";
    doc.text(durationText, colDurationX, currentY + 20, {
      width: colDurationWidth,
    });

    // FIX: Use proper width for right-aligned amount (not width: 0)
    doc.fontSize(11).fillColor("#0f172a").font("Helvetica-Bold");
    doc.text(
      formatCurrency(service?.price || booking.totalPrice),
      colAmountX,
      currentY + 20,
      { width: colAmountWidth, align: "right" },
    );

    // ============================================
    // TOTALS & NOTES SECTION
    // ============================================
    currentY += rowHeight + 25;

    // Notes (Left)
    // Totals Box
    const totalsBoxWidth = 170;
    const totalsBoxX = pageWidth - marginRight - totalsBoxWidth;
    const totalsBoxHeight = booking.rescheduleOutcome ? 145 : 115; // Extra height for reschedule fee
    const totalsPadding = 20;
    const totalsInnerWidth = totalsBoxWidth - totalsPadding * 2;

    doc
      .roundedRect(totalsBoxX, currentY - 5, totalsBoxWidth, totalsBoxHeight, 6)
      .fillAndStroke("#f1f5f9", "#e2e8f0");

    let totalsY = currentY + 8;

    // Service Charge
    const servicePrice = service?.price || booking.totalPrice;
    doc.fontSize(10).fillColor("#64748b").font("Helvetica");
    doc.text("Service Charge", totalsBoxX + totalsPadding, totalsY, {
      width: totalsInnerWidth,
      align: "left",
    });
    doc.text(
      formatCurrency(servicePrice),
      totalsBoxX + totalsPadding,
      totalsY,
      { width: totalsInnerWidth, align: "right" },
    );

    totalsY += 22;

    // Reschedule Fee (if applicable)
    let rescheduleFeeAmount = 0;
    let hasRescheduleRefund = false;

    if (booking.rescheduleOutcome === "pending" || booking.rescheduleOutcome === "accepted") {
      rescheduleFeeAmount = booking.lastRescheduleFee ? booking.lastRescheduleFee / 100 : 100; // Convert paise to rupees
      doc.text("Reschedule Fee", totalsBoxX + totalsPadding, totalsY, {
        width: totalsInnerWidth,
        align: "left",
      });
      doc.text(
        formatCurrency(rescheduleFeeAmount),
        totalsBoxX + totalsPadding,
        totalsY,
        { width: totalsInnerWidth, align: "right" },
      );
      totalsY += 22;
    } else if (booking.rescheduleOutcome === "rejected" || booking.rescheduleOutcome === "cancelled") {
      rescheduleFeeAmount = booking.lastRescheduleFee ? booking.lastRescheduleFee / 100 : 100;
      hasRescheduleRefund = true;

      // Show the fee that was charged
      doc.text("Reschedule Fee", totalsBoxX + totalsPadding, totalsY, {
        width: totalsInnerWidth,
        align: "left",
      });
      doc.text(
        formatCurrency(rescheduleFeeAmount),
        totalsBoxX + totalsPadding,
        totalsY,
        { width: totalsInnerWidth, align: "right" },
      );
      totalsY += 22;

      // Show the refund
      doc.fontSize(9).fillColor("#16a34a"); // Green for refund
      doc.text("Refund", totalsBoxX + totalsPadding, totalsY, {
        width: totalsInnerWidth,
        align: "left",
      });
      doc.text(
        `-${formatCurrency(rescheduleFeeAmount)}`,
        totalsBoxX + totalsPadding,
        totalsY,
        { width: totalsInnerWidth, align: "right" },
      );
      doc.fontSize(10).fillColor("#64748b"); // Reset color
      totalsY += 22;
    }

    // Tax
    doc.text("Tax (Included)", totalsBoxX + totalsPadding, totalsY, {
      width: totalsInnerWidth,
      align: "left",
    });
    doc.fontSize(8).fillColor("#cbd5e1");
    doc.text("Included", totalsBoxX + totalsPadding, totalsY, {
      width: totalsInnerWidth,
      align: "right",
    });

    totalsY += 25;

    // Divider
    doc
      .moveTo(totalsBoxX + totalsPadding, totalsY)
      .lineTo(totalsBoxX + totalsBoxWidth - totalsPadding, totalsY)
      .lineWidth(1)
      .strokeColor("#e2e8f0")
      .stroke();

    totalsY += 12;

    // Total
    const finalTotal = hasRescheduleRefund ? servicePrice : (servicePrice + rescheduleFeeAmount);
    doc.fontSize(11).fillColor("#0f172a").font("Helvetica-Bold");
    doc.text("TOTAL", totalsBoxX + totalsPadding, totalsY + 2, {
      width: totalsInnerWidth,
      align: "left",
    });
    doc.fontSize(16).fillColor("#ec5b13");
    doc.text(
      formatCurrency(finalTotal),
      totalsBoxX + totalsPadding,
      totalsY,
      { width: totalsInnerWidth, align: "right" },
    );

    // Reschedule Details Note (if applicable)
    if (booking.rescheduleOutcome && booking.previousBookingDate) {
      currentY += totalsBoxHeight + 15;
      doc.fontSize(8).fillColor("#94a3b8").font("Helvetica-Bold");
      doc.text("RESCHEDULE DETAILS", marginLeft, currentY);
      currentY += 12;

      doc.fontSize(8).fillColor("#64748b").font("Helvetica");
      const prevDate = formatDate(booking.previousBookingDate);
      const prevTime = booking.previousSlotTime ? formatTime(booking.previousSlotTime) : "";

      const rescheduleStatusText =
        booking.rescheduleOutcome === "pending" ? "Pending approval" :
        booking.rescheduleOutcome === "accepted" ? "Approved" :
        booking.rescheduleOutcome === "rejected" ? "Declined by provider" :
        "Cancelled by customer";

      doc.text(
        `Previous: ${prevDate}${prevTime ? ` at ${prevTime}` : ""} → ${formatDate(booking.bookingDate)} at ${formatTime(slot?.startTime)} (${rescheduleStatusText})`,
        marginLeft,
        currentY,
        { width: contentWidth, ellipsis: true }
      );
    }

    // ============================================
    // FOOTER
    // ============================================
    currentY = pageHeight - 85; // was -65, not enough room

    doc.fontSize(9).fillColor("#64748b").font("Helvetica");
    doc.text(
      "For questions, contact support@homeservice.com or call +91 9876543210",
      marginLeft,
      currentY,
      { width: contentWidth, align: "center" },
    );

    currentY += 15;
    const lineLen = 50;
    const lineX = (pageWidth - lineLen) / 2;
    doc
      .moveTo(lineX, currentY)
      .lineTo(lineX + lineLen, currentY)
      .lineWidth(1)
      .strokeColor("#94a3b8")
      .stroke();

    currentY += 10;
    doc.fontSize(8).fillColor("#94a3b8").font("Helvetica-Bold");
    doc.text("HOME SERVICE MANAGEMENT", marginLeft, currentY, {
      width: contentWidth,
      align: "center",
    });
    doc.end();
  } catch (error) {
    console.error("Error generating invoice:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  generateInvoice,
};
