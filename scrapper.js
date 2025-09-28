const express = require("express");
const axios = require("axios");
const { Buffer } = require("buffer");

const app = express();
app.use(express.json()); // parse JSON body

// Zyte credentials
const ZYTE_API_KEY = process.env.ZYTE_API_KEY || "REPLACE_WITH_YOUR_ZYTE_KEY";
const ZYTE_BASE_URL = process.env.ZYTE_BASE_URL || "https://api.zyte.com/v1";

// Helper: Zyte Basic Auth
function getAuthHeader() {
  const token = Buffer.from(`${ZYTE_API_KEY}:`).toString("base64");
  return `Basic ${token}`;
}

// Scrape Instagram posts
async function scrapeInstagramPosts(username) {
  if (!ZYTE_API_KEY || ZYTE_API_KEY === "REPLACE_WITH_YOUR_ZYTE_KEY") {
    throw new Error("ZYTE_API_KEY is not set. Please set it in your environment.");
  }

  const cleanUsername = String(username).replace("@", "").trim();
  if (!cleanUsername) throw new Error("Invalid username provided");

  const profileUrl = `https://www.instagram.com/${encodeURIComponent(cleanUsername)}/`;

  let extractResp;
  try {
    extractResp = await axios.post(
      `${ZYTE_BASE_URL}/extract`,
      {
        url: profileUrl,
        httpResponseBody: true
      },
      {
        headers: {
          Authorization: getAuthHeader(),
          "Content-Type": "application/json"
        },
        timeout: 60000
      }
    );
  } catch (err) {
    if (err.response) {
      throw new Error(
        `Zyte extract failed: ${err.response.status} - ${JSON.stringify(err.response.data)}`
      );
    } else if (err.request) {
      throw new Error("No response from Zyte extract (network/timeouts)");
    } else {
      throw new Error(`Error calling Zyte extract: ${err.message}`);
    }
  }

  const extractData = extractResp.data;
  let html = "";
  if (extractData.httpResponseBody) {
    const buf = Buffer.from(extractData.httpResponseBody, "base64");
    html = buf.toString("utf-8");
  }

  const posts = [];
  try {
    const sharedDataMatch = html.match(/window\._sharedData\s*=\s*(\{.+?\});/);
    if (!sharedDataMatch) return [];
    const shared = JSON.parse(sharedDataMatch[1]);

    const mediaEdges =
      shared.entry_data &&
      shared.entry_data.ProfilePage &&
      shared.entry_data.ProfilePage[0]?.graphql?.user?.edge_owner_to_timeline_media?.edges;

    if (Array.isArray(mediaEdges)) {
      mediaEdges.forEach((edge, idx) => {
        const node = edge.node || {};
        const captionEdges = node.edge_media_to_caption?.edges;
        const caption = captionEdges?.[0]?.node?.text || "";
        const title = caption ? caption.split("\n")[0].substring(0, 100).trim() : `Post ${idx + 1}`;
        const hashtags = (caption.match(/#([A-Za-z0-9_]+)/g) || []).map((h) => h.substring(1));
        const postUrl = node.shortcode ? `https://www.instagram.com/p/${node.shortcode}/` : "";
        posts.push({ title, url: postUrl, caption, hashtags });
      });
    }
  } catch (e) {
    console.warn("Parsing failed:", e.message);
  }

  return posts;
}

// API endpoint
// … (imports and helper functions remain same) …

app.post("/", async (req, res) => {
  try {
    const { username } = req.body || {};
    if (!username) {
      return res
        .status(400)
        .json({ status: "error", message: "Username is required" });
    }

    const posts = await scrapeInstagramPosts(username);

    // Send success format
    return res.status(200).json({
      status: "success",
      data: {
        username,
        posts
      }
    });
  } catch (err) {
    console.error("Error:", err);
    return res
      .status(500)
      .json({ status: "error", message: err.message || "Internal Error" });
  }
});


// Start server (Render will use process.env.PORT)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Scraper running on port ${PORT}`);
});

