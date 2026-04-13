/**
 * Input Sanitization Helper
 *
 * Provides utilities for sanitizing user input to prevent:
 * - XSS (Cross-Site Scripting) attacks
 * - NoSQL/Script injection
 * - Malicious payload injection
 */

// ============================================
// DANGEROUS PATTERNS
// ============================================

/**
 * Patterns that could indicate XSS or script injection attempts
 */
const DANGEROUS_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /javascript:/gi,
  /vbscript:/gi,
  /onload\s*=/gi,
  /onerror\s*=/gi,
  /onclick\s*=/gi,
  /ondblclick\s*=/gi,
  /onmousedown\s*=/gi,
  /onmouseup\s*=/gi,
  /onmouseover\s*=/gi,
  /onmouseout\s*=/gi,
  /onfocus\s*=/gi,
  /onblur\s*=/gi,
  /onkeydown\s*=/gi,
  /onkeypress\s*=/gi,
  /onkeyup\s*=/gi,
  /onsubmit\s*=/gi,
  /<iframe/gi,
  /<embed/gi,
  /<object/gi,
  /<link/gi,
  /<meta/gi,
  /<style/gi,
  /@import/gi,
  /expression\s*\(/gi,
  /eval\s*\(/gi,
  /fromCharCode/gi,
  /innerHTML\s*=/gi,
  /outerHTML\s*=/gi,
  /document\.(write|writeln|open|close)/gi,
  /window\.location/gi,
  /\.cookie/gi,
];

// ============================================
// SANITIZATION FUNCTIONS
// ============================================

/**
 * Strip HTML tags from string
 * @param {string} input - Input string
 * @returns {string} Sanitized string without HTML tags
 */
function stripHtml(input) {
  if (!input || typeof input !== "string") return "";
  return input.replace(/<[^>]*>/g, "");
}

/**
 * Escape HTML special characters
 * @param {string} input - Input string
 * @returns {string} Escaped string
 */
function escapeHtml(input) {
  if (!input || typeof input !== "string") return "";
  const htmlMap = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#x27;",
    "/": "&#x2F;",
    "`": "&#x60;",
    "=": "&#x3D;",
  };
  return input.replace(/[&<>"'/=`]/g, (char) => htmlMap[char] || char);
}

/**
 * Check if string contains dangerous content
 * @param {string} input - Input string
 * @returns {boolean} True if dangerous content found
 */
function containsDangerousContent(input) {
  if (!input || typeof input !== "string") return false;

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(input)) {
      return true;
    }
  }

  return false;
}

/**
 * Sanitize string input
 * @param {string} input - Input string
 * @param {Object} options - Sanitization options
 * @returns {string} Sanitized string
 */
function sanitizeString(input, options = {}) {
  if (!input || typeof input !== "string") return "";

  const {
    maxLength = null,
    trim = true,
    removeHtml = true,
    lowercase = false,
  } = options;

  let sanitized = input;

  // Trim whitespace
  if (trim) {
    sanitized = sanitized.trim();
  }

  // Remove HTML tags
  if (removeHtml) {
    sanitized = stripHtml(sanitized);
  }

  // Apply maxLength
  if (maxLength && sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  // Convert to lowercase
  if (lowercase) {
    sanitized = sanitized.toLowerCase();
  }

  return sanitized;
}

/**
 * Sanitize name field (letters, spaces, hyphens, apostrophes only)
 * @param {string} input - Input name
 * @returns {string} Sanitized name
 */
function sanitizeName(input) {
  if (!input || typeof input !== "string") return "";
  const sanitized = input.trim();
  // Keep only letters, spaces, hyphens, apostrophes, and common accented characters
  return sanitized.replace(/[^a-zA-Z\s\u00C0-\u00FF\-'.]/g, "");
}

/**
 * Sanitize phone number (keep only digits and +)
 * @param {string} input - Input phone
 * @returns {string} Sanitized phone
 */
function sanitizePhone(input) {
  if (!input || typeof input !== "string") return "";
  // Keep only digits and +
  return input.replace(/[^\d+]/g, "");
}

/**
 * Sanitize email (lowercase and trim)
 * @param {string} input - Input email
 * @returns {string} Sanitized email
 */
function sanitizeEmail(input) {
  if (!input || typeof input !== "string") return "";
  return input.trim().toLowerCase();
}

/**
 * Sanitize numeric input
 * @param {string} input - Input string
 * @returns {string} Sanitized string with only digits and decimal point
 */
function sanitizeNumber(input) {
  if (!input || typeof input !== "string") return "";
  return input.replace(/[^\d.-]/g, "");
}

/**
 * Sanitize request body recursively
 * @param {Object} body - Request body
 * @param {Object} fieldRules - Rules for specific fields
 * @returns {Object} Sanitized body
 */
function sanitizeBody(body, fieldRules = {}) {
  if (!body || typeof body !== "object") return body;

  const sanitized = {};

  for (const [key, value] of Object.entries(body)) {
    if (value === null || value === undefined) {
      sanitized[key] = value;
      continue;
    }

    // Check if there's a specific rule for this field
    const rule = fieldRules[key];

    if (rule && typeof value === "string") {
      switch (rule.type) {
        case "name":
          sanitized[key] = sanitizeName(value);
          break;
        case "email":
          sanitized[key] = sanitizeEmail(value);
          break;
        case "phone":
          sanitized[key] = sanitizePhone(value);
          break;
        case "number":
          sanitized[key] = sanitizeNumber(value);
          break;
        case "text":
          sanitized[key] = sanitizeString(value, {
            maxLength: rule.maxLength,
            removeHtml: true,
          });
          break;
        default:
          sanitized[key] = sanitizeString(value);
      }
    } else if (typeof value === "string") {
      // Default string sanitization
      sanitized[key] = sanitizeString(value, {
        removeHtml: true,
      });
    } else if (typeof value === "object") {
      // Recursively sanitize nested objects
      sanitized[key] = Array.isArray(value)
        ? value.map((item) =>
            typeof item === "object" ? sanitizeBody(item, fieldRules) : item
          )
        : sanitizeBody(value, fieldRules);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Middleware to sanitize request body
 * @param {Object} fieldRules - Rules for specific fields
 * @returns {Function} Express middleware
 */
function sanitizeMiddleware(fieldRules = {}) {
  return (req, res, next) => {
    if (req.body && typeof req.body === "object") {
      req.body = sanitizeBody(req.body, fieldRules);
    }
    if (req.params && typeof req.params === "object") {
      req.params = sanitizeBody(req.params);
    }
    if (req.query && typeof req.query === "object") {
      req.query = sanitizeBody(req.query);
    }
    next();
  };
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  stripHtml,
  escapeHtml,
  containsDangerousContent,
  sanitizeString,
  sanitizeName,
  sanitizePhone,
  sanitizeEmail,
  sanitizeNumber,
  sanitizeBody,
  sanitizeMiddleware,
};
