# Phase 6: Caching, Queues & Background Jobs — Deployment Checklist ✅

**Status**: Ready for Deployment  
**Last Updated**: April 2026  
**Reviewed by**: [Your Name]  

---

## Pre-Deployment Verification

### Code Quality

#### Syntax Checks
```bash
# All modules must pass Node.js syntax validation
node -c src/utils/cache.js
node -c src/utils/cacheInvalidation.js
node -c src/jobs/queues.js
node -c src/jobs/queueJob.js
node -c src/jobs/processors/emailProcessor.js
node -c src/jobs/processors/inventoryProcessor.js
node -c src/jobs/processors/imagesProcessor.js
node -c src/jobs/processors/analyticsProcessor.js
node -c src/modules/queues/routes.js
node -c src/app.js
```

**Status**: 
- [ ] All syntax checks pass
- [ ] No parse errors

#### Linting
```bash
npm run lint -- src/utils/cache.js
npm run lint -- src/utils/cacheInvalidation.js
npm run lint -- src/jobs/
npm run lint -- src/modules/queues/
```

**Status**:
- [ ] No eslint errors
- [ ] No warnings (or documented exceptions)
- [ ] Code style consistent with codebase

#### Code Review
- [ ] Cache invalidation logic reviewed
- [ ] Queue processor error handling reviewed
- [ ] Bull Board authentication verified
- [ ] Data serialization/deserialization correct
- [ ] No hardcoded credentials in code

### Tests

#### Unit Tests
```bash
npm test -- src/jobs/__tests__/cache.test.js
npm test -- src/jobs/__tests__/queues.test.js
npm test -- src/jobs/__tests__/emailProcessor.test.js
npm test -- src/jobs/__tests__/imageProcessor.test.js
```

**Status**:
- [ ] All tests pass
- [ ] Test coverage > 80%
- [ ] Edge cases covered (null, undefined, errors)
- [ ] Error handling tested
- [ ] Concurrent operations tested

#### Integration Tests
```bash
npm test -- src/modules/queues/__tests__/
npm test -- src/routes/__tests__/
```

**Status**:
- [ ] Routes return correct status codes
- [ ] Admin authentication enforced
- [ ] Queue operations return expected results
- [ ] Error responses well-formatted

### Dependencies

#### Installation
```bash
npm ls bull
npm ls redis
npm ls bull-board
npm ls sharp
npm ls @aws-sdk/client-s3
```

**Status**:
- [ ] `bull@^4.16.5` installed
- [ ] `redis@^5.11.0` installed
- [ ] `bull-board@^1.7.2` installed
- [ ] `sharp@^0.34.5` installed
- [ ] `@aws-sdk/client-s3@^3.1024.0` installed

#### Security Audit
```bash
npm audit
# Should show:
# - 0 HIGH vulnerabilities
# - 0 CRITICAL vulnerabilities
# - Acceptable number of LOW vulnerabilities
```

**Status**:
- [ ] No critical vulnerabilities
- [ ] No high vulnerabilities
- [ ] Known vulnerabilities have mitigation plan

#### Dependency Tree
```bash
npm ls --depth=2
```

**Status**:
- [ ] No duplicate dependencies
- [ ] No conflicting versions
- [ ] All transitive dependencies compatible

### Environment Configuration

#### Development Environment (.env.dev)
```bash
# Cache
REDIS_URL=redis://localhost:6379/0
REDIS_CACHE_TTL=300
REDIS_ENABLE=true

# Queues
BULL_QUEUE_PREFIX=dev:
BULL_ENABLE=true
JOB_CONCURRENCY_EMAIL=3
JOB_CONCURRENCY_INVENTORY=2
JOB_CONCURRENCY_IMAGES=1
JOB_CONCURRENCY_ANALYTICS=1

# S3 (for image uploads)
AWS_S3_BUCKET=getshitdone-images-dev
AWS_ACCESS_KEY_ID=<dev-key>
AWS_SECRET_ACCESS_KEY=<dev-secret>
AWS_REGION=us-east-1

# Monitoring
BULL_BOARD_ENABLED=true
CACHE_STATS_ENABLED=true
```

**Status**:
- [ ] .env.dev has all required keys
- [ ] Redis accessible: `redis-cli PING`
- [ ] S3 credentials valid
- [ ] No secrets checked into git

