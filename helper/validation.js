const yup = require("yup");

/* -------------------- COMMON HELPERS -------------------- */

const phoneRegex = /^[6-9]\d{9}$/;
const timeRegex = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const idField = (name) =>
  yup
    .number()
    .typeError(`${name} must be a number`)
    .integer(`${name} must be an integer`)
    .positive(`${name} must be positive`)
    .required(`${name} is required`);

/* -------------------- AUTH -------------------- */

const registerSchema = yup.object({
  name: yup
    .string()
    .trim()
    .min(3, "Name must be at least 3 characters")
    .max(50, "Name cannot exceed 50 characters")
    .required("Name is required"),

  email: yup
    .string()
    .email("Invalid email format")
    .required("Email is required"),

  phone: yup
    .string()
    .matches(phoneRegex, "Invalid phone number")
    .required("Phone number is required"),

  password: yup
    .string()
    .min(6, "Password must be at least 6 characters")
    .max(30, "Password cannot exceed 30 characters")
    .required("Password is required"),

  roleId: yup.number().optional(),
});

const loginSchema = yup.object({
  email: yup
    .string()
    .email("Invalid email format")
    .required("Email is required"),

  password: yup.string().required("Password is required"),
});

const forgotPasswordSchema = yup.object({
  email: yup
    .string()
    .email("Invalid email format")
    .required("Email is required"),
});

const verifyOTPSchema = yup.object({
  email: yup
    .string()
    .email("Invalid email format")
    .required("Email is required"),
  otp: yup
    .string()
    .matches(/^\d{6}$/, "OTP must be 6 digits")
    .required("OTP is required"),
});

const resetPasswordSchema = yup.object({
  email: yup
    .string()
    .email("Invalid email format")
    .required("Email is required"),
  otp: yup
    .string()
    .matches(/^\d{6}$/, "OTP must be 6 digits")
    .required("OTP is required"),
  newPassword: yup
    .string()
    .min(6, "Password must be at least 6 characters")
    .max(30, "Password cannot exceed 30 characters")
    .required("New password is required"),
});

/* -------------------- ADDRESS -------------------- */

const addressSchema = yup.object({
  street: yup
    .string()
    .trim()
    .min(3, "Street must be at least 3 characters")
    .required("Street is required"),

  city: yup
    .string()
    .trim()
    .min(2, "City must be at least 2 characters")
    .required("City is required"),

  state: yup
    .string()
    .trim()
    .min(2, "State must be at least 2 characters")
    .required("State is required"),

  zipCode: yup
    .string()
    .matches(/^\d{6}$/, "Zip code must be 6 digits")
    .required("Zip code is required"),
});

/* -------------------- BUSINESS -------------------- */

const businessSchema = yup.object({
  name: yup
    .string()
    .trim()
    .min(3, "Business name must be at least 3 characters")
    .max(100, "Business name too long")
    .required("Business name is required"),

  description: yup
    .string()
    .trim()
    .min(10, "Description must be at least 10 characters")
    .max(500, "Description too long")
    .required("Description is required"),

  categoryId: idField("Category ID"),
});

/* -------------------- SERVICE -------------------- */

const serviceSchema = yup.object({
  name: yup
    .string()
    .trim()
    .min(3, "Service name must be at least 3 characters")
    .required("Service name is required"),

  description: yup
    .string()
    .trim()
    .min(10, "Service description too short")
    .required("Service description is required"),

  price: yup
    .number()
    .typeError("Price must be a number")
    .positive("Price must be greater than 0")
    .max(100000, "Price seems unrealistic")
    .required("Price is required"),

  duration: yup
    .number()
    .typeError("Duration must be a number")
    .positive("Duration must be positive")
    .max(1440, "Duration cannot exceed 24 hours")
    .required("Duration is required"),
});

/* -------------------- SLOT -------------------- */

const slotSchema = yup.object({
  startTime: yup
    .string()
    .matches(timeRegex, "Start time must be HH:mm:ss")
    .required("Start time is required"),

  endTime: yup
    .string()
    .matches(timeRegex, "End time must be HH:mm:ss")
    .required("End time is required"),
});

/* -------------------- BOOKING -------------------- */

const bookingSchema = yup.object({
  serviceId: idField("Service ID"),
  slotId: idField("Slot ID"),
  addressId: idField("Address ID"),

  bookingDate: yup
    .date()
    .typeError("Invalid booking date")
    .required("Booking date is required"),
});

/* -------------------- FEEDBACK -------------------- */

const feedbackSchema = yup.object({
  bookingId: idField("Booking ID"),

  rating: yup
    .number()
    .typeError("Rating must be a number")
    .min(1, "Rating must be at least 1")
    .max(5, "Rating cannot exceed 5")
    .required("Rating is required"),

  comments: yup.string().trim().max(300, "Comments too long").optional(),
});

/* -------------------- EXPORTS -------------------- */

module.exports = {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  verifyOTPSchema,
  resetPasswordSchema,
  addressSchema,
  businessSchema,
  serviceSchema,
  slotSchema,
  bookingSchema,
  feedbackSchema,
};
