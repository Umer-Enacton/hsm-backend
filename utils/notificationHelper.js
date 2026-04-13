const db = require('../config/db');
const { notifications, users, bookings, services, businessProfiles, slots } = require('../models/schema');
const { eq, and, desc, sql } = require('drizzle-orm');
const { sendPushNotification } = require('../services/fcm.service');

// STARTUP LOG: Confirm this file is loaded
console.log('✅ notificationHelper.js loaded - version 2026-03-16-v2');

/**
 * Create and send notification
 * @param {object} params - Notification parameters
 * @returns {Promise<object>} Created notification
 */
async function createNotification({
  userId,
  type,
  title,
  message,
  data = {},
}) {
  try {
    console.log('🔔 Creating notification:', { userId, type, title });

    // Convert data object to JSON string for storage
    const dataString = Object.keys(data).length > 0 ? JSON.stringify(data) : null;

    // Save to database
    const [notification] = await db.insert(notifications)
      .values({
        userId,
        type,
        title,
        message,
        data: dataString,
      })
      .returning();

    console.log('✅ Notification saved to DB:', notification.id);

    // Send push notification
    const pushResult = await sendPushNotification(userId, title, message, {
      notificationId: notification.id.toString(),
      ...data,
    });

    console.log('📱 Push notification result:', pushResult);

    return notification;
  } catch (error) {
    console.error('❌ Notification creation error:', error);
    return null;
  }
}

/**
 * Helper to get booking details for notifications
 * Includes slot information for accurate time display
 */
async function getBookingDetails(bookingId) {
  const [booking] = await db.select()
    .from(bookings)
    .where(eq(bookings.id, bookingId));

  if (!booking) return null;

  const [service] = await db.select()
    .from(services)
    .where(eq(services.id, booking.serviceId));

  const [business] = await db.select()
    .from(businessProfiles)
    .where(eq(businessProfiles.id, booking.businessProfileId));

  const [slot] = await db.select()
    .from(slots)
    .where(eq(slots.id, booking.slotId));

  return { booking, service, business, slot };
}

/**
 * Notification templates for different events
 */
