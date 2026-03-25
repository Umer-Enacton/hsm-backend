# Image Upload Feature - Changes Log

## Overview
Added Cloudinary image upload functionality to support user avatars, business logos, cover images, service images, and category images.

---

## 📊 Schema Changes

### File: `models/schema.js`

#### 1. **Users Table**
```javascript
// ADDED: avatar field (line 68)
avatar: varchar("avatar", { length: 500 }), // Cloudinary URL for profile picture
```

#### 2. **Business Profiles Table**
```javascript
// ADDED: logo field (line 84)
logo: varchar("logo", { length: 500 }), // Cloudinary URL for business logo

// ADDED: coverImage field (line 85)
coverImage: varchar("cover_image", { length: 500 }), // Cloudinary URL for cover/banner image
```

#### 3. **Services Table**
```javascript
// ADDED: image field (line 96)
image: varchar("image", { length: 500 }), // Cloudinary URL for service image
```

#### 4. **Categories Table**
```javascript
// ADDED: image field (line 54)
image: varchar("image", { length: 500 }), // Cloudinary URL for category image
```

---

## 🆕 New Files Created

### 1. **Configuration Files**

#### `config/cloudinary.js`
- **Purpose**: Cloudinary SDK configuration
- **Dependencies**: `cloudinary` package
- **Environment Variables Used**:
  - `CLOUDINARY_CLOUD_NAME`
  - `CLOUDINARY_API_KEY`
  - `CLOUDINARY_API_SECRET`

```javascript
const cloudinary = require('cloudinary').v2;
require('dotenv').config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

module.exports = cloudinary;
```

#### `config/multer.js`
- **Purpose**: Multer configuration for handling multipart/form-data
- **Dependencies**: `multer`, `uuid`
- **Features**:
  - Memory storage (uploads directly to Cloudinary from memory)
  - File size limit: 5MB
  - File filter: Only images (JPG, JPEG, PNG, GIF, WEBP)
- **Exports**: Pre-configured upload middleware for different use cases

```javascript
module.exports = {
  single: (fieldName) => upload.single(fieldName),
  multiple: (fieldName, maxCount) => upload.array(fieldName, maxCount),
  avatar: upload.single('avatar'),
  logo: upload.single('logo'),
  coverImage: upload.single('coverImage'),
  serviceImage: upload.single('image'),
  categoryImage: upload.single('image'),
  multipleImages: upload.array('images', 5),
};
```

### 2. **Utility Files**

#### `utils/cloudinaryUpload.js`
- **Purpose**: Helper functions for Cloudinary operations
- **Functions**:
  - `uploadBufferToCloudinary(fileBuffer, folder, publicId)` - Upload image buffer to Cloudinary
  - `deleteFromCloudinary(publicId)` - Delete image from Cloudinary
  - `extractPublicIdFromUrl(url)` - Extract public ID from Cloudinary URL

### 3. **Controller Files**

#### `controllers/upload.controller.js`
- **Purpose**: Handle all upload requests
- **Functions**:
  - `uploadAvatar(req, res)` - POST /api/upload/avatar
  - `uploadLogo(req, res)` - POST /api/upload/logo
  - `uploadCoverImage(req, res)` - POST /api/upload/cover-image
  - `uploadServiceImage(req, res)` - POST /api/upload/service-image
  - `uploadCategoryImage(req, res)` - POST /api/upload/category-image
  - `deleteImage(req, res)` - DELETE /api/upload/:publicId

### 4. **Route Files**

#### `routes/upload.route.js`
- **Purpose**: Define upload endpoints
- **Middleware**: All routes protected with `authMiddleware`
- **Routes**:
  - `POST /api/upload/avatar` - Upload user avatar
  - `POST /api/upload/logo` - Upload business logo
  - `POST /api/upload/cover-image` - Upload business cover image
  - `POST /api/upload/service-image` - Upload service image
  - `POST /api/upload/category-image` - Upload category image
  - `DELETE /api/upload/:publicId` - Delete image

