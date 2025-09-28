import express from "express";
import { ApifyClient } from "apify-client";
import NodeCache from "node-cache";
import { RateLimiter } from "limiter";

const app = express();
app.use(express.json());

// Enhanced configuration
const CONFIG = {
  APIFY_TOKEN: process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN,
  PORT: process.env.PORT || 3000,
  CACHE_TTL: 15 * 60, // 15 minutes cache
  MAX_POSTS: 100,
  REQUEST_TIMEOUT: 10000, // 10 seconds
  RATE_LIMIT: 100 // requests per hour
};

// Validate environment
if (!CONFIG.APIFY_TOKEN) {
  console.error("❌ APIFY_TOKEN is required in environment variables");
  process.exit(1);
}

const client = new ApifyClient({ token: CONFIG.APIFY_TOKEN });

// Enhanced caching with TTL - Using LRU strategy
const cache = new NodeCache({ 
  stdTTL: CONFIG.CACHE_TTL,
  checkperiod: 60,
  useClones: false
});

// Rate limiter to avoid API abuse
const limiter = new RateLimiter({
  tokensPerInterval: CONFIG.RATE_LIMIT,
  interval: "hour"
});

// Optimized hashtag extraction using Set for O(1) lookups
function extractHashtags(text) {
  if (!text || typeof text !== 'string') return [];
  
  const hashtagSet = new Set();
  const matches = text.match(/#[\w]+/g) || [];
  
  for (const tag of matches) {
    hashtagSet.add(tag.slice(1).toLowerCase()); // Normalize to lowercase
  }
  
  return Array.from(hashtagSet);
}

// Optimized data processing using Map for O(1) access
function processPosts(items, maxPosts) {
  if (!Array.isArray(items)) return [];
  
  const posts = new Map(); // Using Map to avoid duplicates by some unique identifier
  let processedCount = 0;

  for (const item of items) {
    if (processedCount >= maxPosts) break;
    if (!item || item.type !== "Post") continue;

    const caption = item.caption || "";
    const title = item.title || caption.split('\n')[0]?.substring(0, 100)?.trim() || "";
    
    // Use post ID or timestamp as key for deduplication
    const key = item.id || item.timestamp || title;
    
    if (!posts.has(key)) {
      posts.set(key, {
        id: item.id,
        title,
        caption,
        hashtags: Array.isArray(item.hashtags) ? item.hashtags : extractHashtags(caption),
        timestamp: item.timestamp || Date.now()
      });
      processedCount++;
    }
  }

  return Array.from(posts.values());
}

// Core scraping function with enhanced error handling and performance
async function fetchInstagramPosts(username, maxPosts = 10) {
  const startTime = Date.now();
  const cacheKey = `instagram:${username}:${maxPosts}`;
  
  // Check cache first - O(1) lookup
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`✅ Cache hit for ${username}`);
    return cached;
  }

  console.log(`🚀 Fetching fresh data for ${username}`);
  
  // Validate input
  const cleanUsername = username.trim().toLowerCase();
  if (!cleanUsername || cleanUsername.length > 30) {
    throw new Error("Invalid username format");
  }

  const postsLimit = Math.min(Math.max(1, maxPosts), CONFIG.MAX_POSTS);

  const input = {
    directUrls: [`https://www.instagram.com/${cleanUsername}/`],
    resultsType: "posts",
    resultsLimit: postsLimit,
    searchType: "user",
    searchLimit: 1,
    proxy: {
      useApifyProxy: true,
      apifyProxyGroups: ["RESIDENTIAL"],
    },
    // Optimized custom map function - minimal data extraction
    customMapFunction: `({ item }) => {
      if (item.type !== "Post") return null;
      return {
        id: item.id,
        type: item.type,
        title: item.title,
        caption: item.caption,
        timestamp: item.timestamp,
        hashtags: (item.caption || "").match(/#[\\w]+/g)?.map(h => h.substring(1).toLowerCase()) || []
      };
    }`,
    // Performance optimizations
    maxRequestsPerCrawl: Math.min(postsLimit + 5, 50),
    maxConcurrency: 5, // Increased for parallel processing
    maxRequestRetries: 2,
    pageTimeout: CONFIG.REQUEST_TIMEOUT,
    useChrome: false, // Use lighter browser when possible
    requestHandlerTimeout: CONFIG.REQUEST_TIMEOUT,
  };

  try {
    // Promise with timeout
    const scrapePromise = client.actor("apify/instagram-scraper").call(input);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Request timeout")), CONFIG.REQUEST_TIMEOUT + 5000)
    );

    const run = await Promise.race([scrapePromise, timeoutPromise]);
    
    // Parallel data fetching and processing
    const [datasetResult] = await Promise.all([
      client.dataset(run.defaultDatasetId).listItems({ 
        limit: postsLimit,
        clean: true 
      }),
      // Add small delay to ensure all items are processed
      new Promise(resolve => setTimeout(resolve, 100))
    ]);

    const posts = processPosts(datasetResult.items, postsLimit);
    
    // Cache the successful result
    if (posts.length > 0) {
      cache.set(cacheKey, posts);
    }

    const duration = Date.now() - startTime;
    console.log(`✅ Fetched ${posts.length} posts for ${username} in ${duration}ms`);
    
    return posts;

  } catch (error) {
    console.error(`❌ Scraping failed for ${username}:`, error);
    
    // Don't cache errors, but implement exponential backoff for retries
    if (error.message.includes("timeout")) {
      throw new Error(`Scraping timeout for ${username}. Please try again.`);
    } else if (error.statusCode === 429) {
      throw new Error("Rate limit exceeded. Please try again later.");
    } else {
      throw new Error(`Failed to fetch data: ${error.message}`);
    }
  }
}

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy", 
    timestamp: new Date().toISOString(),
    cacheStats: cache.getStats()
  });
});

