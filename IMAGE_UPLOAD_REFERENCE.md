# Image Upload Functionality - Complete Reference

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Configuration Files](#configuration-files)
4. [Upload Endpoints](#upload-endpoints)
5. [Response Format](#response-format)
6. [Usage Flow](#usage-flow)
7. [Integration Examples](#integration-examples)
8. [Error Handling](#error-handling)
9. [File Specifications](#file-specifications)
10. [Cloudinary Folder Structure](#cloudinary-folder-structure)

---

## Overview

This application uses **Cloudinary** for cloud image storage and **Multer** for handling multipart/form-data uploads. Images are uploaded to Cloudinary and the returned URL is stored in the database.

**Key Features:**
- Direct upload to Cloudinary (no local file storage)
- Memory-based uploads (no temporary files)
- Image validation (type and size)
- Organized folder structure in Cloudinary
- JWT-protected endpoints
- Public URL generation for all uploaded images

---

## Architecture

```
Frontend (FormData)
     ↓
Upload Route (with Multer middleware)
     ↓
Multer processes file (memory storage)
     ↓
Upload Controller
     ↓
Cloudinary Upload Utility
     ↓
Cloudinary Cloud Storage
     ↓
Return URL to Frontend
     ↓
Frontend sends URL to update/create endpoint
     ↓
URL stored in Database
```

---

## Configuration Files

### 1. Cloudinary Configuration
**File:** `config/cloudinary.js`

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

**Environment Variables Required:**
```env
CLOUDINARY_CLOUD_NAME=dzj8ztyiv
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

### 2. Multer Configuration
**File:** `config/multer.js`

**Configuration Details:**
- **Storage Type:** Memory storage (files stored in RAM, not disk)
- **Max File Size:** 6MB (6 * 1024 * 1024 bytes)
- **Allowed Formats:** JPG, JPEG, PNG, GIF, WEBP

**Exported Middleware:**
```javascript
module.exports = {
  avatar: upload.single("avatar"),              // User avatar
  logo: upload.single("logo"),                  // Business logo
  coverImage: upload.single("coverImage"),      // Cover image
  serviceImage: upload.single("image"),         // Service image
  categoryImage: upload.single("image"),        // Category image
  multipleImages: upload.array("images", 5),    // Multiple images
};
```

### 3. Upload Utility Functions
**File:** `utils/cloudinaryUpload.js`

**Functions Available:**

#### `uploadBufferToCloudinary(fileBuffer, folder, publicId)`
Uploads a file buffer to Cloudinary.

**Parameters:**
- `fileBuffer` (Buffer) - The file buffer from Multer
- `folder` (String) - Cloudinary folder name
- `publicId` (String, optional) - Custom public ID for the file

**Returns:**
```javascript
{
  url: "https://res.cloudinary.com/...",  // Secure HTTPS URL
  publicId: "avatars/abc123",              // Cloudinary public ID
  width: 800,                               // Image width
  height: 600                               // Image height
}
```

#### `deleteFromCloudinary(publicId)`
Deletes an image from Cloudinary using its public ID.

**Parameters:**
- `publicId` (String) - The Cloudinary public ID

#### `extractPublicIdFromUrl(url)`
Extracts the public ID from a Cloudinary URL.

**Parameters:**
- `url` (String) - The Cloudinary URL

**Returns:**
- Public ID string or null if extraction fails

---

## Upload Endpoints

### Route Configuration
**File:** `routes/upload.route.js`

**Middleware:** All routes protected with `auth` middleware (JWT required)

### Available Endpoints

| Method | Endpoint | Form Field | Purpose | Folder |
|--------|----------|------------|---------|--------|
| POST | `/api/upload/avatar` | `avatar` | Upload user profile picture | `avatars/` |
| POST | `/api/upload/logo` | `logo` | Upload business logo | `business/logos/` |
| POST | `/api/upload/cover-image` | `coverImage` | Upload cover image | `business/covers/` |
| POST | `/api/upload/service-image` | `image` | Upload service image | `services/` |
| POST | `/api/upload/category-image` | `image` | Upload category image | `categories/` |
| DELETE | `/api/upload/:publicId` | - | Delete image from Cloudinary | - |

### Controller Functions
**File:** `controllers/upload.controller.js`

#### 1. `uploadAvatar(req, res)`
- **Endpoint:** `POST /api/upload/avatar`
- **Form Field:** `avatar`
- **Cloudinary Folder:** `avatars`
- **Auth Required:** Yes

#### 2. `uploadLogo(req, res)`
- **Endpoint:** `POST /api/upload/logo`
- **Form Field:** `logo`
- **Cloudinary Folder:** `business/logos`
- **Auth Required:** Yes

#### 3. `uploadCoverImage(req, res)`
- **Endpoint:** `POST /api/upload/cover-image`
- **Form Field:** `coverImage`
- **Cloudinary Folder:** `business/covers`
- **Auth Required:** Yes

#### 4. `uploadServiceImage(req, res)`
- **Endpoint:** `POST /api/upload/service-image`
- **Form Field:** `image`
- **Cloudinary Folder:** `services`
- **Auth Required:** Yes

#### 5. `uploadCategoryImage(req, res)`
- **Endpoint:** `POST /api/upload/category-image`
- **Form Field:** `image`
- **Cloudinary Folder:** `categories`
- **Auth Required:** Yes

#### 6. `deleteImage(req, res)`
- **Endpoint:** `DELETE /api/upload/:publicId`
- **Parameter:** `publicId` (URL parameter)
- **Auth Required:** Yes

---

## Response Format

### Success Response (200 OK)

```json
{
  "success": true,
  "message": "Avatar uploaded successfully",
  "data": {
    "url": "https://res.cloudinary.com/dzj8ztyiv/image/upload/v1234567890/avatars/abc123.jpg",
    "publicId": "avatars/abc123",
    "width": 800,
    "height": 600
  }
}
```

**Response Fields:**
- `success` (Boolean) - Always true for successful uploads
- `message` (String) - Descriptive success message
- `data` (Object) - Upload details
  - `url` (String) - Full HTTPS URL to the uploaded image
  - `publicId` (String) - Cloudinary public ID (for deletion)
  - `width` (Number) - Image width in pixels
  - `height` (Number) - Image height in pixels

### Error Responses

#### 400 Bad Request - No File
```json
{
  "success": false,
  "message": "No file uploaded"
}
```

#### 400 Bad Request - Invalid File Type
```json
{
  "success": false,
  "message": "Only image files are allowed!"
}
```

#### 500 Internal Server Error - Upload Failed
```json
{
  "success": false,
  "message": "Failed to upload avatar",
  "error": "Error details here"
}
```

#### 401 Unauthorized
```json
{
  "success": false,
  "message": "Authentication required"
}
```

---

## Usage Flow

### Step 1: Upload Image

Frontend sends image to upload endpoint:

```javascript
// Frontend code
const formData = new FormData();
formData.append('avatar', imageFile);

const response = await fetch('http://localhost:8000/api/upload/avatar', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
  },
  body: formData,
});

const result = await response.json();
// result.data.url contains the Cloudinary URL
```

### Step 2: Store URL in Database

Frontend sends the returned URL to the appropriate create/update endpoint:

```javascript
// Update user profile with avatar URL
const updateResponse = await fetch('http://localhost:8000/api/user/update', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify({
    name: "John Doe",
    email: "john@example.com",
    avatar: result.data.url,  // URL from step 1
  }),
});
```

---

## Integration Examples

### Example 1: Upload User Avatar

**Step 1:** Upload avatar
```bash
curl -X POST http://localhost:8000/api/upload/avatar \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "avatar=@/path/to/avatar.jpg"
```

**Response:**
```json
{
  "success": true,
  "message": "Avatar uploaded successfully",
  "data": {
    "url": "https://res.cloudinary.com/dzj8ztyiv/image/upload/v1234567890/avatars/xyz123.jpg",
    "publicId": "avatars/xyz123",
    "width": 500,
    "height": 500
  }
}
```

**Step 2:** Update user profile
```bash
curl -X PUT http://localhost:8000/api/user/update \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "1234567890",
    "avatar": "https://res.cloudinary.com/dzj8ztyiv/image/upload/v1234567890/avatars/xyz123.jpg"
  }'
```

### Example 2: Create Business with Logo and Cover Image

**Step 1:** Upload logo
```bash
curl -X POST http://localhost:8000/api/upload/logo \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "logo=@/path/to/logo.png"
```

**Step 2:** Upload cover image
```bash
curl -X POST http://localhost:8000/api/upload/cover-image \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "coverImage=@/path/to/cover.jpg"
```

**Step 3:** Create business with URLs
```bash
curl -X POST http://localhost:8000/api/business/add \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "Plumbing Services",
    "description": "Professional plumbing services",
    "categoryId": 1,
    "logo": "https://res.cloudinary.com/dzj8ztyiv/image/upload/v1234567890/business/logos/logo123.png",
    "coverImage": "https://res.cloudinary.com/dzj8ztyiv/image/upload/v1234567890/business/covers/cover456.jpg",
    "website": "https://example.com"
  }'
```

### Example 3: Update Service Image

**Step 1:** Upload service image
```bash
curl -X POST http://localhost:8000/api/upload/service-image \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "image=@/path/to/service.jpg"
```

**Step 2:** Update service
```bash
curl -X PUT http://localhost:8000/api/service/1/update \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "name": "Pipe Repair",
    "description": "Fix broken pipes",
    "price": 100,
    "duration": 60,
    "image": "https://res.cloudinary.com/dzj8ztyiv/image/upload/v1234567890/services/service789.jpg"
  }'
```

### Example 4: Delete Image

```bash
curl -X DELETE http://localhost:8000/api/upload/avatars/xyz123 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "message": "Image deleted successfully",
  "data": {
    "result": "ok"
  }
}
```

---

## Error Handling

### Common Error Scenarios

#### 1. File Too Large
**Status Code:** 413 Payload Too Large
**Cause:** File exceeds 6MB limit
**Solution:** Compress image or upload smaller file

#### 2. Invalid File Type
**Status Code:** 400 Bad Request
**Cause:** File is not an image (JPG, PNG, GIF, WEBP)
**Solution:** Upload only image files

#### 3. No File Uploaded
**Status Code:** 400 Bad Request
**Cause:** Form field name doesn't match expected field name
**Solution:** Use correct field name (avatar, logo, coverImage, image)

#### 4. Authentication Failed
**Status Code:** 401 Unauthorized
**Cause:** Missing or invalid JWT token
**Solution:** Include valid JWT token in Authorization header

#### 5. Cloudinary Upload Failed
**Status Code:** 500 Internal Server Error
**Cause:** Cloudinary API error, invalid credentials, or network issue
**Solution:** Check Cloudinary credentials and internet connection

---

## File Specifications

### Allowed File Types
- **Images:** JPG, JPEG, PNG, GIF, WEBP
- **Validation:** Case-insensitive file extension check

### File Size Limits
- **Maximum Size:** 6MB (6,291,456 bytes)
- **Recommended:** Under 2MB for optimal performance

### Image Dimensions
- **No minimum/maximum** enforced
- Cloudinary automatically optimizes images
- Original dimensions preserved and returned in response

---

## Cloudinary Folder Structure

Images are organized in Cloudinary with the following folder structure:

```
cloudinary_root/
├── avatars/                    # User profile pictures
│   ├── abc123.jpg
│   └── xyz456.png
│
├── business/                   # Business-related images
│   ├── logos/                  # Business logos
│   │   ├── logo1.png
│   │   └── logo2.jpg
│   └── covers/                 # Business cover/banner images
│       ├── cover1.jpg
│       └── cover2.png
│
├── services/                   # Service preview images
│   ├── service1.jpg
│   └── service2.png
│
└── categories/                 # Category icons/images
    ├── cat1.jpg
    └── cat2.png
```

**Folder Assignment by Endpoint:**
- `/api/upload/avatar` → `avatars/`
- `/api/upload/logo` → `business/logos/`
- `/api/upload/cover-image` → `business/covers/`
- `/api/upload/service-image` → `services/`
- `/api/upload/category-image` → `categories/`

---

## Database Schema Fields

### Users Table
```javascript
avatar: varchar("avatar", { length: 500 })  // Optional - User profile picture URL
```

### Business Profiles Table
```javascript
logo: varchar("logo", { length: 500 })           // Optional - Business logo URL
coverImage: varchar("cover_image", { length: 500 })  // Optional - Cover image URL
```

### Services Table
```javascript
image: varchar("image", { length: 500 })  // Optional - Service image URL
```

### Categories Table
```javascript
image: varchar("image", { length: 500 })  // Optional - Category image URL
```

**All fields are optional (nullable) and store full Cloudinary URLs.**

---

## Update Endpoints Supporting Images

### User Profile
- **PUT `/api/user/update`** - Accepts `avatar` field

### Business Profile
- **POST `/api/business/add`** - Accepts `logo` and `coverImage` fields
- **PUT `/api/business/update/:id`** - Accepts `logo` and `coverImage` fields

### Services
- **POST `/api/service/:businessId/add`** - Accepts `image` field
- **PUT `/api/service/:serviceId/update`** - Accepts `image` field

### Categories
- **POST `/api/categories`** - Accepts `image` field
- **PUT `/api/categories/:id`** - Accepts `image` field

---

## React Integration Example

### Avatar Upload Component

```jsx
import React, { useState } from 'react';

const AvatarUpload = () => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [preview, setPreview] = useState(null);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setFile(selectedFile);

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result);
    };
    reader.readAsDataURL(selectedFile);
  };

  const handleUpload = async () => {
    if (!file) return;

    const formData = new FormData();
    formData.append('avatar', file);

    setUploading(true);

    try {
      // Step 1: Upload to Cloudinary
      const uploadResponse = await fetch('http://localhost:8000/api/upload/avatar', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: formData,
      });

      const uploadData = await uploadResponse.json();

      if (uploadData.success) {
        const imageUrl = uploadData.data.url;
        setAvatarUrl(imageUrl);

        // Step 2: Update user profile with URL
        await updateUserProfile(imageUrl);
        alert('Avatar uploaded successfully!');
      }
    } catch (error) {
      console.error('Upload failed:', error);
      alert('Failed to upload avatar');
    } finally {
      setUploading(false);
    }
  };

  const updateUserProfile = async (avatar) => {
    await fetch('http://localhost:8000/api/user/update', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
      },
      body: JSON.stringify({ avatar }),
    });
  };

  return (
    <div className="avatar-upload">
      <h3>Upload Avatar</h3>

      {/* Preview */}
      {preview && (
        <img
          src={preview}
          alt="Preview"
          style={{ width: '150px', height: '150px', objectFit: 'cover', borderRadius: '50%' }}
        />
      )}

      {/* File Input */}
      <input
        type="file"
        onChange={handleFileChange}
        accept="image/*"
        disabled={uploading}
      />

      {/* Upload Button */}
      <button
        onClick={handleUpload}
        disabled={!file || uploading}
      >
        {uploading ? 'Uploading...' : 'Upload Avatar'}
      </button>

      {/* Display uploaded image URL */}
      {avatarUrl && (
        <div>
          <p>Image URL:</p>
          <code style={{ fontSize: '12px' }}>{avatarUrl}</code>
        </div>
      )}
    </div>
  );
};