### 5. **Documentation Files**

#### `IMAGE_UPLOAD_GUIDE.md`
- Complete guide for using image upload functionality
- API examples
- Frontend integration examples
- Error handling

---

## 🔧 Modified Files

### 1. **Controllers**

#### `controllers/user.controller.js`
**Changed Function**: `updateUserProfile()`
- **Line**: 58-74
- **Changes**:
  - Added `avatar` to destructured request body
  - Made updates dynamic (only update provided fields)
  - Added avatar to updateData object
  - Removed password from response

```javascript
// BEFORE
const { name, email, phone } = req.body;
const [updatedUser] = await db
  .update(users)
  .set({ name, email, phone })
  .where(eq(users.id, userId))
  .returning();

// AFTER
const { name, email, phone, avatar } = req.body;
const updateData = {};
if (name !== undefined) updateData.name = name;
if (email !== undefined) updateData.email = email;
if (phone !== undefined) updateData.phone = phone;
if (avatar !== undefined) updateData.avatar = avatar;
const [updatedUser] = await db
  .update(users)
  .set(updateData)
  .where(eq(users.id, userId))
  .returning();
```

#### `controllers/business.controller.js`
**Changed Functions**: `addBusiness()`, `updateBusiness()`

**Function: `addBusiness()`**
- **Line**: 94-140
- **Changes**:
  - Added `logo`, `coverImage`, `website` to destructured request body
  - Added these fields to insert values

```javascript
// BEFORE
const { name, description, categoryId } = req.body;
const [newBusiness] = await db
  .insert(businessProfiles)
  .values({
    providerId: userId,
    businessName: name,
    description,
    categoryId,
    phone,
  })
  .returning();

// AFTER
const { name, description, categoryId, logo, coverImage, website } = req.body;
const [newBusiness] = await db
  .insert(businessProfiles)
  .values({
    providerId: userId,
    businessName: name,
    description,
    categoryId,
    phone,
    logo: logo || null,
    coverImage: coverImage || null,
    website: website || null,
  })
  .returning();
```

**Function: `updateBusiness()`**
- **Line**: 141-185
- **Changes**:
  - Added `logo`, `coverImage`, `website` to destructured request body
  - Made updates dynamic (only update provided fields)
  - Added these fields to updateData object

```javascript
// BEFORE
const { name, description, categoryId } = req.body;
const [updatedBusiness] = await db
  .update(businessProfiles)
  .set({
    businessName: name,
    description,
    categoryId,
  })
  .where(...)

// AFTER
const { name, description, categoryId, logo, coverImage, website } = req.body;
const updateData = {};
if (name !== undefined) updateData.businessName = name;
if (description !== undefined) updateData.description = description;
if (categoryId !== undefined) updateData.categoryId = categoryId;
if (logo !== undefined) updateData.logo = logo;
if (coverImage !== undefined) updateData.coverImage = coverImage;
if (website !== undefined) updateData.website = website;
const [updatedBusiness] = await db
  .update(businessProfiles)
  .set(updateData)
  .where(...)
```

#### `controllers/service.controller.js`
**Changed Functions**: `addService()`, `updateService()`

**Function: `addService()`**
- **Line**: 35-85
- **Changes**:
  - Added `image` to destructured request body
  - Added image field to insert values

```javascript
// BEFORE
const { name, description, price, duration } = req.body;
const [newService] = await db
  .insert(services)
  .values({
    businessProfileId: businessId,
    name,
    description,
    EstimateDuration: duration,
    price,
  })
  .returning();

// AFTER
const { name, description, price, duration, image } = req.body;
const [newService] = await db
  .insert(services)
  .values({
    businessProfileId: businessId,
    name,
    description,
    EstimateDuration: duration,
    price,
    image: image || null,
  })
  .returning();
```

**Function: `updateService()`**
- **Line**: 86-139
- **Changes**:
  - Added `image` to destructured request body
  - Made updates dynamic (only update provided fields)
  - Added image to updateData object

