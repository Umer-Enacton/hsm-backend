const { drizzle } = require("drizzle-orm/postgres-js");
const postgres = require("postgres");
require("dotenv").config();

// Create postgres connection
const connectionString = process.env.DATABASE_URL;
const client = postgres(connectionString);

// Create drizzle instance
const db = drizzle(client);

module.exports = db;
