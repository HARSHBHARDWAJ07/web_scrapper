import express from "express";
import { ApifyClient } from "apify-client";

/**
 * Instagram Scraper using Apify
 * Extracts ONLY: title, caption, hashtags
 */
class FastInstagramScraper {
    constructor(apiToken) {
        this.client = new ApifyClient({ token: apiToken });
    }

    /**
     * Get Instagram posts for a username
     * @param {string} username - Instagram username (no @, just plain name)
     * @param {number} maxPosts - Number of posts to fetch
     */
    async getPostDetails(username, maxPosts = 12) {
        const cleanUsername = username.trim();

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
            const run = await this.client.actor("apify/instagram-scraper").call(input);
            const { items } = await this.client.dataset(run.defaultDatasetId).listItems();

            const posts = this.processMinimalData(items);

            return {
                username: cleanUsername,
                posts,
            };
        } catch (error) {
            return {
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
                caption,
                hashtags,
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

// Express API
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

// Run server directly if called via `node scrapper.js`
if (import.meta.url === `file://${process.argv[1]}`) {
    app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
}
