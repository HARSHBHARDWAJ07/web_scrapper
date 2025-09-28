const express = require("express");
const axios = require("axios");
const { Buffer } = require("buffer");
const app = express();
app.use(express.json());

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN || "REPLACE_WITH_YOUR_APIFY_TOKEN";
const APIFY_BASE_URL = process.env.APIFY_BASE_URL || "https://api.apify.com/v2";

// Helper: Apify Auth Header
function getAuthHeader() {
  return `Bearer ${APIFY_API_TOKEN}`;
}

// --------------------
// Scraper Function
// --------------------
async function scrapeInstagramPosts(username) {
  if (!APIFY_API_TOKEN || APIFY_API_TOKEN === "REPLACE_WITH_YOUR_APIFY_TOKEN") {
    throw new Error("APIFY_API_TOKEN is not set");
  }

  const cleanUsername = String(username).replace("@", "").trim();
  if (!cleanUsername) {
    throw new Error("Invalid username");
  }

  const profileUrl = `https://www.instagram.com/${cleanUsername}/`;

  let extractResp;
  try {
    // Using Apify's Web Scraper actor for browser rendering
    extractResp = await axios.post(
      `${APIFY_BASE_URL}/acts/apify~web-scraper/runs?token=${APIFY_API_TOKEN}`,
      {
        startUrls: [{ url: profileUrl }],
        globs: [],
        pseudoUrls: [],
        pageFunction: `async function pageFunction(context) {
          const { page } = context;
          await page.waitForTimeout(3000);
          const html = await page.content();
          return { html: html };
        }`,
        proxyConfiguration: { useApifyProxy: true },
        initialCookies: [],
        waitUntil: ["networkidle2"],
        debugLog: false,
        ignoreSslErrors: false,
        ignoreCorsAndCsp: false,
        downloadMedia: false,
        downloadCss: false,
        maxRequestRetries: 3,
        maxPagesPerCrawl: 1,
        maxResultsPerCrawl: 1,
        maxCrawlingDepth: 0,
        maxConcurrency: 1,
        pageLoadTimeoutSecs: 60,
        pageFunctionTimeoutSecs: 60,
        maxScrollHeightPixels: 5000,
        useChrome: true,
        useStealth: true
      },
      {
        headers: {
          Authorization: getAuthHeader(),
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );

    // Wait for the run to complete
    const runId = extractResp.data.data.id;
    let runStatus = 'RUNNING';
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes timeout
    
    while (runStatus === 'RUNNING' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
      
      const statusResp = await axios.get(
        `${APIFY_BASE_URL}/actor-runs/${runId}?token=${APIFY_API_TOKEN}`,
        {
          headers: {
            Authorization: getAuthHeader(),
          }
        }
      );
      
      runStatus = statusResp.data.data.status;
      attempts++;
    }

    if (runStatus !== 'SUCCEEDED') {
      throw new Error(`Apify run failed with status: ${runStatus}`);
    }

    // Get the results
    const resultsResp = await axios.get(
      `${APIFY_BASE_URL}/datasets/${runId}/items?token=${APIFY_API_TOKEN}`,
      {
        headers: {
          Authorization: getAuthHeader(),
        }
      }
    );

    const results = resultsResp.data;
    if (!results || results.length === 0) {
      return [];
    }

    const html = results[0].html || '';
    
    if (!html) {
      return [];
    }

    // Parse Instagram's embedded JSON (_sharedData fallback) - same as original
    let posts = [];
    try {
      const m = html.match(/window\._sharedData\s*=\s*(\{.*?\});/s);
      if (m) {
        const obj = JSON.parse(m[1]);
        const edges =
          obj.entry_data?.ProfilePage?.[0]?.graphql?.user?.edge_owner_to_timeline_media?.edges;
        if (Array.isArray(edges)) {
          posts = edges.map((edge, idx) => {
            const node = edge.node || {};
            const captionEdge = node.edge_media_to_caption?.edges;
            const caption =
              (Array.isArray(captionEdge) && captionEdge[0]?.node?.text) || "";
            const title = caption
              ? caption.split("\n")[0].substring(0, 100).trim()
              : `Post ${idx + 1}`;
            const hashtags =
              (caption.match(/#([A-Za-z0-9_]+)/g) || []).map((h) => h.substring(1));
            const shortcode = node.shortcode;
            const postUrl = shortcode
              ? `https://www.instagram.com/p/${shortcode}/`
              : "";
            return {
              title,
              url: postUrl,
              caption,
              hashtags,
            };
          });
        }
      }
    } catch (parseErr) {
      console.error("Error parsing Instagram HTML:", parseErr);
    }

    return posts;

  } catch (err) {
    const resp = err.response;
    if (resp) {
      throw new Error(
        `Apify extract error: status ${resp.status}, data = ${JSON.stringify(resp.data)}`
      );
    }
    throw new Error(`Apify extract network error: ${err.message}`);
  }
}

// --------------------
// Express Routes
// --------------------
app.post("/", async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ status: "error", message: "Username is required" });
    }

    const posts = await scrapeInstagramPosts(username);
    return res.status(200).json({
      status: "success",
      data: { username, posts },
    });
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ status: "error", message: err.message });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// --------------------
// Start Server
// --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Scraper running on port ${PORT}`);
});