```javascript
// BEFORE
const { name, description, price, duration } = req.body;
const [updatedService] = await db
  .update(services)
  .set({
    name,
    description,
    price,
    EstimateDuration: duration,
  })
  .where(eq(services.id, serviceId))
  .returning();

// AFTER
const { name, description, price, duration, image } = req.body;
const updateData = {};
if (name !== undefined) updateData.name = name;
if (description !== undefined) updateData.description = description;
if (price !== undefined) updateData.price = price;
if (duration !== undefined) updateData.EstimateDuration = duration;
if (image !== undefined) updateData.image = image;
const [updatedService] = await db
  .update(services)
  .set(updateData)
  .where(eq(services.id, serviceId))
  .returning();
```

#### `controllers/category.controller.js`
**Changed Functions**: `addCategory()`
**Added Function**: `updateCategory()`

**Function: `addCategory()`**
- **Line**: 14-32
- **Changes**:
  - Added `image` to destructured request body
  - Added image field to insert values

```javascript
// BEFORE
const { name, description } = req.body;
const [newCategory] = await db
  .insert(Category)
  .values({ name, description })
  .returning();

// AFTER
const { name, description, image } = req.body;
const [newCategory] = await db
  .insert(Category)
  .values({ name, description, image: image || null })
  .returning();
```

**Function: `updateCategory()` - NEW**
- **Line**: 49-73
- **Purpose**: Update category details including image
- **Features**: Dynamic updates (only updates provided fields)

```javascript
const updateCategory = async (req, res) => {
  try {
    const categoryId = req.params.id;
    const { name, description, image } = req.body;
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (image !== undefined) updateData.image = image;
    const [updatedCategory] = await db
      .update(Category)
      .set(updateData)
      .where(eq(Category.id, categoryId))
      .returning();
    if (!updatedCategory) {
      return res.status(404).json({ message: "Category not found" });
    }
    res.status(200).json({
      message: "Category updated successfully",
      category: updatedCategory,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
```

### 2. **Routes**

#### `routes/category.route.js`
- **Line**: 3-7, 13
- **Changes**:
  - Added `updateCategory` import
  - Added new PUT route for updating categories

```javascript
// BEFORE
const {
  getAllCategories,
  addCategory,
  deleteCategory,
} = require("../controllers/category.controller");

// Routes
router.get("/categories", getAllCategories);
router.post("/categories", authorizeRole(ADMIN), addCategory);
router.delete("/categories/:id", authorizeRole(ADMIN), deleteCategory);

// AFTER
const {
  getAllCategories,
  addCategory,
  deleteCategory,
  updateCategory,
} = require("../controllers/category.controller");

// Routes
router.get("/categories", getAllCategories);
router.post("/categories", authorizeRole(ADMIN), addCategory);
router.put("/categories/:id", authorizeRole(ADMIN), updateCategory);
router.delete("/categories/:id", authorizeRole(ADMIN), deleteCategory);
```

### 3. **Main Application**

#### `index.js`
- **Line**: 11, 44
- **Changes**:
  - Added upload routes import
  - Added upload routes to app

```javascript
// Line 11 - Import
const uploadRoutes = require("./routes/upload.route");

// Line 44 - Register routes
app.use("/", uploadRoutes);
```

### 4. **Environment Configuration**

#### `.env`
- **Changes**: Added Cloudinary configuration variables

