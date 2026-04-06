/**
 * User Schema
 * Stores user account information, roles, addresses, and refresh tokens
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        'Please provide a valid email address',
      ],
    },
    passwordHash: {
      type: String,
      required: true,
      minlength: 8,
      select: false, // Don't select by default for security
    },
    role: {
      type: String,
      enum: ['customer', 'admin', 'seller'],
      default: 'customer',
    },
    firstName: {
      type: String,
      trim: true,
    },
    lastName: {
      type: String,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    addresses: [
      {
        _id: false,
        street: String,
        city: String,
        state: String,
        zipCode: String,
        country: String,
        isDefault: { type: Boolean, default: false },
      },
    ],
    refreshTokens: [
      {
        _id: false,
        token: { type: String, required: true },
        createdAt: { type: Date, default: Date.now, expires: 604800 }, // 7 days TTL
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationToken: String,
    emailVerificationTokenExpiry: Date,
    passwordResetToken: String,
    passwordResetTokenExpiry: Date,
    lastLogin: Date,
    profileImage: String,
    // OAuth providers
    googleId: String,
    githubId: String,
    oauthProvider: {
      type: String,
      enum: ['local', 'google', 'github'],
      default: 'local',
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for email lookup and role-based queries
userSchema.index({ email: 1, isActive: 1 });
userSchema.index({ role: 1, isActive: 1 });
// OAuth lookups
userSchema.index({ googleId: 1 }, { sparse: true });
userSchema.index({ githubId: 1 }, { sparse: true });
// Email verification token cleanup
userSchema.index({ emailVerificationTokenExpiry: 1 }, { sparse: true, expireAfterSeconds: 0 });
userSchema.index({ passwordResetTokenExpiry: 1 }, { sparse: true, expireAfterSeconds: 0 });

// Hash password before saving
userSchema.pre('save', async function (next) {
  // Only hash if password is new or modified
  if (!this.isModified('passwordHash')) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(12);
    this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password
userSchema.methods.comparePassword = async function (plainPassword) {
  return bcrypt.compare(plainPassword, this.passwordHash);
};

// Method to get public data (exclude sensitive fields)
userSchema.methods.toJSON = function () {
  const userObject = this.toObject();
  delete userObject.passwordHash;
  delete userObject.refreshTokens;
  return userObject;
};

module.exports = mongoose.model('User', userSchema);
