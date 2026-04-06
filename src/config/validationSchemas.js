/**
 * Schema Validation Examples
 * Demonstrates Joi validation schemas for API request validation
 * Should be used in routes/controllers for request body validation
 */

const Joi = require('joi');

// ============================================
// USER VALIDATION SCHEMAS
// ============================================

const createUserSchema = Joi.object({
  email: Joi.string()
    .email()
    .required()
    .messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required',
    }),
  password: Joi.string()
    .min(8)
    .required()
    .messages({
      'string.min': 'Password must be at least 8 characters',
      'any.required': 'Password is required',
    }),
  firstName: Joi.string().trim(),
  lastName: Joi.string().trim(),
  phone: Joi.string().pattern(/^[0-9\-+()]+$/),
  role: Joi.string().valid('customer', 'admin', 'seller').default('customer'),
});

const updateUserSchema = Joi.object({
  firstName: Joi.string().trim(),
  lastName: Joi.string().trim(),
  phone: Joi.string().pattern(/^[0-9\-+()]+$/),
  profileImage: Joi.string().uri(),
}).min(1);

const addAddressSchema = Joi.object({
  street: Joi.string().required(),
  city: Joi.string().required(),
  state: Joi.string().required(),
  zipCode: Joi.string().required(),
  country: Joi.string().required(),
  isDefault: Joi.boolean().default(false),
});

// ============================================
// PRODUCT VALIDATION SCHEMAS
// ============================================

const createProductSchema = Joi.object({
  name: Joi.string()
    .required()
    .trim()
    .messages({
      'any.required': 'Product name is required',
    }),
  slug: Joi.string()
    .required()
    .lowercase()
    .trim()
    .messages({
      'any.required': 'Product slug is required',
    }),
  sku: Joi.string()
    .required()
    .uppercase()
    .messages({
      'any.required': 'SKU is required',
    }),
  description: Joi.string().trim(),
  price: Joi.number()
    .required()
    .min(0)
    .messages({
      'any.required': 'Price is required',
      'number.min': 'Price must be positive',
    }),
  discountPrice: Joi.number().min(0),
  stock: Joi.number().required().min(0),
  category: Joi.string().required().pattern(/^[0-9a-f]{24}$/), // MongoDB ObjectId
  images: Joi.array().items(
    Joi.object({
      url: Joi.string().uri().required(),
      alt: Joi.string(),
      isPrimary: Joi.boolean().default(false),
    })
  ),
  variants: Joi.array().items(
    Joi.object({
      name: Joi.string().required(),
      options: Joi.array().items(Joi.string()).required(),
    })
  ),
});

const updateProductSchema = Joi.object({
  name: Joi.string().trim(),
  description: Joi.string().trim(),
  price: Joi.number().min(0),
  discountPrice: Joi.number().min(0),
  stock: Joi.number().min(0),
  isActive: Joi.boolean(),
}).min(1);

// ============================================
// CART VALIDATION SCHEMAS
// ============================================

const addToCartSchema = Joi.object({
  product: Joi.string()
    .required()
    .pattern(/^[0-9a-f]{24}$/)
    .messages({
      'any.required': 'Product ID is required',
      'string.pattern.base': 'Invalid product ID',
    }),
  quantity: Joi.number()
    .required()
    .min(1)
    .max(999)
    .messages({
      'number.min': 'Quantity must be at least 1',
      'number.max': 'Maximum quantity is 999',
    }),
  selectedVariants: Joi.object().pattern(Joi.string(), Joi.string()),
});

const updateCartItemSchema = Joi.object({
  quantity: Joi.number()
    .required()
    .min(1)
    .max(999),
});

// ============================================
// ORDER VALIDATION SCHEMAS
// ============================================

const createOrderSchema = Joi.object({
  items: Joi.array()
    .items(
      Joi.object({
        product: Joi.string().required().pattern(/^[0-9a-f]{24}$/),
        quantity: Joi.number().required().min(1),
        price: Joi.number().required().min(0),
      })
    )
    .required()
    .min(1),
  shippingAddress: Joi.object({
    street: Joi.string().required(),
    city: Joi.string().required(),
    state: Joi.string().required(),
    zipCode: Joi.string().required(),
    country: Joi.string().required(),
    phone: Joi.string(),
  }).required(),
  paymentMethod: Joi.string()
    .valid('credit_card', 'debit_card', 'paypal', 'stripe', 'bank_transfer')
    .required(),
  couponCode: Joi.string().uppercase(),
});

