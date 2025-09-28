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
        browserHtml: true // ✅ only use browser rendering
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

  // If Zyte did automatic extraction and has posts
  if (data.extracted && Array.isArray(data.extracted.posts)) {
    return data.extracted.posts.map((p, idx) => {
      const caption = p.caption || "";
      const title = caption
        ? String(caption).split("\n")[0].substring(0, 100).trim()
        : `Post ${idx + 1}`;
      return {
        title,
        url: p.url || "",
        caption,
        hashtags: Array.isArray(p.hashtags) ? p.hashtags : [],
      };
    });
  }

  // Otherwise parse from HTML
  let html = "";
  if (data.browserHtml) {
    html = Buffer.from(data.browserHtml, "base64").toString("utf-8");
  }

  if (!html) {
    return [];
  }

  // Parse the Instagram sharedData JSON
  let posts = [];
  try {
    const m = html.match(/window\._sharedData\s*=\s*(\{.*?\});/s);
    if (m) {
      const obj = JSON.parse(m[1]);
      const edges =
        obj.entry_data?.ProfilePage?.[0]?.graphql?.user?.edge_owner_to_timeline_media?.edges;

      if (Array.isArray(edges)) {
        edges.forEach((edge, idx) => {
          const node = edge.node || {};
          const captionEdge = node.edge_media_to_caption?.edges;
          const caption =
            (Array.isArray(captionEdge) &&
              captionEdge[0]?.node?.text) ||
            "";
          const title = caption
            ? String(caption).split("\n")[0].substring(0, 100).trim()
            : `Post ${idx + 1}`;
          const hashtags = (String(caption).match(/#([A-Za-z0-9_]+)/g) || []).map(
            (h) => h.substring(1)
          );
          const shortcode = node.shortcode;
          const postUrl = shortcode
            ? `https://www.instagram.com/p/${shortcode}/`
            : "";
          posts.push({
            title,
            url: postUrl,
            caption,
            hashtags,
          });
        });
      }
    }
  } catch (parseErr) {
    console.error("Error parsing HTML:", parseErr);
  }

  return posts;
}
