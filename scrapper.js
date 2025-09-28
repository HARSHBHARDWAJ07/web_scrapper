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

  const profileUrl = `https://www.instagram.com/${username}/`;

  let extractResp;
  try {
    extractResp = await axios.post(
      `${ZYTE_BASE_URL}/extract`,
      {
        url: profileUrl,
        autoExtract: true // <--- Let Zyte do the extraction
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
    throw new Error(err.response?.data || err.message);
  }

  const data = extractResp.data;

  // Zyte returns structured data, e.g. data.extracted.posts
  const posts = (data.extracted?.posts || []).map((p) => ({
    title: p.caption ? p.caption.split("\n")[0].substring(0, 100) : "Post",
    url: p.url || "",
    caption: p.caption || "",
    hashtags: p.hashtags || []
  }));

  return posts;
}

// API route
app.post("/", async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ status: "error", message: "Username is required" });

    const posts = await scrapeInstagramPosts(username);

    return res.status(200).json({
      status: "success",
      data: { username, posts }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: "error", message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