const updateOrderStatusSchema = Joi.object({
  status: Joi.string()
    .valid('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded')
    .required(),
  note: Joi.string(),
});

// ============================================
// REVIEW VALIDATION SCHEMAS
// ============================================

const createReviewSchema = Joi.object({
  product: Joi.string()
    .required()
    .pattern(/^[0-9a-f]{24}$/),
  rating: Joi.number()
    .required()
    .min(1)
    .max(5)
    .messages({
      'number.min': 'Rating must be between 1 and 5',
      'number.max': 'Rating must be between 1 and 5',
    }),
  title: Joi.string().trim(),
  body: Joi.string().trim(),
  verifiedPurchase: Joi.boolean(),
});

// ============================================
// COUPON VALIDATION SCHEMAS
// ============================================

const createCouponSchema = Joi.object({
  code: Joi.string()
    .required()
    .uppercase()
    .trim()
    .messages({
      'any.required': 'Coupon code is required',
    }),
  type: Joi.string()
    .valid('percentage', 'fixed')
    .required(),
  value: Joi.number()
    .required()
    .min(0)
    .messages({
      'any.required': 'Discount value is required',
    }),
  maxDiscountAmount: Joi.number().min(0),
  minPurchaseAmount: Joi.number().min(0).default(0),
  maxUses: Joi.number()
    .required()
    .min(1),
  expiryDate: Joi.date()
    .required()
    .greater('now')
    .messages({
      'date.greater': 'Expiry date must be in the future',
    }),
  isActive: Joi.boolean().default(true),
  description: Joi.string(),
});

// ============================================
// AUTH VALIDATION SCHEMAS
// ============================================

const registerSchema = Joi.object({
  email: Joi.string()
    .email()
    .required()
    .lowercase()
    .trim()
    .messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required',
    }),
  password: Joi.string()
    .min(8)
    .required()
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .messages({
      'string.min': 'Password must be at least 8 characters',
      'string.pattern.base':
        'Password must contain at least one uppercase letter, one lowercase letter, and one number',
      'any.required': 'Password is required',
    }),
  firstName: Joi.string().trim(),
  lastName: Joi.string().trim(),
  phone: Joi.string().pattern(/^[0-9\-+()]+$/),
});

const loginSchema = Joi.object({
  email: Joi.string()
    .email()
    .required()
    .lowercase()
    .trim()
    .messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required',
    }),
  password: Joi.string()
    .required()
    .messages({
      'any.required': 'Password is required',
    }),
});

const verifyEmailSchema = Joi.object({
  token: Joi.string()
    .required()
    .messages({
      'any.required': 'Verification token is required',
    }),
});

const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string()
    .required()
    .messages({
      'any.required': 'Refresh token is required',
    }),
});

const forgotPasswordSchema = Joi.object({
  email: Joi.string()
    .email()
    .required()
    .lowercase()
    .trim()
    .messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required',
    }),
});

const resetPasswordSchema = Joi.object({
  token: Joi.string()
    .required()
    .messages({
      'any.required': 'Reset token is required',
    }),
  newPassword: Joi.string()
    .min(8)
    .required()
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .messages({
      'string.min': 'Password must be at least 8 characters',
      'string.pattern.base':
        'Password must contain at least one uppercase letter, one lowercase letter, and one number',
      'any.required': 'Password is required',
    }),
});

module.exports = {
  // Auth schemas
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,

  // User schemas
  createUserSchema,
  updateUserSchema,
  addAddressSchema,

  // Product schemas
  createProductSchema,
  updateProductSchema,

  // Cart schemas
  addToCartSchema,
  updateCartItemSchema,

  // Order schemas
  createOrderSchema,
  updateOrderStatusSchema,

  // Review schemas
  createReviewSchema,

  // Coupon schemas
  createCouponSchema,
};
