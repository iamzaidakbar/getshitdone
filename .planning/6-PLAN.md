# Phase 6: Caching, Queues & Background Jobs — Execution Plan

**Goal**: Performance and reliability at scale  
**Context**: [6-CONTEXT.md](6-CONTEXT.md)  
**Status**: Ready for Execution  
**Estimated Duration**: 6-8 hours (7 waves)  

---

## Executive Summary

Build production-ready caching (Redis) and job queues (Bull MQ) for high-scale e-commerce:
- **Cache**: Product/category data with 5-min TTL, cache-aside pattern, event-driven invalidation
- **Queues**: 4 separate Bull queues (email, inventory, images, analytics)
- **Monitoring**: Bull Board UI at `/api/admin/queues` (admin-only)
- **Resilience**: Graceful degradation (work without cache/queues)

---

## Video Map (7 Waves, Parallel Where Possible)

### Wave 1: Dependencies & Redis Config (30 min)
**Goal**: Ensure all packages installed and Redis connectivity working

**Tasks**:
- [ ] Install missing dependencies: `bull-board`, `sharp`, `@aws-sdk/client-s3`
- [ ] Verify Redis connectivity (redis-cli test)
- [ ] Create Redis config in `src/config/index.js` (if missing)
- [ ] Test Redis commands (SET, GET, DEL, EXPIRE)

**Deliverables**:
- ✅ `package.json` updated with new dependencies
- ✅ Redis config exported from `src/config/index.js`
- ✅ `src/utils/redis-client.js` (singleton Redis instance)

**Commits**: `chore: Phase 6 Wave 1 — Redis setup and dependencies`

---

### Wave 2: Cache Layer & Middleware (45 min)
**Goal**: Implement cache-aside pattern with key namespacing

**Tasks**:
- [ ] Create `src/utils/cache.js`
  - `getFromCache(key)` — Retrieve with error handling
  - `setToCache(key, value, ttl=300)` — Store with TTL
  - `deleteFromCache(key)` — Delete single key
  - `deletePatternFromCache(pattern)` — Delete by pattern (e.g., `products:list:*`)
  - `clearCache()` — Full flush (dev only)

- [ ] Create cache middleware in `src/middlewares/cacheMiddleware.js`
  - `cacheGet(key)` — Middleware to check cache, fallback DB
  - Graceful error handling (continue without cache)

- [ ] Extend `src/modules/products/routes.js`:
  - `GET /api/v1/products/:id` — Cache via middleware
  - `GET /api/v1/products` — Cache listings (with pagination key)

- [ ] Extend `src/modules/categories/routes.js`:
  - `GET /api/v1/categories` — Cache full tree
  - `GET /api/v1/categories/:id` — Cache individual

**Deliverables**:
- ✅ `src/utils/cache.js` with all cache methods
- ✅ `src/middlewares/cacheMiddleware.js` (request-level caching)
- ✅ Cache integrated into product & category GET routes
- ✅ Graceful fallback (log warning if Redis down, continue without cache)

**Commits**: `feat: Phase 6 Wave 2 — Cache-aside pattern with middleware`

---

### Wave 3: Event-Driven Cache Invalidation (40 min)
**Goal**: Decouple models from cache via EventEmitter

**Tasks**:
- [ ] Create `src/utils/events.js` (EventEmitter singleton)
  - Export event names: `CACHE_INVALIDATE_PRODUCT`, `CACHE_INVALIDATE_CATEGORY`, etc.
  - Global event bus for cache invalidation

- [ ] Create `src/utils/cacheInvalidation.js`
  - Listen for `CACHE_INVALIDATE_*` events
  - Clear appropriate cache keys based on event type
  - Log all invalidations at INFO level

- [ ] Extend `src/modules/products/model.js`
  - POST-SAVE hook: Emit `CACHE_INVALIDATE_PRODUCT` with `{ productId, action: 'save' }`
  - POST-DELETE hook: Emit `CACHE_INVALIDATE_PRODUCT` with `{ productId, action: 'delete' }`

- [ ] Extend `src/modules/categories/model.js`
  - POST-SAVE hook: Emit `CACHE_INVALIDATE_CATEGORY` event
  - Invalidates both single category + full tree

- [ ] Initialize cache invalidation listener in `src/app.js`
  - Start listening for events on app startup

**Deliverables**:
- ✅ `src/utils/events.js` (EventEmitter singleton)
- ✅ `src/utils/cacheInvalidation.js` (event listeners + clearing logic)
- ✅ Model hooks emit cache invalidation events
- ✅ Cache cleared automatically on writes (no manual calls needed)

**Commits**: `feat: Phase 6 Wave 3 — Event-driven cache invalidation`

---

### Wave 4: Bull Queue Setup (50 min)
**Goal**: Create 4 independent queues with proper configuration

**Tasks**:
- [ ] Create `src/jobs/queues.js`
  - Initialize queue instances with Redis config
  - Export: `emailQueue`, `inventoryQueue`, `imagesQueue`, `analyticsQueue`

