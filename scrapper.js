import express from "express";
import { ApifyClient } from "apify-client";
import NodeCache from "node-cache";

const app = express();
app.use(express.json());

// Enhanced configuration
const CONFIG = {
  APIFY_TOKEN: process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN,
  PORT: process.env.PORT || 3000,
  CACHE_TTL: 15 * 60, // 15 minutes cache
  MAX_POSTS: 100,
  REQUEST_TIMEOUT: 10000, // 10 seconds (local guard for page timeouts)
  ACTOR_TIMEOUT: 120_000, // 2 minutes actor-level timeout
  RATE_LIMIT_PER_HOUR: 100, // requests per hour (global)
};

if (!CONFIG.APIFY_TOKEN) {
  console.error("❌ APIFY_TOKEN is required in environment variables");
  process.exit(1);
}

const client = new ApifyClient({ token: CONFIG.APIFY_TOKEN });

// NodeCache setup
const cache = new NodeCache({
  stdTTL: CONFIG.CACHE_TTL,
  checkperiod: 60,
  useClones: false,
});

// ----------------------
// Simple global token-bucket rate limiter (per hour)
// ----------------------
const RateLimiterSimple = (() => {
  let tokens = CONFIG.RATE_LIMIT_PER_HOUR;
  let lastRefill = Date.now();

  function refill() {
    const now = Date.now();
    const elapsed = now - lastRefill;
    if (elapsed >= 60 * 60 * 1000) {
      tokens = CONFIG.RATE_LIMIT_PER_HOUR;
      lastRefill = now;
    }
  }

  return {
    tryRemoveTokens(n = 1) {
      refill();
      if (tokens >= n) {
        tokens -= n;
        return true;
      }
      return false;
    },
    getTokensLeft() {
      refill();
      return tokens;
    },
  };
})();

// ----------------------
// Utilities
// ----------------------
function extractHashtags(text) {
  if (!text || typeof text !== "string") return [];
  const matches = text.match(/#[\w\u0590-\u05ff]+/g) || [];
  const s = new Set();
  for (const m of matches) {
    s.add(m.slice(1).toLowerCase());
  }
  return Array.from(s);
}

function processPosts(items = [], maxPosts) {
  if (!Array.isArray(items)) return [];
  const posts = new Map();
  let processed = 0;

  for (const item of items) {
    if (processed >= maxPosts) break;
    if (!item || item.type !== "Post") continue;

    const caption = item.caption || "";
    const title =
      item.title ||
      (caption.split("\n")[0] ? caption.split("\n")[0].substring(0, 100).trim() : "");

    const key = item.id || item.shortCode || item.timestamp || title;
    if (posts.has(key)) continue;

    posts.set(key, {
      id: item.id,
      title,
      caption,
      hashtags: Array.isArray(item.hashtags) ? item.hashtags : extractHashtags(caption),
      timestamp: item.timestamp || Date.now(),
    });
    processed++;
  }
  return Array.from(posts.values());
}

// ----------------------
// Core scraping function
// ----------------------
async function fetchInstagramPosts(username, maxPosts = 25) {
  const start = Date.now();
  const normalized = String(username).trim();
  if (!normalized || normalized.length > 50) throw new Error("Invalid username");

  const postsLimit = Math.min(Math.max(1, Number(maxPosts) || 10), CONFIG.MAX_POSTS);
  const cacheKey = `instagram:${normalized.toLowerCase()}:${postsLimit}`;

  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`✅ Cache hit (${cacheKey})`);
    return cached;
  }

  if (!RateLimiterSimple.tryRemoveTokens(1)) {
    const tokensLeft = RateLimiterSimple.getTokensLeft();
    console.warn(`⚠️ Rate limit exceeded. tokensLeft=${tokensLeft}`);
    const err = new Error("Rate limit exceeded");
    err.code = "RATE_LIMIT";
    throw err;
  }

  const input = {
    directUrls: [`https://www.instagram.com/${normalized}/`],
    resultsType: "posts",
    resultsLimit: postsLimit,
    searchType: "user",
    searchLimit: 1,
    proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
    maxRequestsPerCrawl: Math.min(postsLimit + 5, 50),
    maxConcurrency: 3,
    maxRequestRetries: 1,
    pageTimeout: CONFIG.REQUEST_TIMEOUT,
    requestHandlerTimeout: CONFIG.REQUEST_TIMEOUT,
    useChrome: false,
    extendOutputFunction: `({ item }) => {
      if (!item || item.type !== "Post") return null;
      return {
        id: item.id,
        shortCode: item.shortcode || item.shortCode || item.code,
        type: item.type,
        title: item.title || (item.caption || '').split('\\n')[0]?.substring(0,100)?.trim() || '',
        caption: item.caption || '',
        timestamp: item.timestamp || item.published_at || null,
        hashtags: (item.caption || '').match(/#[\\w\\u0590-\\u05ff]+/g)?.map(h => h.substring(1).toLowerCase()) || []
      };
    }`,
  };

  try {
    const run = await client.actor("apify/instagram-scraper").call(input, {
      waitForFinish: CONFIG.ACTOR_TIMEOUT / 1000, // convert ms → seconds
    });

    const datasetResult = await client.dataset(run.defaultDatasetId).listItems({
      limit: postsLimit,
      clean: true,
    });

    const items = Array.isArray(datasetResult) ? datasetResult : datasetResult.items || [];
    const posts = processPosts(items, postsLimit);

    if (posts.length > 0) cache.set(cacheKey, posts);

    const duration = Date.now() - start;
    console.log(`✅ Fetched ${posts.length} posts for ${normalized} in ${duration}ms`);

    return posts;
  } catch (err) {
    console.error(`❌ Scraping failed for ${normalized}:`, err && err.message ? err.message : err);
    if (err.message && err.message.toLowerCase().includes("timeout")) {
      const e = new Error("Scraping timeout. Please try again later.");
      e.code = "TIMEOUT";
      throw e;
    } else if (err.code === "RATE_LIMIT") {
      throw err;
    } else {
      const e = new Error(`Failed to fetch data: ${err.message || err}`);
      e.code = "FETCH_ERROR";
      throw e;
    }
  }
}

