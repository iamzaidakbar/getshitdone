# Security Features Quick Reference

## For Developers - How to Use Security Features

### 1. Input Validation on Routes

#### Using Joi Schema (Recommended):

```javascript
// In src/routes/example.js
const express = require('express');
const { validateRequest } = require('../utils/sanitizer');
const { exampleSchema } = require('../config/validationSchemas');

const router = express.Router();

// Validate request body automatically
router.post('/example', 
  validateRequest(exampleSchema),
  controller.handle
);

// exampleSchema in validationSchemas.js:
const exampleSchema = Joi.object({
  email: Joi.string().email().lowercase().required(),
  password: Joi.string().min(8).required(),
  name: Joi.string().max(100),
});
```

#### Manual Validation:

```javascript
const { validateEmail, validatePassword } = require('../utils/sanitizer');

// Validate email
const emailResult = validateEmail('user@example.com');
if (emailResult.error) {
  return res.status(400).json({ error: emailResult.error });
}
const validEmail = emailResult.email;

// Validate password
const passwordResult = validatePassword('MyPass123!');
if (passwordResult.error) {
  return res.status(400).json({ error: passwordResult.error });
}
```

---

### 2. Input Sanitization

```javascript
const { sanitizeInput, sanitizeSearchQuery } = require('../utils/sanitizer');

// Sanitize user input (trim, remove null bytes, limit length)
const clean = sanitizeInput(userInput);

// Sanitize search queries (prevent NoSQL injection)
const cleanQuery = sanitizeSearchQuery(req.query);
```

---

### 3. Data Validation Helpers

```javascript
const sanitizer = require('../utils/sanitizer');

// Email validation
const { email, error: emailError } = sanitizer.validateEmail('test@test.com');

// Password validation
const { value: password, error: pwdError } = sanitizer.validatePassword('MyPass123!');

// MongoDB ObjectId validation
const isValid = sanitizer.validateObjectId('507f1f77bcf86cd799439011');

// Pagination validation
const { page, limit, error: paginationError } = sanitizer.validatePagination(1, 20);

// Safe JSON parsing
const { data, error: parseError } = sanitizer.parseJSON(jsonString);
```

---

### 4. Logging Without Data Leaks

```javascript
const { logger } = require('../utils');

// ✅ SAFE - Email is OK to log
logger.info('User created', { email: user.email, id: user._id });

// ❌ UNSAFE - Password will be logged (DON'T DO THIS)
// The automatic redaction catches this, but don't assume it works
logger.info('User registered', { email, password, token });

// ✅ GOOD - Only log safe data
logger.info('Authentication attempt', { 
  email: user.email,
  timestamp: new Date(),
  ipAddress: req.ip
});
```

**Automatically Redacted Fields** (no need to manually filter):
- password, pwd, pass
- token, accessToken, refreshToken
- secret, secretKey, privateKey
- apiKey, api_key
- creditCard, cardNumber, cvv
- ssn, socialSecurityNumber
- authorization, bearer
- resetToken, verificationCode, otp
- stripeKey, awsSecret

---

### 5. Rate Limiting is Automatic

**No code changes needed!** Rate limiting is applied globally:

```
GET/POST /api/* → 100 req/15 min (global)
POST /api/v1/auth/login → 5 req/15 min (auth)
POST /api/v1/auth/register → 5 req/15 min (auth)
POST /api/v1/auth/password-reset → 10 req/hour (sensitive)
```

**Response when rate limited**:
```json
{
  "statusCode": 429,
  "message": "Too many requests. Please try again later.",
  "success": false
}
```

**Check rate limit status in response headers**:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1234567890
```

---

### 6. Security Headers are Automatic

All HTTP security headers are set automatically by Helmet. No code needed.

**Headers added**:
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- X-XSS-Protection: 1; mode=block
- Strict-Transport-Security: max-age=31536000
- Content-Security-Policy: [...]
- Referrer-Policy: strict-no-referrer

**Verify in browser DevTools**:
1. Open Network tab
2. Click on any API response
3. Look at Response Headers
4. See security headers set

---

### 7. CORS is Configured with Allowlist

**No code changes needed!** CORS is configured in app.js with explicit origins.

**Configure allowed origins**:
```bash
# .env
CORS_ORIGINS=http://localhost:3000,https://example.com
```

**Never use wildcard (*) origin!**

---

### 8. Testing Security Features

### Run All Security Tests:
```bash
npm test -- src/tests/security.test.js
```

### Test Specific Feature:
```bash
npm test -- src/tests/security.test.js -t "Rate Limiting"
npm test -- src/tests/security.test.js -t "Input Validation"
npm test -- src/tests/security.test.js -t "Helmet"
```

### Run with Coverage:
```bash
npm test -- src/tests/security.test.js --coverage
```

---

### 9. Common Patterns

#### Pattern 1: Validate and Sanitize Input

```javascript
// Route
router.post('/users', validateRequest(userSchema), async (req, res) => {
  // req.validatedBody contains sanitized, validated data
  const user = await User.create(req.validatedBody);
  
  // Log safely (sensitive data auto-redacted)
  logger.info('User created', { email: user.email, id: user._id });
  
  return res.json(user);
});
```

#### Pattern 2: Verify Email and Password

```javascript
// Direct validation in controller
const { email, error: emailError } = validateEmail(req.body.email);
if (emailError) {
  return res.status(400).json({ error: emailError.message });
}

