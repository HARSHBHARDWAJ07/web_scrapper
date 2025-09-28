// scrapper.js
const axios = require('axios');
const { Buffer } = require('buffer');

// Configuration / secrets
const ZYTE_API_KEY = process.env.ZYTE_API_KEY || 'REPLACE_WITH_YOUR_ZYTE_KEY';
const ZYTE_BASE_URL = process.env.ZYTE_BASE_URL || 'https://api.zyte.com/v1';  // use Zyte API base

// Helper: Basic Auth header for Zyte (api key as username, no password) per docs :contentReference[oaicite:0]{index=0}
function getAuthHeader() {
  // Zyte expects HTTP Basic auth: "apikey:" as base64
  const token = Buffer.from(`${ZYTE_API_KEY}:`).toString('base64');
  return `Basic ${token}`;
}

/**
 * Scrape Instagram posts for a given username via Zyte API.
 * Returns array of { title, url, caption, hashtags }.
 */
async function scrapeInstagramPosts(username) {
  if (!ZYTE_API_KEY || ZYTE_API_KEY === 'REPLACE_WITH_YOUR_ZYTE_KEY') {
    throw new Error('ZYTE_API_KEY is not set. Please set it in your environment.');
  }

  const cleanUsername = String(username).replace('@', '').trim();
  if (!cleanUsername) {
    throw new Error('Invalid username provided');
  }

  // Build the Instagram URL for the profile page
  const profileUrl = `https://www.instagram.com/${encodeURIComponent(cleanUsername)}/`;

  // 1) Use Zyte “extract” endpoint to fetch the HTML or JSON of the Instagram profile page
  // Zyte’s API reference: use /extract with JSON body. :contentReference[oaicite:1]{index=1}
  let extractResp;
  try {
    extractResp = await axios.post(
      `${ZYTE_BASE_URL}/extract`,
      {
        url: profileUrl,
        httpResponseBody: true,
        // Optionally, you can request browser rendering:
        // browserHtml: true
      },
      {
        headers: {
          Authorization: getAuthHeader(),
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      }
    );
  } catch (err) {
    if (err.response) {
      throw new Error(`Zyte extract failed: ${err.response.status} - ${JSON.stringify(err.response.data)}`);
    } else if (err.request) {
      throw new Error('No response from Zyte extract (network/timeouts)');
    } else {
      throw new Error(`Error calling Zyte extract: ${err.message}`);
    }
  }

  const extractData = extractResp.data;
  // Zyte returns `httpResponseBody` as Base64 (if requested) :contentReference[oaicite:2]{index=2}
  let html = '';
  if (extractData.httpResponseBody) {
    const buf = Buffer.from(extractData.httpResponseBody, 'base64');
    html = buf.toString('utf-8');
  } else {
    // If Zyte returned parsed JSON or direct extracted fields, you might find JSON in extractData instead of html
    // We’ll assume `html` is what we got; but if data is in `extractData.data` or `extractData.extracted`, that may be used
    html = extractData.data || '';
  }

  // 2) Parse the HTML to extract post entries
  // You’ll need to either:
  //   - use a DOM parser or regex to find post JSON embedded in <script> tags (e.g. window._sharedData)
  //   - or Zyte might already support “automatic extraction” of social media schema if configured in their setup

  // For demonstration, here’s a rough approach using regex on sharedData:
  // This is fragile — real approach depends on Instagram page structure
  const posts = [];
  try {
    const sharedDataMatch = html.match(/window\._sharedData\s*=\s*(\{.+?\});/);
    if (!sharedDataMatch) {
      // fail silently with empty posts
      return [];
    }
    const shared = JSON.parse(sharedDataMatch[1]);
    // Navigate to profile media edges
    const mediaEdges =
      shared.entry_data &&
      shared.entry_data.ProfilePage &&
      shared.entry_data.ProfilePage[0] &&
      shared.entry_data.ProfilePage[0].graphql &&
      shared.entry_data.ProfilePage[0].graphql.user &&
      shared.entry_data.ProfilePage[0].graphql.user.edge_owner_to_timeline_media &&
      shared.entry_data.ProfilePage[0].graphql.user.edge_owner_to_timeline_media.edges;

    if (Array.isArray(mediaEdges)) {
      mediaEdges.forEach((edge, idx) => {
        const node = edge.node || {};
        const captionEdges = node.edge_media_to_caption && node.edge_media_to_caption.edges;
        const caption = (captionEdges && captionEdges[0] && captionEdges[0].node.text) || '';
        const title = caption
          ? caption.split('\n')[0].substring(0, 100).trim()
          : `Post ${idx + 1}`;
        const hashtags = (caption.match(/#([A-Za-z0-9_]+)/g) || []).map((h) => h.substring(1));
        // URL for the post
        const shortCode = node.shortcode;
        const postUrl = shortCode ? `https://www.instagram.com/p/${shortCode}/` : '';
        posts.push({
          title,
          url: postUrl,
          caption,
          hashtags,
        });
      });
    }
  } catch (parseErr) {
    // If parsing fails, just return empty or partial results
    console.warn('Failed to parse Instagram HTML / sharedData:', parseErr.message);
  }

  return posts;
}

/**
 * Handle post request: expects { username }
 * Returns { posts, status } or { error, status }
 */
async function handlePostRequest(requestBody) {
  try {
    const { username } = requestBody || {};
    if (!username) {
      return { error: 'Username is required', status: 400 };
    }
    const posts = await scrapeInstagramPosts(username);
    return { posts, status: 200 };
  } catch (err) {
    return { error: String(err.message || err), status: 500 };
  }
}

// If executed directly, test with username “instagram”
if (require.main === module) {
  (async () => {
    try {
      const result = await handlePostRequest({ username: 'instagram' });
      console.log('Result:', JSON.stringify(result, null, 2));
    } catch (e) {
      console.error('Fatal error:', e);
    }
  })();
}

module.exports = { handlePostRequest };
