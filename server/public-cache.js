const PUBLIC_CACHE_MAX_ENTRIES = Math.max(50, parseInt(process.env.PUBLIC_CACHE_MAX_ENTRIES || '400', 10));

const cacheStore = new Map();

function touchEntry(key, entry) {
    // Delete first so insertion order tracks recent activity.
    cacheStore.delete(key);
    cacheStore.set(key, entry);

    while (cacheStore.size > PUBLIC_CACHE_MAX_ENTRIES) {
        const oldestKey = cacheStore.keys().next().value;
        if (!oldestKey) break;
        cacheStore.delete(oldestKey);
    }
}

function getEntry(key) {
    const entry = cacheStore.get(key);
    if (!entry) return null;

    if (entry.staleUntil <= Date.now()) {
        cacheStore.delete(key);
        return null;
    }

    return entry;
}

function setEntry(key, value, ttlMs, staleMs) {
    const now = Date.now();
    const entry = {
        value,
        expiresAt: now + ttlMs,
        staleUntil: now + ttlMs + staleMs,
        refreshPromise: null,
    };
    touchEntry(key, entry);
    return entry;
}

function scheduleRefresh(key, entry, loader, ttlMs, staleMs) {
    if (entry.refreshPromise) return;

    entry.refreshPromise = Promise.resolve()
        .then(loader)
        .then((freshValue) => {
            setEntry(key, freshValue, ttlMs, staleMs);
        })
        .catch((error) => {
            // Keep stale cache available; request path can still use stale value.
            console.warn(`[cache] background refresh failed for ${key}:`, error?.message || error);
        })
        .finally(() => {
            const current = cacheStore.get(key);
            if (current) {
                current.refreshPromise = null;
            }
        });
}

/**
 * In-process cache with stale-while-revalidate behavior.
 *
 * Returns:
 * - MISS: no cache entry, loader executed
 * - HIT: fresh cache
 * - STALE: stale cache served while refresh runs in background
 */
export async function getCachedValue({ key, ttlMs, staleMs, loader }) {
    const entry = getEntry(key);
    const now = Date.now();

    if (!entry) {
        const value = await loader();
        setEntry(key, value, ttlMs, staleMs);
        return { value, cacheStatus: 'MISS' };
    }

    if (entry.expiresAt > now) {
        touchEntry(key, entry);
        return { value: entry.value, cacheStatus: 'HIT' };
    }

    scheduleRefresh(key, entry, loader, ttlMs, staleMs);
    touchEntry(key, entry);
    return { value: entry.value, cacheStatus: 'STALE' };
}

export function invalidatePublicCacheForRestaurant(restaurantId) {
    const marker = `:${restaurantId}:`;
    for (const key of cacheStore.keys()) {
        if (key.includes(marker)) {
            cacheStore.delete(key);
        }
    }
}

export function invalidatePublicCacheByPrefix(prefix) {
    for (const key of cacheStore.keys()) {
        if (key.startsWith(prefix)) {
            cacheStore.delete(key);
        }
    }
}
