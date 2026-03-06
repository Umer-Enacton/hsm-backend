require("dotenv").config();
const { fetchPaymentDetails } = require("./utils/razorpay");

async function checkPayment11() {
  console.log("\n=== CHECK PAYMENT 11 ON RAZORPAY ===\n");

  try {
    const payment = await fetchPaymentDetails("pay_SNuj3Cd4qxpDMW");
    console.log("Amount:", payment.amount / 100, "₹");
    console.log("Status:", payment.status);
    console.log("Refund Status:", payment.refund_status || "None");

    if (payment.refunds && payment.refunds.length > 0) {
      console.log("\nRefunds found:");
      payment.refunds.forEach(r => {
        console.log(`  - ID: ${r.id}, Amount: ${r.amount / 100} ₹, Status: ${r.status}`);
      });
    }
  } catch (error) {
    console.error("Error:", error.message);
  }

  process.exit(0);
}

checkPayment11();
