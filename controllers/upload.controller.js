const { uploadBufferToCloudinary, deleteFromCloudinary } = require('../utils/cloudinaryUpload');

/**
 * Upload avatar image
 * @route POST /api/upload/avatar
 */
const uploadAvatar = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
      });
    }

    const result = await uploadBufferToCloudinary(req.file.buffer, 'avatars');

    res.status(200).json({
      success: true,
      message: 'Avatar uploaded successfully',
      data: result,
    });
  } catch (error) {
    console.error('Avatar upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload avatar',
      error: error.message,
    });
  }
};

/**
 * Upload business logo
 * @route POST /api/upload/logo
 */
const uploadLogo = async (req, res) => {
  try {
    console.log('Logo upload request received');
    console.log('File:', req.file ? 'Found' : 'Not found');
    console.log('Body:', req.body);

    if (!req.file) {
      console.log('No file in request');
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
      });
    }

    console.log('Uploading logo to Cloudinary...');
    const result = await uploadBufferToCloudinary(req.file.buffer, 'business/logos');
    console.log('Logo uploaded to Cloudinary:', result);

    res.status(200).json({
      success: true,
      message: 'Logo uploaded successfully',
      data: result,
    });
  } catch (error) {
    console.error('Logo upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload logo',
      error: error.message,
    });
  }
};

/**
 * Upload cover image
 * @route POST /api/upload/cover-image
 */
const uploadCoverImage = async (req, res) => {
  try {
    console.log('Cover image upload request received');
    console.log('File:', req.file ? 'Found' : 'Not found');
    console.log('Body:', req.body);

    if (!req.file) {
      console.log('No file in request');
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
      });
    }

    console.log('Uploading cover image to Cloudinary...');
    const result = await uploadBufferToCloudinary(req.file.buffer, 'business/covers');
    console.log('Cover image uploaded to Cloudinary:', result);

    res.status(200).json({
      success: true,
      message: 'Cover image uploaded successfully',
      data: result,
    });
  } catch (error) {
    console.error('Cover image upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload cover image',
      error: error.message,
    });
  }
};

/**
 * Upload service image
 * @route POST /api/upload/service-image
 */
const uploadServiceImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
      });
    }

    const result = await uploadBufferToCloudinary(req.file.buffer, 'services');

    res.status(200).json({
      success: true,
      message: 'Service image uploaded successfully',
      data: result,
    });
  } catch (error) {
    console.error('Service image upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload service image',
      error: error.message,
    });
  }
};

/**
 * Upload category image
 * @route POST /api/upload/category-image
 */
const uploadCategoryImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
      });
    }

    const result = await uploadBufferToCloudinary(req.file.buffer, 'categories');

    res.status(200).json({
      success: true,
      message: 'Category image uploaded successfully',
      data: result,
    });
  } catch (error) {
    console.error('Category image upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload category image',
      error: error.message,
    });
  }
};

/**
 * Delete image from Cloudinary
 * @route DELETE /api/upload/:publicId
 */
const deleteImage = async (req, res) => {
  try {
    const { publicId } = req.params;

    if (!publicId) {
      return res.status(400).json({
        success: false,
        message: 'Public ID is required',
      });
    }

    const result = await deleteFromCloudinary(publicId);

    res.status(200).json({
      success: true,
      message: 'Image deleted successfully',
      data: result,
    });
  } catch (error) {
    console.error('Image deletion error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete image',
      error: error.message,
    });
  }
};

module.exports = {
  uploadAvatar,
  uploadLogo,
  uploadCoverImage,
  uploadServiceImage,
  uploadCategoryImage,
  deleteImage,
};
