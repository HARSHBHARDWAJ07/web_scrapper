// server.mjs
import express from "express";
import { ApifyClient } from "apify-client";
import pino from "pino";

const log = pino({ level: process.env.LOG_LEVEL || "info" });

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
if (!APIFY_TOKEN) {
  log.error("APIFY_TOKEN not set in env");
  process.exit(1);
}
const client = new ApifyClient({ token: APIFY_TOKEN });

const PORT = process.env.PORT || 3000;
const DEFAULT_MAX_POSTS = 25;

// Utility: extract unique hashtags
function extractHashtags(text) {
  if (!text) return [];
  const matches = text.match(/#[A-Za-z0-9_]+/g) || [];
  const seen = new Set();
  const result = [];
  for (const h of matches) {
    const clean = h.slice(1).toLowerCase();
    if (!seen.has(clean)) {
      seen.add(clean);
      result.push(clean);
    }
  }
  return result;
}

async function fetchInstagramPosts(username, maxPosts = DEFAULT_MAX_POSTS) {
  const clean = username.trim().replace(/^@/, "");

  const input = {
    directUrls: [`https://www.instagram.com/${clean}/`],
    resultsType: "posts",
    resultsLimit: maxPosts,
    searchType: "user",
    searchLimit: 1,
    proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
    maxRequestsPerCrawl: Math.min(20, maxPosts),
    maxConcurrency: 3,
    maxRequestRetries: 1,
    pageTimeout: 10_000,
    customMapFunction: `({ item }) => {
      if (item.type !== "Post") return null;
      const caption = item.caption || "";
      const title = item.title || (caption.split("\\n")[0] || "").substring(0, 140).trim();
      return {
        title,
        caption,
        url: item.url || item.postUrl || ("https://instagram.com/p/" + item.shortcode),
        hashtags: (caption.match(/#[A-Za-z0-9_]+/g) || []).map(h => h.substring(1).toLowerCase())
      };
    }`
  };

  // Start actor run
  const run = await client.actor("apify/instagram-scraper").call(input);

  // Poll until finished
  let finishedRun;
  while (true) {
    finishedRun = await client.run(run.id).get();
    if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(finishedRun.status)) break;
    await new Promise((r) => setTimeout(r, 5000)); // wait 5s between polls
  }

  if (finishedRun.status !== "SUCCEEDED") {
    throw new Error(`Apify run failed with status ${finishedRun.status}`);
  }

  // Fetch dataset items
  const datasetId = finishedRun.defaultDatasetId;
  const { items } = await client.dataset(datasetId).listItems({ limit: maxPosts });

  return items
    .filter(Boolean)
    .slice(0, maxPosts)
    .map((it) => ({
      title: it.title || "",
      caption: it.caption || "",
      url: it.url,
      hashtags: Array.isArray(it.hashtags)
        ? it.hashtags
        : extractHashtags(it.caption || "")
    }));
}

// Express app
const app = express();
app.use(express.json());

app.post("/", async (req, res) => {
  try {
    const { username, maxPosts } = req.body;
    if (!username) {
      return res.status(400).json({ error: "username is required" });
    }
    const limit = Number.isInteger(maxPosts) && maxPosts > 0 ? maxPosts : DEFAULT_MAX_POSTS;
    const posts = await fetchInstagramPosts(username, limit);
    return res.json({ username, posts });
  } catch (err) {
    log.error(err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen(PORT, () => log.info(`Server running on port ${PORT}`));
}
