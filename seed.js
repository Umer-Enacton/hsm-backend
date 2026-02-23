const bcrypt = require("bcryptjs");
const db = require("./config/db"); // your drizzle db instance
const {
  Roles,
  users,
  Address,
  Category,
  businessProfiles,
  services,
  slots,
  bookings,
  feedback,
} = require("./models/schema");

const SALT_ROUNDS = 10;

/* ============================
   ROLES
============================ */
async function seedRoles() {
  await db.insert(Roles).values([
    { id: 1, name: "customer", description: "Customer user" },
    { id: 2, name: "provider", description: "Service provider" },
    { id: 3, name: "admin", description: "Admin user" },
  ]);
}

/* ============================
   USERS (names only, not business)
============================ */
async function seedUsers() {
  const password = await bcrypt.hash("Password@123", SALT_ROUNDS);

  await db.insert(users).values([
    {
      id: 1,
      name: "Umer Saiyad",
      roleId: 1,
      email: "umer.customer@gmail.com",
      phone: "9000000001",
      password,
    },
    {
      id: 2,
      name: "Sahil Garasiya",
      roleId: 1,
      email: "sahil.customer@gmail.com",
      phone: "9000000002",
      password,
    },
    {
      id: 3,
      name: "Vikram Singh",
      roleId: 2,
      email: "vikram.provider@gmail.com",
      phone: "9000000003",
      password,
    },
    {
      id: 4,
      name: "Ayesha Mansur",
      roleId: 2,
      email: "ayesha.provider@gmail.com",
      phone: "9000000004",
      password,
    },
  ]);
}

/* ============================
   ADDRESSES
============================ */
async function seedAddresses() {
  await db.insert(Address).values([
    {
      userId: 1,
      addressType: "home",
      street: "12 MG Road",
      city: "Ahmedabad",
      state: "Gujarat",
      zipCode: "380001",
    },
    {
      userId: 2,
      addressType: "home",
      street: "45 Ring Road",
      city: "Surat",
      state: "Gujarat",
      zipCode: "395003",
    },
    {
      userId: 3,
      addressType: "work",
      street: "Business Park A",
      city: "Ahmedabad",
      state: "Gujarat",
      zipCode: "380015",
    },
    {
      userId: 4,
      addressType: "work",
      street: "Service Hub B",
      city: "Vadodara",
      state: "Gujarat",
      zipCode: "390001",
    },
  ]);
}

/* ============================
   CATEGORIES
============================ */
async function seedCategories() {
  await db.insert(Category).values([
    { id: 1, name: "Plumbing", description: "Plumbing & water services" },
    { id: 2, name: "Electrical", description: "Electrical services" },
    { id: 3, name: "Cleaning", description: "Home & office cleaning" },
  ]);
}

/* ============================
   BUSINESS PROFILES (providers)
============================ */
async function seedBusinessProfiles() {
  await db.insert(businessProfiles).values([
    {
      id: 1,
      providerId: 3,
      categoryId: 1,
      businessName: "FixIt Plumbing Co.",
      description: "Professional plumbing solutions",
      phone: "9000000003",
      website: "https://fixitplumbing.com",
      rating: "4.6",
      isVerified: true,
    },
    {
      id: 2,
      providerId: 4,
      categoryId: 3,
      businessName: "Sparkle Clean Services",
      description: "Reliable home cleaning services",
      phone: "9000000004",
      website: "https://sparkleclean.com",
      rating: "4.8",
      isVerified: true,
    },
  ]);
}

/* ============================
   SERVICES
============================ */
async function seedServices() {
  await db.insert(services).values([
    {
      businessProfileId: 1,
      name: "Leak Fixing",
      description: "Fix pipe and tap leakage",
      price: 500,
      EstimateDuration: 60,
    },
    {
      businessProfileId: 1,
      name: "Bathroom Plumbing",
      description: "Complete bathroom plumbing service",
      price: 1500,
      EstimateDuration: 150,
    },
    {
      businessProfileId: 2,
      name: "Full Home Cleaning",
      description: "Deep cleaning for entire house",
      price: 1800,
      EstimateDuration: 180,
    },
  ]);
}

/* ============================
   SLOTS
============================ */
async function seedSlots() {
  await db.insert(slots).values([
    {
      businessProfileId: 1,
      startTime: "09:00:00",
      endTime: "10:00:00",
    },
    {
      businessProfileId: 1,
      startTime: "10:00:00",
      endTime: "11:00:00",
    },
    {
      businessProfileId: 1,
      startTime: "11:00:00",
      endTime: "12:00:00",
    },
    {
      businessProfileId: 1,
      startTime: "14:00:00",
      endTime: "15:00:00",
    },
    {
      businessProfileId: 1,
      startTime: "15:00:00",
      endTime: "16:00:00",
    },
    {
      businessProfileId: 2,
      startTime: "09:00:00",
      endTime: "10:00:00",
    },
    {
      businessProfileId: 2,
      startTime: "10:00:00",
      endTime: "11:00:00",
    },
    {
      businessProfileId: 2,
      startTime: "11:00:00",
      endTime: "12:00:00",
    },
    {
      businessProfileId: 2,
      startTime: "14:00:00",
      endTime: "15:00:00",
    },
    {
      businessProfileId: 2,
      startTime: "15:00:00",
      endTime: "16:00:00",
    },
  ]);
}

/* ============================
   BOOKINGS
============================ */
async function seedBookings() {
  // Get current date and add 2 days for future bookings
  const futureDate1 = new Date();
  futureDate1.setDate(futureDate1.getDate() + 2);

  const futureDate2 = new Date();
  futureDate2.setDate(futureDate2.getDate() + 3);

  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 2);

  await db.insert(bookings).values([
    {
      customerId: 1,
      businessProfileId: 1,
      serviceId: 1,
      slotId: 1,
      addressId: 1,
      bookingDate: futureDate1,
      status: "pending",
      totalPrice: 500,
    },
    {
      customerId: 1,
      businessProfileId: 1,
      serviceId: 2,
      slotId: 2,
      addressId: 1,
      bookingDate: futureDate2,
      status: "confirmed",
      totalPrice: 1500,
    },
    {
      customerId: 2,
      businessProfileId: 2,
      serviceId: 3,
      slotId: 6,
      addressId: 2,
      bookingDate: pastDate,
      status: "completed",
      totalPrice: 1800,
    },
    {
      customerId: 2,
      businessProfileId: 1,
      serviceId: 1,
      slotId: 3,
      addressId: 2,
      bookingDate: pastDate,
      status: "completed",
      totalPrice: 500,
    },
  ]);
}

/* ============================
   FEEDBACK
============================ */
async function seedFeedback() {
  await db.insert(feedback).values([
    {
      bookingId: 3,
      rating: "4.5",
      comments: "Excellent cleaning service! Very professional and thorough.",
    },
    {
      bookingId: 4,
      rating: "4.0",
      comments: "Good plumbing work, fixed the leak quickly.",
    },
  ]);
}

/* ============================
   RUN SEED
============================ */
async function runSeed() {
  try {
    // await seedRoles();
    // await seedUsers();
    // await seedAddresses();
    await seedCategories();
    // await seedBusinessProfiles();
    // await seedServices();
    // await seedSlots();
    // await seedBookings();
    // await seedFeedback();

    console.log("✅ Seeding completed successfully");
    process.exit(0);
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  }
}

runSeed();