```env
# Cloudinary Configuration
CLOUDINARY_CLOUD_NAME=dzj8ztyiv
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

### 5. **Package Dependencies**

#### `package.json`
- **New Dependencies Added**:
  - `cloudinary: ^2.9.0` (already installed)
  - `multer: ^latest` (installed)
  - `uuid: ^latest` (installed)

---

## 📋 Summary of Changes by Category

### New Files (6)
1. `config/cloudinary.js` - Cloudinary configuration
2. `config/multer.js` - Multer middleware configuration
3. `utils/cloudinaryUpload.js` - Upload utility functions
4. `controllers/upload.controller.js` - Upload endpoints controller
5. `routes/upload.route.js` - Upload routes definition
6. `IMAGE_UPLOAD_GUIDE.md` - Documentation

### Modified Files (8)
1. `models/schema.js` - Added image fields to 4 tables
2. `controllers/user.controller.js` - Added avatar support
3. `controllers/business.controller.js` - Added logo & coverImage support
4. `controllers/service.controller.js` - Added image support
5. `controllers/category.controller.js` - Added image support & update function
6. `routes/category.route.js` - Added update category route
7. `index.js` - Registered upload routes
8. `.env` - Added Cloudinary credentials

---

## 🔑 Key Features Implemented

1. **Multiple Upload Types**: Support for 5 different image types (avatar, logo, cover, service, category)
2. **File Validation**: Only image files allowed (JPG, JPEG, PNG, GIF, WEBP)
3. **Size Limit**: 5MB maximum file size
4. **Dynamic Updates**: Controllers only update fields that are provided
5. **Folder Organization**: Images organized in Cloudinary folders (avatars, business/logos, business/covers, services, categories)
6. **Secure Uploads**: All endpoints protected with JWT authentication
7. **Error Handling**: Comprehensive error messages
8. **Image Deletion**: Ability to delete images from Cloudinary

---

## 🚀 Next Steps for Deployment

1. ✅ Add Cloudinary credentials to `.env` file
2. ✅ Run `npm run db:generate` to generate migration
3. ✅ Run `npm run db:push` to apply schema changes
4. ✅ Test upload endpoints
5. ✅ Update frontend to use new upload endpoints

---

## 📊 Database Migration Required

The following columns need to be added to your database:

```sql
-- Users table
ALTER TABLE users ADD COLUMN avatar VARCHAR(500);

-- Business_profiles table
ALTER TABLE business_profiles ADD COLUMN logo VARCHAR(500);
ALTER TABLE business_profiles ADD COLUMN cover_image VARCHAR(500);

-- Services table
ALTER TABLE services ADD COLUMN image VARCHAR(500);

-- Categories table
ALTER TABLE categories ADD COLUMN image VARCHAR(500);
```

Run these commands to apply:
```bash
npm run db:generate
npm run db:push
```

---

## 🔗 API Endpoints Reference

### Upload Endpoints (All require authentication)

| Method | Endpoint | Form Field | Purpose |
|--------|----------|------------|---------|
| POST | `/api/upload/avatar` | `avatar` | Upload user profile picture |
| POST | `/api/upload/logo` | `logo` | Upload business logo |
| POST | `/api/upload/cover-image` | `coverImage` | Upload business cover image |
| POST | `/api/upload/service-image` | `image` | Upload service image |
| POST | `/api/upload/category-image` | `image` | Upload category image |
| DELETE | `/api/upload/:publicId` | - | Delete image from Cloudinary |

### Update Endpoints (Now support image URLs)

| Method | Endpoint | Image Field | Purpose |
|--------|----------|-------------|---------|
| PUT | `/api/user/update` | `avatar` | Update user with avatar |
| POST | `/api/business/add` | `logo`, `coverImage` | Create business with images |
| PUT | `/api/business/update/:id` | `logo`, `coverImage` | Update business images |
| POST | `/api/service/:businessId/add` | `image` | Create service with image |
| PUT | `/api/service/:serviceId/update` | `image` | Update service image |
| POST | `/api/categories` | `image` | Create category with image |
| PUT | `/api/categories/:id` | `image` | Update category image |

---

## 📝 Notes

- All image fields are **optional** (nullable in database)
- Images are stored as **Cloudinary URLs** (full HTTPS URLs)
- No image files are stored locally on the server
- All upload operations use **memory storage** (no temp files)
- Maximum file size: **5MB**
- Supported formats: **JPG, JPEG, PNG, GIF, WEBP**
