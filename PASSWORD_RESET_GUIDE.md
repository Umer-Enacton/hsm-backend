# Password Reset API Documentation

## Overview

The password reset functionality uses a **OTP (One-Time Password)** based system with email verification. Users can request a password reset, receive an OTP via email, verify it, and then set a new password.

---

## API Endpoints

### 1. Forgot Password - Request OTP

```http
POST /forgot-password
```

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Success Response (200 OK):**
```json
{
  "message": "If an account exists with this email, an OTP has been sent"
}
```

---

### 2. Verify OTP

```http
POST /verify-otp
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "otp": "123456"
}
```

**Success Response (200 OK):**
```json
{
  "message": "OTP verified successfully",
  "verified": true
}
```

---

### 3. Reset Password

```http
POST /reset-password
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "otp": "123456",
  "newPassword": "newSecurePassword123"
}
```

**Success Response (200 OK):**
```json
{
  "message": "Password reset successfully. You can now login with your new password"
}
```

---

## Frontend Implementation Example

```javascript
// Step 1: Request OTP
const requestOTP = async (email) => {
  const response = await fetch('http://localhost:8000/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email })
  });
  return await response.json();
};

// Step 2: Verify OTP
const verifyOTP = async (email, otp) => {
  const response = await fetch('http://localhost:8000/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, otp })
  });
  return await response.json();
};

// Step 3: Reset Password
const resetPassword = async (email, otp, newPassword) => {
  const response = await fetch('http://localhost:8000/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, otp, newPassword })
  });
  return await response.json();
};
```

---

## Features

✅ **6-digit OTP** sent via email
✅ **10-minute expiration** for security
✅ **Beautiful HTML emails** with professional design
✅ **Confirmation email** after successful reset
✅ **Security best practices** - prevents email enumeration
✅ **Input validation** using Yup schemas

---

## Configuration

Your `.env` is already configured with:

```env
EMAIL_USER=noorchisti35@gmail.com
EMAIL_PASS=gvvx lrmz qizy dbps
```

The email service is ready to use!

---

## Files Created/Modified

### New Files:
- `helper/emailService.js` - Email sending with nodemailer

### Modified Files:
- `controllers/auth.controller.js` - Added 3 new functions
- `routes/auth.route.js` - Added 3 new routes
- `helper/validation.js` - Added 3 new validation schemas

---

**Version:** 1.0.0 | **Last Updated:** 2026-02-20