// ----------------------
// HTTP endpoints
// ----------------------
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    cacheStats: cache.getStats(),
    tokensLeft: RateLimiterSimple.getTokensLeft(),
  });
});

app.delete("/cache/:username?", (req, res) => {
  const { username } = req.params;
  if (username) {
    const pattern = new RegExp(`^instagram:${username.toLowerCase()}:`);
    const keys = cache.keys().filter((k) => pattern.test(k));
    keys.forEach((k) => cache.del(k));
    return res.json({ cleared: keys.length, keys });
  }
  const count = cache.keys().length;
  cache.flushAll();
  return res.json({ cleared: count, message: "All cache cleared" });
});

app.post("/", async (req, res) => {
  try {
    const { username, maxPosts } = req.body;
    if (!username || typeof username !== "string" || username.trim().length === 0) {
      return res.status(400).json({
        error: "Valid username is required",
        details: "Username must be a non-empty string",
      });
    }
    const limit = Math.min(Math.max(1, parseInt(maxPosts) || 25), CONFIG.MAX_POSTS);
    const posts = await fetchInstagramPosts(username.trim(), limit);
    return res.json({
      username: username.trim(),
      posts,
      count: posts.length,
      cached: false,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Scraping endpoint error:", err);
    const statusCode =
      (err.code === "TIMEOUT" && 408) || (err.code === "RATE_LIMIT" && 429) || 500;
    return res.status(statusCode).json({ error: err.message, details: "See server logs" });
  }
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  try {
    cache.flushAll();
  } catch (e) {}
  process.exit(0);
});

// Start server
const server = app.listen(CONFIG.PORT, () => {
  console.log(`🚀 Server running on port ${CONFIG.PORT}`);
  console.log(`💾 Cache enabled with ${CONFIG.CACHE_TTL}s TTL`);
  console.log(`📊 Rate limiting: ${CONFIG.RATE_LIMIT_PER_HOUR} req/hour`);
});

export default app;
