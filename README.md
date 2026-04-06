# GetShitDone - E-Commerce Platform

A modern, scalable e-commerce platform built with Express.js, MongoDB, and feature-based architecture.

## Project Structure

```
/src
  /config          → Environment configuration & validation
  /modules         → Feature modules (auth, users, products, etc.)
  /middlewares     → Global middlewares (auth, error handler, rate limiter)
  /utils           → Shared utilities (logger, asyncHandler, ApiError)
  /jobs            → Background job queues (Bull)
  /routes          → Central route aggregator
  app.js           → Express app configuration
  server.js        → Server entry point
```

## Setup & Installation

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Configuration

Create two environment files and configure them:

**Development (.env.dev)**
```bash
NODE_ENV=dev
PORT=5000
MONGODB_URI=mongodb://localhost:27017/getshitdone
JWT_SECRET=your_dev_secret_key
CORS_ORIGIN=http://localhost:3000
LOG_LEVEL=debug
```

**Production (.env.prod)**
```bash
NODE_ENV=prod
PORT=8080
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/getshitdone
JWT_SECRET=your_prod_secret_key
CORS_ORIGIN=https://yourdomain.com
LOG_LEVEL=info
```

### 3. Start Development Server
```bash
npm run dev
```

The server starts with auto-reload via `nodemon` and connects to MongoDB.

### 4. Build & Start Production
```bash
npm start
```

## Key Features Included

### Configuration Management
- Multi-environment support (.env.dev, .env.prod)
- Joi validation for all required env vars
- Centralized config exports in `src/config/index.js`
- Throws on missing critical variables

### Logging
- Winston logger with daily rotating files
- Separate error log files
- Console output in dev, file rotation in prod
- Uncaught exception and unhandled rejection handlers

### Error Handling
- Custom `ApiError` class with statusCode & details
- Global error middleware for consistent responses
- Supports MongoDB validation & duplicate key errors
- Joi validation error formatting

### Utilities
- `asyncHandler()` - Eliminates try/catch boilerplate in route handlers
- `ApiResponse` - Standard response wrapper across all endpoints
- `logger` - Centralized logging throughout the app

### Security & Performance
- Helmet.js for security headers
- CORS with configurable origin
- Rate limiting on /api routes
- Request compression
- Morgan request logging

### Code Quality Tools
- ESLint with recommended rules
- Prettier for code formatting
- Dev scripts: `npm run lint`, `npm run format`

## Available Scripts

```bash
npm run dev             # Development with hot-reload
npm start               # Production server
npm run lint            # Check code quality
npm run lint:fix        # Auto-fix linting issues
npm run format          # Format code with Prettier
```

## Completed Phases

### ✅ Phase 1: Project Foundation & Architecture
- Feature-based folder structure
- Environment configuration with validation
- Core utilities (asyncHandler, ApiError, ApiResponse)
- Winston logger with daily rotating files
- Global error handling middleware
- Security middleware (Helmet, CORS, rate limiting)
- Development scripts (lint, format)

### ✅ Phase 2: MongoDB & Data Modeling
- Production-grade MongoDB connection with pool management
- 7 core Mongoose schemas with best practices:
  - **User**: Authentication, profiles, addresses, refresh tokens
  - **Product**: Catalog with variants, ratings, images
  - **Category**: Hierarchical self-referencing structure
  - **Cart**: Shopping cart with TTL auto-cleanup
  - **Order**: Order management with payment tracking
  - **Review**: Product reviews with verified purchase flag
  - **Coupon**: Discount codes with usage limits
- All fields typed and validated
- Compound indexes for query optimization
- Password hashing with bcrypt (12 rounds)
- Prices stored as integers (cents) to avoid float precision bugs
- `mongoose-paginate-v2` plugin for cursor-based pagination
- Comprehensive validation schemas using Joi
- See [PHASE2_DATA_MODELING.md](./PHASE2_DATA_MODELING.md) for detailed documentation

## Next Steps

1. **Phase 3: Authentication & Authorization**
   - JWT token generation and refresh tokens
   - Login/signup routes with validation
   - Password reset flow
   - Token middleware for protected routes
   - Role-based access control (RBAC)

2. **Phase 4: API Routes & Controllers**
   - CRUD operations for each module
   - Business logic implementation
   - Request/response validation middleware
   - Error handling per endpoint

3. **Phase 5: Testing**
   - Unit tests for models and utilities
   - Integration tests for API routes
   - Mock data generators
   - Database seeding for development

## Example: Adding a New Module

### 1. Create Module Structure
```
/src/modules/products
  ├── model.js           # MongoDB schema
  ├── controller.js      # Business logic
  ├── routes.js          # Route definitions
  └── validation.js      # Joi schemas
```

### 2. Create Controller with asyncHandler
```javascript
// controller.js
const { asyncHandler, ApiError, ApiResponse } = require('../../utils');

exports.getProduct = asyncHandler(async (req, res) => {
  // No try/catch needed!
  const product = await Product.findById(req.params.id);
  if (!product) throw new ApiError(404, 'Product not found');
  res.status(200).json(new ApiResponse(200, product));
});
```

### 3. Register Routes
```javascript
// In src/routes/index.js
router.use('/products', require('../modules/products/routes'));
```

## API Response Format

All successful responses follow this format:
```json
{
  "statusCode": 200,
  "data": { ... },
  "message": "Success",
  "success": true
}
```

All errors return:
```json
{
  "statusCode": 400,
  "data": null,
  "message": "Error description",
  "success": false
}
```

## Logging

Logs are stored in `/logs/` with daily rotation:
- `app-YYYY-MM-DD.log` - All application logs
- `error-YYYY-MM-DD.log` - Error logs only
- `exceptions-YYYY-MM-DD.log` - Uncaught exceptions
- `rejections-YYYY-MM-DD.log` - Promise rejections

## License

ISC
