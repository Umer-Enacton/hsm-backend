const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

// Configure storage with memory storage (we'll upload to Cloudinary directly from memory)
const storage = multer.memoryStorage();

// File filter to accept only images
const fileFilter = (req, file, cb) => {
  // Accept images only
  if (
    !file.originalname.match(/\.(jpg|JPG|jpeg|JPEG|png|PNG|gif|GIF|webp|WEBP)$/)
  ) {
    req.fileValidationError = "Only image files are allowed!";
    return cb(new Error("Only image files are allowed!"), false);
  }
  cb(null, true);
};

// Initialize multer with configuration
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 6 * 1024 * 1024, // 5MB max file size
  },
  fileFilter: fileFilter,
});

// Export different upload configurations for different use cases
module.exports = {
  // Single file upload
  single: (fieldName) => upload.single(fieldName),

  // Multiple files upload
  multiple: (fieldName, maxCount) => upload.array(fieldName, maxCount),

  // Upload single avatar
  avatar: upload.single("avatar"),

  // Upload business logo
  logo: upload.single("logo"),

  // Upload cover image
  coverImage: upload.single("coverImage"),

  // Upload service image
  serviceImage: upload.single("image"),

  // Upload category image
  categoryImage: upload.single("image"),

  // Upload multiple images
  multipleImages: upload.array("images", 5),
};
