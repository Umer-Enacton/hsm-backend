const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/upload.controller');
const { avatar, logo, coverImage, serviceImage, categoryImage } = require('../config/multer');
const auth = require('../middleware/auth');

// Upload routes (protected - require authentication)
router.post('/avatar', auth, avatar, uploadController.uploadAvatar);
router.post('/logo', auth, logo, uploadController.uploadLogo);
router.post('/cover-image', auth, coverImage, uploadController.uploadCoverImage);
router.post('/service-image', auth, serviceImage, uploadController.uploadServiceImage);
router.post('/category-image', auth, categoryImage, uploadController.uploadCategoryImage);

// Delete image route (protected)
router.delete('/:publicId', auth, uploadController.deleteImage);

module.exports = router;
