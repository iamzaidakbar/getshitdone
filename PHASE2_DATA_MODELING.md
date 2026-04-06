# Phase 2: MongoDB & Data Modeling

## Overview

This phase establishes production-grade MongoDB setup with robust Mongoose schemas, optimization best practices, and data integrity.

## Database Connection

### Configuration

Connection established via `src/config/database.js` with production-grade settings:

```javascript
const connectDB = require('./config/database');
await connectDB();
```

**Settings:**
- **maxPoolSize**: 10 - Connection pool size
- **serverSelectionTimeoutMS**: 5000 - Server selection timeout
- **socketTimeoutMS**: 45000 - Socket timeout for long-running operations
- **retryWrites**: true - Automatic retry on transient errors
- **w: 'majority'** - Write concern for data durability

### Connection Lifecycle

- **Connected**: App initializes, models loaded
- **Error**: Logged via Winston, process exit triggered
- **Disconnected**: Warning logged, auto-reconnect attempted
- **Reconnected**: Success logged

Monitor connection status in logs:
```bash
tail -f logs/app-YYYY-MM-DD.log | grep MongoDB
```

---

## Schema Architecture

### Naming Conventions

- **Collections**: Plural (users, products, orders)
- **Fields**: camelCase (firstName, emailVerified)
- **Enums**: lowercase (pending, confirmed, shipped)
- **Prices**: Stored as integers in cents (e.g., $19.99 = 1999)

### Common Patterns

#### Timestamps

Every schema includes:
```javascript
timestamps: true  // Adds createdAt, updatedAt automatically
```

#### Virtuals

Non-stored computed fields:
```javascript
schema.virtual('discountPercentage').get(function() {
  return Math.round(((this.price - this.discountPrice) / this.price) * 100);
});

// In responses:
schema.set('toJSON', { virtuals: true });
```

#### Indexes

Strategic compound indexes for common query patterns:
```javascript
schema.index({ category: 1, price: 1, stock: 1 });
schema.index({ user: 1, isActive: 1 });
```

---

## Core Schemas

### 1. User Schema

**Location**: `src/modules/users/model.js`

**Purpose**: User accounts, authentication, and profiles

**Key Fields:**
| Field | Type | Notes |
|-------|------|-------|
| email | String | Unique, lowercase, validated |
| passwordHash | String | Bcrypt hashed (12 rounds), not selected by default |
| role | Enum | customer, admin, seller |
| firstName, lastName | String | User name |
| phone | String | Contact number |
| addresses | Array | Multiple addresses, one can be default |
| refreshTokens | Array | JWT refresh tokens with 7-day TTL |
| emailVerified | Boolean | Email verification status |
| isActive | Boolean | Account status |
| lastLogin | Date | Last login timestamp |

**Indexes:**
```javascript
{ email: 1, isActive: 1 }           // Email lookups
{ role: 1, isActive: 1 }            // Role-based queries
```

**Methods:**
```javascript
user.comparePassword(plainPassword)  // Compare plain text to hash
user.toJSON()                        // Return public data (no passwordHash)
```

**Pre-Save Hook:**
- Auto-hashes passwordHash with bcrypt (12 rounds)
- Only runs if password is modified

**Example Usage:**
```javascript
const User = require('./modules/users/model');

// Create user
const user = new User({
  email: 'user@example.com',
  passwordHash: 'plainPassword123',  // Will be hashed
  role: 'customer',
  firstName: 'John'
});
await user.save();

// Authenticate
const isMatch = await user.comparePassword('plainPassword123');

// Get public data
const publicData = user.toJSON();  // passwordHash excluded
```

---

### 2. Product Schema

**Location**: `src/modules/products/model.js`

**Purpose**: Product catalog with variants and ratings

**Key Fields:**
| Field | Type | Notes |
|-------|------|-------|
| name | String | Product title |
| slug | String | URL-friendly name, unique |
| sku | String | Stock keeping unit, unique, uppercase |
| description | String | Product details |
| price | Number | Price in cents (1999 = $19.99) |
| discountPrice | Number | Sale price in cents |
| stock | Number | Available quantity |
| category | ObjectId | Reference to Category |
| images | Array | Product photos with alt text |
| variants | Array | Size/color/etc. options |
| ratings | Object | Average rating and count |
| seller | ObjectId | Reference to User (seller) |
| isActive | Boolean | Product availability |