#### Production Environment (.env.prod)
```bash
# Cache
REDIS_URL=redis://<prod-endpoint>:6379/0
REDIS_CACHE_TTL=300
REDIS_ENABLE=true

# Queues
BULL_QUEUE_PREFIX=prod:
BULL_ENABLE=true
JOB_CONCURRENCY_EMAIL=10
JOB_CONCURRENCY_INVENTORY=5
JOB_CONCURRENCY_IMAGES=3
JOB_CONCURRENCY_ANALYTICS=2

# S3
AWS_S3_BUCKET=getshitdone-images-prod
AWS_ACCESS_KEY_ID=<prod-key>
AWS_SECRET_ACCESS_KEY=<prod-secret>
AWS_REGION=us-east-1

# Monitoring
BULL_BOARD_ENABLED=true
CACHE_STATS_ENABLED=false
LOG_LEVEL=info
```

**Status**:
- [ ] .env.prod configured
- [ ] Production Redis endpoint correct
- [ ] Production S3 bucket correct
- [ ] Concurrency values tuned for prod
- [ ] No dev values in production

### Database Setup

#### Cache Collections (Redis)
```bash
# Should be empty before first run
redis-cli DBSIZE
redis-cli KEYS '*'
```

**Status**:
- [ ] Redis database initialized
- [ ] No leftover keys from previous runs
- [ ] Expiration (TTL) working: `redis-cli TTL <key>`

#### Queue Collections (MongoDB)
```javascript
// Test connections
db.webhookevents.count()       // Should find collection
db.paymentlogs.count()          // Should find collection
```

**Status**:
- [ ] MongoDB accessible
- [ ] Necessary collections created
- [ ] Indexes created for performance
- [ ] Replica set initialized (if transactions needed)

#### Job History Collection
```javascript
db.jobs.find().limit(1)  // Should exist
db.jobs.createIndex({ createdAt: 1 })
db.jobs.createIndex({ status: 1 })
db.jobs.createIndex({ queueName: 1 })
```

**Status**:
- [ ] Job history collection created
- [ ] Indexes created
- [ ] TTL index set for auto-cleanup (30 days)

---

## Runtime Verification

### Local Testing (Development)

#### Start Services
```bash
# Terminal 1: Redis
redis-cli PING  # Should return PONG

# Terminal 2: MongoDB
mongo --eval "db.adminCommand('ping')"  # Should return { ok: 1 }

# Terminal 3: App
npm run dev
# Should log:
# ✓ MongoDB connected
# ✓ Redis initialized
# ✓ All Bull queues initialized
# ✓ Cache invalidation listeners registered
# ✓ Bull Board mounted at /api/admin/queues
```

**Status**:
- [ ] Redis running and accessible
- [ ] MongoDB running and accessible
- [ ] App starts without errors
- [ ] All services initialize successfully

#### Cache Verification
```bash
# Test cache-aside pattern
GET /api/v1/products/PROD-123

# First request: Database hit (slow)
# Check cache was populated:
redis-cli GET "products:detail:PROD-123"  # Should have JSON

# Second request: Should be from cache (fast)
GET /api/v1/products/PROD-123  # Response time < 50ms

# Update product and verify invalidation
POST /api/v1/products/PROD-123 { name: "Updated" }
redis-cli GET "products:detail:PROD-123"  # Should be null (invalidated)
```

**Status**:
- [ ] Cache hit/miss working correctly
- [ ] Cache invalidation triggered on writes
- [ ] TTL expired correctly after 5 minutes
- [ ] Response times improved with cache

#### Queue Verification
```bash
# Enqueue test jobs
curl -X POST http://localhost:3000/api/v1/orders \
  -H "Authorization: Bearer <token>" \
  -d { "items": [...], "shippingAddress": ... }

# Check queue status
GET /api/admin/queues/stats
# Should show:
# { email: { active: 1, waiting: 0, ... }, ... }

# Check job details
GET /api/admin/queues/email/jobs?status=active

# Wait for processing
# Job should move from active → completed within 100ms

# Check job result
redis-cli GET "bull:email:<jobId>:data"  # Job data
```

**Status**:
- [ ] Jobs enqueue successfully
- [ ] Bull Board shows jobs in real-time
- [ ] Jobs process and complete
- [ ] Processed jobs archived correctly

