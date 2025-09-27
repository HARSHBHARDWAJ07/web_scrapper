const axios = require('axios');

// Bright Data API Configuration
const BRIGHT_DATA_API_TOKEN = 'cf96ceec4012206e60f60300367e67b980c3861afc10f2fe96aa1ec3f96e1360'; // Get from your Bright Data dashboard
const DATASET_ID = 'YOUR_DATASET_ID'; // e.g., for "Instagram - Posts - Discover by URL"
const API_URL = `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${DATASET_ID}&format=json`;

/**
 * Scrapes Instagram posts for a given username and returns filtered data.
 * @param {string} username - The Instagram username to scrape.
 * @returns {Promise<Array>} - Filtered array of posts with title, URL, caption, and hashtags.
 */
async function scrapeInstagramPosts(username) {
  // Construct the profile URL from the username
  const profileUrl = `https://www.instagram.com/${username}/`;

  try {
    console.log(`🟡 Initiating scrape for profile: ${username}`);

    const response = await axios({
      method: 'POST',
      url: API_URL,
      headers: {
        'Authorization': `Bearer ${BRIGHT_DATA_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      data: [{
        url: profileUrl
        // You can add other optional parameters here, like:
        // number_of_posts: 20, // Limit number of posts
        // start_date: "01-01-2024", // Filter by date (MM-DD-YYYY)
        // post_type: "post" // or "reel"
      }]
    });

    console.log('✅ Scraping successful. Filtering data...');

    // Filter the response to include only the required fields
    const filteredData = response.data.map(post => {
      // Use the description as the title, or a default if it's empty
      const postTitle = post.description ? post.description.split('\n')[0].substring(0, 100) : 'Untitled Post'; 

      return {
        title: postTitle,
        url: post.url, // URL of the specific post
        caption: post.description || '', // Full caption/description
        hashtags: post.hashtags || [] // Array of hashtags
      };
    });

    return filteredData;

  } catch (error) {
    console.error('❌ Scraping failed:');
    if (error.response) {
      // Server responded with an error status (4xx, 5xx)
      throw new Error(`Bright Data API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      // Request was made but no response received
      throw new Error('No response received from Bright Data API. Please check your network connection.');
    } else {
      // Something else went wrong
      throw new Error(`Request setup error: ${error.message}`);
    }
  }
}

// Example usage: Wrap in an async function
(async () => {
  try {
    const username = "example_user"; // Replace with the target username
    const posts = await scrapeInstagramPosts(username);

    console.log(`\n📊 Retrieved ${posts.length} posts for @${username}:`);
    console.log(JSON.stringify(posts, null, 2)); // Pretty print the result

  } catch (error) {
    console.error(error.message);
  }
})();