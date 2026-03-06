require("dotenv").config();
const { initiateRefund } = require("./utils/razorpay");

async function testRefund() {
  console.log("\n=== TEST REFUND FOR PAYMENT 14 ===\n");

  try {
    const result = await initiateRefund(
      "pay_SNvl29Avtt7jLm", // Payment ID 14
      null, // Full refund
      { reason: "Test refund - reschedule declined" }
    );

    console.log("✅ Refund SUCCESS!");
    console.log(`Refund ID: ${result.id}`);
    console.log(`Amount: ${result.amount / 100} ₹`);
    console.log(`Status: ${result.status}`);
    console.log(`Full response:`, JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("❌ Refund FAILED!");
    console.error(`Error: ${error.message}`);
    console.error(`Full error:`, error);
  }

  process.exit(0);
}

testRefund();
