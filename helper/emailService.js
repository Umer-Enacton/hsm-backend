const nodemailer = require("nodemailer");
require("dotenv").config();

// Create transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * Send OTP email for password reset
 * @param {string} email - Recipient email address
 * @param {string} otp - One-time password
 * @returns {Promise} - Send result
 */
const sendOTPEmail = async (email, otp) => {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Password Reset OTP - Home Service Management",
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .container {
            background-color: #f9f9f9;
            border-radius: 10px;
            padding: 30px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          }
          .header {
            text-align: center;
            margin-bottom: 30px;
          }
          .header h1 {
            color: #4a90e2;
            margin: 0;
          }
          .otp-box {
            background-color: #4a90e2;
            color: white;
            font-size: 32px;
            font-weight: bold;
            text-align: center;
            padding: 20px;
            border-radius: 8px;
            margin: 30px 0;
            letter-spacing: 5px;
          }
          .footer {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #ddd;
            text-align: center;
            font-size: 12px;
            color: #666;
          }
          .warning {
            background-color: #fff3cd;
            border-left: 4px solid #ffc107;
            padding: 15px;
            margin: 20px 0;
            border-radius: 4px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔐 Password Reset</h1>
          </div>
          <p>Hello,</p>
          <p>You have requested to reset your password for your Home Service Management account.</p>
          <p>Your One-Time Password (OTP) is:</p>
          <div class="otp-box">${otp}</div>
          <p><strong>This OTP will expire in 10 minutes.</strong></p>
          <div class="warning">
            <strong>⚠️ Security Notice:</strong><br>
            If you did not request this password reset, please ignore this email and your password will remain unchanged.
          </div>
          <p>To complete your password reset:</p>
          <ol>
            <li>Enter this OTP on the verification page</li>
            <li>Create your new password</li>
            <li>Submit the form</li>
          </ol>
          <div class="footer">
            <p>This is an automated email. Please do not reply.</p>
            <p>&copy; 2026 Home Service Management. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`OTP email sent to ${email}`);
    return { success: true };
  } catch (error) {
    console.error("Error sending email:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Send confirmation email for successful password reset
 * @param {string} email - Recipient email address
 * @returns {Promise} - Send result
 */
const sendPasswordResetConfirmation = async (email) => {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Password Reset Successful - Home Service Management",
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .container {
            background-color: #f9f9f9;
            border-radius: 10px;
            padding: 30px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          }
          .header {
            text-align: center;
            margin-bottom: 30px;
          }
          .header h1 {
            color: #28a745;
            margin: 0;
          }
          .success-icon {
            text-align: center;
            font-size: 64px;
            margin: 20px 0;
          }
          .footer {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #ddd;
            text-align: center;
            font-size: 12px;
            color: #666;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>✅ Password Reset Successful</h1>
          </div>
          <div class="success-icon">🎉</div>
          <p>Hello,</p>
          <p>Your password has been successfully reset for your Home Service Management account.</p>
          <p>You can now log in with your new password.</p>
          <p><strong>Security Reminder:</strong></p>
          <ul>
            <li>Never share your password with anyone</li>
            <li>Use a strong, unique password</li>
            <li>Change your password regularly</li>
          </ul>
          <p>If you did not make this change, please contact our support team immediately.</p>
          <div class="footer">
            <p>This is an automated email. Please do not reply.</p>
            <p>&copy; 2026 Home Service Management. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Password reset confirmation sent to ${email}`);
    return { success: true };
  } catch (error) {
    console.error("Error sending confirmation email:", error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendOTPEmail,
  sendPasswordResetConfirmation,
};
