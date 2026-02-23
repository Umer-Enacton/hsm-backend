# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Home Service Management Backend - A RESTful API for a home services platform connecting customers with service providers. Built with Express.js, PostgreSQL, and Drizzle ORM.

## Development Commands

```bash
# Start development server with file watching
npm run dev

# Start production server
npm start

# Generate Drizzle ORM migrations from schema changes
npm run db:generate

# Push schema changes directly to database (development)
npm run db:push

# Seed database with initial data
node seed.js
```

## Architecture

### MVC Pattern
- **Controllers** (`controllers/`) - Business logic, database operations, request/response handling
- **Routes** (`routes/`) - API endpoint definitions, middleware wiring
- **Models** (`models/schema.js`) - Drizzle ORM schema definitions

### Key Middleware Stack Order (index.js)
The middleware order is critical:
1. CORS configuration
2. JSON body parser
3. Cookie parser
4. URL-encoded parser
5. **Upload routes** (must come before global auth to avoid body-parser conflicts with multipart/form-data)
6. Auth routes (public)
7. **Global auth middleware** (applies to all subsequent routes)
8. All other routes (protected by default)

### Authentication Flow
- JWT tokens stored in httpOnly cookies
- Global `auth` middleware (line 37 in index.js) protects all routes after auth routes
- OTP-based password reset via email
- Role-based access control using `roleBasedRoutes` middleware

### Database Setup
- PostgreSQL with Drizzle ORM
- Schema definitions in `models/schema.js`
- Migrations in `drizzle/` directory
- Connection via `config/db.js`

### Role-Based Access
Three roles defined in `config/roles.js`:
- Customer (roleId: 1) - Browse, book services
- Provider (roleId: 2) - Manage business profiles, services, slots
- Admin (roleId: 3) - Full system access

## Critical Implementation Details

### File Upload Routes
**IMPORTANT**: Upload routes must be registered BEFORE the global auth middleware in `index.js` to prevent body-parser conflicts with multipart/form-data. Upload routes have their own auth middleware.

### Validation
- Yup schemas in `helper/validation.js`
- Validation middleware in `middleware/validate.js`
- Apply validation middleware before controller in route definitions

### Drizzle ORM Patterns
```javascript
// Import what you need from schema
const { users, businessProfiles, services } = require("./models/schema");
const { eq, and, or } = require("drizzle-orm");

// Query pattern
const db = require("./config/db");
const [result] = await db.select().from(users).where(eq(users.id, userId));

// Update pattern - build dynamic updateData object
const updateData = {};
if (name !== undefined) updateData.name = name;
if (email !== undefined) updateData.email = email;
const [updated] = await db.update(users).set(updateData).where(eq(users.id, userId)).returning();
```

### Foreign Key Cascades
The schema uses cascading deletes. When deleting:
- Users → cascades to addresses, business_profiles
- Business profiles → cascades to services, slots
- Services → cascades to bookings
- etc.

Check `models/schema.js` for cascade relationships before adding delete operations.

### Error Response Format
Controllers use consistent error responses:
```javascript
res.status(400).json({ message: "Error description" });
res.status(500).json({ message: "Server error", error: error.message });
```

### Image Upload Architecture
- Multer with memory storage (no temp files)
- Cloudinary for cloud storage
- Helper functions in `utils/cloudinaryUpload.js`
- Upload controller in `controllers/upload.controller.js`
- Image URLs stored as VARCHAR(500) in database

All image fields are optional. Update endpoints accept image URLs returned from upload endpoints.

## Environment Variables

Required in `.env`:
```env
JWT_SECRET=your_secret
DATABASE_URL=postgres://user:pass@host:port/db
PORT=8000
FRONTEND_URL=http://localhost:3000

# Email (password reset)
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password

# Cloudinary (image uploads)
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

## Database Schema Reference

Core tables and relationships:
- `users` - User accounts (FK to roles)
- `roles` - User roles (customer/provider/admin)
- `categories` - Service categories
- `business_profiles` - Provider businesses (FK to users, categories)
- `services` - Services offered (FK to business_profiles)
- `slots` - Available time slots (FK to business_profiles)
- `bookings` - Customer bookings (FK to users, business_profiles, services, slots, address)
- `address` - Customer addresses (FK to users)
- `feedback` - Service reviews (FK to bookings)

Enum types:
- `role_type`: customer, provider, admin
- `booking_status`: pending, confirmed, completed, cancelled
- `address_type`: home, work, billing, shipping, other

## API Endpoint Structure

All routes prefixed with `/api/` implicitly (from base URL).

Public routes (before global auth):
- `/auth/*` - Registration, login, password reset

Protected routes (after global auth):
- `/address/*` - Address management
- `/user/*` - User profile
- `/categories/*` - Category management (admin only for mutations)
- `/business/*` - Business profiles
- `/services/*` - Service management
- `/slots/*` - Time slot management
- `/booking/*` - Booking management
- `/feedback/*` - Reviews and ratings
- `/upload/*` - Image uploads (has own auth middleware)

See `API_DOCUMENTATION.md` for complete API reference.

## Common Patterns

### Adding New Protected Routes
1. Create controller function in `controllers/`
2. Create route definition in `routes/`
3. Import and register route in `index.js` (after line 37, after global auth)
4. Add validation schema if needed

### Adding New Schema Fields
1. Update table definition in `models/schema.js`
2. Run `npm run db:generate` to create migration
3. Run `npm run db:push` to apply to database
4. Update relevant controllers to handle new field
5. Update validation schemas if applicable

### Controller Pattern
```javascript
const controllerFunction = async (req, res) => {
  try {
    // Extract data from req.body, req.params, req.token
    // Validate input if needed
    // Perform database operations
    // Return success response
    res.status(200).json({ message: "Success", data });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
```

### Adding Image Upload to Existing Entity
1. Add VARCHAR(500) field to schema (optional, nullable)
2. Run migrations
3. Create upload endpoint in `upload.controller.js`
4. Update entity controller to accept image URL in create/update functions
5. Use dynamic update pattern for updates (only update provided fields)

## Documentation Files

- `API_DOCUMENTATION.md` - Complete API reference
- `PASSWORD_RESET_GUIDE.md` - Password reset flow
- `STRIPE_INTEGRATION_GUIDE.md` - Payment integration
- `IMAGE_UPLOAD_GUIDE.md` - File upload implementation
- `CHANGES_LOG.md` - Recent changes history

## Known Issues & Considerations

- Upload routes must remain before global auth middleware in `index.js`
- All image fields are optional - handle null values appropriately
- Cascade deletes can remove related data automatically
- OTP storage is in-memory (use Redis in production)
- No test framework currently configured