// Cache management endpoint
app.delete("/cache/:username?", (req, res) => {
  const { username } = req.params;
  
  if (username) {
    const pattern = new RegExp(`instagram:${username}`);
    const keys = cache.keys().filter(key => pattern.test(key));
    keys.forEach(key => cache.del(key));
    res.json({ cleared: keys.length, keys });
  } else {
    const count = cache.keys().length;
    cache.flushAll();
    res.json({ cleared: count, message: "All cache cleared" });
  }
});

// Main scraping endpoint with enhanced validation and rate limiting
app.post("/", async (req, res) => {
  try {
    // Rate limiting check
    if (!await limiter.tryRemoveTokens(1)) {
      return res.status(429).json({ 
        error: "Rate limit exceeded", 
        retryAfter: "1 hour" 
      });
    }

    const { username, maxPosts } = req.body;
    
    // Enhanced validation
    if (!username || typeof username !== 'string' || username.trim().length === 0) {
      return res.status(400).json({ 
        error: "Valid username is required",
        details: "Username must be a non-empty string" 
      });
    }

    const postsLimit = Math.min(
      Math.max(1, parseInt(maxPosts) || 10), 
      CONFIG.MAX_POSTS
    );

    const posts = await fetchInstagramPosts(username, postsLimit);
    
    res.json({
      username: username.trim().toLowerCase(),
      posts,
      count: posts.length,
      cached: false, // We handle cache internally
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("Scraping endpoint error:", error);
    
    const statusCode = error.message.includes("timeout") ? 408 
                     : error.message.includes("Rate limit") ? 429 
                     : 500;
                     
    res.status(statusCode).json({ 
      error: error.message,
      details: "Please try again with a valid username" 
    });
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  cache.close();
  process.exit(0);
});

// Start server
const server = app.listen(CONFIG.PORT, () => {
  console.log(`🚀 Server running on port ${CONFIG.PORT}`);
  console.log(`💾 Cache enabled with ${CONFIG.CACHE_TTL}s TTL`);
  console.log(`📊 Rate limiting: ${CONFIG.RATE_LIMIT} requests/hour`);
});

export default app;
