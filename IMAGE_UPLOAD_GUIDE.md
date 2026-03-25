# Image Upload with Cloudinary - Setup Guide

## Overview
This application now supports image uploads to Cloudinary for user avatars, business logos, cover images, service images, and category images.

## Prerequisites

1. **Cloudinary Account**: Sign up at https://cloudinary.com
2. **Get Your Credentials**:
   - Cloud Name
   - API Key
   - API Secret

## Configuration Steps

### 1. Update Environment Variables

Add your Cloudinary credentials to the `.env` file:

```env
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

### 2. Run Database Migration

After updating the schema, generate and run the migration:

```bash
npm run db:generate
npm run db:push
```

## API Endpoints

All upload endpoints are **protected** and require authentication (JWT token).

### Upload Endpoints

| Endpoint | Method | Description | Form Field Name |
|----------|--------|-------------|-----------------|
| `/api/upload/avatar` | POST | Upload user avatar | `avatar` |
| `/api/upload/logo` | POST | Upload business logo | `logo` |
| `/api/upload/cover-image` | POST | Upload business cover image | `coverImage` |
| `/api/upload/service-image` | POST | Upload service image | `image` |
| `/api/upload/category-image` | POST | Upload category image | `image` |
| `/api/upload/:publicId` | DELETE | Delete image from Cloudinary | - |

### Success Response

```json
{
  "success": true,
  "message": "Image uploaded successfully",
  "data": {
    "url": "https://res.cloudinary.com/...",
    "publicId": "avatars/abc123",
    "width": 800,
    "height": 600
  }
}
```

## Usage Examples

### Example 1: Upload User Avatar

**Request:**
```bash
curl -X POST http://localhost:8000/api/upload/avatar \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "avatar=@/path/to/image.jpg"
```

**Response:** Returns Cloudinary URL

### Example 2: Update User Profile with Avatar

After getting the Cloudinary URL from the upload endpoint:

**Request:**
```bash
curl -X PUT http://localhost:8000/api/user/update \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "1234567890",
    "avatar": "https://res.cloudinary.com/dzj8ztyiv/image/upload/v1234567890/avatars/abc123.jpg"
  }'
```

### Example 3: Create Business with Logo and Cover Image

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

**Step 3:** Create business with the URLs
```bash
curl -X POST http://localhost:8000/api/business/add \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Plumbing Services",
    "description": "Professional plumbing services",
    "categoryId": 1,
    "logo": "https://res.cloudinary.com/dzj8ztyiv/image/upload/v1234567890/business/logos/xyz123.png",
    "coverImage": "https://res.cloudinary.com/dzj8ztyiv/image/upload/v1234567890/business/covers/def456.jpg",
    "website": "https://example.com"
  }'
```

## File Upload Limits

- **Max file size**: 5MB
- **Allowed formats**: JPG, JPEG, PNG, GIF, WEBP

## Folder Structure in Cloudinary

Images are organized in folders:

```
cloudinary_root/
├── avatars/          # User profile pictures
├── business/
│   ├── logos/        # Business logos
│   └── covers/       # Business cover/banner images
├── services/         # Service images
└── categories/       # Category images
```

## Schema Changes

### Users Table
- `avatar` (VARCHAR(500)) - Profile picture URL

### Business Profiles Table
- `logo` (VARCHAR(500)) - Business logo URL
- `coverImage` (VARCHAR(500)) - Cover/banner image URL

### Services Table
- `image` (VARCHAR(500)) - Service image URL

### Categories Table
- `image` (VARCHAR(500)) - Category image URL

All image fields are **optional**.

## Error Handling

### Common Errors

1. **No file uploaded** (400):
```json
{
  "success": false,
  "message": "No file uploaded"
}
```

2. **Invalid file type** (400):
```json
{
  "success": false,
  "message": "Only image files are allowed!"
}
```

3. **File too large** (413):
```json
{
  "success": false,
  "message": "File too large. Max size is 5MB"
}
```

4. **Unauthorized** (401):
```json
{
  "success": false,
  "message": "Authentication required"
}
```

## Frontend Integration Example (React)

```jsx
import React, { useState } from 'react';

const AvatarUpload = () => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState('');

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!file) return;

    const formData = new FormData();
    formData.append('avatar', file);

    setUploading(true);

    try {
      const response = await fetch('http://localhost:8000/api/upload/avatar', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: formData,
      });

      const data = await response.json();

      if (data.success) {
        setAvatarUrl(data.data.url);
        // Now update user profile with the URL
        await updateUserProfile(data.data.url);
      }
    } catch (error) {
      console.error('Upload failed:', error);
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
    <div>
      <input type="file" onChange={handleFileChange} accept="image/*" />
      <button onClick={handleUpload} disabled={uploading}>
        {uploading ? 'Uploading...' : 'Upload Avatar'}
      </button>
      {avatarUrl && <img src={avatarUrl} alt="Avatar" />}
    </div>
  );
};

export default AvatarUpload;
```

## Notes

- All image URLs returned are **HTTPS** secure URLs
- Images are optimized and served through Cloudinary's CDN
- You can delete images using the `publicId` returned in the upload response
- Update your Cloudinary account settings to manage transformations, optimizations, and more