const { error: pwdError } = validatePassword(req.body.password);
if (pwdError) {
  return res.status(400).json({ error: pwdError.message });
}

// Use validated data
const user = await User.create({ email, password: hash(req.body.password) });
```

#### Pattern 3: Safe Logging with Sensitive Data

```javascript
// ✅ GOOD - Automatic redaction handles it
logger.info('Login attempt', {
  email: 'user@test.com',
  password: 'willBeRedacted', // This gets redacted automatically
  ip: req.ip,
  timestamp: new Date()
});

// Result in logs:
// {
//   "email": "user@test.com",
//   "password": "[REDACTED]",  // ← Automatically redacted
//   "ip": "192.168.1.1",
//   "timestamp": "2024-01-15T10:30:00Z"
// }
```

#### Pattern 4: Paginated Query with Validation

```javascript
const { page, limit } = req.query;

// Validate pagination parameters
const { page: validPage, limit: validLimit, error } = 
  validatePagination(parseInt(page) || 1, parseInt(limit) || 10);

if (error) {
  return res.status(400).json({ error: error.message });
}

// Safe to use validated values
const skip = (validPage - 1) * validLimit;
const results = await Collection.find().skip(skip).limit(validLimit);
```

---

### 10. Environment Configuration

```bash
# .env (development)
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://localhost:27017/getshitdone
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
JWT_SECRET=dev-secret-key
JWT_EXPIRE_IN=24h

# .env (production)
NODE_ENV=production
PORT=3000
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/getshitdone
CORS_ORIGINS=https://example.com,https://www.example.com
JWT_SECRET=production-secret-key-very-long-and-random
JWT_EXPIRE_IN=24h
```

---

### 11. Checking Security Compliance

```bash
# Check npm vulnerabilities
npm audit

# Run security tests
npm test -- src/tests/security.test.js

# Verify syntax of security modules
node -c src/utils/security.js
node -c src/utils/sanitizer.js

# Check app loads without errors
NODE_ENV=dev npm start 2>&1 | head -20
```

---

### 12. Debugging Security Issues

#### Rate Limit Not Working?
```javascript
// Check trust proxy is set
app.set('trust proxy', 1); // ✅ Should be set

// Check rate limiter is applied
app.use('/api/', security.globalLimiter); // ✅ Should be applied
```

#### Validation Not Working?
```javascript
// Check middleware is applied
router.post('/endpoint', validateRequest(schema), controller);

// Check schema is correct
const schema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
});

// Check controller receives validated data
console.log(req.validatedBody); // Should be sanitized
```

#### Headers Not Showing?
```javascript
// Check helmet is applied early in middleware stack
app.use(helmet()); // Should be first

// Verify in browser DevTools
// Network tab → Click response → Response Headers → Look for security headers
```

#### Sensitive Data Still Logging?
```javascript
// Check logger redaction is enabled
const redactedMeta = redactSensitive(meta); // ✅ Should be applied

// Add to sensitive keys if needed
const sensitiveKeys = ['newKeyName', ...existing];

// Test redaction
logger.info('Test', { password: 'hidden' }); // Should show [REDACTED]
```

---

### 13. Production Checklist

Before deploying to production:

```markdown
## Security Pre-Deployment Checklist

- [ ] All validation schemas defined
- [ ] No hardcoded secrets in code
- [ ] Environment variables configured
- [ ] npm audit reviewed (no critical vulnerabilities)
- [ ] Security tests passing (npm test)
- [ ] HTTPS enabled
- [ ] CORS origins configured (not wildcard)
- [ ] Rate limiting verified on auth routes
- [ ] Logging configured (sensitive data redacted)
- [ ] Helmet headers verified
- [ ] Database encrypted
- [ ] Backups scheduled
- [ ] Monitoring configured
- [ ] Incident response plan documented
```

---

### 14. Quick Command Reference

```bash
# Test security features
npm test -- src/tests/security.test.js

# Check for vulnerabilities
npm audit

# Start in dev mode
npm run dev

# Lint code
npm run lint

# Fix linting issues
npm run lint:fix

# Format code
npm run format

# Check syntax
node -c src/app.js
node -c src/utils/security.js
node -c src/utils/sanitizer.js
```

---

## Security Principles to Remember

### ✅ DO:
- Validate all input
- Sanitize all output
- Log safely (no passwords/tokens)
- Use HTTPS in production
- Keep dependencies updated
- Review security logs regularly
- Use strong passwords (8+ chars, mixed case, numbers, symbols)
- Enable CORS only for trusted origins
- Implement rate limiting on sensitive endpoints
- Test security features before deployment

### ❌ DON'T:
- Commit secrets to version control
- Use wildcard CORS origins (*)
- Log passwords, tokens, or PII
- Trust client-side validation
- Use deprecated packages
- Skip npm audit results
- Hard-code security settings
- Disable security headers
- Use HTTP in production
- Ignore security warnings

---

## Where to Find More Information

1. **PHASE7_SECURITY.md** — Detailed implementation guide
2. **PHASE7_SUMMARY.md** — Completion summary and status
3. **src/utils/security.js** — Security middleware source code
4. **src/utils/sanitizer.js** — Validation functions source code
5. **src/tests/security.test.js** — Test examples and patterns
6. **OWASP Top 10** — Industry standard security guidelines

---

**All security features are production-ready and fully integrated.**

**Questions? Check the documentation or security test file for examples.**
