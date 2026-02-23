# Stripe Payment Gateway Integration Guide

## Table of Contents

1. [What is Stripe?](#what-is-stripe)
2. [Step-by-Step: Get Stripe API Keys](#step-by-step-get-stripe-api-keys)
3. [Integration Overview](#integration-overview)
4. [Payment Flow for Home Service Management](#payment-flow-for-home-service-management)
5. [Implementation Steps](#implementation-steps)
6. [Testing with Stripe Test Mode](#testing-with-stripe-test-mode)
7. [Going Live](#going-live)

---

## What is Stripe?

**Stripe** is a payment processing platform that allows businesses to accept payments online. It's one of the most popular payment gateways due to:

✅ **Easy Integration** - Simple APIs and SDKs
✅ **Secure** - PCI DSS Level 1 certified
✅ **Supports Multiple Currencies** - INR, USD, EUR, etc.
✅ **Test Mode** - Test without real money
✅ **Excellent Documentation** - Comprehensive guides
✅ **Webhooks** - Real-time payment notifications
✅ **Supports India** - Full support for INR payments

---

## Step-by-Step: Get Stripe API Keys

### Step 1: Create a Stripe Account

1. Go to [https://dashboard.stripe.com/register](https://dashboard.stripe.com/register)
2. Sign up using your email
3. Verify your email address
4. Complete the basic account setup

### Step 2: Access the Stripe Dashboard

1. After logging in, you'll see the Stripe Dashboard
2. Note: You start in **Test Mode** (safe for development)
3. Look for the toggle at the top left: "Test mode" is enabled

### Step 3: Get Your Test API Keys

1. In the left sidebar, click on **"Developers"**
2. Click on **"API keys"**
3. You'll see two sections:
   - **Publishable key** (starts with `pk_test_...`)
   - **Secret key** (starts with `sk_test_...`)

4. **Important:**
   - **Publishable key** (`pk_test_...`) → Used in **Frontend** (can be public)
   - **Secret key** (`sk_test_...`) → Used in **Backend** (NEVER share this!)

### Step 4: Copy Your API Keys

You'll see something like:

```
Publishable key: pk_test_51ABC...XYZ
Secret key: sk_test_51ABC...XYZ
```

**Save these keys for your .env file:**
```env
STRIPE_PUBLISHABLE_KEY=pk_test_51ABC...XYZ
STRIPE_SECRET_KEY=sk_test_51ABC...XYZ
```

### Step 5: Get Webhook Endpoint Secret (Optional, for later)

When you set up webhooks (for payment confirmations):
1. Go to **Developers** → **Webhooks**
2. Click **"Add endpoint"**
3. Enter your URL: `https://your-domain.com/api/webhook/stripe`
4. Stripe will give you a **Signing Secret** (`whsec_...`)

---

## Integration Overview

### Payment Flow for Home Service Management

```
┌─────────────┐
│   Customer  │
│  (Frontend) │
└──────┬──────┘
       │ 1. Request to book service
       ↓
┌─────────────────┐
│   Backend       │
│  (Your API)     │
└──────┬──────────┘
       │ 2. Create Payment Intent
       ↓
┌─────────────────┐
│   Stripe API    │
└──────┬──────────┘
       │ 3. Return Client Secret
       ↓
┌─────────────────┐
│   Backend       │
└──────┬──────────┘
       │ 4. Send Client Secret to Frontend
       ↓
┌─────────────────┐
│   Frontend      │
│  (Stripe.js)    │
└──────┬──────────┘
       │ 5. Confirm Payment (Card Details)
       ↓
┌─────────────────┐
│   Stripe API    │
└──────┬──────────┘
       │ 6. Payment Success/Failure
       ↓
┌─────────────────┐
│   Backend       │
│  (Webhook)      │
└──────┬──────────┘
       │ 7. Update Booking Status
       ↓
┌─────────────────┐
│   Database      │
└─────────────────┘
```

### Key Concepts

#### 1. Payment Intent
- Represents a payment transaction
- Contains amount, currency, booking details
- Returns a **client_secret** for frontend

#### 2. Payment Method
- Customer's card details (tokenized by Stripe)
- Never stored on your servers

#### 3. Client Secret
- Used by frontend to confirm payment
- Looks like: `pi_1234..._secret_ABCD`

---

## Implementation Steps

### Step 1: Install Stripe Package

```bash
npm install stripe
```

### Step 2: Update .env File

Add your Stripe keys:

```env
# Stripe Payment Configuration
STRIPE_PUBLISHABLE_KEY=pk_test_51ABC...XYZ
STRIPE_SECRET_KEY=sk_test_51ABC...XYZ

# Stripe Webhook Secret (optional, for production)
STRIPE_WEBHOOK_SECRET=whsec_...XYZ
```

### Step 3: Create Stripe Configuration

Create `config/stripe.js`:

```javascript
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = stripe;
```

### Step 4: Update Booking Schema

When a customer creates a booking, we'll add a payment step:

**Booking Flow:**
1. Customer selects service and slot
2. Backend creates Payment Intent
3. Customer pays via Stripe
4. On success, booking is confirmed

### Step 5: Create Payment Controller

Create `controllers/payment.controller.js`:

```javascript
const stripe = require('../config/stripe');
const db = require('../config/db');
const { bookings, services } = require('../models/schema');
const { eq } = require('drizzle-orm');

/**
 * Create Payment Intent
 * POST /create-payment-intent
 */
const createPaymentIntent = async (req, res) => {
  try {
    const { serviceId, slotId, addressId, bookingDate } = req.body;

    // Get service details to calculate amount
    const [service] = await db
      .select()
      .from(services)
      .where(eq(services.id, serviceId));

    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }

    // Amount is in paisa/cents (already stored correctly)
    const amount = service.price;

    // Create a Payment Intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: 'inr', // Use 'inr' for India
      metadata: {
        serviceId: serviceId.toString(),
        slotId: slotId.toString(),
        addressId: addressId.toString(),
        bookingDate: bookingDate,
        userId: req.token.id.toString(),
      },
    });

    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      amount: amount,
      currency: 'inr',
      service: {
        id: service.id,
        name: service.name,
        price: service.price,
      },
    });
  } catch (error) {
    console.error('Payment Intent Error:', error);
    res.status(500).json({
      message: 'Failed to create payment intent',
      error: error.message,
    });
  }
};

/**
 * Confirm Booking after Payment
 * POST /confirm-booking
 */
const confirmBooking = async (req, res) => {
  try {
    const { paymentIntentId, serviceId, slotId, addressId, bookingDate } = req.body;

    // Verify payment with Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ message: 'Payment not successful' });
    }

    // Create booking
    const [service] = await db
      .select()
      .from(services)
      .where(eq(services.id, serviceId));

    const [newBooking] = await db
      .insert(bookings)
      .values({
        customer_id: req.token.id,
        service_id: serviceId,
        slot_id: slotId,
        address_id: addressId,
        booking_date: new Date(bookingDate),
        status: 'confirmed',
        total_price: service.price,
        business_profile_id: service.business_profile_id,
      })
      .returning();

    res.status(201).json({
      message: 'Booking confirmed successfully',
      booking: newBooking,
    });
  } catch (error) {
    console.error('Confirm Booking Error:', error);
    res.status(500).json({
      message: 'Failed to confirm booking',
      error: error.message,
    });
  }
};

/**
 * Get Payment Details
 * GET /payment/:paymentIntentId
 */
const getPaymentDetails = async (req, res) => {
  try {
    const { paymentIntentId } = req.params;

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    res.status(200).json({
      id: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      status: paymentIntent.status,
      created: new Date(paymentIntent.created * 1000),
    });
  } catch (error) {
    console.error('Get Payment Error:', error);
    res.status(500).json({
      message: 'Failed to get payment details',
      error: error.message,
    });
  }
};

module.exports = {
  createPaymentIntent,
  confirmBooking,
  getPaymentDetails,
};
```

### Step 6: Create Payment Routes

Create `routes/payment.route.js`:

```javascript
const express = require('express');
const router = express.Router();
const {
  createPaymentIntent,
  confirmBooking,
  getPaymentDetails,
} = require('../controllers/payment.controller');
const auth = require('../middleware/auth');
const { CUSTOMER } = require('../config/roles');
const authorizeRole = require('../middleware/roleBasedRoutes');

// Create Payment Intent - Customer only
router.post(
  '/create-payment-intent',
  auth,
  authorizeRole(CUSTOMER),
  createPaymentIntent
);

// Confirm Booking after payment - Customer only
router.post(
  '/confirm-booking',
  auth,
  authorizeRole(CUSTOMER),
  confirmBooking
);

// Get Payment Details
router.get('/payment/:paymentIntentId', auth, getPaymentDetails);

module.exports = router;
```

### Step 7: Update Main Server File

In `index.js`:

```javascript
const paymentRoutes = require('./routes/payment.route');

// Add after other routes
app.use('/', paymentRoutes);
```

### Step 8: Frontend Integration Example

**Install Stripe.js on Frontend:**
```bash
npm install @stripe/stripe-js
```

**Frontend Payment Component:**

```javascript
import { loadStripe } from '@stripe/stripe-js';

const stripePromise = loadStripe('pk_test_51ABC...XYZ');

const PaymentComponent = async ({ serviceId, amount }) => {
  // Step 1: Create Payment Intent
  const createPaymentIntent = async () => {
    const response = await fetch('http://localhost:8000/create-payment-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        serviceId,
        slotId: 1,
        addressId: 1,
        bookingDate: '2026-02-25',
      }),
    });

    const { clientSecret } = await response.json();
    return clientSecret;
  };

  // Step 2: Confirm Payment
  const handlePayment = async () => {
    const stripe = await stripePromise;
    const clientSecret = await createPaymentIntent();

    const { error, paymentIntent } = await stripe.confirmCardPayment(
      clientSecret,
      {
        payment_method: {
          card: elements.getElement(CardElement),
          billing_details: {
            name: 'Customer Name',
          },
        },
      }
    );

    if (error) {
      console.error('Payment failed:', error);
    } else if (paymentIntent.status === 'succeeded') {
      // Step 3: Confirm Booking
      await fetch('http://localhost:8000/confirm-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          paymentIntentId: paymentIntent.id,
          serviceId,
          slotId: 1,
          addressId: 1,
          bookingDate: '2026-02-25',
        }),
      });

      alert('Payment successful! Booking confirmed.');
    }
  };

  return (
    <button onClick={handlePayment}>
      Pay ₹{amount / 100}
    </button>
  );
};
```

---

## Testing with Stripe Test Mode

### Test Card Numbers

Use these cards in **Test Mode** to simulate different scenarios:

#### Successful Payments

| Card Number | Expiry | CVC | Description |
|-------------|--------|-----|-------------|
| **4242 4242 4242 4242** | Any future date | Any 3 digits | Default success card |
| **4000 0025 0000 3155** | Any future date | Any 3 digits | Require authentication |

#### Failed Payments

| Card Number | Description |
|-------------|-------------|
| **4000 0000 0000 0002** | Card declined |
| **4000 0000 0000 9995** | Insufficient funds |
| **4000 0000 0000 0069** | Expired card |
| **4000 0000 0000 0119** | Processing error |

### How to Test

1. **Start your backend server:**
   ```bash
   npm start
   ```

2. **Make a payment request from frontend:**
   - Use test card: `4242 4242 4242 4242`
   - Use any future expiry date
   - Use any 3-digit CVC

3. **Check Stripe Dashboard:**
   - Go to **Payments** section
   - You'll see the test payment
   - Status: **Succeeded**

4. **Verify in your database:**
   - Booking should be created
   - Status should be `confirmed`

---

## Stripe Dashboard Overview

### Key Sections

1. **Payments** - View all payments
2. **Customers** - Customer information
3. **Products** - Your services/products
4. **Prices** - Pricing for products
5. **Webhooks** - Configure webhook endpoints
6. **Events** - All Stripe events
7. **Logs** - API request logs

### View Test Payments

1. Go to **Dashboard** → **Payments**
2. Filter by **Test mode**
3. Click on any payment to see details:
   - Amount
   - Status
   - Customer info
   - Metadata (booking details)

---

## Pricing Configuration

### For Indian Market (INR)

**Minimum Amount:** ₹0.50 (50 paisa)
**Maximum Amount:** ₹10,00,000

**Stripe Fees for India:**
- 2% per transaction
- No setup fees
- No monthly fees
- No hidden charges

### Example Calculations

```javascript
// Service price: ₹500
// Store in paisa: 50000 (500 * 100)

const paymentIntent = await stripe.paymentIntents.create({
  amount: 50000, // ₹500.00
  currency: 'inr',
});
```

---

## Security Best Practices

### ✅ DO

1. **Use environment variables** for API keys
2. **Never expose Secret Key** in frontend code
3. **Only use Publishable Key** in frontend
4. **Verify payments** on backend before confirming bookings
5. **Use HTTPS** in production
6. **Validate amounts** before creating payment intent
7. **Check payment status** before fulfilling service

### ❌ DON'T

1. **Don't store card details** on your servers
2. **Don't log full card numbers**
3. **Don't expose Secret Key** in client-side code
4. **Don't skip payment verification**
5. **Don't use test keys in production**

---

## Webhooks (Optional but Recommended)

Webhooks allow Stripe to notify your server about payment events.

### Common Webhook Events

- `payment_intent.succeeded` - Payment successful
- `payment_intent.payment_failed` - Payment failed
- `charge.refunded` - Payment refunded

### Webhook Handler Example

```javascript
// Endpoint: POST /webhook/stripe
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

const handleWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];

  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      webhookSecret
    );

    switch (event.type) {
      case 'payment_intent.succeeded':
        // Update booking status to confirmed
        const paymentIntent = event.data.object;
        console.log('Payment succeeded:', paymentIntent.id);
        break;

      case 'payment_intent.payment_failed':
        // Update booking status to cancelled
        console.log('Payment failed:', event.data.object.id);
        break;
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(400).json({ error: 'Webhook error' });
  }
};
```

---

## Going Live

### Step 1: Complete Stripe Account Setup

1. Go to **Settings** → **Account details**
2. Fill in business information
3. Upload required documents (for India: PAN, GST, etc.)
4. Add bank account for settlements

### Step 2: Switch to Live Mode

1. Toggle **Test mode** → **Live mode** (top left)
2. Get your **Live API keys**:
   - Publishable key: `pk_live_...`
   - Secret key: `sk_live_...`

### Step 3: Update .env File

```env
# Use live keys in production
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_SECRET_KEY=sk_live_...
```

### Step 4: Test Live Payments

Make small test transactions (₹1-₹5) and refund immediately.

### Step 5: Monitor Dashboard

Keep an eye on:
- Daily settlements
- Failed payments
- Refunds
- Disputes

---

## Troubleshooting

### Common Errors

#### 1. "Amount must be at least ₹0.50"
```javascript
// Wrong
amount: 50 // ₹0.50

// Correct
amount: 50 // This is ₹0.50 (already in paisa)
```

#### 2. "Invalid API Key"
- Check if you're using test keys in test mode
- Verify keys in .env file

#### 3. "Payment Intent Not Found"
- Verify paymentIntentId is correct
- Check if payment was created

#### 4. "Currency Not Supported"
- For India, use `'inr'`
- For US, use `'usd'`

---

## Useful Resources

### Official Stripe Documentation
- [Stripe API Docs](https://stripe.com/docs/api)
- [Payment Intents Guide](https://stripe.com/docs/payments/payment-intents)
- [Test Cards](https://stripe.com/docs/testing)
- [Webhooks Guide](https://stripe.com/docs/webhooks)

### Stripe Dashboard Links
- [Dashboard](https://dashboard.stripe.com)
- [Test Dashboard](https://dashboard.stripe.com/test)
- [API Keys](https://dashboard.stripe.com/apikeys)
- [Webhooks](https://dashboard.stripe.com/webhooks)

### India-Specific
- [Stripe India Guide](https://stripe.com/en-in)
- [Indian Pricing](https://stripe.com/en-in/pricing)

---

## Next Steps

1. ✅ Get your Stripe API keys (Test mode)
2. ✅ Add keys to `.env` file
3. ✅ Install stripe package: `npm install stripe`
4. ✅ Implement payment controller
5. ✅ Test with test card: `4242 4242 4242 4242`
6. ✅ Verify payment in Stripe Dashboard
7. ✅ Go live when ready!

---

## Support

If you need help:
1. Check Stripe Dashboard logs
2. Review API documentation
3. Contact Stripe Support
4. Check error messages in console

---

**Version:** 1.0.0
**Last Updated:** 2026-02-20
**Currency:** INR (₹) - India
