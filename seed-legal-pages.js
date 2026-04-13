// Seed script for Privacy Policy and Terms & Conditions
// Run with: node seed-legal-pages.js

const db = require("./config/db");
const { privacyPolicies, termsConditions, users } = require("./models/schema");

const getAdminUser = async () => {
  const [admin] = await db
    .select()
    .from(users)
    .limit(1);
  return admin;
};

const privacyPolicyContent = `
<h1>Privacy Policy</h1>
<p>Last updated: ${new Date().toLocaleDateString()}</p>

<h2>1. Introduction</h2>
<p>Welcome to <strong>HomeFixCare</strong>. We respect your privacy and are committed to protecting your personal data. This privacy policy explains how we collect, use, and safeguard your information when you use our home services platform.</p>

<h2>2. Information We Collect</h2>

<h3>2.1 Personal Information</h3>
<p>We collect the following personal information:</p>
<ul>
  <li><strong>Name and contact details:</strong> Full name, email address, phone number</li>
  <li><strong>Account information:</strong> Username, password (encrypted), profile picture</li>
  <li><strong>Address information:</strong> Home, work, and other service addresses</li>
  <li><strong>Payment details:</strong> For providers - bank account or UPI details for payouts</li>
</ul>

<h3>2.2 Service-Related Information</h3>
<ul>
  <li>Booking history and service requests</li>
  <li>Communication with service providers</li>
  <li>Feedback and ratings provided</li>
  <li>Support queries and responses</li>
</ul>

<h2>3. How We Use Your Information</h2>
<p>We use your information to:</p>
<ul>
  <li>Provide and improve our services</li>
  <li>Process bookings and payments</li>
  <li>Connect you with suitable service providers</li>
  <li>Send booking confirmations and reminders</li>
  <li>Process provider payouts</li>
  <li>Respond to your queries and support requests</li>
  <li>Send important notifications about policy changes</li>
  <li>Prevent fraud and ensure platform security</li>
</ul>

<h2>4. Data Sharing</h2>

<h3>4.1 With Service Providers</h3>
<p>When you book a service, we share relevant details with the provider:</p>
<ul>
  <li>Name and contact information</li>
  <li>Service address</li>
  <li>Booking details and requirements</li>
</ul>

<h3>4.2 With Other Users</h3>
<p>We may share your profile information with other users for service purposes, subject to your privacy settings.</p>

<h3>4.3 Third-Party Services</h3>
<p>We use third-party services for:</p>
<ul>
  <li><strong>Payment processing:</strong> Razorpay</li>
  <li><strong>Authentication:</strong> Google OAuth</li>
  <li><strong>Push notifications:</strong> Firebase Cloud Messaging</li>
  <li><strong>Image hosting:</strong> Cloudinary</li>
</ul>

<h2>5. Data Security</h2>
<p>We implement industry-standard security measures to protect your data:</p>
<ul>
  <li>SSL/TLS encryption for data transmission</li>
  <li>Encrypted password storage</li>
  <li>Secure payment processing</li>
  <li>Regular security audits</li>
  <li>Access controls and authentication</li>
</ul>

<h2>6. Your Rights</h2>
<p>You have the right to:</p>
<ul>
  <li><strong>Access:</strong> Request a copy of your personal data</li>
  <li><strong>Correction:</strong> Update or correct your information</li>
  <li><strong>Deletion:</strong> Request deletion of your account and data</li>
  <li><strong>Opt-out:</strong> Unsubscribe from marketing communications</li>
</ul>

<h2>7. Cookies and Tracking</h2>
<p>We use cookies and similar technologies to:</p>
<ul>
  <li>Keep you logged in</li>
  <li>Remember your preferences</li>
  <li>Analyze platform usage</li>
  <li>Improve our services</li>
</ul>

<h2>8. Children's Privacy</h2>
<p>Our services are not intended for children under 18. We do not knowingly collect personal information from children.</p>

<h2>9. Changes to This Policy</h2>
<p>We may update this privacy policy from time to time. We will notify you of significant changes via email or in-app notification.</p>

<h2>10. Contact Us</h2>
<p>If you have questions about this privacy policy or our data practices, please contact us at:</p>
<p><strong>Email:</strong> privacy@homefixcare.com<br>
<strong>Address:</strong> HomeFixCare Pvt. Ltd., Bangalore, India</p>
`;

