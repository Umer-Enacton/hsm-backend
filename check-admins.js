const db = require("./config/db");
const { users } = require("./models/schema");
const { eq } = require("drizzle-orm");

(async () => {
  try {
    const admins = await db.select().from(users).where(eq(users.roleId, 3));
    console.log("Admin users found:");
    admins.forEach((u) => {
      console.log(`- ID: ${u.id}, Email: ${u.email}, Name: ${u.name}`);
    });
    process.exit(0);
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
})();
