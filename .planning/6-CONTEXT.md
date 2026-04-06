# Phase 6: Caching, Queues & Background Jobs — Context

**Phase Number**: 6  
**Goal**: Performance and reliability at scale  
**Status**: Discussion Complete — Ready for Planning  

---

## Summary

Build a production-ready caching layer (Redis) and job queue system (Bull MQ) to handle:
- High-frequency reads via cache-aside pattern
- Asynchronous background jobs (email, inventory, image processing, analytics)
- Real-time queue monitoring via Bull Board
- Graceful degradation when cache/queue unavailable

---

## Technology Stack

### Dependencies Already Installed
- ✅ `bull` (v4.16.5) — Job queue engine
- ✅ `redis` (v5.11.0) — Redis client
- ℹ️ Note: User specified `ioredis`, but project uses `redis` client package

### Dependencies to Install
- `bull-board` — Web UI for queue monitoring
- `sharp` — Image processing library
- `aws-sdk` or `@aws-sdk/client-s3` — AWS S3 integration (for image storage)
- `ioredis` — (Optional: migration from `redis` to `ioredis` if higher performance needed)

---

## Locked Decisions

### 1. Redis Caching Strategy

**Pattern**: Cache-Aside (Lazy Loading)
```
GET request
  ├─ Check Redis cache
  ├─ IF MISS:
  │  ├─ Load from MongoDB
  │  ├─ Write to Redis (TTL: 5 min)
  │  └─ Return
  └─ IF HIT:
     └─ Return from cache (no DB query)
```

**Cache Key Namespacing**:
- Products: `product:${productId}`
- Product listings: `products:list:${page}:${limit}:${sort}`
- Categories: `category:${categoryId}`
- Category tree: `categories:tree`

**TTL**: 5 minutes for all cached data

**Failure Handling**: Fallback to Database
- If Redis unavailable (connection error, timeout), catch exception
- Log warn-level message with context
- Continue without cache (slower, but functional)
- Eventually consistent — cache rebuilt when TTL expires

---

### 2. Cache Invalidation

**Strategy**: Event-Driven (Decoupled Pattern)

**Flow**:
```
Product.save() → POST-SAVE HOOK → Emit 'cache:invalidate' event
                                 ↓
                        Cache Service Listens
                                 ↓
                        Clear related cache keys:
                        - product:<id>
                        - products:list:* (all listings)
                        - categories:tree (may affect category counts)
```