#### Bull Board UI
```bash
# Access Bull Board (require admin JWT)
GET /api/admin/queues
# Should return JSON with queue info

# Advanced: Open in browser if frontend available
# POST /api/v1/auth/login
#   email: admin@getshitdone.com
#   password: <admin-password>
# 
# Then: Browser → http://localhost:3000/api/admin/queues
# Should show Bull Board web UI with all queues
```

**Status**:
- [ ] Bull Board endpoint accessible
- [ ] Authentication required (returns 401 without auth)
- [ ] Admin role enforced (returns 403 for non-admin)
- [ ] All 4 queues visible in listing

### Production Testing (Staging/Pre-prod)

#### Health Checks
```bash
# Cache health
redis-cli INFO memory
redis-cli INFO stats
# Should show: used_memory < maxmemory
# Should show: connected_clients < 100

# Queue health
GET /api/admin/queues/stats
# All queues should have:
# - active: reasonable number (< 100)
# - failed: 0 (or very few)
# - completed: increasing over time

# App health
GET /health
# Should return: { status: "OK", timestamp: "..." }
```

**Status**:
- [ ] Redis memory usage normal
- [ ] Queue backlog manageable
- [ ] No stuck jobs (active count not growing)
- [ ] App responding to health checks

#### Load Testing
```bash
# Generate steady load
npm install -g wrk
wrk -t4 -c100 -d30s http://localhost:3000/api/v1/products

# Monitor during load
# Check cache hit ratio:
redis-cli INFO stats
# Look for: keyspace_hits / (keyspace_hits + keyspace_misses)
# Target: > 80%

# Check queue throughput:
GET /api/admin/queues/stats
# completed count should be increasing
```

**Status**:
- [ ] System handles 100+ concurrent users
- [ ] Cache hit ratio maintained > 80%
- [ ] Queue jobs process without backing up
- [ ] No memory leaks (memory stable)
- [ ] Response times remain acceptable

#### Error Scenario Testing
```bash
# Test 1: Redis down
redis-cli SHUTDOWN NOSAVE
# App should continue working (graceful degradation)
GET /api/v1/products  # Should work, just slower (DB hits)
redis-server  # Restart Redis

# Test 2: Queue processor crash
# Manually pause queue worker
# Enqueue jobs: should wait in queue
# Restart worker: should process waiting jobs

# Test 3: Database connection pool exhausted
# Enqueue many concurrent image jobs (heavy DB load)
# Should queue them, not crash
# Monitor: Queue should drain as database recovers
```

**Status**:
- [ ] App works without Redis (degrades gracefully)
- [ ] Queue jobs retry correctly
- [ ] Database connection pool recovers
- [ ] No cascading failures

### Monitoring Setup

#### Logging
```bash
# Check logs for errors
tail -f logs/error.log

# Verify log patterns:
# - [INFO] Cache initialized
# - [INFO] Bull queues initialized  
# - [WARN] Cache read failed (only on Redis errors)
# - [ERROR] Email processor error (with job ID)

# Should NOT see:
# - secrets (keys, tokens)
# - passwords
# - sensitive user data
```

**Status**:
- [ ] Logs clean (no errors on startup)
- [ ] No sensitive data in logs
- [ ] Error events properly logged
- [ ] Performance metrics logged

#### Metrics Collection (if applicable)
```bash
# If using Prometheus/DataDog, verify metrics:

# Cache metrics
cache_hits_total
cache_misses_total
cache_hit_ratio
cache_memory_bytes

# Queue metrics
bull_job_processing_duration_seconds
bull_job_completion_total
bull_job_failure_total
bull_queue_waiting_count
bull_queue_active_count

# Business metrics
orders_processed_total
emails_sent_total
images_processed_total
```

**Status**:
- [ ] Metrics endpoint accessible
- [ ] All expected metrics present
- [ ] Historical data collected
- [ ] Alerts configured for failures

---

## Deployment Checklist

### Pre-Deployment
- [ ] Code merged to main branch
- [ ] All tests passing (CI/CD green)
- [ ] Code review approved
- [ ] Security audit passed
- [ ] Performance regression test passed
- [ ] Backup of production database created
- [ ] Rollback plan documented

### Deployment Steps
```bash
# 1. Update code
git pull origin main
npm install  # Install any dependency updates

# 2. Start Redis (if not running)
redis-server

# 3. Run database migrations (if any)
npm run migrate

# 4. Start application
npm run start  # Or pm2 start ecosystem.config.js

# 5. Verify health
curl http://localhost:3000/health

# 6. Tail logs for errors
tail -f logs/error.log
```