const notificationTemplates = {
  /**
   * New booking created - Notify provider
   */
  async bookingCreated(bookingId) {
    console.log('🔔 ============================================ 🔔');
    console.log('🔔 bookingCreated called with bookingId:', bookingId);
    console.log('🔔 ============================================ 🔔');

    const details = await getBookingDetails(bookingId);
    console.log('🔔 getBookingDetails result:', JSON.stringify(details, null, 2));

    if (!details) {
      console.log('❌ getBookingDetails returned null');
      return null;
    }

    const { business, service } = details;
    console.log('🔔 Business providerId:', business?.providerId, 'Service name:', service?.name);

    if (!business) {
      console.log('❌ Business is null - cannot send notification');
      return null;
    }

    if (!business.providerId) {
      console.log('❌ Business.providerId is null or undefined - business:', JSON.stringify(business));
      return null;
    }

    console.log('🔔 About to call createNotification for providerId:', business.providerId);
    const result = await createNotification({
      userId: business.providerId,
      type: 'booking_created',
      title: 'New Booking Request',
      message: `You have a new booking request for ${service.name}`,
      data: { bookingId: bookingId.toString(), actionUrl: `/provider/bookings` },
    });
    console.log('🔔 createNotification completed, result:', result);
    return result;
  },

  /**
   * Provider accepted booking - Notify customer
   */
  async bookingConfirmed(bookingId) {
    const details = await getBookingDetails(bookingId);
    if (!details) return null;

    const { booking, service } = details;

    return createNotification({
      userId: booking.customerId,
      type: 'booking_confirmed',
      title: 'Booking Confirmed',
      message: `Your booking for ${service.name} has been confirmed`,
      data: { bookingId: bookingId.toString(), actionUrl: `/customer/bookings` },
    });
  },

  /**
   * Provider rejected booking - Notify customer
   */
  async bookingRejected(bookingId, reason = '') {
    const details = await getBookingDetails(bookingId);
    if (!details) return null;

    const { booking, service } = details;

    return createNotification({
      userId: booking.customerId,
      type: 'booking_rejected',
      title: 'Booking Rejected',
      message: reason
        ? `Your booking for ${service.name} was declined: ${reason}`
        : `Your booking request for ${service.name} was declined`,
      data: { bookingId: bookingId.toString(), actionUrl: `/customer/bookings` },
    });
  },

  /**
   * Customer cancelled booking - Notify provider
   */
  async bookingCancelled(bookingId) {
    const details = await getBookingDetails(bookingId);
    if (!details) return null;

    const { business, service, booking } = details;

    return createNotification({
      userId: business.providerId,
      type: 'booking_cancelled',
      title: 'Booking Cancelled',
      message: `Booking for ${service.name} has been cancelled by customer`,
      data: { bookingId: bookingId.toString(), actionUrl: `/provider/bookings` },
    });
  },

  /**
   * Customer requested reschedule - Notify provider
   */
  async rescheduleRequested(bookingId) {
    const details = await getBookingDetails(bookingId);
    if (!details) return null;

    const { business, service } = details;

    return createNotification({
      userId: business.providerId,
      type: 'reschedule_request',
      title: 'Reschedule Request',
      message: `Customer requested to reschedule ${service.name}`,
      data: { bookingId: bookingId.toString(), actionUrl: `/provider/bookings` },
    });
  },

  /**
   * Provider approved reschedule - Notify customer
   */
  async rescheduleApproved(bookingId) {
    const details = await getBookingDetails(bookingId);
    if (!details) return null;

    const { booking } = details;

    return createNotification({
      userId: booking.customerId,
      type: 'reschedule_approved',
      title: 'Reschedule Approved',
      message: `Your reschedule request has been approved`,
      data: { bookingId: bookingId.toString(), actionUrl: `/customer/bookings` },
    });
  },

  /**
   * Provider declined reschedule - Notify customer
   */
  async rescheduleDeclined(bookingId) {
    const details = await getBookingDetails(bookingId);
    if (!details) return null;

    const { booking } = details;

    return createNotification({
      userId: booking.customerId,
      type: 'reschedule_declined',
      title: 'Reschedule Declined',
      message: `Your reschedule request was declined. Original booking time restored.`,
      data: { bookingId: bookingId.toString(), actionUrl: `/customer/bookings` },
    });
  },

  /**
   * Provider initiated reschedule - Notify customer
   * This is when the provider proactively changes the booking time
   */
  async providerRescheduled(bookingId, reason = '') {
    const details = await getBookingDetails(bookingId);
    if (!details) return null;

    const { booking, service } = details;

    return createNotification({
      userId: booking.customerId,
      type: 'provider_rescheduled',
      title: 'Booking Rescheduled by Provider',
      message: `Your booking for ${service.name} has been rescheduled by the provider${reason ? `: ${reason}` : ''}`,
      data: { bookingId: bookingId.toString(), actionUrl: `/customer/bookings` },
    });
  },

  /**
   * Reminder to accept/reject booking - Notify provider
   */
  async acceptReminder(bookingId) {
    const details = await getBookingDetails(bookingId);
    if (!details) return null;

    const { business, service } = details;

    return createNotification({
      userId: business.providerId,
      type: 'reminder_accept',
      title: 'Action Required',
      message: `Please accept/reject booking for ${service.name} - expiring soon`,
      data: { bookingId: bookingId.toString(), actionUrl: `/provider/bookings` },
    });
  },

  /**
   * Upcoming service reminder - Notify customer
   * Uses slot time for accurate scheduling
   */
  async upcomingService(bookingId) {
    const details = await getBookingDetails(bookingId);
    if (!details) return null;

    const { booking, service, slot } = details;

    // Combine booking date with slot time for accurate datetime
    const bookingDate = new Date(booking.bookingDate);
    const [hours, minutes, seconds] = slot.startTime.split(':').map(Number);

    // Create a date in the local timezone by combining date and time
    const bookingDateTime = new Date(
      bookingDate.getFullYear(),
      bookingDate.getMonth(),
      bookingDate.getDate(),
      hours,
      minutes,
      seconds || 0
    );

    const dateStr = bookingDateTime.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      timeZone: 'Asia/Kolkata', // IST timezone
    });
    const timeStr = bookingDateTime.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    });

    return createNotification({
      userId: booking.customerId,
      type: 'reminder_upcoming',
      title: 'Service Tomorrow',
      message: `Reminder: Your ${service.name} is scheduled for ${dateStr} at ${timeStr}`,
      data: { bookingId: bookingId.toString(), actionUrl: `/customer/bookings` },
    });
  },

  /**
   * Upcoming service reminder - Notify provider
   * Uses slot time for accurate scheduling
   */
  async providerUpcomingService(bookingId) {
    const details = await getBookingDetails(bookingId);
    if (!details) return null;

    const { booking, service, slot, business } = details;

    // Combine booking date with slot time for accurate datetime
    const bookingDate = new Date(booking.bookingDate);
    const [hours, minutes, seconds] = slot.startTime.split(':').map(Number);

    // Create a date in the local timezone by combining date and time
    const bookingDateTime = new Date(
      bookingDate.getFullYear(),
      bookingDate.getMonth(),
      bookingDate.getDate(),
      hours,
      minutes,
      seconds || 0
    );

    const dateStr = bookingDateTime.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      timeZone: 'Asia/Kolkata',
    });
    const timeStr = bookingDateTime.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    });

    return createNotification({
      userId: business.providerId,
      type: 'reminder_upcoming_provider',
      title: 'Upcoming Service',
      message: `Reminder: You have a ${service.name} scheduled for ${dateStr} at ${timeStr}`,
      data: { bookingId: bookingId.toString(), actionUrl: `/provider/bookings` },
    });
  },

  /**
   * Day-of service reminder - Notify customer
   * Uses slot time for accurate time display
   */
  async dayOfReminderCustomer(bookingId) {
    const details = await getBookingDetails(bookingId);
    if (!details) return null;

    const { booking, service, slot } = details;

    // Combine booking date with slot time for accurate datetime
    const bookingDate = new Date(booking.bookingDate);
    const [hours, minutes, seconds] = slot.startTime.split(':').map(Number);

    // Create a date in the local timezone by combining date and time
    const bookingDateTime = new Date(
      bookingDate.getFullYear(),
      bookingDate.getMonth(),
      bookingDate.getDate(),
      hours,
      minutes,
      seconds || 0
    );

    const timeStr = bookingDateTime.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    });

    return createNotification({
      userId: booking.customerId,
      type: 'reminder_day_of',
      title: 'Service Today',
      message: `Reminder: Your ${service.name} is scheduled for today at ${timeStr}`,
      data: { bookingId: bookingId.toString(), actionUrl: `/customer/bookings` },
    });
  },

  /**
   * Day-of service reminder - Notify provider
   * Uses slot time for accurate time display
   */
  async dayOfReminderProvider(bookingId) {
    const details = await getBookingDetails(bookingId);
    if (!details) return null;

    const { business, service, slot } = details;

    // Combine booking date with slot time for accurate datetime
    const bookingDate = new Date(booking.bookingDate);
    const [hours, minutes, seconds] = slot.startTime.split(':').map(Number);

    // Create a date in the local timezone by combining date and time
    const bookingDateTime = new Date(
      bookingDate.getFullYear(),
      bookingDate.getMonth(),
      bookingDate.getDate(),
      hours,
      minutes,
      seconds || 0
    );

    const timeStr = bookingDateTime.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    });

    return createNotification({
      userId: business.providerId,
      type: 'reminder_day_of_provider',
      title: 'Service Today',
      message: `Reminder: You have a ${service.name} scheduled for today at ${timeStr}`,
      data: { bookingId: bookingId.toString(), actionUrl: `/provider/bookings` },
    });
  },

  /**
   * Pending Action Reminder - Notify provider
   */
  async providerPendingActionReminder(bookingId) {
    const details = await getBookingDetails(bookingId);
    if (!details) return null;

    const { business, service } = details;

    return createNotification({
      userId: business.providerId,
      type: 'reminder_pending_action',
      title: 'Action Required: Pending Booking',
      message: `Reminder: You have a pending booking request for ${service.name}. Please take an action.`,
      data: { bookingId: bookingId.toString(), actionUrl: `/provider/bookings` },
    });
  },

  /**
   * Payment successful - Notify both parties
   */
  async paymentSuccess(bookingId, amount) {
    const details = await getBookingDetails(bookingId);
    if (!details) return null;

    const { booking, service, business } = details;
    const amountInRupees = (amount / 100).toFixed(2);

    // Notify customer
    await createNotification({
      userId: booking.customerId,
      type: 'payment_success',
      title: 'Payment Successful',
      message: `Payment of ₹${amountInRupees} for ${service.name} completed`,
      data: { bookingId: bookingId.toString(), actionUrl: `/customer/bookings` },
    });

    // Notify provider
    return createNotification({
      userId: business.providerId,
      type: 'payment_received',
      title: 'Payment Received',
      message: `Payment of ₹${amountInRupees} received for ${service.name}`,
      data: { bookingId: bookingId.toString(), actionUrl: `/provider/bookings` },
    });
  },

  /**
   * Booking completed - Notify customer
   */
  async bookingCompleted(bookingId) {
    const details = await getBookingDetails(bookingId);
    if (!details) return null;

    const { booking, service } = details;

    return createNotification({
      userId: booking.customerId,
      type: 'booking_completed',
      title: 'Service Completed',
      message: `Your ${service.name} has been completed. Please rate your experience!`,
      data: { bookingId: bookingId.toString(), actionUrl: `/customer/bookings` },
    });
  },

  /**
   * Business blocked - Notify provider
   */
  async businessBlocked(providerId, businessName, reason) {
    return createNotification({
      userId: providerId,
      type: 'business_blocked',
      title: 'Business Blocked',
      message: `Your business "${businessName}" has been blocked. Reason: ${reason}`,
      data: { type: 'blocked', actionUrl: `/provider/business` },
    });
  },

  /**
   * Business unblocked - Notify provider
   */
  async businessUnblocked(providerId, businessName) {
    return createNotification({
      userId: providerId,
      type: 'business_unblocked',
      title: 'Business Unblocked',
      message: `Your business "${businessName}" has been unblocked. You can receive new bookings.`,
      data: { type: 'unblocked', actionUrl: `/provider/business` },
    });
  },

  /**
   * Service deactivated - Notify provider
   */
  async serviceDeactivated(providerId, serviceName, reason) {
    return createNotification({
      userId: providerId,
      type: 'service_deactivated',
      title: 'Service Deactivated',
      message: `Service "${serviceName}" has been deactivated. Reason: ${reason}`,
      data: { type: 'deactivated', actionUrl: `/provider/services` },
    });
  },

  /**
   * Service reactivated - Notify provider
   */
  async serviceReactivated(providerId, serviceName) {
    return createNotification({
      userId: providerId,
      type: 'service_reactivated',
      title: 'Service Reactivated',
      message: `Service "${serviceName}" has been reactivated and is available for booking.`,
      data: { type: 'reactivated', actionUrl: `/provider/services` },
    });
  },

  /**
   * Booking limit reached - Notify provider
   */
  async bookingLimitReached(providerId, maxBookings, planName) {
    return createNotification({
      userId: providerId,
      type: 'booking_limit_reached',
      title: 'Monthly Booking Limit Reached',
      message: `You've reached your ${maxBookings} booking limit for this month on the ${planName} plan. Your services are now hidden from customers. Upgrade to continue receiving bookings.`,
      data: {
        maxBookings,
        planName,
        actionUrl: `/provider/subscription`,
      },
    });
  },

  /**
   * Trial expired - Notify provider
   */
  async trialExpired(providerId, previousPlanName) {
    return createNotification({
      userId: providerId,
      type: 'trial_expired',
      title: 'Your Trial Has Ended',
      message: `Your ${previousPlanName} trial has ended. You've been downgraded to the Free plan. Upgrade anytime to regain access to premium features.`,
      data: {
        previousPlanName,
        newPlanName: 'Free',
        actionUrl: `/provider/subscription`,
      },
    });
  },

  /**
   * Trial expiring soon (3 days) - Notify provider
   */
  async trialExpiringSoon(providerId, planName, daysRemaining) {
    return createNotification({
      userId: providerId,
      type: 'trial_expiring_soon',
      title: 'Trial Expiring Soon',
      message: `Your ${planName} trial ends in ${daysRemaining} days. Upgrade now to continue enjoying premium features.`,
      data: {
        planName,
        daysRemaining,
        actionUrl: `/provider/subscription`,
      },
    });
  },

  /**
   * Trial expiring tomorrow - Notify provider
   */
  async trialExpiringTomorrow(providerId, planName) {
    return createNotification({
      userId: providerId,
      type: 'trial_expiring_tomorrow',
      title: 'Trial Ends Tomorrow!',
      message: `Your ${planName} trial ends tomorrow. Don't lose access to premium features - upgrade today!`,
      data: {
        planName,
        actionUrl: `/provider/subscription`,
      },
    });
  },

  /**
   * Trial ended (via cron) - Notify provider
   * Called when cron job marks trial as expired
   */
  async trialEnded(providerId) {
    return createNotification({
      userId: providerId,
      type: 'trial_ended',
      title: 'Your Free Trial Has Ended',
      message: 'Your 7-day free trial has ended. You\'ve been downgraded to the Free plan. Upgrade anytime to regain access to premium features.',
      data: {
        actionUrl: `/provider/subscription`,
      },
    });
  },

  /**
   * Plan upgraded - Notify provider
   */
  async planUpgraded(providerId, newPlanName) {
    return createNotification({
      userId: providerId,
      type: 'plan_upgraded',
      title: 'Plan Upgraded Successfully!',
      message: `You've been upgraded to the ${newPlanName} plan. Enjoy all the premium features!`,
      data: {
        newPlanName,
        actionUrl: `/provider/subscription`,
      },
    });
  },

  /**
   * Notify provider that no staff is available for auto-assign
   */
  async noStaffAvailableForBooking(providerId, details) {
    const { bookingId, serviceName, bookingDate, slotTime, reason } = details;

    return createNotification({
      userId: providerId,
      type: "no_staff_available",
      title: "Staff Assignment Required",
      message: `Booking #${bookingId} for ${serviceName} on ${new Date(bookingDate).toLocaleDateString()} at ${slotTime} could not be auto-assigned: ${reason}. Please assign manually.`,
      data: {
        bookingId,
        reason,
        actionUrl: `/provider/bookings?booking=${bookingId}`,
      },
    });
  },

  /**
   * Notify staff about new booking assignment
   */
  async staffBookingAssigned(staffUserId, details) {
    const { bookingId, serviceName, bookingDate, slotTime, earningType, commissionPercent, fixedAmount } = details;

    let earningInfo = "";
    if (earningType === "commission") {
      earningInfo = `Earning: ${commissionPercent}% commission`;
    } else if (earningType === "fixed") {
      earningInfo = `Earning: ₹${(fixedAmount / 100).toFixed(2)} fixed`;
    }

    return createNotification({
      userId: staffUserId,
      type: "booking_assigned",
      title: "New Booking Assigned",
      message: `You have been assigned a new booking: ${serviceName} on ${new Date(bookingDate).toLocaleDateString()} at ${slotTime}. ${earningInfo}`,
      data: {
        bookingId,
        actionUrl: "/staff/bookings",
      },
    });
  },

  /**
   * Notify provider when staff requests leave
   */
  async staffLeaveRequested(providerId, details) {
    const { staffName, leaveType, startDate, endDate, reason, leaveId } = details;

    return createNotification({
      userId: providerId,
      type: "staff_leave_request",
      title: "Staff Leave Request",
      message: `${staffName} has requested ${leaveType} leave from ${new Date(startDate).toLocaleDateString()} to ${new Date(endDate).toLocaleDateString()}. Reason: ${reason || "No reason provided"}`,
      data: {
        leaveId,
        actionUrl: "/provider/staff/leave",
      },
    });
  },

  /**
   * Notify staff when leave is approved
   */
  async staffLeaveApproved(staffUserId, details) {
    const { startDate, endDate } = details;

    return createNotification({
      userId: staffUserId,
      type: "leave_approved",
      title: "Leave Approved",
      message: `Your leave request from ${new Date(startDate).toLocaleDateString()} to ${new Date(endDate).toLocaleDateString()} has been approved.`,
      data: {},
    });
  },

  /**
   * Notify staff when leave is rejected
   */
  async staffLeaveRejected(staffUserId, details) {
    const { rejectionReason } = details;

    return createNotification({
      userId: staffUserId,
      type: "leave_rejected",
      title: "Leave Request Rejected",
      message: `Your leave request has been rejected. Reason: ${rejectionReason || "No reason provided"}`,
      data: {},
    });
  },

  /**
   * Notify staff about upcoming booking reminder (day before)
   */
  async staffBookingReminder(staffUserId, details) {
    const { serviceName, bookingDate, slotTime, address, customerName } = details;

    return createNotification({
      userId: staffUserId,
      type: "staff_booking_reminder",
      title: "Upcoming Booking Tomorrow",
      message: `Reminder: You have a booking for ${serviceName} tomorrow at ${slotTime}. Customer: ${customerName}. Address: ${address}`,
      data: {
        actionUrl: "/staff/bookings",
      },
    });
  },

  /**
   * Notify staff about payout received
   */
  async staffPayoutReceived(staffUserId, details) {
    const { amount, payoutId, bookingCount } = details;

    return createNotification({
      userId: staffUserId,
      type: "payout_received",
      title: "Payout Received",
      message: `You have received a payout of ₹${(amount / 100).toFixed(2)} for ${bookingCount} booking(s). Ref: ${payoutId}`,
      data: {
        amount,
        payoutId,
      },
    });
  },
};

module.exports = {
  createNotification,
  notificationTemplates,
};