- [ ] Configure queue options:
  ```javascript
  emailQueue = new Queue('email', {
    redis: redisConfig,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      timeout: 30000
    }
  })
  ```
  - Email: attempts=3, timeout=30s, backoff=exponential
  - Inventory: attempts=5, timeout=20s, backoff=exponential
  - Images: attempts=3, timeout=60s, backoff=exponential
  - Analytics: attempts=5, timeout=120s, backoff=exponential

- [ ] Create queue processors skeleton in `src/jobs/`:
  - `src/jobs/processors/emailProcessor.js` (process handler stub)
  - `src/jobs/processors/inventoryProcessor.js` (stub)
  - `src/jobs/processors/imagesProcessor.js` (stub)
  - `src/jobs/processors/analyticsProcessor.js` (stub)

- [ ] Create job enqueueing utility `src/jobs/queueJob.js`
  - `enqueueEmail(jobData)` — Add to email queue
  - `enqueueInventoryAlert(jobData)` — Add to inventory queue
  - `enqueueImage(jobData)` — Add to images queue
  - `enqueueAnalytics(jobData)` — Add to analytics queue
  - Include error handling (log errors, don't crash request)

**Deliverables**:
- ✅ `src/jobs/queues.js` (4 configured queue instances)
- ✅ Queue processors skeleton files
- ✅ `src/jobs/queueJob.js` with enqueueing utilities
- ✅ All queues using Redis backend from config

**Commits**: `feat: Phase 6 Wave 4 — Bull queue setup with 4 independent queues`

---

### Wave 5: Job Handlers & Processors (90 min)
**Goal**: Implement job processing logic for each queue

**Tasks**:

#### 5a: Email Queue Processor
- [ ] Extend `src/jobs/processors/emailProcessor.js`
  - Handle job types: `order-confirmation`, `shipping-update`, `password-reset`
  - Use existing email utilities from `src/utils/email.js`
  - Log success + send errors to Sentry (if enabled)
  - Return job result

#### 5b: Inventory Queue Processor
- [ ] Extend `src/jobs/processors/inventoryProcessor.js`
  - Handle: `low-stock-alert`, `restock-notification`, `stock-update`
  - Check current inventory against threshold
  - Send email notifications via email queue (chain queues)
  - Log to MongoDB (InventoryEvent collection)

#### 5c: Image Processing Queue Processor
- [ ] Extend `src/jobs/processors/imagesProcessor.js`
  - Receive job: `{ uploadId, sourceUrl, operations, dimensions }`
  - Download image from temp storage
  - Resize using Sharp (3 sizes: 200x200, 600x600, 1200x1200)
  - Compress to JPEG (quality: 80)
  - Upload all 3 versions to S3
  - Update database with S3 URLs
  - Delete local temp file
  - Handle errors gracefully (mark as failed, log context)

- [ ] Create `src/utils/s3.js`
  - S3 client initialization
  - `uploadToS3(bucket, key, buffer)` — Upload image buffer
  - `deleteFromS3(bucket, key)` — Delete image

#### 5d: Analytics Queue Processor
- [ ] Extend `src/jobs/processors/analyticsProcessor.js`
  - Collect pending events from memory or Redis list
  - Batch insert to MongoDB every 30s or 500 events (whichever first)
  - Update timestamps, ensure indexes
  - Handle duplicate detection (optional, based on sessionId+eventType)

**Deliverables**:
- ✅ All 4 processor files fully implemented
- ✅ `src/utils/s3.js` with S3 integration
- ✅ Job handlers idempotent (safe to retry)
- ✅ Error logging + context for debugging
- ✅ Graceful failure (don't crash queue worker)

**Commits**: 
- `feat: Phase 6 Wave 5a — Email job processor`
- `feat: Phase 6 Wave 5b — Inventory alerts processor`
- `feat: Phase 6 Wave 5c — Image processing with Sharp & S3`
- `feat: Phase 6 Wave 5d — Analytics batch processor`

---

### Wave 6: Bull Board & Admin Route (35 min)
**Goal**: Expose queue monitoring UI with security

**Tasks**:
- [ ] Create `src/modules/queues/routes.js`
  - `GET /api/admin/queues` — Serve Bull Board UI
  - Apply `requireAuth` + `adminOnly` middleware
  - Create Bull Board instance with all 4 queues

- [ ] Integrate in `src/routes/index.js`
  - Mount: `router.use('/admin/queues', queuesRoutes)`

- [ ] Create admin middleware in `src/middlewares/adminOnly.js` (if missing)
  - Check `req.user.role === 'admin'`
  - Return 403 if not authorized

- [ ] Bull Board configuration:
  - Read-only mode (no delete/retry in UI, those via API)
  - or Full access (conditional on environment)

**Deliverables**:
- ✅ Bull Board mounted at `/api/admin/queues`
- ✅ Admin-only access (401 if not authenticated, 403 if not admin)
- ✅ All 4 queues visible in UI
- ✅ Queue stats, job logs, failed jobs visible

**Commits**: `feat: Phase 6 Wave 6 — Bull Board monitoring UI`

---

### Wave 7: Testing & Documentation (90 min)
**Goal**: Comprehensive tests and deployment guide

**Tests** (60 min):
- [ ] Create `src/jobs/__tests__/cache.test.js`
  - Test cache-aside pattern (hit, miss, TTL)
  - Test graceful degradation (Redis down scenario)
  - Test pattern deletion (products:list:*)

- [ ] Create `src/jobs/__tests__/queues.test.js`
  - Test enqueueing jobs to each queue
  - Test job retry logic
  - Test job timeout handling

- [ ] Create `src/jobs/__tests__/emailProcessor.test.js`
  - Mock email service
  - Test job processing success + failures
  - Test retry behavior

- [ ] Create `src/jobs/__tests__/imageProcessor.test.js`
  - Mock Sharp library
  - Mock S3 uploads
  - Test error handling (corrupted image, S3 failure)

**Documentation** (30 min):
- [ ] Create `.planning/PHASE6_PERFORMANCE.md`
  - Architecture overview (cache + queues)
  - Usage examples (how to enqueue jobs, clear cache)
  - Monitoring guide (Bull Board walkthrough)
  - Troubleshooting (Redis down, queue backed up, etc.)

- [ ] Create `.planning/PHASE6_CHECKLIST.md`
  - Pre-deployment verification
  - Post-deployment monitoring
  - Scaling considerations

**Deliverables**:
- ✅ 4 test files with comprehensive coverage
- ✅ All tests passing (`npm test`)
- ✅ PHASE6_PERFORMANCE.md (2,000+ lines)
- ✅ PHASE6_CHECKLIST.md (deployment guide)

**Commits**: 
- `test: Phase 6 Wave 7a — Cache and queue tests`
- `docs: Phase 6 Wave 7b — Performance guide and deployment checklist`

---

## Dependency Graph

```
Wave 1 (Dependencies)
  ↓
Wave 2 (Cache Layer) ←→ Wave 3 (Cache Invalidation)
  ↓
Wave 4 (Queue Setup)
  ↓
Wave 5 (Job Handlers)
  ↓
Wave 6 (Bull Board)
  ↓
Wave 7 (Testing & Docs)
```

**Parallel Opportunities**:
- Waves 2 & 3 can run in parallel (both modify models but don't conflict)
- Waves 5a-5d can run in parallel (independent queue processors)

---

## Success Criteria

### Functional Completeness
- ✅ Products cached with automatic invalidation
- ✅ Categories cached with TTL
- ✅ All 4 job queues operational
- ✅ Password reset tokens in Redis (15-min TTL)
- ✅ Image processing pipeline (Sharp + S3)
- ✅ Analytics events batched to MongoDB
- ✅ Bull Board accessible and functional
- ✅ Graceful degradation (all endpoints work without cache/queues)

### Quality Gates
- ✅ All syntax checks pass
- ✅ All tests passing (unit + integration)
- ✅ No hardcoded secrets in code
- ✅ Proper error handling + logging
- ✅ Request timeouts configured per queue

### Documentation
- ✅ PHASE6_PERFORMANCE.md complete
- ✅ PHASE6_CHECKLIST.md complete
- ✅ Code commented for complex logic
- ✅ Architecture diagrams in docs

### Deployment Readiness
- ✅ Environment variables documented (.env config needed)
- ✅ Redis connection string configurable
- ✅ AWS S3 bucket setup documented
- ✅ Pre-deployment checklist reviewed

---

## Timeline Estimate

| Wave | Task | Duration | Status |
|------|------|----------|--------|
| 1 | Dependencies + Redis | 30 min | 📋 Planned |
| 2 | Cache layer | 45 min | 📋 Planned |
| 3 | Cache invalidation | 40 min | 📋 Planned |
| 4 | Queue setup | 50 min | 📋 Planned |
| 5 | Job handlers | 90 min | 📋 Planned |
| 6 | Bull Board | 35 min | 📋 Planned |
| 7 | Testing & docs | 90 min | 📋 Planned |
| **Total** | | **380 min ≈ 6.5 hrs** | |

---

## Known Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Redis unavailable | Cache reads fail, slow requests | Graceful fallback to DB, circuit breaker pattern |
| Bull queue backlog | Delayed notifications | Monitor queue length, scale workers |
| S3 upload failure | Image processing hangs | Timeout + retry with exponential backoff |
| Cache stampede (many concurrent misses) | DB overwhelmed | Request coalescing (implement in Wave 2) |

---

## Questions for Executor

1. **Request Coalescing**: Should we implement request coalescing to prevent cache stampede on popular products?
2. **S3 Bucket**: Should executor create S3 test bucket or assume it exists?
3. **Warm Cache**: Pre-load top 100 products on server startup?
4. **Metrics**: Should we track cache hit rates and publish metrics?

---

## Next Steps After Execution

1. Deploy to staging environment
2. Run 24-hour stability test (monitor queues, cache)
3. Load test (check cache hit rates under load)
4. Move to production with monitoring

---

**Phase 6 Status**: Ready for Execution  
**Executor**: [Autonomous Agent]  
**Date**: 2026-04-06  
**Approval**: [User]
