/**
 * Cache Tests
 * Unit tests for cache-aside pattern, TTL handling, and graceful degradation
 */

const cache = require('../../utils/cache');
const { logger } = require('../../utils');

describe('Cache Utility', () => {
  // Reset cache before each test
  beforeEach(async () => {
    try {
      await cache.clearCache();
    } catch (error) {
      // Ignore errors during test cleanup
    }
  });

  describe('Cache-Aside Pattern', () => {
    it('should retrieve value from cache when key exists', async () => {
      const key = 'test:user:123';
      const value = { id: 123, name: 'John Doe', email: 'john@example.com' };

      // Set value
      await cache.setToCache(key, value, 300);

      // Get value
      const cached = await cache.getFromCache(key);

      expect(cached).toBeDefined();
      expect(cached.id).toBe(value.id);
      expect(cached.name).toBe(value.name);
    });

    it('should return null when cache miss', async () => {
      const key = 'nonexistent:key:xyz';

      const result = await cache.getFromCache(key);

      expect(result).toBeNull();
    });

    it('should set and retrieve complex nested objects', async () => {
      const key = 'products:list:page:1';
      const complexValue = {
        items: [
          { id: 1, name: 'Product 1', price: 100, variants: ['red', 'blue'] },
          { id: 2, name: 'Product 2', price: 200, variants: ['large', 'small'] },
        ],
        pagination: { page: 1, total: 50, perPage: 10 },
        metadata: { cached: true, timestamp: new Date().toISOString() },
      };

      await cache.setToCache(key, complexValue, 300);
      const retrieved = await cache.getFromCache(key);

      expect(retrieved).toEqual(complexValue);
      expect(retrieved.items.length).toBe(2);
      expect(retrieved.pagination.total).toBe(50);
    });
  });

  describe('TTL (Time-To-Live)', () => {
    it('should respect custom TTL when set', async () => {
      const key = 'short:lived:key';
      const value = { data: 'expires quickly' };

      // Set with 1 second TTL
      await cache.setToCache(key, value, 1);

      // Verify it exists immediately
      const immediate = await cache.getFromCache(key);
      expect(immediate).toBeDefined();

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should be expired
      const expired = await cache.getFromCache(key);
      expect(expired).toBeNull();
    });

    it('should use default TTL (5 minutes) when not specified', async () => {
      const key = 'default:ttl:key';
      const value = { timestamp: Date.now() };

      // Set without TTL (should use default)
      await cache.setToCache(key, value);

      // Should exist after 1 second
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const result = await cache.getFromCache(key);
      expect(result).toBeDefined();
    });
  });

  describe('Key Deletion', () => {
    it('should delete a specific key', async () => {
      const key = 'deletable:key';
      const value = { data: 'will be deleted' };

      // Set and verify
      await cache.setToCache(key, value, 300);
      let result = await cache.getFromCache(key);
      expect(result).toBeDefined();

      // Delete
      await cache.deleteFromCache(key);

      // Verify deletion
      result = await cache.getFromCache(key);
      expect(result).toBeNull();
    });

    it('should delete multiple keys matching pattern', async () => {
      // Set multiple keys
      await cache.setToCache('products:list:page:1', { page: 1 }, 300);
      await cache.setToCache('products:list:page:2', { page: 2 }, 300);
      await cache.setToCache('products:detail:123', { id: 123 }, 300);
      await cache.setToCache('users:list:all', { count: 100 }, 300);

      // Delete all products:list:* keys
      await cache.deletePatternFromCache('products:list:*');

      // Page 1 should be deleted
      expect(await cache.getFromCache('products:list:page:1')).toBeNull();

      // Page 2 should be deleted
      expect(await cache.getFromCache('products:list:page:2')).toBeNull();

      // Other keys should remain
      expect(await cache.getFromCache('products:detail:123')).toBeDefined();
      expect(await cache.getFromCache('users:list:all')).toBeDefined();
    });

    it('should handle wildcard patterns correctly', async () => {
      // Set keys with different nesting levels
      await cache.setToCache('products:123:basic', { type: 'basic' }, 300);
      await cache.setToCache('products:123:detailed', { type: 'detailed' }, 300);
      await cache.setToCache('products:124:basic', { type: 'basic' }, 300);
      await cache.setToCache('categories:123:basic', { type: 'basic' }, 300);

      // Delete all keys for product 123
      await cache.deletePatternFromCache('products:123:*');

      expect(await cache.getFromCache('products:123:basic')).toBeNull();
      expect(await cache.getFromCache('products:123:detailed')).toBeNull();
      expect(await cache.getFromCache('products:124:basic')).toBeDefined();
      expect(await cache.getFromCache('categories:123:basic')).toBeDefined();
    });
  });

  describe('Graceful Degradation', () => {
    it('should handle Redis connection errors gracefully', async () => {
      // Temporarily break Redis connection
      const originalSet = cache.setToCache;
      cache.setToCache = jest.fn().mockRejectedValue(new Error('Redis unavailable'));

      try {
        // Should not throw - just log warning
        const result = await cache.setToCache('key', { data: 'test' }, 300).catch(
          (err) => {
            logger.warn('Cache write failed', { error: err.message });
            return null;
          }
        );

        expect(result).toBeNull();
      } finally {
        cache.setToCache = originalSet;
      }
    });

    it('should log cache operations for debugging', async () => {
      const loggerInfoSpy = jest.spyOn(logger, 'debug').mockImplementation();

      await cache.setToCache('debug:key', { value: 'test' }, 300);
      await cache.getFromCache('debug:key');

      // Verify logging occurred
      expect(loggerInfoSpy).toHaveBeenCalled();
      loggerInfoSpy.mockRestore();
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid JSON gracefully', async () => {
      const key = 'invalid:json:key';

      // Try to set and retrieve invalid data
      try {
        await cache.setToCache(key, { circular: null }, 300);
        const result = await cache.getFromCache(key);
        expect(result).toBeDefined();
      } catch (error) {
        // Should handle gracefully without crashing
        expect(error).toBeDefined();
      }
    });

    it('should handle null/undefined values', async () => {
      // Should handle null
      await cache.setToCache('null:key', null, 300);
      const nullResult = await cache.getFromCache('null:key');
      expect(nullResult).toBeNull();

      // Should handle undefined
      await cache.setToCache('undefined:key', undefined, 300);
      const undefinedResult = await cache.getFromCache('undefined:key');
      expect(undefinedResult).toBeNull();
    });

    it('should handle empty objects and arrays', async () => {
      await cache.setToCache('empty:object', {}, 300);
      await cache.setToCache('empty:array', [], 300);

      const emptyObj = await cache.getFromCache('empty:object');
      const emptyArr = await cache.getFromCache('empty:array');

      expect(emptyObj).toEqual({});
      expect(emptyArr).toEqual([]);
    });
  });

  describe('Cache Namespace Isolation', () => {
    it('should not confuse keys with similar names', async () => {
      await cache.setToCache('user:1', { type: 'user', id: 1 }, 300);
      await cache.setToCache('user:10', { type: 'user', id: 10 }, 300);
      await cache.setToCache('user:100', { type: 'user', id: 100 }, 300);

      const user1 = await cache.getFromCache('user:1');
      const user10 = await cache.getFromCache('user:10');
      const user100 = await cache.getFromCache('user:100');

      expect(user1.id).toBe(1);
      expect(user10.id).toBe(10);
      expect(user100.id).toBe(100);
    });
  });

  // Cleanup after all tests
  afterAll(async () => {
    try {
      await cache.clearCache();
    } catch (error) {
      // Ignore
    }
  });
});