**Virtuals:**
- `discountPercentage` - Calculated discount %

**Indexes:**
```javascript
{ category: 1, price: 1, stock: 1 }  // Category browsing with price filters
{ slug: 1 }                          // URL lookups
{ sku: 1 }                           // Inventory management
{ seller: 1, isActive: 1 }           // Seller's active products
{ 'ratings.average': -1 }            // Popular products sort
```

**Pagination**: Uses `mongoose-paginate-v2` for cursor-based pagination

**Example Usage:**
```javascript
const Product = require('./modules/products/model');

// Create product
const product = new Product({
  name: 'Gaming Laptop',
  slug: 'gaming-laptop-pro',
  sku: 'LP-GAMING-001',
  price: 139999,  // $1,399.99
  stock: 50,
  category: categoryId,
  images: [
    { url: '/images/prod1.jpg', alt: 'Front view', isPrimary: true },
    { url: '/images/prod2.jpg', alt: 'Side view' }
  ],
  variants: [
    { name: 'Color', options: ['Silver', 'Black', 'Gold'] },
    { name: 'RAM', options: ['8GB', '16GB', '32GB'] }
  ]
});

// Paginate products
const page = await Product.paginate(
  { category: categoryId, isActive: true },
  { page: 1, limit: 20, sort: { 'ratings.average': -1 } }
);
```

---

### 3. Category Schema

**Location**: `src/modules/categories/model.js`

**Purpose**: Hierarchical product categories

**Key Fields:**
| Field | Type | Notes |
|-------|------|-------|
| name | String | Category title |
| slug | String | URL-friendly name, unique |
| description | String | Category details |
| image | String | Category image URL |
| parent | ObjectId | Self-reference for nested categories |
| isActive | Boolean | Category availability |
| displayOrder | Number | Sort order |

**Virtuals:**
- `path` - Breadcrumb category path [root → parent → child]

**Indexes:**
```javascript
{ parent: 1, isActive: 1 }  // Get active subcategories
{ slug: 1 }                 // URL lookups
```

**Self-Referencing Hierarchy:**
```
Electronics (no parent)
├── Computers (parent: Electronics)
│   ├── Laptops (parent: Computers)
│   ├── Desktops (parent: Computers)
└── Mobile (parent: Electronics)
```

**Example Usage:**
```javascript
const Category = require('./modules/categories/model');

// Create root category
const electronics = new Category({
  name: 'Electronics',
  slug: 'electronics'
});
await electronics.save();

// Create subcategory
const laptops = new Category({
  name: 'Laptops',
  slug: 'laptops',
  parent: electronics._id
});
await laptops.save();

// Get breadcrumb path
const path = await laptops.path;
// [{ id: electronics._id, name: 'Electronics' }, 
//  { id: laptops._id, name: 'Laptops' }]
```

---

### 4. Cart Schema

**Location**: `src/modules/cart/model.js`

**Purpose**: Shopping cart with automatic expiration

**Key Fields:**
| Field | Type | Notes |
|-------|------|-------|
| user | ObjectId | Reference to User, unique |
| items | Array | Cart line items |
| items[].product | ObjectId | Reference to Product |
| items[].quantity | Number | Qty ordered |
| items[].price | Number | Price snapshot in cents |
| items[].selectedVariants | Map | Chosen variant options |
| expiresAt | Date | Auto-delete after 30 days (TTL) |

**Virtuals:**
- `itemCount` - Total number of items
- `totalPrice` - Total cart value in cents

**Indexes:**
```javascript
{ expiresAt: 1 }  // TTL index for auto-cleanup
{ user: 1 }       // User's cart lookup
```

**TTL Index**: Automatically deletes carts 30 days after creation

