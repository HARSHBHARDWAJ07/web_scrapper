import express from "express";
import { ApifyClient } from "apify-client";

const app = express();
app.use(express.json());

// Load API token from env
const APIFY_TOKEN = process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN;
if (!APIFY_TOKEN) {
  console.error("Error: APIFY_TOKEN is not set in environment variables");
  process.exit(1);
}

// Create Apify client
const client = new ApifyClient({ token: APIFY_TOKEN });

// Utility: extract hashtags (unique)
function extractHashtags(text) {
  if (!text) return [];
  // regex for hashtags (alphanumeric + underscore)
  const matches = text.match(/#[A-Za-z0-9_]+/g) || [];
  // deduplicate
  const seen = new Set();
  const result = [];
  for (const h of matches) {
    const clean = h.substring(1); // drop '#'
    if (!seen.has(clean)) {
      seen.add(clean);
      result.push(clean);
    }
  }
  return result;
}

// Core function: scrape minimal post details for a username
async function fetchInstagramPosts(username, maxPosts = 25) {
  const clean = username.trim();

  // Input for the actor
  const input = {
    directUrls: [`https://www.instagram.com/${clean}/`],
    resultsType: "posts",
    resultsLimit: maxPosts,
    searchType: "user",
    searchLimit: 1,
    // Use Apify proxy by default (for reliability)
    proxy: {
      useApifyProxy: true,
      apifyProxyGroups: ["RESIDENTIAL"],
    },
    // Use a small custom map function to keep minimal data
    customMapFunction: `({ item }) => {
      if (item.type !== "Post") return null;
      const caption = item.caption || "";
      const hashtags = (caption.match(/#[A-Za-z0-9_]+/g) || []).map(h => h.substring(1));
      return {
        title: item.title || caption.split("\\n")[0].substring(0, 100).trim(),
        caption,
        hashtags
      };
    }`,
    // Some performance tuning
    maxRequestsPerCrawl: 20,
    maxConcurrency: 3,
    maxRequestRetries: 1,
    pageTimeout: 10_000,
  };

  try {
    // Trigger the actor run
    const run = await client.actor("apify/instagram-scraper").call(input);
    // List items in the output dataset
    const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: maxPosts });

    // Filter nulls & take first valid posts
    const posts = items
      .filter(it => it !== null)
      .map((it) => ({
        title: it.title || "",
        caption: it.caption || "",
        hashtags: Array.isArray(it.hashtags) ? it.hashtags : extractHashtags(it.caption || "")
      }));

    return posts;
  } catch (err) {
    // Throw error upward
    throw new Error(`Apify error: ${err.statusCode || ""} ${err.message || err.toString()}`);
  }
}

// API route
app.post("/", async (req, res) => {
  try {
    const { username, maxPosts } = req.body;
    if (!username) {
      return res.status(400).json({ error: "username is required" });
    }
    const limit = typeof maxPosts === "number" && maxPosts > 0 ? maxPosts : 10;
    const posts = await fetchInstagramPosts(username, limit);
    return res.json({ username, posts });
  } catch (e) {
    console.error("Scrape failed:", e);
    return res.status(500).json({ error: e.message || "Unknown error" });
  }
});

const PORT = process.env.PORT || 3000;
if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
}