**Implementation**:
- Create centralized EventEmitter in `src/utils/events.js`
- Model post-hooks emit cache invalidation events
- Cache service listens and clears keys
- Provides decoupling (models don't need to know about cache)

**Invalidation Triggers**:
- `Product.save()` → Invalidate `product:${id}` + `products:list:*`
- `Category.save()` → Invalidate `category:${id}` + `categories:tree`
- `Product.deleteOne()` → Invalidate `product:${id}` + `products:list:*`

---

### 3. Job Queue Organization

**Strategy**: Hybrid (Time-Sensitive vs Batch)

**Separate Queues** (Time-Sensitive, Fast Workers):
- **email** — Order confirmations, shipping updates, password resets
  - Priority: High
  - Max concurrency: 5 workers
  - Timeout: 30 seconds
  - Retries: 3 attempts with exponential backoff

- **inventory** — Low-stock alerts, restock notifications, stock updates
  - Priority: High
  - Max concurrency: 3 workers
  - Timeout: 20 seconds
  - Retries: 5 attempts

**Batch Queues** (Lower Priority, Scheduled):
- **images** — Image resizing/compression after upload
  - Processing: Sharp library
  - Storage: AWS S3
  - Max concurrency: 2 workers (resource-intensive)
  - Timeout: 60 seconds
  - Retries: 3 attempts

- **analytics** — View & purchase event logging
  - Batch insert every 30 seconds
  - Max concurrency: 1 worker
  - Bulk writes to MongoDB
  - Retries: 5 attempts (eventual consistency acceptable)

**Queue Configuration**:
```javascript
emailQueue = new Queue('email', redisConfig)
inventoryQueue = new Queue('inventory', redisConfig)
imagesQueue = new Queue('images', redisConfig)
analyticsQueue = new Queue('analytics', redisConfig)

// Each queue has independent workers, scaling, and retry logic
```

---

### 4. Job Types & Schemas

**Email Queue**:
```javascript
{
  jobType: 'order-confirmation' | 'shipping-update' | 'password-reset',
  orderId?: ObjectId,
  userId: ObjectId,
  email: String,
  templateData: Object,
  retryCount: 0
}
```

**Inventory Queue**:
```javascript
{
  jobType: 'low-stock-alert' | 'restock-notification' | 'stock-update',
  productId: ObjectId,
  currentStock: Number,
  threshold?: Number,
  userId?: ObjectId,
  retryCount: 0
}
```

**Images Queue**:
```javascript
{
  jobType: 'process-image',
  uploadId: ObjectId,
  sourceUrl: String,
  operations: ['resize', 'compress'],
  dimensions?: { width, height },
  retryCount: 0
}
```

**Analytics Queue**:
```javascript
{
  jobType: 'log-event',
  eventType: 'view' | 'purchase' | 'search' | 'add-to-cart',
  userId?: ObjectId,
  productId?: ObjectId,
  sessionId: String,
  timestamp: Date,
  metadata: Object
}
```

---

### 5. Bull Board (Queue Monitoring)

**Route**: `/api/admin/queues`

**Authentication**: Requires admin role (requireAuth + adminOnly middleware)

**Features**:
- Real-time queue status
- Job history and logs
- Failed job management
- Queue pause/resume
- Job retry controls

**Security**:
- Protected by JWT + role-based access control (admin only)
- Not exposed in production without authentication
- Audit logging for queue operations

---

### 6. Password Reset Token Management

**Storage**: Redis (Time-Limited)

**Flow**:
```
User requests password reset
  ├─ Generate token: crypto.randomBytes(32).toString('hex')
  ├─ Store in Redis: key = 'passwordReset:${userId}:${token}'
  ├─ TTL: 15 minutes
  ├─ Send email with reset link
  └─ User clicks link
     └─ Verify token in Redis
     └─ IF exists: allow reset, delete token
     └─ IF expired: 400 Bad Request with retry option
```

**Benefits**:
- Fast verification (no DB query)
- Automatic cleanup (TTL expiry)
- No permanent records
- High throughput

---

### 7. Image Processing Pipeline

**Library**: Sharp (Node.js image library)

**Storage**: AWS S3

**Flow**:
```
User uploads image
  ├─ Save original to temporary location
  ├─ Queue image processing job (Bull)
  │  ├─ Job picks: resize (recommended dimensions)
  │  └─ Compress (quality: 80%)
  ├─ Processing worker:
  │  ├─ Download from temp storage
  │  ├─ Transform with Sharp
  │  ├─ Upload to S3 (separate bucket: product-images)
  │  └─ Update database with S3 URL
  └─ Return to user (async, may show "Processing..." state)
```

**Processed Versions**:
- Thumbnail: 200x200 (for listings)
- Medium: 600x600 (for product detail)
- Large: 1200x1200 (for lightbox/zoom)

**S3 Configuration**:
- Bucket: `${APP_NAME}-product-images`
- Folder structure: `products/${productId}/${filename}-{size}.jpg`
- Public ACL for serving images via CloudFront
- Lifecycle policy: Delete originals after 7 days (keep processed versions)

---

### 8. Analytics Event Schema

**MongoDB Collection**: `analytics_events`

**Document Structure**:
```javascript
{
  _id: ObjectId,
  eventType: 'view' | 'purchase' | 'search' | 'add-to-cart',
  userId: ObjectId,
  sessionId: String,
  productId: ObjectId,
  metadata: {
    category?: String,
    price?: Number,
    source?: 'direct' | 'search' | 'recommendation',
    customData?: Object
  },
  timestamp: Date, // When event occurred
  batchInsertedAt: Date // When written to DB
}
```

**Batch Processing**:
- Events queued to Bull `analytics` queue
- Worker collects events for 30 seconds
- Bulk insert up to 500 events or 30s timeout (whichever first)
- Reduces write load on MongoDB (500 inserts → 1 bulk write)

**Indexes**:
```javascript
db.analytics_events.createIndex({ userId: 1, timestamp: -1 })
db.analytics_events.createIndex({ eventType: 1, timestamp: -1 })
db.analytics_events.createIndex({ timestamp: 1 }) // For TTL cleanup
db.analytics_events.createIndex(
  { timestamp: 1 },
  { expireAfterSeconds: 7776000 } // 90 days retention
)
```

---

### 9. Cache & Queue Monitoring

**Health Checks**:
- Redis connectivity test on server startup
- Bull queue health check (enabled jobs count, failed jobs count)
- Both logged to Winston logger

**Alerts** (Optional, documented):
- Failed job count exceeds threshold → Log warning
- Redis connection lost → Log error, enable DB-only fallback
- Queue backlog > 1000 jobs → Log warning (possible worker bottleneck)

---

### 10. Graceful Degradation

**If Redis is Down**:
- ✅ Requests proceed without caching (slower)
- ✅ Database queries succeed
- ✅ Responses have full data (not cached)
- ✅ Logging at WARN level
- ℹ️ User still gets correct data, just slower

**If Bull Queues are Down**:
- ❌ Emails NOT sent (critical path)
- ❌ Inventory alerts delayed
- ⚠️ Mitigate: Implement queue health check, alert ops team

**Solution for Queue Failures**:
- Health check endpoint: `GET /api/health/queues`
- Returns queue status and failed job count
- If queue down > 5 min, send Slack/email alert to ops

---

## Non-Goals & Deferred

- [ ] Distributed cache (multi-region) — Phase X
- [ ] Real-time analytics dashboard — Phase X
- [ ] Message queue (RabbitMQ/Kafka) — Phase X (Bull MQ sufficient for now)
- [ ] Custom image filters/effects — Phase X (Just resize/compress)
- [ ] Advanced queue scheduling (cron jobs) — Phase X (Bull supports, can add later)

---

## Success Criteria

**For Implementation**:
1. ✅ Products cached with 5-min TTL
2. ✅ Cache-aside pattern implemented (read cache → miss → DB → write)
3. ✅ Event-driven cache invalidation working
4. ✅ 4 separate Bull queues running with independent workers
5. ✅ Bull Board UI accessible at `/api/admin/queues` (admin only)
6. ✅ Password reset tokens stored in Redis (15-min TTL)
7. ✅ Image processing pipeline: Sharp + S3 integration
8. ✅ Analytics events batched every 30s to MongoDB
9. ✅ Graceful degradation: All endpoints work if Redis down (slower)
10. ✅ All tests passing (unit tests for cache logic, queue job handlers)
11. ✅ Documentation complete (PHASE6_PERFORMANCE.md + PHASE6_CHECKLIST.md)

---

## Dependencies & Assumptions

**Dependencies on Prior Phases**:
- Phase 4 (E-Commerce): Product & Category models exist
- Phase 5 (Payments): Order model with payment fields
- Phase 3 (Auth): JWT + requireAuth middleware
- All user models and routes established

**Assumptions**:
- Redis is available locally (dev) or cloud (prod)
- AWS S3 bucket accessible for image uploads
- MongoDB running and connected
- Bull library works with current Node.js version
- `sharp` compatible with current OS

---

## Questions for Planner

1. **Warm Cache on Startup**: Should we pre-load top 100 products into cache on server start? (For faster response on first request)
2. **Cache Stampede Prevention**: Should we implement request coalescing to prevent multiple DB queries on cache miss? (Nice-to-have optimization)
3. **Dead Letter Queue**: For failed jobs that exhaust retries, should we route to a separate visualizable queue in Bull Board?
4. **Image CDN**: Should we use CloudFront or another CDN to serve images from S3?
5. **Observability**: Should we integrate metrics (Prometheus) for cache hit rates and queue lag?

---

## Next Steps

1. **Planning Phase** → Create PLAN.md with wave-based execution
2. **Execution Phase** → Implement according to plan
3. **Testing Phase** → Unit tests for cache logic, queue job handlers
4. **Documentation Phase** → PHASE6_PERFORMANCE.md + deployment checklist

---

**Locked Date**: 2026-04-06  
**Decision Frame**: Final (ready to plan)  
**Reviewer**: [User]
