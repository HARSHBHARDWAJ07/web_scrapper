const express = require("express");
const axios = require("axios");
const { Buffer } = require("buffer");

const app = express();
app.use(express.json());

const ZYTE_API_KEY = process.env.ZYTE_API_KEY || "REPLACE_WITH_YOUR_ZYTE_KEY";
const ZYTE_BASE_URL = process.env.ZYTE_BASE_URL || "https://api.zyte.com/v1";

// Helper: Zyte Basic Auth
function getAuthHeader() {
  const token = Buffer.from(`${ZYTE_API_KEY}:`).toString("base64");
  return `Basic ${token}`;
}

// --------------------
// Scraper Function
// --------------------
async function scrapeInstagramPosts(username) {
  if (!ZYTE_API_KEY || ZYTE_API_KEY === "REPLACE_WITH_YOUR_ZYTE_KEY") {
    throw new Error("ZYTE_API_KEY is not set");
  }

  const cleanUsername = String(username).replace("@", "").trim();
  if (!cleanUsername) {
    throw new Error("Invalid username");
  }

  const profileUrl = `https://www.instagram.com/${cleanUsername}/`;

  let extractResp;
  try {
    extractResp = await axios.post(
      `${ZYTE_BASE_URL}/extract`,
      {
        url: profileUrl,
        browserHtml: true // ✅ request rendered HTML only
      },
      {
        headers: {
          Authorization: getAuthHeader(),
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );
  } catch (err) {
    const resp = err.response;
    if (resp) {
      throw new Error(
        `Zyte extract error: status ${resp.status}, data = ${JSON.stringify(resp.data)}`
      );
    }
    throw new Error(`Zyte extract network error: ${err.message}`);
  }

  const data = extractResp.data;

  // Decode the rendered HTML
  let html = "";
  if (data.browserHtml) {
    html = Buffer.from(data.browserHtml, "base64").toString("utf-8");
  }

  if (!html) {
    return [];
  }

  // Parse Instagram’s embedded JSON (_sharedData fallback)
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