**Example Usage:**
```javascript
const Cart = require('./modules/cart/model');

// Create/update cart
let cart = await Cart.findOne({ user: userId });
if (!cart) {
  cart = new Cart({ user: userId });
}

cart.items.push({
  product: productId,
  quantity: 2,
  price: 1999,  // $19.99
  selectedVariants: { Color: 'Silver', RAM: '16GB' }
});
await cart.save();

// Get cart totals
console.log(cart.itemCount);   // 2
console.log(cart.totalPrice);  // 3998 (2 × 1999)
```

---

### 5. Order Schema

**Location**: `src/modules/orders/model.js`

**Purpose**: Order management with payment and shipping tracking

**Key Fields:**
| Field | Type | Notes |
|-------|------|-------|
| orderNumber | String | Unique order ID |
| user | ObjectId | Reference to User |
| items | Array | Order line items (from cart) |
| shippingAddress | Object | Delivery location |
| status | Enum | pending → delivered |
| payment.method | Enum | credit_card, paypal, stripe, etc. |
| payment.status | Enum | pending, processing, completed, failed |
| payment.amount | Number | Total in cents |
| pricing | Object | Breakdown: subtotal, shipping, tax, discount, total |
| timeline | Array | Status change history |
| coupon | ObjectId | Reference to applied Coupon |

**Status Flow:**
```
pending → confirmed → processing → shipped → delivered
                            ↓
                         refunded (if needed)
```

**Indexes:**
```javascript
{ user: 1, status: 1 }          // User's orders by status
{ orderNumber: 1 }              // Quick lookup
{ 'payment.status': 1 }         // Payment queries
{ createdAt: -1 }               // Recent orders
```

**Pagination**: Uses `mongoose-paginate-v2`

**Example Usage:**
```javascript
const Order = require('./modules/orders/model');

// Create order from cart
const order = new Order({
  orderNumber: `ORD-${Date.now()}`,
  user: userId,
  items: cartItems,
  shippingAddress: {
    street: '123 Main St',
    city: 'NYC',
    state: 'NY',
    zipCode: '10001',
    country: 'USA'
  },
  payment: {
    method: 'credit_card',
    status: 'processing',
    transactionId: 'txn_123456',
    amount: 39999
  },
  pricing: {
    subtotal: 39999,
    shipping: 1000,
    tax: 3200,
    discount: 2000,
    total: 42199
  },
  timeline: [{
    status: 'pending',
    note: 'Order placed'
  }]
});
await order.save();

// Update order status
order.status = 'shipped';
order.timeline.push({
  status: 'shipped',
  note: 'Shipped via FedEx - Tracking #123456'
});
await order.save();
```

---

### 6. Review Schema

**Location**: `src/modules/reviews/model.js`

**Purpose**: Product reviews and ratings

**Key Fields:**
| Field | Type | Notes |
|-------|------|-------|
| user | ObjectId | Reference to User |
| product | ObjectId | Reference to Product |
| rating | Number | 1-5 rating |
| title | String | Review headline |
| body | String | Review content |
| verifiedPurchase | Boolean | Reviewer bought the product |
| helpful, unhelpful | Number | Upvote/downvote counts |
| isApproved | Boolean | Moderation status |

**Constraints:**
- Unique index on (user, product) - one review per user per product

**Indexes:**
```javascript
{ product: 1, isApproved: 1 }  // Product reviews
{ user: 1, product: 1 }        // User hasn't reviewed already
{ rating: -1 }                 // High-rated first
{ verifiedPurchase: 1 }        // Filter verified reviews
```

**Pagination**: Uses `mongoose-paginate-v2`

**Example Usage:**
```javascript
const Review = require('./modules/reviews/model');

// Create review
const review = new Review({
  user: userId,
  product: productId,
  rating: 5,
  title: 'Excellent Quality!',
  body: 'Great laptop, very fast and quiet. Highly recommend!',
  verifiedPurchase: true  // User bought this product
});
await review.save();

// Get product reviews (paginated)
const reviews = await Review.paginate(
  { product: productId, isApproved: true },
  { page: 1, limit: 10, sort: { helpful: -1 } }
);
```

---

### 7. Coupon Schema

**Location**: `src/modules/payments/model.js`

