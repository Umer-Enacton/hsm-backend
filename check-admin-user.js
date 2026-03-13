const db = require("./config/db");
const { users, Roles } = require("./models/schema");
const { eq } = require("drizzle-orm");

async function checkAdminUser() {
  try {
    // Get admin role
    const [adminRole] = await db
      .select()
      .from(Roles)
      .where(eq(Roles.name, "admin"))
      .limit(1);

    console.log("Admin role ID:", adminRole?.id);

    // Get admin users
    const adminUsers = await db
      .select()
      .from(users)
      .where(eq(users.roleId, adminRole.id));

    console.log("\nAdmin users found:", adminUsers.length);
    adminUsers.forEach((u) => {
      console.log(`  - ID: ${u.id}, Email: ${u.email}, Name: ${u.name}`);
    });

    // Also check all users
    const allUsers = await db.select().from(users);
    console.log("\nAll users:");
    allUsers.forEach((u) => {
      console.log(`  - ID: ${u.id}, Email: ${u.email}, RoleId: ${u.roleId}, Name: ${u.name}`);
    });

    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

checkAdminUser();
