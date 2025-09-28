const express = require("express");
const axios = require("axios");
const { Buffer } = require("buffer");

const app = express();
app.use(express.json());

const ZYTE_API_KEY = process.env.ZYTE_API_KEY || "REPLACE_WITH_YOUR_ZYTE_KEY";
const ZYTE_BASE_URL = process.env.ZYTE_BASE_URL || "https://api.zyte.com/v1";

function getAuthHeader() {
  const token = Buffer.from(`${ZYTE_API_KEY}:`).toString("base64");
  return `Basic ${token}`;
}

async function scrapeInstagramPosts(username) {
  if (!ZYTE_API_KEY || ZYTE_API_KEY === "REPLACE_WITH_YOUR_ZYTE_KEY") {
    throw new Error("ZYTE_API_KEY is not set");
  }

  const cleanUsername = String(username).replace("@", "").trim();
  if (!cleanUsername) {
    throw new Error("Invalid username");
  }
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
    // Bubble error so route handler will catch
    if (err.response) {
      throw new Error(`Zyte extract failed: ${err.response.status} - ${JSON.stringify(err.response.data)}`);
    } else if (err.request) {
      throw new Error("No response from Zyte extract (network/timeouts)");
    } else {
      throw new Error(`Zyte call error: ${err.message}`);
    }
  }

  const extractData = extractResp.data;
  let html = "";
  if (extractData.httpResponseBody) {
    const buf = Buffer.from(extractData.httpResponseBody, "base64");
    html = buf.toString("utf-8");
  } else {
    // If HTML not returned, maybe Zyte did automatic extraction or some other field
    console.warn("No httpResponseBody in extractData", extractData);
  }

  // debug: log
  console.log("=== HTML snippet ===");
  console.log(html.substring(0, 500));

  const posts = [];
  try {
    const sharedMatch = html.match(/window\._sharedData\s*=\s*(\{.+?\});/);
    if (!sharedMatch) {
      console.warn("sharedData not found in HTML");
    } else {
      const shared = JSON.parse(sharedMatch[1]);
      const edges = shared.entry_data?.ProfilePage?.[0]?.graphql?.user?.edge_owner_to_timeline_media?.edges;
      if (Array.isArray(edges)) {
        edges.forEach((edge, idx) => {
          const node = edge.node || {};
          const caption = node.edge_media_to_caption?.edges?.[0]?.node?.text || "";
          const title = caption
            ? caption.split("\n")[0].substring(0, 100).trim()
            : `Post ${idx + 1}`;
          const hashtags = (caption.match(/#([A-Za-z0-9_]+)/g) || []).map(h => h.substring(1));
          const postUrl = node.shortcode ? `https://www.instagram.com/p/${node.shortcode}/` : "";
          posts.push({ title, url: postUrl, caption, hashtags });
        });
      }
    }
  } catch (parseErr) {
    console.warn("Error parsing HTML / JSON:", parseErr);
  }

  return posts;
}

app.post("/", async (req, res) => {
  try {
    const { username } = req.body || {};
    if (!username) {
      return res.status(400).json({
        status: "error",
        message: "Username is required"
      });
    }

    const posts = await scrapeInstagramPosts(username);

    return res.status(200).json({
      status: "success",
      data: {
        username,
        posts
      }
    });
  } catch (err) {
    console.error("Error in / handler:", err);
    return res.status(500).json({
      status: "error",
      message: err.message || "Internal Server Error"
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