const termsConditionsContent = `
<h1>Terms & Conditions</h1>
<p>Last updated: ${new Date().toLocaleDateString()}</p>

<h2>1. Acceptance of Terms</h2>
<p>By accessing or using <strong>HomeFixCare</strong>, you agree to be bound by these Terms & Conditions. If you disagree with any part of these terms, you may not access our services.</p>

<h2>2. Account Registration</h2>

<h3>2.1 Eligibility</h3>
<p>You must be at least 18 years old to create an account. By using our platform, you represent that you meet this requirement.</p>

<h3>2.2 Account Responsibilities</h3>
<p>You are responsible for:</p>
<ul>
  <li>Maintaining the confidentiality of your password</li>
  <li>All activities that occur under your account</li>
  <li>Notifying us immediately of unauthorized access</li>
  <li>Providing accurate and complete information</li>
</ul>

<h2>3. Services</h2>

<h3>3.1 Booking Services</h3>
<p>HomeFixCare connects customers with service providers. We facilitate but do not directly perform the services.</p>

<h3>3.2 Provider Services</h3>
<p>Service providers listed on our platform are independent contractors. We are not responsible for their actions or the quality of their services.</p>

<h2>4. Payments</h2>

<h3>4.1 Customer Payments</h3>
<ul>
  <li>Payments are processed through Razorpay</li>
  <li>Full payment is required at the time of booking</li>
  <li>Refunds are processed according to our cancellation policy</li>
</ul>

<h3>4.2 Provider Payouts</h3>
<ul>
  <li>Providers receive their earnings after platform fees</li>
  <li>Minimum payout amount applies</li>
  <li>Payouts are processed within 5-7 business days</li>
</ul>

<h3>4.3 Platform Fees</h3>
<p>HomeFixCare charges a platform fee on each booking. The fee varies based on the provider's subscription plan.</p>

<h2>5. Cancellations & Refunds</h2>

<h3>5.1 Customer Cancellations</h3>
<p>Refund percentages based on cancellation timing:</p>
<ul>
  <li><strong>> 24 hours before:</strong> 100% refund</li>
  <li><strong>12-24 hours before:</strong> 75% refund</li>
  <li><strong>4-12 hours before:</strong> 50% refund</li>
  <li><strong>30 min - 4 hours before:</strong> 25% refund</li>
</ul>

<h3>5.2 Provider Cancellations</h3>
<p>Providers who cancel confirmed bookings may receive negative reviews and account penalties.</p>

<h2>6. User Conduct</h2>
<p>You agree NOT to:</p>
<ul>
  <li>Use the platform for any illegal purpose</li>
  <li>Harass or abuse other users or providers</li>
  <li>Post false or misleading reviews</li>
  <li>Attempt to gain unauthorized access to our systems</li>
  <li>Interfere with the proper working of the platform</li>
</ul>

<h2>7. Provider Obligations</h2>
<p>Service providers must:</p>
<ul>
  <li>Provide accurate service descriptions</li>
  <li>Honor confirmed bookings</li>
  <li>Maintain professional conduct</li>
  <li>Complete services as described</li>
  <li>Respond to customer inquiries</li>
</ul>

<h2>8. Intellectual Property</h2>
<p>All content on HomeFixCare, including text, graphics, logos, and software, is our property or the property of our licensors and is protected by copyright laws.</p>

<h2>9. Limitation of Liability</h2>
<p>HomeFixCare shall not be liable for:</p>
<ul>
  <li>Any indirect, incidental, or consequential damages</li>
  <li>The quality or safety of services provided by third-party providers</li>
  <li>Loss or damage resulting from provider misconduct</li>
  <li>Service interruptions or technical issues</li>
</ul>

<h2>10. Termination</h2>

<h3>10.1 By You</h3>
<p>You may terminate your account at any time by contacting support or using the account settings.</p>

<h3>10.2 By Us</h3>
<p>We reserve the right to suspend or terminate accounts that violate these terms.</p>

<h2>11. Privacy Policy</h2>
<p>Your use of our services is also governed by our Privacy Policy, which can be found at <a href="/privacy">/privacy</a>.</p>

<h2>12. Modifications</h2>
<p>We may modify these terms at any time. Continued use of the platform after changes constitutes acceptance of the new terms.</p>

<h2>13. Governing Law</h2>
<p>These terms are governed by the laws of India. Any disputes shall be resolved in the courts of Bangalore, India.</p>

<h2>14. Contact Information</h2>
<p>For questions about these terms, please contact:</p>
<p><strong>Email:</strong> legal@homefixcare.com<br>
<strong>Address:</strong> HomeFixCare Pvt. Ltd., Bangalore, India</p>
`;

const seedLegalPages = async () => {
  try {
    console.log("🌱 Starting to seed Privacy Policy and Terms & Conditions...");

    // Get admin user
    const admin = await getAdminUser();
    if (!admin) {
      console.error("❌ No admin user found. Please create an admin user first.");
      process.exit(1);
    }
    console.log(`👤 Using admin user ID: ${admin.id}`);

    // Clear existing data
    console.log("🧹 Clearing existing privacy policies and terms...");
    await db.delete(privacyPolicies);
    await db.delete(termsConditions);

    // Create Privacy Policy
    console.log("📄 Creating Privacy Policy version 1.0...");
    const [privacyPolicy] = await db
      .insert(privacyPolicies)
      .values({
        version: "1.0",
        content: privacyPolicyContent,
        createdBy: admin.id,
        isActive: true,
      })
      .returning();

    console.log(`✅ Privacy Policy created (ID: ${privacyPolicy.id})`);

    // Create Terms & Conditions
    console.log("📄 Creating Terms & Conditions version 1.0...");
    const [termsCondition] = await db
      .insert(termsConditions)
      .values({
        version: "1.0",
        content: termsConditionsContent,
        createdBy: admin.id,
        isActive: true,
      })
      .returning();

    console.log(`✅ Terms & Conditions created (ID: ${termsCondition.id})`);

    console.log("\n✨ Seeding completed successfully!");
    console.log("\n📋 Summary:");
    console.log(`   - Privacy Policy v1.0 (Active): ID ${privacyPolicy.id}`);
    console.log(`   - Terms & Conditions v1.0 (Active): ID ${termsCondition.id}`);
    console.log("\n💡 You can now view these at:");
    console.log("   - Privacy: /privacy, /provider/privacy, /customer/privacy, /admin/privacy, /staff/privacy");
    console.log("   - Terms: /terms, /provider/terms, /customer/terms, /admin/terms, /staff/terms");

    process.exit(0);
  } catch (error) {
    console.error("❌ Error seeding legal pages:", error);
    process.exit(1);
  }
};

// Run the seed
seedLegalPages();