**Status**:
- [ ] Code deployed
- [ ] Services started
- [ ] Health check passing
- [ ] Logs clean

### Post-Deployment
- [ ] Monitor CPU/memory for 30 minutes
- [ ] Check error logs
- [ ] Verify cache is populating
- [ ] Verify queues are processing
- [ ] Run smoke tests
- [ ] Check user-facing features work
- [ ] Document deployment time

**Duration Target**: < 5 minutes total

### Rollback Plan
```
If critical issues detected:
1. Stop new application
2. Revert to previous version: git revert HEAD
3. Restart application with previous code
4. Verify services working
5. Post-mortem: identify issue and fix
```

**Status**:
- [ ] Rollback procedure tested
- [ ] Previous version available
- [ ] Communication plan ready

---

## Post-Deployment Verification (24-48 hours)

### Performance Metrics
```
Baseline (Before Phase 6)
  ├─ Page load: ~500ms
  ├─ Database queries: 500+ per request
  ├─ P95 latency: 2000ms
  └─ Errors: < 0.1%

Target (After Phase 6)
  ├─ Page load: ~100ms (80% improvement)
  ├─ Database queries: 20 per request
  ├─ P95 latency: 400ms (80% improvement)
  └─ Errors: < 0.1% (same)
```

**Verification**:
- [ ] Page load time improved by 50%+
- [ ] Database query count reduced by 80%+
- [ ] Error rate unchanged or improved
- [ ] User session duration increased (time on site)

### Business Impact
- [ ] No customer complaints about performance
- [ ] Order conversion rate stable or improved
- [ ] Customer support tickets stable
- [ ] Revenue/sales metrics stable

### Infrastructure Health
- [ ] Redis memory stable (not growing unbounded)
- [ ] MongoDB connections stable
- [ ] CPU usage normal (not spiking)
- [ ] Disk usage normal

---

## Known Issues & Workarounds

### Issue: Bull Board shows "Cannot read property 'get' of undefined"
**Cause**: Redis connection drop  
**Workaround**: Restart Redis, then refresh Bull Board
**Fix**: Add connection pooling + auto-retry

### Issue: Cache invalidation takes > 1 second
**Cause**: Too many pattern deletes (`DELETE products:*`)  
**Workaround**: Reduce invalidation scope in model hooks
**Fix**: Use specific key deletes instead of patterns

### Issue: Image jobs fail with "ENOENT: no such file or directory"
**Cause**: Temp file deleted before processing complete  
**Workaround**: Increase temp file TTL to 30 seconds
**Fix**: Use streaming instead of temp files

---

## Success Criteria

✅ All pre-deployment checks pass  
✅ All tests pass with > 80% coverage  
✅ Production Redis operational  
✅ All 4 queues initialized  
✅ Bull Board accessible at /api/admin/queues  
✅ Cache hit ratio > 80%  
✅ Page load latency < 300ms (cached endpoints)  
✅ Zero job processing errors in first 24h  
✅ Error rate < 0.1%  
✅ No production incidents  

---

## Sign-Off

- [ ] Technical Lead: _________________ Date: _______
- [ ] QA Manager: _________________ Date: _______
- [ ] DevOps Engineer: _________________ Date: _______
- [ ] Product Manager: _________________ Date: _______

---

## Appendix: Quick Reference

### Useful Commands

```bash
# Monitor Redis in real-time
redis-cli MONITOR

# Check Redis memory
redis-cli INFO MEMORY

# Clear Redis cache (dev only!)
redis-cli FLUSHALL

# Monitor queue in real-time
curl http://localhost:3000/api/admin/queues/stats

# Tail logs
tail -f logs/error.log
tail -f logs/combined.log

# Check process
ps aux | grep node

# Restart application
npm restart
# or
pm2 restart all
```

### Emergency Contacts

- **On-Call Engineer**: [Name] - [Phone]
- **Database Admin**: [Name] - [Phone]
- **Ops Lead**: [Name] - [Phone]

### Documentation Links

- Phase 6 Performance Guide: `.planning/PHASE6_PERFORMANCE.md`
- Architecture Docs: `.planning/PHASE6_CONTEXT.md`
- Test Results: `npm test -- src/jobs/__tests__`