export default AvatarUpload;
```

---

## Testing Checklist

- [ ] Upload avatar (JPG, PNG, GIF, WEBP)
- [ ] Upload logo
- [ ] Upload cover image
- [ ] Upload service image
- [ ] Upload category image
- [ ] Verify file size limit (6MB)
- [ ] Verify file type validation
- [ ] Test without authentication (should fail)
- [ ] Test with invalid file type (should fail)
- [ ] Delete uploaded image
- [ ] Update user profile with avatar URL
- [ ] Create business with logo and coverImage
- [ ] Create service with image
- [ ] Create category with image
- [ ] Update existing records with new images

---

## Troubleshooting

### Issue: "No file uploaded" error
**Solution:** Check that form field name matches the expected name (avatar, logo, coverImage, image)

### Issue: "Only image files are allowed!" error
**Solution:** Ensure file extension is .jpg, .jpeg, .png, .gif, or .webp

### Issue: Upload hangs or times out
**Solution:** Check file size (must be under 6MB) and internet connection

### Issue: 401 Unauthorized
**Solution:** Ensure JWT token is valid and included in Authorization header

### Issue: URL stored but image not accessible
**Solution:** Verify Cloudinary credentials are correct in .env file

---

## Security Considerations

1. **Authentication Required:** All upload endpoints require valid JWT token
2. **File Type Validation:** Only image files accepted
3. **File Size Limits:** 6MB maximum prevents abuse
4. **No Local Storage:** Files uploaded directly to Cloudinary, no disk usage
5. **HTTPS URLs:** All returned URLs use HTTPS
6. **No Private Data:** Images stored in publicly accessible Cloudinary folders

---

## Performance Tips

1. **Compress Images Before Upload:** Reduces upload time and bandwidth
2. **Use WebP Format:** Better compression than JPEG/PNG
3. **Optimal Size:** Keep images under 2MB for best performance
4. **Lazy Loading:** Use lazy loading on frontend for image-heavy pages
5. **CDN Benefits:** Cloudinary automatically serves images from CDN

---

## Summary

- **6 Upload Endpoints** (avatar, logo, cover-image, service-image, category-image, delete)
- **1 Upload Controller** with 6 functions
- **2 Config Files** (cloudinary.js, multer.js)
- **1 Utility File** (cloudinaryUpload.js)
- **Protected by JWT** authentication
- **6MB Max File Size**
- **5 Image Formats Supported** (JPG, JPEG, PNG, GIF, WEBP)
- **Organized Folder Structure** in Cloudinary
- **HTTPS URLs** returned for all uploads
- **Optional Image Fields** in database schema
