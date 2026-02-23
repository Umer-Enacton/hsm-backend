const cloudinary = require('../config/cloudinary');

/**
 * Upload a buffer to Cloudinary
 * @param {Buffer} fileBuffer - The file buffer to upload
 * @param {String} folder - The folder name in Cloudinary
 * @param {String} publicId - Optional public ID for the file
 * @returns {Promise<Object>} - Upload result with secure_url
 */
const uploadBufferToCloudinary = async (fileBuffer, folder, publicId = null) => {
  try {
    const uploadOptions = {
      folder: folder,
      resource_type: 'image',
      allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    };

    // Add public ID if provided
    if (publicId) {
      uploadOptions.public_id = publicId;
    }

    // Convert buffer to base64 and upload
    const dataUri = `data:image/jpeg;base64,${fileBuffer.toString('base64')}`;
    const result = await cloudinary.uploader.upload(dataUri, uploadOptions);

    return {
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
    };
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw new Error('Failed to upload image to Cloudinary');
  }
};

/**
 * Delete an image from Cloudinary
 * @param {String} publicId - The public ID of the image to delete
 * @returns {Promise<Object>} - Deletion result
 */
const deleteFromCloudinary = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: 'image',
    });
    return result;
  } catch (error) {
    console.error('Cloudinary deletion error:', error);
    throw new Error('Failed to delete image from Cloudinary');
  }
};

/**
 * Extract public ID from Cloudinary URL
 * @param {String} url - The Cloudinary URL
 * @returns {String} - The public ID
 */
const extractPublicIdFromUrl = (url) => {
  if (!url) return null;

  try {
    // Parse URL to get the path
    const urlParts = url.split('/');
    const filename = urlParts[urlParts.length - 1];
    const publicId = filename.split('.')[0]; // Remove file extension

    // Get folder path if exists
    const folderStart = urlParts.indexOf('upload') + 1;
    const folderEnd = urlParts.length - 1;
    const folder = urlParts.slice(folderStart, folderEnd).join('/');

    return `${folder}/${publicId}`;
  } catch (error) {
    console.error('Error extracting public ID:', error);
    return null;
  }
};

module.exports = {
  uploadBufferToCloudinary,
  deleteFromCloudinary,
  extractPublicIdFromUrl,
};