**Purpose**: Discount codes and promotional coupons

**Key Fields:**
| Field | Type | Notes |
|-------|------|-------|
| code | String | Coupon code, unique, uppercase |
| type | Enum | percentage or fixed |
| value | Number | Discount % or amount in cents |
| maxDiscountAmount | Number | Cap on discount (for % coupons) |
| minPurchaseAmount | Number | Minimum order value required |
| maxUses | Number | Total usage limit |
| usedCount | Number | Times used so far |
| expiryDate | Date | When coupon expires |
| applicableCategories | Array | Categories where valid (null = all) |
| applicableProducts | Array | Products where valid (null = all) |
| applicableUsers | Array | Users allowed (null = all) |
| isActive | Boolean | Currently available |

**Virtuals:**
- `isExpired` - Check if past expiryDate
- `canUse` - Check if still available and not expired

**Example Usage:**
```javascript
const Coupon = require('./modules/payments/model');

// Create coupon
const coupon = new Coupon({
  code: 'SUMMER2024',
  type: 'percentage',
  value: 15,  // 15% off
  maxDiscountAmount: 5000,  // Max $50 discount
  minPurchaseAmount: 2000,  // Min $20 order
  maxUses: 1000,
  expiryDate: new Date('2024-08-31'),
  isActive: true
});
await coupon.save();

// Check if valid
if (coupon.canUse && !coupon.isExpired && coupon.usedCount < coupon.maxUses) {
  // Apply discount
}
```

---

## Best Practices Applied

### 1. **Timestamps**
Every schema includes `timestamps: true` for audit trails

### 2. **Password Security**
- Bcrypt hashing with 12 rounds (takes ~250ms per hash)
- Never select by default (`select: false`)
- Pre-save hook handles hashing

### 3. **Prices as Integers**
Store all prices in cents to avoid float precision bugs:
```javascript
$19.99  → 1999
$100    → 10000
```

### 4. **Compound Indexes**
Strategic multi-field indexes for common query patterns:
```javascript
{ category: 1, price: 1, stock: 1 }
{ user: 1, status: 1 }
```

### 5. **Pagination**
`mongoose-paginate-v2` for cursor-based pagination from day 1:
```javascript
Product.paginate({ active: true }, { page: 1, limit: 20, sort: _id: 1 })
```

### 6. **TTL Indexes**
Automatic cleanup of expired data:
```javascript
{ expiresAt: 1 }, { expireAfterSeconds: 0 }  // Cart cleanup
```

### 7. **Virtuals**
Computed fields that aren't stored:
```javascript
schema.virtual('discountPercentage').get(...)
schema.set('toJSON', { virtuals: true })
```

### 8. **Enums**
Restrict field values to known states:
```javascript
status: { type: String, enum: ['pending', 'completed'] }
```

---

## Importing Models

### Single Model
```javascript
const User = require('../modules/users/model');
```

### All Models
```javascript
const { User, Product, Category, Cart, Order, Review, Coupon } = require('../config/models');
```

---

## Schema Validation

All schemas validate on save:
- Required fields throw error if missing
- Enums only allow specified values
- Min/max constraints enforced
- Custom regex patterns (email, phone)

---

## Query Patterns

### Find with Population
```javascript
const order = await Order.findById(orderId)
  .populate('user', 'email firstName lastName')
  .populate('items.product', 'name price image');
```

### Pagination
```javascript
const page = await Product.paginate(
  { category: catId, isActive: true },
  { page: 1, limit: 20, sort: { 'ratings.average': -1 } }
);
```

### Bulk Operations
```javascript
await User.updateMany({ role: 'customer' }, { isActive: true });
await Cart.deleteMany({ user: userId });
```

---

## Next Steps

1. **Phase 3**: Authentication & Authorization
   - JWT token generation and validation
   - Login/signup routes
   - Password reset flow

2. **Phase 4**: API Routes & Controllers
   - CRUD operations for each module
   - Request/response validation
   - Business logic implementation

3. **Phase 5**: Testing
   - Unit tests for models
   - Integration tests for routes
   - Data validation tests
