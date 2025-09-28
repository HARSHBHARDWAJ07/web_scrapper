import { ApifyClient } from 'apify-client';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ES module equivalent of __filename and __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Ultra-optimized Instagram Scraper for Single User
 * Extracts ONLY: title, caption, hashtags
 * Optimized for maximum speed with minimal data transfer
 */
class FastInstagramScraper {
    constructor(apiToken) {
        this.client = new ApifyClient({ token: apiToken });
    }

    /**
     * Main method - Gets posts with only title, caption, hashtags
     * @param {string} username - Instagram username (without @)
     * @param {number} maxPosts - Maximum posts to fetch (default: 12)
     * @returns {Promise<Object>} Structured post data
     */
    async getPostDetails(username, maxPosts = 12) {
        // Sanitize username
        const cleanUsername = username.replace('@', '').trim().toLowerCase();
        
        // Optimized Apify configuration for minimal data
        const input = {
            // Direct URL for fastest access
            directUrls: [`https://www.instagram.com/${cleanUsername}/`],
            
            // Essential configuration
            resultsType: "posts",
            resultsLimit: maxPosts,
            searchType: "user",
            searchLimit: 1,
            
            // Disable all unnecessary data to maximize speed
            addParentData: false,
            includeRelatedProfiles: false,
            expandOwners: false,
            
            // Custom extender to extract ONLY what we need
            extendOutputFunction: `async ({ data, item, itemSpec, page, request, customData }) => {
                // Only process if it's a post
                if (item.type !== 'Post') return null;
                
                // Extract hashtags efficiently
                const caption = item.caption || '';
                const hashtagRegex = /#[\\w\\u0590-\\u05ff]+/g;
                const hashtags = caption.match(hashtagRegex) || [];
                
                // Return ONLY required fields
                return {
                    title: item.title || caption.substring(0, 50) || 'No title',
                    caption: caption,
                    hashtags: [...new Set(hashtags)] // Remove duplicates
                };
            }`,
            
            // Proxy configuration for reliability
            proxy: {
                useApifyProxy: true,
                apifyProxyGroups: ["RESIDENTIAL"],
                apifyProxyCountry: "US"
            },
            
            // Performance settings
            maxRequestRetries: 1,  // Minimal retries for speed
            maxRequestsPerCrawl: 50,
            maxConcurrency: 5,
            pageTimeout: 20,
            
            // Minimal fields to fetch
            fields: ["caption", "title", "type"]
        };

        try {
            const startTime = Date.now();
            
            // Run the scraper
            const run = await this.client.actor("apify/instagram-scraper").call(input);
            
            // Get results
            const { items } = await this.client.dataset(run.defaultDatasetId).listItems();
            
            // Process and structure the minimal data
            const posts = this.processMinimalData(items);
            
            const endTime = Date.now();
            
            return {
                status: 'success',
                username: cleanUsername,
                postCount: posts.length,
                posts: posts,
                executionTime: `${(endTime - startTime) / 1000}s`
            };
            
        } catch (error) {
            return {
                status: 'error',
                username: cleanUsername,
                error: error.message,
                posts: []
            };
        }
    }

    /**
     * Process data with minimal overhead
     * @param {Array} items - Raw items from Apify
     * @returns {Array} Processed posts with only required fields
     */
    processMinimalData(items) {
        const posts = [];
        const seen = new Set(); // Deduplication
        
        for (const item of items) {
            // Skip if not a post or already processed
            if (!item || seen.has(item.shortCode)) continue;
            
            seen.add(item.shortCode);
            
            // Extract only what we need
            const caption = item.caption || '';
            const hashtags = this.extractHashtags(caption);
            
            posts.push({
                title: item.title || this.generateTitle(caption) || 'Untitled Post',
                caption: caption,
                hashtags: hashtags
            });
        }
        
        return posts;
    }

    /**
     * Extract hashtags with optimized regex
     * @param {string} text - Text to extract hashtags from
     * @returns {Array} Array of unique hashtags
     */
    extractHashtags(text) {
        if (!text) return [];
        
        // Optimized regex for hashtags (including Unicode support)
        const hashtags = text.match(/#[\w\u0590-\u05ff]+/g) || [];
        
        // Remove duplicates and return
        return [...new Set(hashtags)];
    }

    /**
     * Generate a title from caption if not available
     * @param {string} caption - Post caption
     * @returns {string} Generated title
     */
    generateTitle(caption) {
        if (!caption) return '';
        
        // Take first sentence or first 50 characters
        const firstSentence = caption.split(/[.!?]/)[0];
        if (firstSentence.length <= 50) {
            return firstSentence.trim();
        }
        
        // Truncate at word boundary
        return caption.substring(0, 50).replace(/\s+\S*$/, '') + '...';
    }
}

/**
 * Simplified async wrapper for immediate use
 */
async function getInstagramPosts(username, apiToken, maxPosts = 12) {
    const scraper = new FastInstagramScraper(apiToken);
    return await scraper.getPostDetails(username, maxPosts);
}

// ============================================
// USAGE EXAMPLE
// ============================================

async function example() {
    const API_TOKEN = 'YOUR_APIFY_API_TOKEN'; // Replace with your token
    const USERNAME = 'kirannydvvv'; // Single username
    const MAX_POSTS = 12; // Number of posts to fetch
    
    console.log(`Fetching posts for @${USERNAME}...`);
    
    const scraper = new FastInstagramScraper(API_TOKEN);
    const result = await scraper.getPostDetails(USERNAME, MAX_POSTS);
    
    if (result.status === 'success') {
        console.log(`✓ Fetched ${result.postCount} posts in ${result.executionTime}`);
        console.log('\nSample Output:');
        
        // Display first 3 posts as example
        result.posts.slice(0, 3).forEach((post, index) => {
            console.log(`\n--- Post ${index + 1} ---`);
            console.log('Title:', post.title);
            console.log('Caption:', post.caption.substring(0, 100) + '...');
            console.log('Hashtags:', post.hashtags.join(', '));
        });
    } else {
        console.error('✗ Error:', result.error);
    }
}

// ============================================
// EVEN SIMPLER - ONE-LINER FUNCTION
// ============================================

/**
 * One-line function for absolute simplicity
 * @example
 * const posts = await quickGetPosts('username', 'YOUR_TOKEN');
 */
async function quickGetPosts(username, apiToken, maxPosts = 12) {
    try {
        const client = new ApifyClient({ token: apiToken });
        
        const run = await client.actor("apify/instagram-scraper").call({
            directUrls: [`https://www.instagram.com/${username}/`],
            resultsType: "posts",
            resultsLimit: maxPosts,
            proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] }
        });
        
        const { items } = await client.dataset(run.defaultDatasetId).listItems();
        
        return items.map(item => ({
            title: item.title || item.caption?.substring(0, 50) || 'No title',
            caption: item.caption || '',
            hashtags: (item.caption?.match(/#[\w]+/g) || []).filter((v, i, a) => a.indexOf(v) === i)
        }));
        
    } catch (error) {
        console.error('Error:', error.message);
        return [];
    }
}

// Export all functions
export { 
    FastInstagramScraper, 
    getInstagramPosts, 
    quickGetPosts 
};

// ES module way to check if file is run directly
// In ES modules, we check if import.meta.url matches the main module
if (import.meta.url === `file://${process.argv[1]}`) {
    example();
}
