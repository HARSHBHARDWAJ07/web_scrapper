const express = require("express");
const axios = require("axios");

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
  if (!cleanUsername) throw new Error("Invalid username");

  const profileUrl = `https://www.instagram.com/${cleanUsername}/`;

  let extractResp;
  try {
    extractResp = await axios.post(
      `${ZYTE_BASE_URL}/extract`,
      {
        url: profileUrl,
        browserHtml: true // ✅ only browser rendering
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
    const resp = err.response;
    if (resp) {
      throw new Error(
        `Zyte extract error: status ${resp.status}, data = ${JSON.stringify(resp.data)}`
      );
    }
    throw new Error(`Zyte extract network error: ${err.message}`);
  }

  const data = extractResp.data;

  // Decode rendered HTML
  let html = "";
  if (data.browserHtml) {
    html = Buffer.from(data.browserHtml, "base64").toString("utf-8");
  }

  if (!html) return [];

  let posts = [];

  try {
    // -------- Option A: old Instagram structure --------
    const sharedDataMatch = html.match(/window\._sharedData\s*=\s*(\{.*?\});/s);
    if (sharedDataMatch) {
      const obj = JSON.parse(sharedDataMatch[1]);
      const edges =
        obj?.entry_data?.ProfilePage?.[0]?.graphql?.user
          ?.edge_owner_to_timeline_media?.edges;

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

          return { title, url: postUrl, caption, hashtags };
        });
      }
    }

    // -------- Option B: newer Instagram ld+json --------
    if (posts.length === 0) {
      const ldJsonMatches = html.match(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
      );

      if (ldJsonMatches) {
        ldJsonMatches.forEach((match, idx) => {
          try {
            const jsonStr = match
              .replace(/<script type="application\/ld\+json">/, "")
              .replace(/<\/script>/, "")
              .trim();
            const ldObj = JSON.parse(jsonStr);

            if (ldObj["@type"] === "SocialMediaPosting") {
              const caption = ldObj.articleBody || "";
              const title = caption
                ? caption.split("\n")[0].substring(0, 100).trim()
                : `Post ${idx + 1}`;
              const hashtags =
                (caption.match(/#([A-Za-z0-9_]+)/g) || []).map((h) =>
                  h.substring(1)
                );
              const url =
                ldObj.mainEntityOfPage?.["@id"] ||
                ldObj.url ||
                profileUrl;

              posts.push({ title, url, caption, hashtags });
            }
          } catch (e) {
            // ignore parse errors
          }
        });
      }
    }
  } catch (parseErr) {
    console.error("Error parsing Instagram HTML:", parseErr);
  }

  return posts;
}

// ------------- API route -------------
app.post("/", async (req, res) => {
  try {
    const { username } = req.body;
    if (!username)
      return res
        .status(400)
        .json({ status: "error", message: "Username is required" });

    const posts = await scrapeInstagramPosts(username);

    return res.status(200).json({
      status: "success",
      data: { username, posts }
    });
  } catch (err) {
    console.error("Scrape error:", err);
    return res.status(500).json({ status: "error", message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ Server running on port ${PORT}`)
);
