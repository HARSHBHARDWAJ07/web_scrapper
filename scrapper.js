import express from "express";
import { ApifyClient } from "apify-client";

/**
 * Ultra-optimized Instagram Scraper for Single User
 * Extracts ONLY: title, caption, hashtags
 */
class FastInstagramScraper {
    constructor(apiToken) {
        this.client = new ApifyClient({ token: apiToken });
    }

    /**
     * Main method - Gets posts with only title, caption, hashtags
     * @param {string} username - Instagram username (without @)
     * @param {number} maxPosts - Maximum posts to fetch
     * @returns {Promise<Object>}
     */
    async getPostDetails(username, maxPosts = 12) {
        const cleanUsername = username.replace("@", "").trim().toLowerCase();

        const input = {
            directUrls: [`https://www.instagram.com/${cleanUsername}/`],
            resultsType: "posts",
            resultsLimit: maxPosts,
            searchType: "user",
            searchLimit: 1,
            addParentData: false,
            includeRelatedProfiles: false,
            expandOwners: false,
            proxy: {
                useApifyProxy: true,
                apifyProxyGroups: ["RESIDENTIAL"],
                apifyProxyCountry: "US",
            },
            maxRequestRetries: 1,
            maxRequestsPerCrawl: 50,
            maxConcurrency: 5,
            pageTimeout: 20,
        };

        try {
            const startTime = Date.now();

            const run = await this.client.actor("apify/instagram-scraper").call(input);
            const { items } = await this.client.dataset(run.defaultDatasetId).listItems();

            const posts = this.processMinimalData(items);

            const endTime = Date.now();

            return {
                status: "success",
                username: cleanUsername,
                postCount: posts.length,
                posts: posts,
                executionTime: `${(endTime - startTime) / 1000}s`,
            };
        } catch (error) {
            return {
                status: "error",
                username: cleanUsername,
                error: error.message,
                posts: [],
            };
        }
    }

    processMinimalData(items) {
        const posts = [];
        const seen = new Set();

        for (const item of items) {
            if (!item || seen.has(item.shortCode)) continue;
            seen.add(item.shortCode);

            const caption = item.caption || "";
            const hashtags = this.extractHashtags(caption);

            posts.push({
                title: item.title || this.generateTitle(caption) || "Untitled Post",
                caption: caption,
                hashtags: hashtags,
            });
        }
        return posts;
    }

    extractHashtags(text) {
        if (!text) return [];
        const hashtags = text.match(/#[\w\u0590-\u05ff]+/g) || [];
        return [...new Set(hashtags)];
    }

    generateTitle(caption) {
        if (!caption) return "";
        const firstSentence = caption.split(/[.!?]/)[0];
        if (firstSentence.length <= 50) return firstSentence.trim();
        return caption.substring(0, 50).replace(/\s+\S*$/, "") + "...";
    }
}

// Helper function
export async function getInstagramPosts(username, apiToken, maxPosts = 12) {
    const scraper = new FastInstagramScraper(apiToken);
    return await scraper.getPostDetails(username, maxPosts);
}

// Simple one-liner
export async function quickGetPosts(username, apiToken, maxPosts = 12) {
    try {
        const client = new ApifyClient({ token: apiToken });

        const run = await client.actor("apify/instagram-scraper").call({
            directUrls: [`https://www.instagram.com/${username}/`],
            resultsType: "posts",
            resultsLimit: maxPosts,
            proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
        });

        const { items } = await client.dataset(run.defaultDatasetId).listItems();

        return items.map((item) => ({
            title: item.title || item.caption?.substring(0, 50) || "No title",
            caption: item.caption || "",
            hashtags: (item.caption?.match(/#[\w]+/g) || []).filter(
                (v, i, a) => a.indexOf(v) === i
            ),
        }));
    } catch (error) {
        console.error("Error:", error.message);
        return [];
    }
}

// ================================
// Express API Setup
// ================================
const app = express();
app.use(express.json());

const API_TOKEN = process.env.APIFY_API_TOKEN || "YOUR_APIFY_API_TOKEN";

app.post("/", async (req, res) => {
    try {
        const { username } = req.body;
        if (!username) {
            return res
                .status(400)
                .json({ status: "error", message: "Username is required" });
        }

        const scraper = new FastInstagramScraper(API_TOKEN);
        const result = await scraper.getPostDetails(username);

        return res.status(200).json(result);
    } catch (err) {
        console.error("Scrape error:", err);
        return res.status(500).json({ status: "error", message: err.message });
    }
});

const PORT = process.env.PORT || 3000;

// Run example if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

    // Example fetch
    const demo = new FastInstagramScraper(API_TOKEN);
    demo.getPostDetails("instagram", 5).then((r) =>
        console.log("Example fetch result:", r)
    );
}
