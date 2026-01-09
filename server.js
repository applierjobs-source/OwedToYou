const http = require('http');
const https = require('https');
const url = require('url');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { searchMissingMoney, getBrowserStats } = require('./missingMoneySearch');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { chromium } = require('playwright');
const { ApifyClient } = require('apify-client');
const sgMail = require('@sendgrid/mail');

// Initialize Apify client (only if token is provided)
let apifyClient = null;
if (process.env.APIFY_API_TOKEN) {
    try {
        apifyClient = new ApifyClient({
            token: process.env.APIFY_API_TOKEN,
        });
        console.log('[APIFY] ✅ Apify client initialized successfully');
    } catch (e) {
        console.error('[APIFY] ❌ Failed to initialize Apify client:', e.message);
        apifyClient = null;
    }
} else {
    console.warn('[APIFY] ⚠️ APIFY_API_TOKEN not set - Instagram name extraction will not work');
}

// Initialize SendGrid email service
let sendGridConfigured = false;
if (process.env.SENDGRID_API_KEY) {
    try {
        sgMail.setApiKey(process.env.SENDGRID_API_KEY);
        sendGridConfigured = true;
        console.log('[EMAIL] ✅ SendGrid initialized successfully');
    } catch (e) {
        console.error('[EMAIL] ❌ Failed to initialize SendGrid:', e.message);
        sendGridConfigured = false;
    }
} else {
    console.warn('[EMAIL] ⚠️ SENDGRID_API_KEY not set - email sending will not work');
}

const PORT = process.env.PORT || 3000;

// Handle unhandled promise rejections gracefully
process.on('unhandledRejection', (reason, promise) => {
    console.error('[UNHANDLED REJECTION] Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit - log and continue
    if (reason && typeof reason === 'object') {
        if (reason.code === 'ECONNRESET' || reason.code === 'ETIMEDOUT') {
            console.error('[UNHANDLED REJECTION] Connection error (non-fatal):', reason.code);
            return; // Don't crash on connection errors
        }
    }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('[UNCAUGHT EXCEPTION] Uncaught Exception:', error);
    // Only exit on non-connection errors
    if (error.code !== 'ECONNRESET' && error.code !== 'ETIMEDOUT') {
        console.error('[UNCAUGHT EXCEPTION] Fatal error, exiting...');
        process.exit(1);
    } else {
        console.error('[UNCAUGHT EXCEPTION] Connection error (non-fatal), continuing...');
    }
});

// PostgreSQL connection pool (only if DATABASE_URL is set)
let pool = null;
if (process.env.DATABASE_URL) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    console.log('[DATABASE] PostgreSQL connection pool created');
    console.log('[DATABASE] DATABASE_URL:', process.env.DATABASE_URL.substring(0, 20) + '...');
} else {
    console.warn('[DATABASE] WARNING: DATABASE_URL not set.');
    console.warn('[DATABASE] To fix: In Railway, link PostgreSQL service to your app service, or manually add DATABASE_URL variable.');
    console.warn('[DATABASE] Leaderboard will not persist until database is connected.');
}

// Initialize database table
async function initializeDatabase() {
    if (!pool) {
        console.warn('[DATABASE] Skipping initialization - no database connection');
        return;
    }
    
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS leaderboard (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                handle VARCHAR(255) UNIQUE NOT NULL,
                amount INTEGER NOT NULL DEFAULT 0,
                is_placeholder BOOLEAN NOT NULL DEFAULT false,
                entities JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Add entities column if it doesn't exist (for existing databases)
        try {
            await pool.query(`
                ALTER TABLE leaderboard 
                ADD COLUMN IF NOT EXISTS entities JSONB
            `);
        } catch (e) {
            // Column might already exist, ignore error
            console.log('[DATABASE] Entities column already exists or error adding:', e.message);
        }
        
        // CRITICAL: Add profile_pic column if it doesn't exist (for storing profile pictures)
        try {
            await pool.query(`
                ALTER TABLE leaderboard 
                ADD COLUMN IF NOT EXISTS profile_pic TEXT
            `);
            console.log('[DATABASE] Profile_pic column added or already exists');
        } catch (e) {
            // Column might already exist, ignore error
            console.log('[DATABASE] Profile_pic column already exists or error adding:', e.message);
        }
        
        // Create index on handle for faster lookups
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_leaderboard_handle ON leaderboard(handle)
        `);
        
        // CRITICAL: Create instagram_cache table to cache Apify results and reduce API calls
        await pool.query(`
            CREATE TABLE IF NOT EXISTS instagram_cache (
                username VARCHAR(255) PRIMARY KEY,
                profile_pic_url TEXT,
                full_name VARCHAR(255),
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Create index on updated_at for cache cleanup queries
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_instagram_cache_updated_at ON instagram_cache(updated_at)
        `);
        
        console.log('[DATABASE] Leaderboard table initialized successfully');
        console.log('[DATABASE] Instagram cache table initialized successfully');
    } catch (error) {
        console.error('[DATABASE] Error initializing database:', error);
        // Don't crash if database isn't available - app can still run
    }
}

// Initialize on startup
initializeDatabase();

// Simple CORS headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
};

// Fetch Instagram profile picture using Apify
async function fetchInstagramProfile(username) {
    // CRITICAL: Check database cache FIRST before calling Apify
    if (pool) {
        try {
            const cacheResult = await pool.query(
                `SELECT profile_pic_url, updated_at FROM instagram_cache WHERE username = $1 AND profile_pic_url IS NOT NULL AND updated_at > NOW() - INTERVAL '90 days'`,
                [username.toLowerCase()]
            );
            
            if (cacheResult.rows.length > 0 && cacheResult.rows[0].profile_pic_url) {
                console.log(`[PROFILE] ✅ Using cached profile pic for ${username} (from database)`);
                return { success: true, url: cacheResult.rows[0].profile_pic_url };
            }
        } catch (cacheError) {
            // If table doesn't exist, create it
            if (cacheError.message && cacheError.message.includes('does not exist')) {
                console.log(`[PROFILE] Cache table doesn't exist, creating it...`);
                try {
                    await pool.query(`
                        CREATE TABLE IF NOT EXISTS instagram_cache (
                            username VARCHAR(255) PRIMARY KEY,
                            profile_pic_url TEXT,
                            full_name VARCHAR(255),
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        )
                    `);
                    await pool.query(`
                        CREATE INDEX IF NOT EXISTS idx_instagram_cache_updated_at ON instagram_cache(updated_at)
                    `);
                    console.log(`[PROFILE] Cache table created successfully`);
                } catch (createError) {
                    console.error(`[PROFILE] Error creating cache table:`, createError.message);
                }
            } else {
                console.error(`[PROFILE] Error checking cache:`, cacheError.message);
            }
            // Continue to Apify call if cache check fails
        }
    }
    
    // Also check if profile pic already exists in leaderboard
    if (pool) {
        try {
            const leaderboardResult = await pool.query(
                `SELECT profile_pic FROM leaderboard WHERE handle = $1 AND profile_pic IS NOT NULL AND profile_pic != '' LIMIT 1`,
                [username.toLowerCase()]
            );
            
            if (leaderboardResult.rows.length > 0 && leaderboardResult.rows[0].profile_pic) {
                const existingPic = leaderboardResult.rows[0].profile_pic;
                // If it's a URL (not base64), use it
                if (existingPic.startsWith('http')) {
                    console.log(`[PROFILE] ✅ Using existing profile pic from leaderboard for ${username}`);
                    // Cache it for future use
                    if (pool) {
                        pool.query(
                            `INSERT INTO instagram_cache (username, profile_pic_url, updated_at) VALUES ($1, $2, NOW()) 
                             ON CONFLICT (username) DO UPDATE SET profile_pic_url = $2, updated_at = NOW()`,
                            [username.toLowerCase(), existingPic]
                        ).catch(() => {}); // Ignore errors
                    }
                    return { success: true, url: existingPic };
                }
            }
        } catch (leaderboardError) {
            console.error(`[PROFILE] Error checking leaderboard:`, leaderboardError.message);
            // Continue to Apify call if check fails
        }
    }
    
    // Use Apify Instagram scraper to get profile picture
    try {
        // Check if Apify client is initialized
        if (!apifyClient) {
            console.error(`[PROFILE] ❌ Apify client not initialized!`);
            return { success: false, error: 'Instagram API not configured. APIFY_API_TOKEN environment variable is missing.' };
        }
        
        // Check if Apify limit is already exceeded - don't even try if we know it's failed
        // This prevents wasting time and resources
        if (!apifyClient) {
            console.error(`[PROFILE] ❌ Apify client not initialized!`);
            return { success: false, error: 'Instagram API not configured. APIFY_API_TOKEN environment variable is missing.' };
        }
        
        // Reduced logging to avoid Railway rate limits - only log critical info
        console.log(`[PROFILE] 🔄 Calling Apify for ${username} (cache miss)`);
        
        // Prepare Apify Actor input
        // Use Instagram Profile Scraper specifically designed for profile data
        // It requires 'usernames' field (just the username, not full URL)
        const input = {
            usernames: [username], // Just the username, not the full URL
        };
        
        // Run the Profile Scraper Actor synchronously and get dataset items
        let run;
        try {
            run = await apifyClient.actor("apify~instagram-profile-scraper").call(input);
        } catch (actorError) {
            console.error(`[PROFILE] ❌ Apify actor call failed:`, actorError.message);
            if (actorError.message && (actorError.message.includes('401') || actorError.message.includes('unauthorized'))) {
                return { success: false, error: 'Apify API authentication failed. Please check APIFY_API_TOKEN environment variable.' };
            }
            // If monthly limit exceeded, don't try fallback - just return error
            if (actorError.message && actorError.message.includes('Monthly usage hard limit exceeded')) {
                console.error(`[PROFILE] ⚠️ Apify monthly limit exceeded - skipping fallback to save resources`);
                return { success: false, error: 'Instagram profile fetching is temporarily unavailable due to API limits. Please try again later.' };
            }
            throw actorError;
        }
        
        let items;
        try {
            const datasetResponse = await apifyClient.dataset(run.defaultDatasetId).listItems();
            items = datasetResponse.items;
        } catch (datasetError) {
            console.error(`[PROFILE] ❌ Failed to fetch dataset items:`, datasetError.message);
            return { success: false, error: `Failed to retrieve results from Apify: ${datasetError.message}` };
        }
        
        if (items && items.length > 0) {
            const item = items[0];
            // Only log critical info to avoid rate limits
            
            // Check for errors first
            if (item.error) {
                console.log(`[PROFILE] Apify error: ${item.error}`);
                // Instagram is blocking automated access - return helpful error
                if (item.error === 'not_found') {
                    return { 
                        success: false, 
                        error: 'Profile not found or Instagram is blocking automated access. The profile may be private, deleted, or Instagram\'s anti-scraping measures are preventing access.' 
                    };
                }
                return { success: false, error: `Profile access failed: ${item.errorDescription || item.error}` };
            }
            
            // Extract profile picture URL from various possible locations
            // Instagram Profile Scraper returns profile picture directly
            // Apify returns profilePicUrl and profilePicUrlHD (camelCase) for main profile
            let profilePicUrl = null;
            
            // Try different paths for profile picture (profile scraper structure)
            // Apify returns profilePicUrlHD and profilePicUrl (camelCase) - check these FIRST
            if (item.profilePicUrlHD) {
                profilePicUrl = item.profilePicUrlHD; // Prefer HD version
            } else if (item.profilePicUrl) {
                profilePicUrl = item.profilePicUrl;
            } else if (item.profile_pic_url) {
                profilePicUrl = item.profile_pic_url;
            } else if (item.profilePicUrlHd) {
                profilePicUrl = item.profilePicUrlHd; // Lowercase variant
            } else if (item.profile_pic_url_hd) {
                profilePicUrl = item.profile_pic_url_hd;
            } else if (item.profileImageUrl) {
                profilePicUrl = item.profileImageUrl;
            } else if (item.profile_image_url) {
                profilePicUrl = item.profile_image_url;
            } else if (item.imageUrl) {
                profilePicUrl = item.imageUrl;
            } else if (item.image_url) {
                profilePicUrl = item.image_url;
            } else if (item.profile && item.profile.profilePicUrlHD) {
                profilePicUrl = item.profile.profilePicUrlHD;
            } else if (item.profile && item.profile.profilePicUrl) {
                profilePicUrl = item.profile.profilePicUrl;
            } else if (item.profile && item.profile.profile_pic_url) {
                profilePicUrl = item.profile.profile_pic_url;
            } else if (item.user && item.user.profilePicUrlHD) {
                profilePicUrl = item.user.profilePicUrlHD;
            } else if (item.user && item.user.profilePicUrl) {
                profilePicUrl = item.user.profilePicUrl;
            } else if (item.user && item.user.profile_pic_url) {
                profilePicUrl = item.user.profile_pic_url;
            }
            
            if (profilePicUrl && profilePicUrl.length > 0) {
                console.log(`[PROFILE] SUCCESS: ${username} -> ${profilePicUrl.substring(0, 60)}...`);
                
                // CRITICAL: Cache the result in database to avoid future Apify calls
                if (pool) {
                    pool.query(
                        `INSERT INTO instagram_cache (username, profile_pic_url, updated_at) VALUES ($1, $2, NOW()) 
                         ON CONFLICT (username) DO UPDATE SET profile_pic_url = $2, updated_at = NOW()`,
                        [username.toLowerCase(), profilePicUrl]
                    ).catch(err => {
                        console.error(`[PROFILE] Error caching result:`, err.message);
                    });
                }
                
                return { success: true, url: profilePicUrl };
            }
        }
        
        // Fallback: Use Playwright to Google search for Instagram profile
        // DISABLED: This causes resource exhaustion errors. Only use if Apify fails but limit not exceeded
        // try {
        //     const googleResult = await fetchInstagramProfileGoogleFallback(username);
        //     if (googleResult.success && googleResult.url) {
        //         console.log(`[PROFILE] Google fallback SUCCESS: ${username}`);
        //         return googleResult;
        //     }
        // } catch (googleError) {
        //     // Silently continue - fallback failed
        // }
        
        // If both methods failed
        return { success: false, error: 'Profile picture not found' };
    } catch (error) {
        // DISABLED: Google fallback causes resource exhaustion
        // Only try Google fallback if it's NOT a limit exceeded error
        // if (!error.message || !error.message.includes('Monthly usage hard limit exceeded')) {
        //     try {
        //         const googleResult = await fetchInstagramProfileGoogleFallback(username);
        //         if (googleResult.success && googleResult.url) {
        //             console.log(`[PROFILE] Google fallback SUCCESS after error: ${username}`);
        //             return googleResult;
        //         }
        //     } catch (googleError) {
        //         // Silently continue
        //     }
        // }
        
        return { success: false, error: `Failed: ${error.message}` };
    }
}

// Google search fallback for profile pictures
async function fetchInstagramProfileGoogleFallback(username) {
    let browser = null;
    try {
        console.log(`[PROFILE] 🔍 Google search fallback: Searching for Instagram profile ${username}`);
        
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--window-size=1920,1080'
            ]
        });
        
        const context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            locale: 'en-US',
            timezoneId: 'America/Chicago',
            colorScheme: 'light',
            extraHTTPHeaders: {
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Referer': 'https://www.google.com/',
            }
        });
        
        const page = await context.newPage();
        
        // Search Google for Instagram profile
        const searchQuery = `site:instagram.com ${username}`;
        const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;
        console.log(`[PROFILE] 🔍 Navigating to Google search: ${googleUrl}`);
        
        await page.goto(googleUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);
        
        // Look for Instagram profile picture in search results
        // Google often shows profile pictures in image results or structured data
        const pageContent = await page.content();
        
        // Try to find profile picture URL in the page
        // Look for Instagram CDN URLs
        const profilePicPatterns = [
            /https:\/\/[^"'\s]*\.cdninstagram\.com\/v\/t51\.2885-19\/[^"'\s]*\.jpg[^"'\s]*/gi,
            /https:\/\/[^"'\s]*scontent[^"'\s]*\.cdninstagram\.com\/[^"'\s]*\.jpg[^"'\s]*/gi,
            /"profile_pic_url"\s*:\s*"([^"]+)"/i,
            /profilePicUrl["\s]*:["\s]*"([^"]+)"/i,
        ];
        
        let profilePicUrl = null;
        for (const pattern of profilePicPatterns) {
            const matches = pageContent.match(pattern);
            if (matches && matches.length > 0) {
                // Get the first match, prefer larger sizes
                const urls = matches.map(m => {
                    const urlMatch = m.match(/https:\/\/[^"'\s]+/);
                    return urlMatch ? urlMatch[0] : null;
                }).filter(Boolean);
                
                if (urls.length > 0) {
                    // Prefer URLs with larger size indicators (320, 640, 1080)
                    const sorted = urls.sort((a, b) => {
                        const sizeA = a.match(/(\d{3,4})/)?.[1] || '0';
                        const sizeB = b.match(/(\d{3,4})/)?.[1] || '0';
                        return parseInt(sizeB) - parseInt(sizeA);
                    });
                    profilePicUrl = sorted[0];
                    console.log(`[PROFILE] ✅ Found profile picture via Google search: ${profilePicUrl.substring(0, 100)}...`);
                    break;
                }
            }
        }
        
        // Also try clicking on the first Instagram result if no direct match
        if (!profilePicUrl) {
            try {
                const instagramLink = await page.$('a[href*="instagram.com/' + username + '"]');
                if (instagramLink) {
                    console.log(`[PROFILE] 🔍 Clicking Instagram link in Google results...`);
                    await instagramLink.click();
                    await page.waitForTimeout(3000);
                    
                    const instagramContent = await page.content();
                    // Look for profile picture in Instagram page
                    const instagramPatterns = [
                        /"profile_pic_url_hd"\s*:\s*"([^"]+)"/i,
                        /"profile_pic_url"\s*:\s*"([^"]+)"/i,
                        /profilePicUrlHD["\s]*:["\s]*"([^"]+)"/i,
                        /profilePicUrl["\s]*:["\s]*"([^"]+)"/i,
                    ];
                    
                    for (const pattern of instagramPatterns) {
                        const match = instagramContent.match(pattern);
                        if (match && match[1]) {
                            profilePicUrl = match[1];
                            console.log(`[PROFILE] ✅ Found profile picture on Instagram page: ${profilePicUrl.substring(0, 100)}...`);
                            break;
                        }
                    }
                }
            } catch (e) {
                console.log(`[PROFILE] Error clicking Instagram link: ${e.message}`);
            }
        }
        
        await browser.close();
        
        if (profilePicUrl && profilePicUrl.length > 0) {
            return { success: true, url: profilePicUrl };
        } else {
            return { success: false, error: 'Profile picture not found via Google search fallback' };
        }
    } catch (error) {
        if (browser) {
            try {
                await browser.close();
            } catch (e) {
                // Ignore close errors
            }
        }
        console.error(`[PROFILE] Google search fallback error for ${username}:`, error.message);
        return { success: false, error: `Google search fallback failed: ${error.message}` };
    }
}

// OLD Playwright implementation (keeping for reference)
async function fetchInstagramProfile_OLD_PLAYWRIGHT(username) {
    // Use Playwright to intercept API responses (same method as name extraction)
    let browser = null;
    try {
        console.log(`[PROFILE] Using Playwright to extract profile picture for ${username}`);
        
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-background-networking',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-breakpad',
                '--disable-client-side-phishing-detection',
                '--disable-component-update',
                '--disable-default-apps',
                '--disable-domain-reliability',
                '--disable-features=AudioServiceOutOfProcess',
                '--disable-hang-monitor',
                '--disable-ipc-flooding-protection',
                '--disable-notifications',
                '--disable-offer-store-unmasked-wallet-cards',
                '--disable-popup-blocking',
                '--disable-print-preview',
                '--disable-prompt-on-repost',
                '--disable-renderer-backgrounding',
                '--disable-speech-api',
                '--disable-sync',
                '--hide-scrollbars',
                '--ignore-gpu-blacklist',
                '--metrics-recording-only',
                '--mute-audio',
                '--no-default-browser-check',
                '--no-pings',
                '--password-store=basic',
                '--use-mock-keychain',
                '--window-size=1920,1080'
            ]
        });
        
        const context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            locale: 'en-US',
            timezoneId: 'America/Chicago',
            permissions: ['geolocation'],
            geolocation: { latitude: 30.2672, longitude: -97.7431 },
            colorScheme: 'light',
            extraHTTPHeaders: {
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Cache-Control': 'max-age=0',
                'Referer': 'https://www.google.com/',
                'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"macOS"'
            }
        });
        
        const page = await context.newPage();
        
        // Intercept network requests to catch Instagram API calls
        const apiResponses = [];
        page.on('response', async (response) => {
            const url = response.url();
            if (url.includes('graphql') || url.includes('api/v1') || url.includes('web_profile_info')) {
                try {
                    const json = await response.json().catch(() => null);
                    if (json) {
                        apiResponses.push({ url, data: json });
                        console.log(`[PROFILE] Caught API response from: ${url.substring(0, 100)}`);
                    }
                } catch (e) {
                    // Not JSON, ignore
                }
            }
        });
        
        // Add stealth scripts
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            window.chrome = { runtime: {}, loadTimes: function() {}, csi: function() {}, app: {} };
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
            Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
            if (navigator.getBattery) {
                navigator.getBattery = () => Promise.resolve({
                    charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1
                });
            }
        });
        
        // Call the API endpoint
        const apiUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
        console.log(`[PROFILE] Calling API endpoint: ${apiUrl}`);
        
        await page.setExtraHTTPHeaders({
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'X-IG-App-ID': '936619743392459',
            'X-IG-WWW-Claim': '0',
            'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"macOS"'
        });
        
        try {
            // Wait for response with longer timeout
            const response = await page.goto(apiUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
            console.log(`[PROFILE] Page loaded, status: ${response ? response.status() : 'unknown'}`);
            
            // Wait longer for API interception to catch responses
            await page.waitForTimeout(3000);
            
            // Extract profile picture from intercepted API responses first
            let profilePicUrl = null;
            console.log(`[PROFILE] Checking ${apiResponses.length} intercepted API responses for ${username}...`);
            
            if (apiResponses.length > 0) {
                for (const apiResponse of apiResponses) {
                    try {
                        const data = apiResponse.data;
                        console.log(`[PROFILE] API response URL: ${apiResponse.url.substring(0, 150)}`);
                        console.log(`[PROFILE] API response keys for ${username}:`, Object.keys(data || {}).slice(0, 10));
                        
                        // Try multiple possible paths for profile picture
                        if (data && data.data && data.data.user) {
                            console.log(`[PROFILE] Found user object for ${username}, checking profile_pic_url...`);
                            profilePicUrl = data.data.user.profile_pic_url_hd || 
                                          data.data.user.profile_pic_url || 
                                          data.data.user.profile_pic_url_hd || 
                                          data.data.user.profile_pic_url;
                            if (profilePicUrl) {
                                console.log(`[PROFILE] ✅ Found profile picture in intercepted API response for ${username}: ${profilePicUrl.substring(0, 100)}...`);
                                break;
                            } else {
                                console.log(`[PROFILE] ⚠️ User object found for ${username} but no profile_pic_url`);
                                console.log(`[PROFILE] User object keys:`, Object.keys(data.data.user || {}).slice(0, 30));
                            }
                        }
                        // Try alternative structure: data.user
                        if (!profilePicUrl && data && data.user) {
                            console.log(`[PROFILE] Found user object at data.user for ${username}`);
                            profilePicUrl = data.user.profile_pic_url_hd || data.user.profile_pic_url;
                            if (profilePicUrl) {
                                console.log(`[PROFILE] ✅ Found profile picture in alternative structure for ${username}: ${profilePicUrl.substring(0, 100)}...`);
                                break;
                            }
                        }
                        // Try root level user
                        if (!profilePicUrl && data && data.profile_pic_url) {
                            profilePicUrl = data.profile_pic_url_hd || data.profile_pic_url;
                            if (profilePicUrl) {
                                console.log(`[PROFILE] ✅ Found profile picture at root level for ${username}: ${profilePicUrl.substring(0, 100)}...`);
                                break;
                            }
                        }
                    } catch (e) {
                        console.log(`[PROFILE] Error parsing intercepted API response for ${username}: ${e.message}`);
                        console.log(`[PROFILE] Error stack:`, e.stack);
                    }
                }
            } else {
                console.log(`[PROFILE] ⚠️ No intercepted API responses found for ${username}, trying direct response...`);
            }
            
            // Also try direct response if interception didn't work
            if (!profilePicUrl && response && response.ok()) {
                try {
                    const json = await response.json().catch(() => null);
                    if (json) {
                        console.log(`[PROFILE] Direct API response keys for ${username}:`, Object.keys(json).slice(0, 10));
                        // Try data.data.user path
                        if (json.data && json.data.user) {
                            profilePicUrl = json.data.user.profile_pic_url_hd || json.data.user.profile_pic_url;
                            if (profilePicUrl) {
                                console.log(`[PROFILE] ✅ Found profile picture in direct API response (data.data.user) for ${username}: ${profilePicUrl.substring(0, 100)}...`);
                            }
                        }
                        // Try data.user path
                        if (!profilePicUrl && json.data && json.data.user) {
                            profilePicUrl = json.data.user.profile_pic_url_hd || json.data.user.profile_pic_url;
                            if (profilePicUrl) {
                                console.log(`[PROFILE] ✅ Found profile picture in direct API response (data.user) for ${username}: ${profilePicUrl.substring(0, 100)}...`);
                            }
                        }
                        // Try user path
                        if (!profilePicUrl && json.user) {
                            profilePicUrl = json.user.profile_pic_url_hd || json.user.profile_pic_url;
                            if (profilePicUrl) {
                                console.log(`[PROFILE] ✅ Found profile picture in direct API response (user) for ${username}: ${profilePicUrl.substring(0, 100)}...`);
                            }
                        }
                        if (!profilePicUrl) {
                            console.log(`[PROFILE] ⚠️ Direct API response doesn't have expected structure for ${username}`);
                        }
                    } else {
                        const text = await response.text().catch(() => '');
                        console.log(`[PROFILE] Direct response is not JSON, first 500 chars:`, text.substring(0, 500));
                    }
                } catch (e) {
                    console.log(`[PROFILE] Error parsing direct API response for ${username}: ${e.message}`);
                    console.log(`[PROFILE] Error stack:`, e.stack);
                }
            } else if (!profilePicUrl) {
                console.log(`[PROFILE] ⚠️ Response not OK for ${username}:`, response ? response.status() : 'No response');
            }
            
            await browser.close();
            
            if (profilePicUrl) {
                console.log(`[PROFILE] ✅✅✅ SUCCESS: Returning profile picture URL for ${username}`);
                return { success: true, url: profilePicUrl };
            } else {
                console.log(`[PROFILE] ❌❌❌ FAILED: Profile picture not found for ${username}`);
                return { success: false, error: 'Profile picture not found in API response' };
            }
        } catch (error) {
            if (browser) {
                try {
                    await browser.close();
                } catch (e) {
                    // Ignore close errors
                }
            }
            console.error(`[PROFILE] Playwright error for ${username}:`, error.message);
            console.error(`[PROFILE] Error stack:`, error.stack);
            return { success: false, error: `Playwright error: ${error.message}` };
        }
    } catch (error) {
        if (browser) {
            try {
                await browser.close();
            } catch (e) {
                // Ignore close errors
            }
        }
        console.error(`[PROFILE] Error fetching profile picture for ${username}:`, error.message);
        return { success: false, error: error.message };
    }
}

// OLD HTTP-based extraction (keeping as fallback, but Playwright is now primary)
async function fetchInstagramProfile_OLD(username) {
    return new Promise((resolve, reject) => {
        const instagramUrl = `https://www.instagram.com/${username}/`;
        
        const options = {
            hostname: 'www.instagram.com',
            path: `/${username}/`,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Cache-Control': 'max-age=0',
                'DNT': '1',
                'Referer': 'https://www.instagram.com/',
                'Origin': 'https://www.instagram.com'
            }
        };
        
        const req = https.get(options, (res) => {
            console.log(`[PROFILE] Response status: ${res.statusCode} for ${username}`);
            
            // Check for redirects to login page - don't follow these
            if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
                const location = res.headers.location || '';
                console.log(`[PROFILE] Redirect detected to: ${location}`);
                // If redirecting to login page, it means Instagram is blocking us
                if (location.includes('/accounts/login/') || location.includes('login')) {
                    console.log(`[PROFILE] Redirect to login page detected - Instagram is blocking requests`);
                    resolve({ success: false, error: 'Instagram is requiring login (blocking detected)' });
                    return;
                }
                // For other redirects, treat as failure
                resolve({ success: false, error: `Redirect to ${location} - likely blocked` });
                return;
            }
            
            // Check for error status codes
            if (res.statusCode !== 200) {
                console.log(`[PROFILE] Non-200 status code: ${res.statusCode} for ${username}`);
                let errorBody = '';
                res.on('data', (chunk) => { errorBody += chunk.toString(); });
                res.on('end', () => {
                    console.log(`[PROFILE] Error response body (first 200 chars):`, errorBody.substring(0, 200));
                    resolve({ success: false, error: `HTTP ${res.statusCode}: ${res.statusMessage || 'Request failed'}` });
                });
                return;
            }
            
            let html = '';
            let stream = res;
            
            // Handle gzip/deflate compression
            if (res.headers['content-encoding'] === 'gzip') {
                stream = res.pipe(zlib.createGunzip());
            } else if (res.headers['content-encoding'] === 'deflate') {
                stream = res.pipe(zlib.createInflate());
            } else if (res.headers['content-encoding'] === 'br') {
                stream = res.pipe(zlib.createBrotliDecompress());
            }
            
            stream.on('data', (chunk) => {
                html += chunk.toString();
            });
            
            stream.on('error', (err) => {
                console.error(`[PROFILE] Stream error for ${username}:`, err.message);
                resolve({ success: false, error: `Stream error: ${err.message}` });
            });
            
            stream.on('end', () => {
                try {
                    // Debug: log HTML length
                    console.log(`[PROFILE] Fetched HTML for ${username}, length: ${html.length}`);
                    
                    if (html.length === 0) {
                        console.log(`[PROFILE] Empty response for ${username} - possible blocking or error`);
                        resolve({ success: false, error: 'Empty response from Instagram (possibly blocked)' });
                        return;
                    }
                    
                    // Check if we got a login page or error page
                    // Only check for login if it's clearly a login redirect, not just the word "login" in the HTML
                    if ((html.includes('Log in to Instagram') || html.includes('login_required')) && html.length < 100000) {
                        console.log('[PROFILE] Login page detected');
                        resolve({ success: false, error: 'Login required' });
                        return;
                    }
                    
                    if (html.length < 10000) {
                        console.log(`[PROFILE] Insufficient HTML: ${html.length} bytes`);
                        if (html.length > 0) {
                            console.log(`[PROFILE] Response preview (first 500 chars):`, html.substring(0, 500));
                        }
                        resolve({ success: false, error: 'Insufficient HTML received' });
                        return;
                    }
                    
                    // Debug: Save a sample of the HTML to see structure
                    if (username === 'zach.arrow') {
                        const sample = html.substring(0, 10000);
                        console.log('HTML sample (first 10KB):', sample.substring(0, 500));
                    }
                    
                    // Try to extract from window._sharedData (multiple patterns)
                    const sharedDataPatterns = [
                        /window\._sharedData\s*=\s*({[\s\S]+?});\s*<\/script>/,
                        /window\._sharedData\s*=\s*({.+?});/s
                    ];
                    
                    for (const pattern of sharedDataPatterns) {
                        const sharedDataMatch = html.match(pattern);
                        if (sharedDataMatch && sharedDataMatch[1]) {
                            try {
                                let jsonStr = sharedDataMatch[1].trim();
                                jsonStr = jsonStr.replace(/;[\s]*$/, '');
                                const sharedData = JSON.parse(jsonStr);
                                
                                // Try multiple paths
                                const possiblePaths = [
                                    sharedData?.entry_data?.ProfilePage?.[0]?.graphql?.user?.profile_pic_url_hd,
                                    sharedData?.entry_data?.ProfilePage?.[0]?.graphql?.user?.profile_pic_url,
                                    sharedData?.entry_data?.ProfilePage?.[0]?.user?.profile_pic_url_hd,
                                    sharedData?.entry_data?.ProfilePage?.[0]?.user?.profile_pic_url
                                ];
                                
                                for (const profilePic of possiblePaths) {
                                    if (profilePic && typeof profilePic === 'string' && profilePic.startsWith('http')) {
                                        resolve({ success: true, url: profilePic });
                                        return;
                                    }
                                }
                            } catch (e) {
                                // Try next pattern
                                continue;
                            }
                        }
                    }
                    
                    // Try meta tags (og:image) - this is the most reliable method
                    // The URL is in: property="og:image" content="URL_HERE"
                    const metaPatterns = [
                        /property="og:image"\s+content="([^"]+)"/i,
                        /<meta\s+property="og:image"\s+content="([^"]+)"/i,
                        /<meta\s+name="og:image"\s+content="([^"]+)"/i
                    ];
                    
                    for (let i = 0; i < metaPatterns.length; i++) {
                        const pattern = metaPatterns[i];
                        const metaMatch = html.match(pattern);
                        if (metaMatch && metaMatch[1]) {
                            let url = metaMatch[1]
                                .replace(/&amp;/g, '&')
                                .replace(/&quot;/g, '"')
                                .replace(/&#39;/g, "'")
                                .replace(/&lt;/g, '<')
                                .replace(/&gt;/g, '>');
                            
                            // Make sure it's not a generic Instagram icon and is a valid profile picture URL
                            if (url && 
                                url.startsWith('http') && 
                                !url.includes('rsrc.php') && 
                                !url.includes('static.cdninstagram.com/rsrc') &&
                                (url.includes('cdninstagram') || url.includes('scontent') || url.includes('instagram'))) {
                                console.log(`Found profile picture via og:image`);
                                resolve({ success: true, url: url });
                                return;
                            }
                        }
                    }
                    
                    // Fallback: Search for profile picture URL pattern directly in HTML
                    // Look for scontent URLs that are likely profile pictures
                    const directUrlPatterns = [
                        /https:\/\/[^"'\s]*scontent[^"'\s]*cdninstagram[^"'\s]*\.(jpg|jpeg|png|webp)[^"'\s]*/gi,
                        /https:\/\/[^"'\s]*cdninstagram[^"'\s]*\/v\/t51\.2885-19[^"'\s]*\.(jpg|jpeg|png|webp)[^"'\s]*/gi
                    ];
                    
                    for (const pattern of directUrlPatterns) {
                        const matches = html.match(pattern);
                        if (matches && matches.length > 0) {
                            // Filter out generic icons and get the first valid profile picture URL
                            for (const match of matches) {
                                const url = match.replace(/&amp;/g, '&');
                                if (url && 
                                    !url.includes('rsrc.php') && 
                                    !url.includes('static.cdninstagram.com/rsrc') &&
                                    (url.includes('t51.2885-19') || url.includes('profile'))) {
                                    console.log(`Found profile picture via direct URL pattern`);
                                    resolve({ success: true, url: url });
                                    return;
                                }
                            }
                        }
                    }
                    
                    // Also try a more lenient pattern that catches the URL even if it spans multiple lines or has different formatting
                    const lenientPattern = /og:image["\s]+content=["']([^"']+cdninstagram[^"']+\.(jpg|jpeg|png|webp)[^"']*)["']/i;
                    const lenientMatch = html.match(lenientPattern);
                    if (lenientMatch && lenientMatch[1]) {
                        let url = lenientMatch[1].replace(/&amp;/g, '&');
                        if (url.startsWith('http') && !url.includes('rsrc.php')) {
                            console.log(`Found profile picture via lenient pattern: ${url.substring(0, 100)}...`);
                            resolve({ success: true, url: url });
                            return;
                        }
                    }
                    
                    // Try to find profile picture URLs in the HTML directly
                    // Look for Instagram CDN URLs that are likely profile pictures
                    const cdnPatterns = [
                        /"profile_pic_url_hd"\s*:\s*"([^"]+)"/,
                        /"profile_pic_url"\s*:\s*"([^"]+)"/,
                        /profile_pic_url_hd["\s]*:["\s]*"([^"]+)"/,
                        /profile_pic_url["\s]*:["\s]*"([^"]+)"/,
                        /https:\/\/[^"'\s]*\.cdninstagram\.com\/[^"'\s]*\/[^"'\s]*\.(jpg|jpeg|png|webp)[^"'\s]*/gi
                    ];
                    
                    for (const pattern of cdnPatterns) {
                        const matches = html.match(pattern);
                        if (matches) {
                            let url = matches[1] || matches[0];
                            if (url) {
                                url = url.replace(/\\u0026/g, '&')
                                         .replace(/\\\//g, '/')
                                         .replace(/\\"/g, '"')
                                         .replace(/\\u003C/g, '<')
                                         .replace(/\\u003E/g, '>');
                                
                                // Filter out generic icons and make sure it's a valid URL
                                if (url.startsWith('http') && 
                                    !url.includes('rsrc.php') && 
                                    !url.includes('static.cdninstagram.com/rsrc') &&
                                    (url.includes('cdninstagram') || url.includes('instagram') || url.includes('fbcdn'))) {
                                    console.log(`Found profile picture URL via pattern: ${url}`);
                                    resolve({ success: true, url: url });
                                    return;
                                }
                            }
                        }
                    }
                    
                    // Last resort: try to find any image URL that might be a profile picture
                    // Look for URLs with common profile picture size indicators
                    const sizePatterns = [
                        /https:\/\/[^"'\s]*\.cdninstagram\.com\/[^"'\s]*(150|320|640|1080)[^"'\s]*\.(jpg|jpeg|png|webp)/gi
                    ];
                    
                    for (const pattern of sizePatterns) {
                        const matches = html.match(pattern);
                        if (matches && matches.length > 0) {
                            // Prefer larger sizes (1080 > 640 > 320 > 150)
                            const sorted = matches.sort((a, b) => {
                                const sizeA = a.match(/(\d+)/)?.[1] || '0';
                                const sizeB = b.match(/(\d+)/)?.[1] || '0';
                                return parseInt(sizeB) - parseInt(sizeA);
                            });
                            const url = sorted[0];
                            if (url && !url.includes('rsrc.php')) {
                                console.log(`Found profile picture URL via size pattern: ${url}`);
                                resolve({ success: true, url: url });
                                return;
                            }
                        }
                    }
                    
                    resolve({ success: false, error: 'Profile picture not found in HTML' });
                } catch (error) {
                    reject(error);
                }
            });
        });
        
        req.on('error', (error) => {
            console.error(`[PROFILE] Request error for ${username}:`, error.message);
            console.error(`[PROFILE] Error code:`, error.code);
            resolve({ success: false, error: `Request failed: ${error.message}` });
        });
        
        req.setTimeout(10000, () => {
            console.error(`[PROFILE] Request timeout for ${username}`);
            req.destroy();
            resolve({ success: false, error: 'Request timeout' });
        });
    });
}

// Fetch Instagram full name
async function fetchInstagramFullName(username) {
    // CRITICAL: Check database cache FIRST before calling Apify
    if (pool) {
        try {
            const cacheResult = await pool.query(
                `SELECT full_name, updated_at FROM instagram_cache WHERE username = $1 AND full_name IS NOT NULL AND updated_at > NOW() - INTERVAL '90 days'`,
                [username.toLowerCase()]
            );
            
            if (cacheResult.rows.length > 0 && cacheResult.rows[0].full_name) {
                console.log(`[INSTAGRAM] ✅ Using cached name for ${username} (from database): ${cacheResult.rows[0].full_name}`);
                return { success: true, fullName: cacheResult.rows[0].full_name };
            }
        } catch (cacheError) {
            // If table doesn't exist, create it
            if (cacheError.message && cacheError.message.includes('does not exist')) {
                console.log(`[INSTAGRAM] Cache table doesn't exist, creating it...`);
                try {
                    await pool.query(`
                        CREATE TABLE IF NOT EXISTS instagram_cache (
                            username VARCHAR(255) PRIMARY KEY,
                            profile_pic_url TEXT,
                            full_name VARCHAR(255),
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        )
                    `);
                    await pool.query(`
                        CREATE INDEX IF NOT EXISTS idx_instagram_cache_updated_at ON instagram_cache(updated_at)
                    `);
                    console.log(`[INSTAGRAM] Cache table created successfully`);
                } catch (createError) {
                    console.error(`[INSTAGRAM] Error creating cache table:`, createError.message);
                }
            } else {
                console.error(`[INSTAGRAM] Error checking cache:`, cacheError.message);
            }
            // Continue to Apify call if cache check fails
        }
    }
    
    // Use Apify Instagram scraper to get profile data
    try {
        console.log(`[INSTAGRAM] 🔄 Calling Apify to extract name for ${username} (cache miss)`);
        
        // Check if Apify client is initialized
        if (!apifyClient) {
            console.error(`[INSTAGRAM] ❌ Apify client not initialized!`);
            return { success: false, error: 'Instagram API not configured. APIFY_API_TOKEN environment variable is missing.' };
        }
        
        // Prepare Apify Actor input
        // Use Instagram Profile Scraper specifically designed for profile data
        // It requires 'usernames' field (just the username, not full URL)
        const input = {
            usernames: [username], // Just the username, not the full URL
        };
        
        console.log(`[INSTAGRAM] Calling Apify actor with input:`, JSON.stringify(input));
        
        // Run the Profile Scraper Actor synchronously and get dataset items
        let run;
        try {
            run = await apifyClient.actor("apify~instagram-profile-scraper").call(input);
            console.log(`[INSTAGRAM] Apify run completed, run ID: ${run.id}, status: ${run.status}`);
        } catch (actorError) {
            console.error(`[INSTAGRAM] ❌ Apify actor call failed:`, actorError.message);
            console.error(`[INSTAGRAM] Error details:`, actorError);
            // Check if it's an authentication error
            if (actorError.message && (actorError.message.includes('401') || actorError.message.includes('unauthorized') || actorError.message.includes('token'))) {
                return { success: false, error: 'Apify API authentication failed. Please check APIFY_API_TOKEN environment variable.' };
            }
            // Check if it's a rate limit error
            if (actorError.message && (actorError.message.includes('429') || actorError.message.includes('rate limit'))) {
                return { success: false, error: 'Apify API rate limit exceeded. Please try again later.' };
            }
            throw actorError; // Re-throw to be caught by outer catch
        }
        
        let items;
        try {
            console.log(`[INSTAGRAM] Fetching dataset items from run ${run.id}...`);
            const datasetResponse = await apifyClient.dataset(run.defaultDatasetId).listItems();
            items = datasetResponse.items;
            console.log(`[INSTAGRAM] Received ${items ? items.length : 0} items from Apify`);
        } catch (datasetError) {
            console.error(`[INSTAGRAM] ❌ Failed to fetch dataset items:`, datasetError.message);
            console.error(`[INSTAGRAM] Dataset error details:`, datasetError);
            return { success: false, error: `Failed to retrieve results from Apify: ${datasetError.message}` };
        }
        
        if (items && items.length > 0) {
            const item = items[0];
            
            // Check for errors first
            if (item.error) {
                console.log(`[INSTAGRAM] ⚠️ Apify returned error: ${item.error} - ${item.errorDescription || ''}`);
                // Instagram is blocking automated access - return helpful error
                if (item.error === 'not_found') {
                    return { 
                        success: false, 
                        error: 'Profile not found or Instagram is blocking automated access. The profile may be private, deleted, or Instagram\'s anti-scraping measures are preventing access. Please try searching by full name instead.' 
                    };
                }
                return { success: false, error: `Profile access failed: ${item.errorDescription || item.error}` };
            }
            
            // Extract full_name from various possible locations
            // Instagram Profile Scraper returns profile data directly
            let fullName = null;
            
            // Log the item structure for debugging (safely)
            if (item && typeof item === 'object') {
                try {
                    console.log(`[INSTAGRAM] Apify item keys:`, Object.keys(item));
                } catch (e) {
                    console.log(`[INSTAGRAM] Could not log item keys:`, e.message);
                }
            }
            console.log(`[INSTAGRAM] Checking for fullName/full_name in item...`);
            
            // Try different paths for full_name (profile scraper structure)
            if (item.fullName && item.fullName.trim().length > 0) {
                fullName = item.fullName.trim();
                console.log(`[INSTAGRAM] ✅ Found name in item.fullName: "${fullName}"`);
            } else if (item.full_name && item.full_name.trim().length > 0) {
                fullName = item.full_name.trim();
                console.log(`[INSTAGRAM] ✅ Found name in item.full_name: "${fullName}"`);
            } else if (item.name && item.name.trim().length > 0 && item.name.includes(' ')) {
                // Only use item.name if it looks like a full name (has space)
                fullName = item.name.trim();
                console.log(`[INSTAGRAM] ✅ Found name in item.name: "${fullName}"`);
            } else if (item.biography && item.biography.includes(' ')) {
                // Sometimes full name is in biography (first line)
                const bioLines = item.biography.split('\n');
                if (bioLines.length > 0 && bioLines[0].includes(' ') && bioLines[0].trim().length > 0) {
                    fullName = bioLines[0].trim();
                    console.log(`[INSTAGRAM] ✅ Found name in biography: "${fullName}"`);
                }
            } else if (item.profile && item.profile.fullName && item.profile.fullName.trim().length > 0) {
                fullName = item.profile.fullName.trim();
                console.log(`[INSTAGRAM] ✅ Found name in item.profile.fullName: "${fullName}"`);
            } else if (item.profile && item.profile.full_name && item.profile.full_name.trim().length > 0) {
                fullName = item.profile.full_name.trim();
                console.log(`[INSTAGRAM] ✅ Found name in item.profile.full_name: "${fullName}"`);
            } else if (item.user && item.user.fullName && item.user.fullName.trim().length > 0) {
                fullName = item.user.fullName.trim();
                console.log(`[INSTAGRAM] ✅ Found name in item.user.fullName: "${fullName}"`);
            } else if (item.user && item.user.full_name && item.user.full_name.trim().length > 0) {
                fullName = item.user.full_name.trim();
                console.log(`[INSTAGRAM] ✅ Found name in item.user.full_name: "${fullName}"`);
            }
            
            // Additional fallback: check if username matches the handle and look for name in other fields
            if (!fullName && item && typeof item === 'object' && item.username === username) {
                console.log(`[INSTAGRAM] ⚠️ Username matches but no name found, checking additional fields...`);
                // Log all string fields that might contain the name
                try {
                    for (const [key, value] of Object.entries(item)) {
                        if (typeof value === 'string' && value.includes(' ') && value.length > 3 && value.length < 100) {
                            console.log(`[INSTAGRAM] Potential name field "${key}": "${value}"`);
                        }
                    }
                } catch (e) {
                    console.log(`[INSTAGRAM] Error checking additional fields:`, e.message);
                }
            }
            
            if (fullName && fullName.length > 0) {
                // Validate that the name looks reasonable (not just the username)
                if (fullName.toLowerCase() !== username.toLowerCase() && !fullName.startsWith('@')) {
                    console.log(`[INSTAGRAM] ✅✅✅ Successfully extracted name: ${fullName}`);
                    
                    // CRITICAL: Cache the result in database to avoid future Apify calls
                    if (pool) {
                        pool.query(
                            `INSERT INTO instagram_cache (username, full_name, updated_at) VALUES ($1, $2, NOW()) 
                             ON CONFLICT (username) DO UPDATE SET full_name = $2, updated_at = NOW()`,
                            [username.toLowerCase(), fullName]
                        ).catch(err => {
                            console.error(`[INSTAGRAM] Error caching result:`, err.message);
                        });
                    }
                    
                    return { success: true, fullName: fullName };
                } else {
                    console.log(`[INSTAGRAM] ⚠️ Extracted name "${fullName}" appears to be just the username, rejecting`);
                }
            }
            
            console.log(`[INSTAGRAM] ⚠️ No valid full_name found in Apify response for ${username}`);
            try {
                const itemStr = item && typeof item === 'object' ? JSON.stringify(item, null, 2).substring(0, 500) : String(item);
                console.log(`[INSTAGRAM] Item structure:`, itemStr);
            } catch (e) {
                console.log(`[INSTAGRAM] Could not stringify item:`, e.message);
            }
            return { success: false, error: 'Full name not found in profile data. The profile may be private or not exist.' };
        } else {
            console.log(`[INSTAGRAM] ⚠️ Apify returned no items`);
            return { success: false, error: 'Profile not found. The profile may be private or not exist.' };
        }
    } catch (error) {
        console.error(`[INSTAGRAM] ❌❌❌ Apify error for ${username}:`, error.message);
        console.error(`[INSTAGRAM] Error type:`, error.constructor.name);
        console.error(`[INSTAGRAM] Error stack:`, error.stack);
        
        // Provide more specific error messages
        let errorMessage = `Failed to fetch profile: ${error.message}`;
        if (error.message && (error.message.includes('401') || error.message.includes('unauthorized') || error.message.includes('token'))) {
            errorMessage = 'Apify API authentication failed. Please check APIFY_API_TOKEN environment variable.';
        } else if (error.message && (error.message.includes('429') || error.message.includes('rate limit'))) {
            errorMessage = 'Apify API rate limit exceeded. Please try again later.';
        } else if (error.message && error.message.includes('timeout')) {
            errorMessage = 'Apify API request timed out. Instagram may be blocking automated access.';
        } else if (error.message && (error.message.includes('network') || error.message.includes('ECONNREFUSED'))) {
            errorMessage = 'Cannot connect to Apify API. Please check your internet connection and Apify service status.';
        }
        
        return { success: false, error: errorMessage };
    }
}

// OLD Playwright implementation (keeping for reference)
async function fetchInstagramFullName_OLD_PLAYWRIGHT(username) {
    // Use Playwright to render the page and extract name from visible DOM
    // Enhanced stealth settings to bypass Instagram detection
    let browser = null;
    try {
        console.log(`[INSTAGRAM] Using Playwright to extract name for ${username}`);
        
        browser = await chromium.launch({
            headless: true, // Required for Railway (no X server)
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled', // Important: hides automation
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-background-networking',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-breakpad',
                '--disable-client-side-phishing-detection',
                '--disable-component-update',
                '--disable-default-apps',
                '--disable-domain-reliability',
                '--disable-features=AudioServiceOutOfProcess',
                '--disable-hang-monitor',
                '--disable-ipc-flooding-protection',
                '--disable-notifications',
                '--disable-offer-store-unmasked-wallet-cards',
                '--disable-popup-blocking',
                '--disable-print-preview',
                '--disable-prompt-on-repost',
                '--disable-renderer-backgrounding',
                '--disable-speech-api',
                '--disable-sync',
                '--hide-scrollbars',
                '--ignore-gpu-blacklist',
                '--metrics-recording-only',
                '--mute-audio',
                '--no-default-browser-check',
                '--no-pings',
                '--password-store=basic',
                '--use-mock-keychain',
                '--window-size=1920,1080'
            ]
        });
        
        // Create context with realistic browser fingerprint
        // Use a more recent Chrome user agent to avoid detection
        const context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            locale: 'en-US',
            timezoneId: 'America/Chicago',
            permissions: ['geolocation'],
            geolocation: { latitude: 30.2672, longitude: -97.7431 }, // Austin, TX
            colorScheme: 'light',
            extraHTTPHeaders: {
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Cache-Control': 'max-age=0',
                'Referer': 'https://www.google.com/',
                'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"macOS"'
            }
        });
        
        const page = await context.newPage();
        
        // Intercept network requests to catch Instagram API calls
        const apiResponses = [];
        page.on('response', async (response) => {
            const url = response.url();
            // Catch Instagram GraphQL API calls
            if (url.includes('graphql') || url.includes('api/v1') || url.includes('web_profile_info')) {
                try {
                    const json = await response.json().catch(() => null);
                    if (json) {
                        apiResponses.push({ url, data: json });
                        console.log(`[INSTAGRAM] Caught API response from: ${url.substring(0, 100)}`);
                        console.log(`[INSTAGRAM] API response keys:`, Object.keys(json).slice(0, 10));
                        // Try to extract name immediately if we can
                        try {
                            if (json.data && json.data.user && json.data.user.full_name) {
                                const extractedName = json.data.user.full_name;
                                console.log(`[INSTAGRAM] ✅ Found name in API response: ${extractedName}`);
                            }
                        } catch (e) {
                            console.log(`[INSTAGRAM] Error checking API response: ${e.message}`);
                        }
                    }
                } catch (e) {
                    // Not JSON, ignore
                }
            }
        });
        
        // Enhanced stealth: Override webdriver property and other automation indicators
        await context.addInitScript(() => {
            // Remove webdriver flag
            Object.defineProperty(navigator, 'webdriver', {
                get: () => false,
            });
            
            // Override chrome property
            window.chrome = {
                runtime: {},
                loadTimes: function() {},
                csi: function() {},
                app: {}
            };
            
            // Override permissions
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );
            
            // Override plugins
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5],
            });
            
            // Override languages
            Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US', 'en'],
            });
            
            // Override platform
            Object.defineProperty(navigator, 'platform', {
                get: () => 'MacIntel',
            });
            
            // Override hardwareConcurrency
            Object.defineProperty(navigator, 'hardwareConcurrency', {
                get: () => 8,
            });
            
            // Override deviceMemory
            Object.defineProperty(navigator, 'deviceMemory', {
                get: () => 8,
            });
            
            // Mock getBattery
            if (navigator.getBattery) {
                navigator.getBattery = () => Promise.resolve({
                    charging: true,
                    chargingTime: 0,
                    dischargingTime: Infinity,
                    level: 1
                });
            }
        });
        
        // Strategy: Navigate to profile page first to establish session, then intercept API calls
        // This mimics what a real browser does and is more reliable than direct API calls
        const profileUrl = `https://www.instagram.com/${username}/`;
        console.log(`[INSTAGRAM] Navigating to profile page: ${profileUrl}`);
        
        let fullName = null;
        
        try {
            // Add random delay to avoid rate limiting (1-3 seconds)
            const delay = 1000 + Math.random() * 2000;
            console.log(`[INSTAGRAM] Waiting ${Math.round(delay)}ms before request to avoid rate limiting...`);
            await page.waitForTimeout(delay);
            
            // First, navigate to Instagram homepage to establish a session and avoid rate limiting
            console.log(`[INSTAGRAM] Establishing session by visiting Instagram homepage first...`);
            try {
                await page.goto('https://www.instagram.com/', {
                    waitUntil: 'domcontentloaded',
                    timeout: 15000
                });
                await page.waitForTimeout(2000 + Math.random() * 1000); // Random delay 2-3 seconds
                console.log(`[INSTAGRAM] Homepage visited, session established`);
            } catch (e) {
                console.log(`[INSTAGRAM] Warning: Could not visit homepage: ${e.message}`);
            }
            
            // Now navigate to the profile page - this will trigger Instagram's API calls automatically
            const response = await page.goto(profileUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 25000
            });
            
            console.log(`[INSTAGRAM] Profile page loaded, status: ${response ? response.status() : 'no response'}`);
            console.log(`[INSTAGRAM] Final URL: ${response ? response.url() : 'no response'}`);
            
            // Check if we got rate limited or redirected to login
            if (response && (response.status() === 429 || response.url().includes('/accounts/login/'))) {
                console.log(`[INSTAGRAM] ⚠️ Rate limited (429) or login required - Instagram is blocking requests`);
                console.log(`[INSTAGRAM] This is expected behavior - Instagram actively blocks automated requests`);
                console.log(`[INSTAGRAM] Returning error message to user`);
                
                // Don't retry immediately - Instagram will block again
                // Instead, return a helpful error message
                await browser.close();
                return { 
                    success: false, 
                    error: 'Instagram is blocking automated requests. The profile may be private, or Instagram\'s rate limiting is preventing access. Please try again later or search by full name instead.' 
                };
            }
            
            // Wait for API calls to be intercepted (Instagram makes them automatically when loading profile)
            await page.waitForTimeout(5000);
            
            console.log(`[INSTAGRAM] Total intercepted API responses: ${apiResponses.length}`);
            
            // Check intercepted API responses
            if (apiResponses.length > 0 && !fullName) {
                console.log(`[INSTAGRAM] Checking ${apiResponses.length} intercepted API responses...`);
                for (let i = 0; i < apiResponses.length; i++) {
                    const apiResponse = apiResponses[i];
                    try {
                        const data = apiResponse.data;
                        console.log(`[INSTAGRAM] [${i}] API response URL: ${apiResponse.url.substring(0, 150)}`);
                        console.log(`[INSTAGRAM] [${i}] API response keys:`, Object.keys(data || {}).slice(0, 20));
                        
                        // Log full response structure for debugging
                        const responseStr = JSON.stringify(data);
                        console.log(`[INSTAGRAM] [${i}] Full API response (first 1000 chars):`, responseStr.substring(0, 1000));
                        
                        // Try direct path: data.data.user.full_name
                        if (data && data.data && data.data.user && data.data.user.full_name) {
                            const potentialName = data.data.user.full_name.trim();
                            if (potentialName && potentialName.length > 0) {
                                fullName = potentialName;
                                console.log(`[INSTAGRAM] ✅✅✅ Extracted name from API response (data.data.user.full_name): ${fullName}`);
                                break;
                            }
                        }
                        
                        // Try alternative path: data.user.full_name (without nested data)
                        if (!fullName && data && data.user && data.user.full_name) {
                            const potentialName = data.user.full_name.trim();
                            if (potentialName && potentialName.length > 0) {
                                fullName = potentialName;
                                console.log(`[INSTAGRAM] ✅✅✅ Extracted name from API response (data.user.full_name): ${fullName}`);
                                break;
                            }
                        }
                        
                        // Try root level user
                        if (!fullName && data && data.user) {
                            console.log(`[INSTAGRAM] [${i}] Found user object at root level, keys:`, Object.keys(data.user).slice(0, 20));
                            if (data.user.full_name) {
                                const potentialName = data.user.full_name.trim();
                                if (potentialName && potentialName.length > 0) {
                                    fullName = potentialName;
                                    console.log(`[INSTAGRAM] ✅✅✅ Extracted name from root user object: ${fullName}`);
                                    break;
                                }
                            }
                        }
                        
                        // Try users array (GraphQL sometimes returns arrays)
                        if (!fullName && data && data.data && Array.isArray(data.data.users) && data.data.users.length > 0) {
                            const user = data.data.users[0];
                            if (user && user.full_name) {
                                const potentialName = user.full_name.trim();
                                if (potentialName && potentialName.length > 0) {
                                    fullName = potentialName;
                                    console.log(`[INSTAGRAM] ✅✅✅ Extracted name from users array: ${fullName}`);
                                    break;
                                }
                            }
                        }
                        
                        // Fallback: search in stringified JSON
                        if (!fullName) {
                            const fullNameMatch = responseStr.match(/"full_name"\s*:\s*"([^"]+)"/i);
                            if (fullNameMatch && fullNameMatch[1]) {
                                const potentialName = fullNameMatch[1].trim();
                                const words = potentialName.split(/\s+/);
                                if (words.length >= 1 && words.length <= 4 && 
                                    words.every(w => w.length >= 1 && w.length <= 30 && /^[A-Za-z\s]+$/.test(w))) {
                                    fullName = potentialName;
                                    console.log(`[INSTAGRAM] ✅✅✅ Extracted name from API response (regex): ${fullName}`);
                                    break;
                                }
                            }
                        }
                        
                        // Check for error messages
                        if (data && (data.error || data.message || data.status === 'fail')) {
                            console.log(`[INSTAGRAM] [${i}] ⚠️ API returned error:`, data.error || data.message || data);
                        }
                    } catch (e) {
                        console.log(`[INSTAGRAM] [${i}] Error parsing API response: ${e.message}`);
                        console.log(`[INSTAGRAM] [${i}] Error stack:`, e.stack);
                    }
                }
            } else if (apiResponses.length === 0) {
                console.log(`[INSTAGRAM] ⚠️ No API responses intercepted - trying to extract from page content`);
                
                // Fallback: Try to extract from page HTML/JSON embedded in page
                try {
                    const pageContent = await page.content();
                    console.log(`[INSTAGRAM] Page content length: ${pageContent.length}`);
                    
                    // Look for JSON data embedded in script tags
                    const scriptMatches = pageContent.match(/<script[^>]*type="application\/json"[^>]*>(.*?)<\/script>/gis);
                    if (scriptMatches) {
                        console.log(`[INSTAGRAM] Found ${scriptMatches.length} JSON script tags`);
                        for (let i = 0; i < scriptMatches.length; i++) {
                            try {
                                const jsonStr = scriptMatches[i].replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
                                const jsonData = JSON.parse(jsonStr);
                                
                                // Search recursively for full_name
                                const searchForFullName = (obj, depth = 0) => {
                                    if (depth > 5) return null;
                                    if (typeof obj !== 'object' || obj === null) return null;
                                    
                                    if (obj.full_name && typeof obj.full_name === 'string' && obj.full_name.trim().length > 0) {
                                        return obj.full_name.trim();
                                    }
                                    
                                    for (const key in obj) {
                                        if (obj.hasOwnProperty(key)) {
                                            const result = searchForFullName(obj[key], depth + 1);
                                            if (result) return result;
                                        }
                                    }
                                    return null;
                                };
                                
                                const foundName = searchForFullName(jsonData);
                                if (foundName) {
                                    fullName = foundName;
                                    console.log(`[INSTAGRAM] ✅✅✅ Extracted name from embedded JSON: ${fullName}`);
                                    break;
                                }
                            } catch (e) {
                                // Not valid JSON, continue
                            }
                        }
                    }
                    
                    // Also try regex search in HTML
                    if (!fullName) {
                        const fullNameMatch = pageContent.match(/"full_name"\s*:\s*"([^"]+)"/i);
                        if (fullNameMatch && fullNameMatch[1]) {
                            const potentialName = fullNameMatch[1].trim();
                            const words = potentialName.split(/\s+/);
                            if (words.length >= 1 && words.length <= 4 && 
                                words.every(w => w.length >= 1 && w.length <= 30 && /^[A-Za-z\s]+$/.test(w))) {
                                fullName = potentialName;
                                console.log(`[INSTAGRAM] ✅✅✅ Extracted name from HTML regex: ${fullName}`);
                            }
                        }
                    }
                } catch (e) {
                    console.log(`[INSTAGRAM] Error extracting from page content: ${e.message}`);
                }
            }
            
            if (fullName && fullName.length > 0) {
                console.log(`[INSTAGRAM] ✅ Successfully extracted name: ${fullName}`);
            }
        } catch (e) {
            console.log(`[INSTAGRAM] Error navigating to profile page: ${e.message}`);
            console.log(`[INSTAGRAM] Error stack:`, e.stack);
        }
        
        await browser.close();
        
        if (fullName && fullName.length > 0) {
            console.log(`[INSTAGRAM] ✅ Successfully extracted name: ${fullName}`);
            return { success: true, fullName: fullName.trim() };
        } else {
            console.log(`[INSTAGRAM] ❌ Could not extract name from any strategy`);
            return { success: false, error: 'Full name not found. The profile may be private or Instagram is blocking requests.' };
        }
        
    } catch (error) {
        console.error(`[INSTAGRAM] Playwright error for ${username}:`, error.message);
        if (browser) {
            try {
                await browser.close();
            } catch (e) {
                // Ignore close errors
            }
        }
        return { success: false, error: `Playwright error: ${error.message}` };
    }
}

// OLD HTTP-based extraction (keeping as fallback, but Playwright is now primary)
async function fetchInstagramFullName_OLD(username) {
    return new Promise((resolve, reject) => {
        const instagramUrl = `https://www.instagram.com/${username}/`;
        
        const options = {
            hostname: 'www.instagram.com',
            path: `/${username}/`,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br, zstd',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'Cache-Control': 'max-age=0',
                'DNT': '1',
                'Referer': 'https://www.instagram.com/',
                'Origin': 'https://www.instagram.com'
            }
        };
        
        const req = https.get(options, (res) => {
            console.log(`[INSTAGRAM] Response status: ${res.statusCode} for ${username}`);
            
            // Check for redirects - follow non-login redirects
            if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
                const location = res.headers.location || '';
                console.log(`[INSTAGRAM] Redirect detected to: ${location}`);
                // If redirecting to login page, it means Instagram is blocking us
                if (location.includes('/accounts/login/') || location.includes('login') || location.includes('is_from_rle')) {
                    console.log(`[INSTAGRAM] Redirect to login page detected - Instagram is blocking requests`);
                    resolve({ success: false, error: 'Instagram is requiring login (blocking detected). Try using the browser-based search method.' });
                    return;
                }
                // For other redirects, continue processing the response
                // (Instagram often redirects but still serves content)
                console.log(`[INSTAGRAM] Non-login redirect detected, continuing with response...`);
            }
            
            // Check for error status codes
            if (res.statusCode !== 200 && res.statusCode !== 301 && res.statusCode !== 302 && res.statusCode !== 307 && res.statusCode !== 308) {
                console.log(`[INSTAGRAM] Non-200 status code: ${res.statusCode} for ${username}`);
                let errorBody = '';
                res.on('data', (chunk) => { errorBody += chunk.toString(); });
                res.on('end', () => {
                    console.log(`[INSTAGRAM] Error response body (first 200 chars):`, errorBody.substring(0, 200));
                    resolve({ success: false, error: `HTTP ${res.statusCode}: ${res.statusMessage || 'Request failed'}` });
                });
                return;
            }
            
            // Process the response inline
            let html = '';
            let stream = res;
            
            // Handle gzip/deflate compression
            if (res.headers['content-encoding'] === 'gzip') {
                stream = res.pipe(zlib.createGunzip());
            } else if (res.headers['content-encoding'] === 'deflate') {
                stream = res.pipe(zlib.createInflate());
            } else if (res.headers['content-encoding'] === 'br') {
                stream = res.pipe(zlib.createBrotliDecompress());
            }
            
            stream.on('data', (chunk) => {
                html += chunk.toString();
            });
            
            stream.on('error', (err) => {
                console.error(`[INSTAGRAM] Stream error for ${username}:`, err.message);
                resolve({ success: false, error: `Stream error: ${err.message}` });
            });
            
            stream.on('end', () => {
                try {
                    console.log(`[INSTAGRAM] Fetching full name for ${username}, HTML length: ${html.length}`);
                    
                    // Log first 500 chars if HTML is very short for debugging
                    if (html.length < 1000 && html.length > 0) {
                        console.log(`[INSTAGRAM] First 500 chars of response:`, html.substring(0, 500));
                    }
                    
                    // Check for login page - be more lenient with length check
                    // Instagram login pages can be large, so check content, not just length
                    const isLoginPage = html.includes('Log in to Instagram') || 
                                      html.includes('login_required') || 
                                      html.includes('Please wait') ||
                                      html.includes('/accounts/login/') ||
                                      html.includes('is_from_rle');
                    
                    if (isLoginPage) {
                        console.log(`[INSTAGRAM] Login page or challenge detected for ${username}`);
                        console.log(`[INSTAGRAM] HTML length: ${html.length}`);
                        // Still try to extract if HTML is large (might be a challenge page with content)
                        if (html.length < 50000) {
                            resolve({ success: false, error: 'Login required or challenge page' });
                            return;
                        } else {
                            console.log(`[INSTAGRAM] Large HTML with login indicators, attempting extraction anyway...`);
                        }
                    }
                    
                    if (html.length < 10000) {
                        console.log(`[INSTAGRAM] Insufficient HTML for name extraction: ${html.length} bytes`);
                        if (html.length > 0) {
                            console.log(`[INSTAGRAM] Response preview:`, html.substring(0, 500));
                        }
                        resolve({ success: false, error: 'Insufficient HTML received' });
                        return;
                    }
                    
                    // Log a sample of the HTML to help debug extraction issues
                    console.log(`[INSTAGRAM] HTML sample (first 2000 chars):`, html.substring(0, 2000));
                    console.log(`[INSTAGRAM] Checking for login/challenge indicators...`);
                    console.log(`[INSTAGRAM] Contains 'Log in': ${html.includes('Log in')}`);
                    console.log(`[INSTAGRAM] Contains 'login_required': ${html.includes('login_required')}`);
                    console.log(`[INSTAGRAM] Contains 'Please wait': ${html.includes('Please wait')}`);
                    console.log(`[INSTAGRAM] Contains 'challenge': ${html.includes('challenge')}`);
                    
                    // Check if HTML contains window._sharedData
                    const hasSharedData = html.includes('window._sharedData') || html.includes('_sharedData');
                    console.log(`[INSTAGRAM] Contains window._sharedData: ${hasSharedData}`);
                    
                    // Try to find and log a snippet of _sharedData if it exists
                    if (hasSharedData) {
                        const sharedDataMatch = html.match(/window\._sharedData\s*=\s*({[\s\S]{0,500})/);
                        if (sharedDataMatch) {
                            console.log(`[INSTAGRAM] _sharedData snippet: ${sharedDataMatch[1].substring(0, 500)}...`);
                        }
                    }
                    
                    // Try to extract from window._sharedData
                    const sharedDataPatterns = [
                        /window\._sharedData\s*=\s*({[\s\S]+?});\s*<\/script>/,
                        /window\._sharedData\s*=\s*({.+?});/s
                    ];
                    
                    for (const pattern of sharedDataPatterns) {
                        const sharedDataMatch = html.match(pattern);
                        if (sharedDataMatch && sharedDataMatch[1]) {
                            try {
                                let jsonStr = sharedDataMatch[1].trim();
                                jsonStr = jsonStr.replace(/;[\s]*$/, '');
                                const sharedData = JSON.parse(jsonStr);
                                
                                // Try multiple paths to find the full name
                                const possiblePaths = [
                                    sharedData?.entry_data?.ProfilePage?.[0]?.graphql?.user?.full_name,
                                    sharedData?.entry_data?.ProfilePage?.[0]?.graphql?.user?.fullName,
                                    sharedData?.entry_data?.ProfilePage?.[0]?.user?.full_name,
                                    sharedData?.entry_data?.ProfilePage?.[0]?.user?.fullName,
                                    sharedData?.graphql?.user?.full_name,
                                    sharedData?.graphql?.user?.fullName,
                                    // Try recursive search in sharedData
                                    findFullNameInObject(sharedData, username)
                                ];
                                
                                for (const fullName of possiblePaths) {
                                    if (fullName && typeof fullName === 'string' && fullName.trim().length > 0) {
                                        console.log(`Found Instagram full name via _sharedData: ${fullName}`);
                                        resolve({ success: true, fullName: fullName.trim() });
                                        return;
                                    }
                                }
                            } catch (e) {
                                console.log(`Failed to parse _sharedData for name: ${e.message}`);
                                continue;
                            }
                        }
                    }
                    
                    // Try meta tags (og:title) - multiple patterns
                    const metaTitlePatterns = [
                        /property="og:title"\s+content="([^"]+)"/i,
                        /property='og:title'\s+content='([^']+)'/i,
                        /<meta[^>]*og:title[^>]*content="([^"]+)"/i,
                        /<meta[^>]*og:title[^>]*content='([^']+)'/i
                    ];
                    
                    for (const pattern of metaTitlePatterns) {
                        const metaTitleMatch = html.match(pattern);
                        if (metaTitleMatch && metaTitleMatch[1]) {
                            const title = metaTitleMatch[1].trim();
                            // Extract name from title (format is usually "Name (@username) • Instagram" or "Name (@username) on Instagram")
                            const nameMatch = title.match(/^([^(•|on|Instagram)]+)/);
                            if (nameMatch && nameMatch[1]) {
                                let extractedName = nameMatch[1].trim();
                                // Clean up common suffixes
                                extractedName = extractedName.replace(/\s*•\s*Instagram.*$/i, '');
                                extractedName = extractedName.replace(/\s*on\s*Instagram.*$/i, '');
                                extractedName = extractedName.replace(/\s*@.*$/i, ''); // Remove @username if present
                                extractedName = extractedName.trim();
                                
                                // Only return if it doesn't look like just a username or error page
                                if (extractedName && extractedName.length > 2 && !extractedName.startsWith('@') && 
                                    extractedName !== 'Instagram' && 
                                    extractedName !== 'Login' &&
                                    extractedName !== 'Page Not Found' &&
                                    !extractedName.includes('Login • Instagram') &&
                                    !extractedName.toLowerCase().includes('error')) {
                                    console.log(`Found Instagram name from og:title: ${extractedName}`);
                                    resolve({ success: true, fullName: extractedName });
                                    return;
                                }
                            }
                        }
                    }
                    
                    // Also try regular title tag
                    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
                    if (titleMatch && titleMatch[1]) {
                        const title = titleMatch[1].trim();
                        const nameMatch = title.match(/^([^(•|on|Instagram)]+)/);
                        if (nameMatch && nameMatch[1]) {
                            let extractedName = nameMatch[1].trim();
                            extractedName = extractedName.replace(/\s*•\s*Instagram.*$/i, '');
                            extractedName = extractedName.replace(/\s*on\s*Instagram.*$/i, '');
                            extractedName = extractedName.replace(/\s*@.*$/i, '');
                            extractedName = extractedName.trim();
                            
                            if (extractedName && extractedName.length > 2 && !extractedName.startsWith('@') && 
                                extractedName !== 'Instagram' && extractedName !== 'Login' &&
                                !extractedName.includes('Login • Instagram')) {
                                console.log(`Found Instagram name from title tag: ${extractedName}`);
                                resolve({ success: true, fullName: extractedName });
                                return;
                            }
                        }
                    }
                    
                    // Try to find name in JSON-LD structured data
                    const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/is);
                    if (jsonLdMatch) {
                        try {
                            const jsonLd = JSON.parse(jsonLdMatch[1]);
                            if (jsonLd.name && typeof jsonLd.name === 'string' && !jsonLd.name.startsWith('@')) {
                                console.log(`Found Instagram name from JSON-LD: ${jsonLd.name}`);
                                resolve({ success: true, fullName: jsonLd.name.trim() });
                                return;
                            }
                        } catch (e) {
                            // Not valid JSON, continue
                        }
                    }
                    
                    // Try to find full_name in script tags (multiple patterns) - be more aggressive
                    const fullNamePatterns = [
                        /"full_name"\s*:\s*"([^"]+)"/i,
                        /"fullName"\s*:\s*"([^"]+)"/i,
                        /full_name["\s]*:["\s]*"([^"]+)"/i,
                        /"profilePage_[\d]+":\s*\{[^}]*"full_name":\s*"([^"]+)"/i,
                        /"user":\s*\{[^}]*"full_name":\s*"([^"]+)"/i,
                        /"full_name":\s*"([^"]+)"[^}]*"username":\s*"([^"]+)"/i,
                        /"biography":\s*"[^"]*"[^}]*"full_name":\s*"([^"]+)"/i,
                        /"edge_owner_to_timeline_media":\s*\{[^}]*"full_name":\s*"([^"]+)"/i,
                        // More patterns for different Instagram formats
                        /"full_name"\s*:\s*"([^"]+)"[^}]*"username"\s*:\s*"([^"]+)"/i,
                        /"username"\s*:\s*"([^"]+)"[^}]*"full_name"\s*:\s*"([^"]+)"/i,
                        /"profile_pic_url"[^}]*"full_name"\s*:\s*"([^"]+)"/i,
                        /"is_verified"[^}]*"full_name"\s*:\s*"([^"]+)"/i
                    ];
                    
                    // Try all matches, not just first
                    for (const pattern of fullNamePatterns) {
                        const matches = html.matchAll(new RegExp(pattern.source, 'gi'));
                        for (const match of matches) {
                            // Check both capture groups (some patterns have username and full_name)
                            const name = match[1] || match[2];
                            if (name && typeof name === 'string') {
                                const trimmedName = name.trim();
                                // Skip if it looks like a username or is too short
                                if (trimmedName && trimmedName.length > 2 && !trimmedName.startsWith('@') && 
                                    !trimmedName.includes('instagram') && trimmedName !== username &&
                                    /[a-zA-Z]/.test(trimmedName)) {
                                    console.log(`Found Instagram name from script pattern: ${trimmedName}`);
                                    resolve({ success: true, fullName: trimmedName });
                                    return;
                                }
                            }
                        }
                    }
                    
                    // Recursive function to search for full_name in JSON objects
                    function findFullNameInObject(obj, username, depth = 0) {
                        // Prevent infinite recursion
                        if (depth > 10) return null;
                        if (typeof obj !== 'object' || obj === null) return null;
                        
                        // Check if this object has full_name
                        if (obj.full_name && typeof obj.full_name === 'string' && obj.full_name.trim().length > 0) {
                            const name = obj.full_name.trim();
                            if (name.length > 2 && !name.startsWith('@') && !name.includes('instagram') && name !== username) {
                                return name;
                            }
                        }
                        if (obj.fullName && typeof obj.fullName === 'string' && obj.fullName.trim().length > 0) {
                            const name = obj.fullName.trim();
                            if (name.length > 2 && !name.startsWith('@') && !name.includes('instagram') && name !== username) {
                                return name;
                            }
                        }
                        
                        // Also check for 'name' field if it looks like a full name (has space)
                        if (obj.name && typeof obj.name === 'string' && obj.name.trim().length > 0) {
                            const name = obj.name.trim();
                            // Check if it's a full name (has space and doesn't start with @)
                            if (name.includes(' ') && name.length > 3 && !name.startsWith('@') && 
                                name !== username && !name.toLowerCase().includes('instagram')) {
                                return name;
                            }
                        }
                        
                        // Recursively search in all properties
                        for (const key in obj) {
                            if (obj.hasOwnProperty(key)) {
                                const result = findFullNameInObject(obj[key], username, depth + 1);
                                if (result) return result;
                            }
                        }
                        return null;
                    }
                    
                    // Try searching in all script tags for JSON data
                    const scriptMatches = html.match(/<script[^>]*>(.*?)<\/script>/gis);
                    if (scriptMatches) {
                        for (const scriptContent of scriptMatches) {
                            // Look for full_name in script content with regex first (faster)
                            const scriptPatterns = [
                                /"full_name"\s*:\s*"([^"]+)"/i,
                                /"fullName"\s*:\s*"([^"]+)"/i,
                                /full_name["\s]*:["\s]*"([^"]+)"/i
                            ];
                            
                            for (const pattern of scriptPatterns) {
                                const match = scriptContent.match(pattern);
                                if (match && match[1]) {
                                    const name = match[1].trim();
                                    if (name && name.length > 2 && !name.startsWith('@') && !name.includes('instagram') && name !== username) {
                                        console.log(`Found Instagram name from script content: ${name}`);
                                        resolve({ success: true, fullName: name });
                                        return;
                                    }
                                }
                            }
                            
                            // Try to parse as JSON and search recursively
                            try {
                                // Look for JSON objects in script tags
                                const jsonMatches = scriptContent.match(/\{[\s\S]{100,50000}\}/g);
                                if (jsonMatches) {
                                    for (const jsonStr of jsonMatches) {
                                        try {
                                            const jsonObj = JSON.parse(jsonStr);
                                            const foundName = findFullNameInObject(jsonObj, username);
                                            if (foundName) {
                                                console.log(`Found Instagram name via recursive JSON search: ${foundName}`);
                                                resolve({ success: true, fullName: foundName });
                                                return;
                                            }
                                        } catch (e) {
                                            // Not valid JSON, continue
                                        }
                                    }
                                }
                            } catch (e) {
                                // Continue to next script tag
                            }
                        }
                    }
                    
                    // Try to extract from article or section tags
                    const articleMatches = html.match(/<article[^>]*>([\s\S]{0,2000})<\/article>/i);
                    if (articleMatches) {
                        const articleContent = articleMatches[1];
                        const nameInArticle = articleContent.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)(?:\s*@|•|\|)/);
                        if (nameInArticle && nameInArticle[1]) {
                            const name = nameInArticle[1].trim();
                            if (name && name.length > 3 && name !== username) {
                                console.log(`Found Instagram name from article: ${name}`);
                                resolve({ success: true, fullName: name });
                                return;
                            }
                        }
                    }
                    
                    // Try to find in header tags
                    const headerMatches = html.match(/<h[12][^>]*>([^<]+)<\/h[12]>/gi);
                    if (headerMatches) {
                        for (const header of headerMatches) {
                            const textMatch = header.match(/>([^<]+)</);
                            if (textMatch && textMatch[1]) {
                                const text = textMatch[1].trim();
                                if (text && text !== username && !text.startsWith('@') && 
                                    (text.includes(' ') || (text.length > 3 && text[0] === text[0].toUpperCase()))) {
                                    console.log(`Found Instagram name from header: ${text}`);
                                    resolve({ success: true, fullName: text });
                                    return;
                                }
                            }
                        }
                    }
                    
                    // Try to find in profile name elements - expanded patterns
                    const profileNamePatterns = [
                        /<span[^>]*class="[^"]*profile[^"]*name[^"]*"[^>]*>([^<]+)<\/span>/i,
                        /<div[^>]*class="[^"]*profile[^"]*name[^"]*"[^>]*>([^<]+)<\/div>/i,
                        /<span[^>]*data-testid="[^"]*name[^"]*"[^>]*>([^<]+)<\/span>/i,
                        /<span[^>]*class="[^"]*x1lliihq[^"]*"[^>]*>([^<]+)<\/span>/i, // Instagram obfuscated classes
                        /<div[^>]*class="[^"]*x1lliihq[^"]*"[^>]*>([^<]+)<\/div>/i,
                        /<h1[^>]*>([^<]+)<\/h1>/i,
                        /<h2[^>]*>([^<]+)<\/h2>/i,
                        /<span[^>]*role="heading"[^>]*>([^<]+)<\/span>/i,
                        /<div[^>]*role="heading"[^>]*>([^<]+)<\/div>/i
                    ];
                    
                    for (const pattern of profileNamePatterns) {
                        const matches = html.match(new RegExp(pattern.source, 'gi'));
                        if (matches) {
                            for (const matchStr of matches) {
                                const match = matchStr.match(pattern);
                                if (match && match[1]) {
                                    const name = match[1].trim();
                                    // More lenient validation - allow names with periods, hyphens, etc.
                                    if (name && name.length > 2 && !name.startsWith('@') && name !== username && 
                                        !name.toLowerCase().includes('instagram') &&
                                        !name.toLowerCase().includes('follow') &&
                                        !name.toLowerCase().includes('login') &&
                                        // Must contain at least one letter
                                        /[a-zA-Z]/.test(name)) {
                                        console.log(`Found Instagram name from profile element: ${name}`);
                                        resolve({ success: true, fullName: name });
                                        return;
                                    }
                                }
                            }
                        }
                    }
                    
                    // Try one more aggressive pattern - look for any JSON structure with user data
                    // Instagram might have changed their data structure
                    try {
                        // Look for any large JSON objects that might contain user info
                        const largeJsonMatches = html.match(/\{"config":\{[\s\S]{500,200000}\}/g);
                        if (largeJsonMatches) {
                            for (const jsonStr of largeJsonMatches) {
                                try {
                                    const jsonObj = JSON.parse(jsonStr);
                                    const foundName = findFullNameInObject(jsonObj, username);
                                    if (foundName) {
                                        console.log(`Found Instagram name via large JSON search: ${foundName}`);
                                        resolve({ success: true, fullName: foundName });
                                        return;
                                    }
                                } catch (e) {
                                    // Not valid JSON, continue
                                }
                            }
                        }
                        
                        // Try to find name in any script tag with "user" or "profile" keywords
                        const userScriptPatterns = [
                            /"user":\s*\{[^}]{0,5000}"full_name":\s*"([^"]+)"/i,
                            /"profile":\s*\{[^}]{0,5000}"full_name":\s*"([^"]+)"/i,
                            /"owner":\s*\{[^}]{0,5000}"full_name":\s*"([^"]+)"/i,
                            /"account":\s*\{[^}]{0,5000}"full_name":\s*"([^"]+)"/i
                        ];
                        
                        for (const pattern of userScriptPatterns) {
                            const matches = html.match(pattern);
                            if (matches && matches[1]) {
                                const name = matches[1].trim();
                                if (name && name.length > 2 && !name.startsWith('@') && 
                                    name !== username && !name.toLowerCase().includes('instagram') &&
                                    /[a-zA-Z]/.test(name)) {
                                    console.log(`Found Instagram name via user script pattern: ${name}`);
                                    resolve({ success: true, fullName: name });
                                    return;
                                }
                            }
                        }
                    } catch (e) {
                        console.log(`[INSTAGRAM] Error in final extraction attempts: ${e.message}`);
                    }
                    
                    // Log what we tried for debugging
                    console.log(`[INSTAGRAM] All extraction methods failed for ${username}`);
                    console.log(`[INSTAGRAM] HTML length: ${html.length}`);
                    console.log(`[INSTAGRAM] Contains 'full_name': ${html.includes('full_name')}`);
                    console.log(`[INSTAGRAM] Contains 'fullName': ${html.includes('fullName')}`);
                    console.log(`[INSTAGRAM] Contains 'og:title': ${html.includes('og:title')}`);
                    console.log(`[INSTAGRAM] Contains username '${username}': ${html.includes(username)}`);
                    
                    // Log a sample of the HTML to help debug (first 2000 chars)
                    if (html.length > 0) {
                        const sample = html.substring(0, 2000).replace(/\s+/g, ' ');
                        console.log(`[INSTAGRAM] HTML sample (first 2000 chars): ${sample}`);
                    }
                    
                    // Try one more pattern - look for React component props/data
                    // Instagram uses React and embeds data in component props
                    try {
                        // Look for React component data structures
                        const reactDataPatterns = [
                            /"__d":\s*"([^"]+)"/g,  // React component data
                            /"props":\s*\{[^}]{0,10000}"full_name":\s*"([^"]+)"/i,
                            /"props":\s*\{[^}]{0,10000}"name":\s*"([^"]+)"/i,
                            /"children":\s*\[[^\]]{0,5000}"full_name":\s*"([^"]+)"/i,
                            // Look for any occurrence of the username followed by a name pattern
                            new RegExp(`"${username}"[^}]{0,2000}"full_name":\\s*"([^"]+)"`, 'i'),
                            new RegExp(`"${username}"[^}]{0,2000}"name":\\s*"([^"]+)"`, 'i'),
                        ];
                        
                        for (const pattern of reactDataPatterns) {
                            const matches = [...html.matchAll(pattern)];
                            for (const match of matches) {
                                const name = match[1] || match[2];
                                if (name && typeof name === 'string') {
                                    const trimmedName = name.trim();
                                    if (trimmedName && trimmedName.length > 2 && !trimmedName.startsWith('@') && 
                                        trimmedName !== username && !trimmedName.toLowerCase().includes('instagram') &&
                                        /[a-zA-Z]/.test(trimmedName)) {
                                        console.log(`Found Instagram name via React data pattern: ${trimmedName}`);
                                        resolve({ success: true, fullName: trimmedName });
                                        return;
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        console.log(`[INSTAGRAM] Error in React data extraction: ${e.message}`);
                    }
                    
                    // Try to find name near username in HTML (Instagram often places them close together)
                    try {
                        const usernameIndex = html.indexOf(username);
                        if (usernameIndex !== -1) {
                            // Look in a 5000 char window around the username
                            const start = Math.max(0, usernameIndex - 2500);
                            const end = Math.min(html.length, usernameIndex + 2500);
                            const window = html.substring(start, end);
                            
                            // Look for full_name near username
                            const nearPatterns = [
                                /"full_name":\s*"([^"]+)"/i,
                                /"fullName":\s*"([^"]+)"/i,
                                /"name":\s*"([^"]+)"/i,
                                /full_name["\s]*:["\s]*"([^"]+)"/i
                            ];
                            
                            for (const pattern of nearPatterns) {
                                const match = window.match(pattern);
                                if (match && match[1]) {
                                    const name = match[1].trim();
                                    if (name && name.length > 2 && !name.startsWith('@') && 
                                        name !== username && !name.toLowerCase().includes('instagram') &&
                                        /[a-zA-Z]/.test(name)) {
                                        console.log(`Found Instagram name near username: ${name}`);
                                        resolve({ success: true, fullName: name });
                                        return;
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        console.log(`[INSTAGRAM] Error in near-username extraction: ${e.message}`);
                    }
                    
                    // Check if we got a login/challenge page - but only reject if HTML is small
                    // Large HTML might still have profile data even with login indicators
                    const hasLoginIndicators = html.includes('Log in to Instagram') || 
                                              html.includes('login_required') || 
                                              html.includes('challenge') || 
                                              html.includes('Please wait');
                    
                    if (hasLoginIndicators && html.length < 50000) {
                        console.log(`[INSTAGRAM] Detected login/challenge page in HTML (${html.length} chars)`);
                        resolve({ success: false, error: 'Instagram is requiring login or showing challenge page' });
                        return;
                    }
                    
                    // If HTML is large but we couldn't extract, log more details
                    if (html.length > 100000) {
                        console.log(`[INSTAGRAM] Large HTML (${html.length} chars) but extraction failed - Instagram may have changed structure`);
                        // Try to find any text that looks like a name anywhere in the HTML
                        const allNameMatches = html.match(/"([A-Z][a-z]+\s+[A-Z][a-z]+)"/g);
                        if (allNameMatches && allNameMatches.length > 0) {
                            console.log(`[INSTAGRAM] Found ${allNameMatches.length} potential name matches in HTML`);
                            // Log first few for debugging
                            for (let i = 0; i < Math.min(5, allNameMatches.length); i++) {
                                const match = allNameMatches[i].match(/"([^"]+)"/);
                                if (match && match[1]) {
                                    const potentialName = match[1].trim();
                                    if (potentialName.includes(' ') && potentialName.length > 3 && 
                                        !potentialName.toLowerCase().includes('instagram') &&
                                        potentialName !== username) {
                                        console.log(`[INSTAGRAM] Potential name found: ${potentialName}`);
                                    }
                                }
                            }
                        }
                    }
                    
                    resolve({ success: false, error: 'Full name not found in HTML' });
                } catch (error) {
                    console.error(`[INSTAGRAM] Error processing HTML for ${username}:`, error.message);
                    resolve({ success: false, error: `Processing error: ${error.message}` });
                }
            });
        });
        
        req.on('error', (error) => {
            console.error(`[INSTAGRAM] Request error for ${username}:`, error.message);
            console.error(`[INSTAGRAM] Error code:`, error.code);
            resolve({ success: false, error: `Request failed: ${error.message}` });
        });
        
        req.setTimeout(15000, () => {
            console.error(`[INSTAGRAM] Request timeout for ${username}`);
            req.destroy();
            resolve({ success: false, error: 'Request timeout' });
        });
    });
}

// Create server
const server = http.createServer((req, res) => {
    // Serve content on both www and non-www domains
    // Note: Railway must have SSL certificates configured for both domains
    // The 502 error occurs at Railway's proxy level, not in this application
    const host = req.headers.host || '';
    
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(200, corsHeaders);
        res.end();
        return;
    }
    
    const parsedUrl = url.parse(req.url, true);
    
    // Handle favicon requests explicitly
    if (parsedUrl.pathname === '/favicon.svg' || parsedUrl.pathname === '/favicon.ico') {
        const faviconPath = path.join(__dirname, 'favicon.svg');
        fs.readFile(faviconPath, (error, content) => {
            if (error) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Favicon not found');
            } else {
                res.writeHead(200, { 
                    'Content-Type': 'image/svg+xml',
                    'Cache-Control': 'public, max-age=31536000' // Cache for 1 year
                });
                res.end(content, 'utf-8');
            }
        });
        return;
    }
    
    // Handle profile picture proxy (to bypass CORS)
    if (parsedUrl.pathname === '/api/profile-pic-proxy' && parsedUrl.query.url) {
        const imageUrl = decodeURIComponent(parsedUrl.query.url);
        console.log(`[PROFILE PROXY] Proxying image: ${imageUrl.substring(0, 60)}...`);
        
        // CRITICAL: If it's already a base64 data URL, return it directly (don't try to fetch it)
        if (imageUrl.startsWith('data:image')) {
            console.log(`[PROFILE PROXY] Image is already base64, returning directly`);
            // Extract content type and base64 data
            const match = imageUrl.match(/^data:image\/([^;]+);base64,(.+)$/);
            if (match) {
                const contentType = `image/${match[1]}`;
                const base64Data = match[2];
                const imageBuffer = Buffer.from(base64Data, 'base64');
                
                const headers = {
                    'Content-Type': contentType,
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'public, max-age=86400',
                    'Content-Length': imageBuffer.length.toString()
                };
                res.writeHead(200, headers);
                res.end(imageBuffer);
            } else {
                res.writeHead(400, corsHeaders);
                res.end(JSON.stringify({ success: false, error: 'Invalid data URL format' }));
            }
            return;
        }
        
        // Validate URL protocol before attempting to fetch
        if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
            console.error(`[PROFILE PROXY] Invalid URL protocol: ${imageUrl.substring(0, 60)}...`);
            res.writeHead(400, corsHeaders);
            res.end(JSON.stringify({ success: false, error: 'Invalid URL protocol. Expected http:// or https://' }));
            return;
        }
        
        const https = require('https');
        const http = require('http');
        const urlObj = new URL(imageUrl);
        const client = urlObj.protocol === 'https:' ? https : http;
        
        client.get(imageUrl, (imageRes) => {
            const headers = {
                'Content-Type': imageRes.headers['content-type'] || 'image/jpeg',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=86400'
            };
            res.writeHead(200, headers);
            imageRes.pipe(res);
        }).on('error', (err) => {
            console.error(`[PROFILE PROXY] Error proxying image:`, err.message);
            res.writeHead(500, corsHeaders);
            res.end(JSON.stringify({ success: false, error: err.message }));
        });
        return;
    }
    
    // Handle profile picture fetch
    if (parsedUrl.pathname === '/api/profile-pic' && parsedUrl.query.username) {
        const username = parsedUrl.query.username.replace('@', '').trim();
        console.log(`[PROFILE] Request: ${username}`);
        
        fetchInstagramProfile(username)
            .then(result => {
                console.log(`[PROFILE] Response: ${username} -> ${result.success ? 'SUCCESS' : 'FAILED'}`);
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify(result));
            })
            .catch(error => {
                console.error(`[PROFILE] Error: ${username} - ${error.message}`);
                res.writeHead(500, corsHeaders);
                res.end(JSON.stringify({ success: false, error: error.message }));
            });
    }
    // Handle Instagram name fetch
    else if (parsedUrl.pathname === '/api/instagram-name' && parsedUrl.query.username) {
        const username = parsedUrl.query.username.replace('@', '').trim();
        console.log(`[INSTAGRAM NAME API] Request received for username: ${username}`);
        
        // Check if Apify is configured
        if (!process.env.APIFY_API_TOKEN) {
            console.error('[INSTAGRAM NAME API] ❌ APIFY_API_TOKEN not set!');
            res.writeHead(500, corsHeaders);
            res.end(JSON.stringify({ 
                success: false, 
                error: 'Instagram API not configured. APIFY_API_TOKEN environment variable is missing.' 
            }));
            return;
        }
        
        // Check if Apify client is initialized
        if (!apifyClient) {
            console.error('[INSTAGRAM NAME API] ❌ Apify client not initialized!');
            res.writeHead(500, corsHeaders);
            res.end(JSON.stringify({ 
                success: false, 
                error: 'Apify client initialization failed. Please check APIFY_API_TOKEN environment variable.' 
            }));
            return;
        }
        
        fetchInstagramFullName(username)
            .then(result => {
                console.log(`[INSTAGRAM NAME API] Response for ${username}:`, result.success ? 'SUCCESS' : `FAILED - ${result.error}`);
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify(result));
            })
            .catch(error => {
                console.error(`[INSTAGRAM NAME API] Error for ${username}:`, error.message);
                console.error(`[INSTAGRAM NAME API] Error stack:`, error.stack);
                res.writeHead(500, corsHeaders);
                res.end(JSON.stringify({ success: false, error: error.message }));
            });
    }
    // Handle Stripe checkout session creation
    else if (parsedUrl.pathname === '/api/create-checkout-session' && req.method === 'POST') {
        console.log('[STRIPE] Received checkout session creation request');
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', async () => {
            try {
                console.log('[STRIPE] Request body:', body);
                
                if (!stripe) {
                    console.error('[STRIPE] ❌ Stripe not configured - STRIPE_SECRET_KEY not set');
                    res.writeHead(500, corsHeaders);
                    res.end(JSON.stringify({ error: 'Stripe not configured. Please set STRIPE_SECRET_KEY environment variable.' }));
                    return;
                }
                
                console.log('[STRIPE] ✅ Stripe initialized, parsing request data...');
                const data = JSON.parse(body);
                const { firstName, lastName, amount, processingFee } = data;
                
                console.log('[STRIPE] Request data:', { firstName, lastName, amount, processingFee });
                
                if (!firstName || !lastName) {
                    console.error('[STRIPE] ❌ Missing required fields');
                    res.writeHead(400, corsHeaders);
                    res.end(JSON.stringify({ error: 'First name and last name are required' }));
                    return;
                }
                
                // Create Stripe Checkout Session
                console.log('[STRIPE] Creating checkout session...');
                const session = await stripe.checkout.sessions.create({
                    payment_method_types: ['card'],
                    line_items: [
                        {
                            price_data: {
                                currency: 'usd',
                                product_data: {
                                    name: 'Unclaimed Funds Processing Fee',
                                    description: `Processing fee for ${firstName} ${lastName} - Claim amount: $${amount.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`
                                },
                                unit_amount: Math.round(processingFee * 100) // Convert to cents
                            },
                            quantity: 1
                        }
                    ],
                    mode: 'payment',
                    success_url: `${req.headers.origin || 'https://www.owedtoyou.ai'}/success?session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url: `${req.headers.origin || 'https://www.owedtoyou.ai'}/cancel`,
                    metadata: {
                        firstName: firstName,
                        lastName: lastName,
                        claimAmount: amount.toString()
                    }
                });
                
                console.log('[STRIPE] ✅ Checkout session created successfully:', session.id);
                console.log('[STRIPE] Session URL:', session.url);
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify({ id: session.id }));
            } catch (error) {
                console.error('[STRIPE] ❌ Error creating checkout session:', error);
                console.error('[STRIPE] Error message:', error.message);
                console.error('[STRIPE] Error type:', error.type);
                console.error('[STRIPE] Error stack:', error.stack);
                res.writeHead(500, corsHeaders);
                res.end(JSON.stringify({ error: error.message || 'Failed to create checkout session' }));
            }
        });
    }
    // Handle Missing Money search
    else if (parsedUrl.pathname === '/api/search-missing-money' && req.method === 'POST') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const { firstName, lastName, city, state, use2Captcha, captchaApiKey } = data;
                
                // Only require first and last name (city and state are optional on missingmoney.com)
                if (!firstName || !lastName) {
                    res.writeHead(400, corsHeaders);
                    res.end(JSON.stringify({ success: false, error: 'Missing required fields: firstName and lastName are required' }));
                    return;
                }
                
                // Use empty strings if city/state not provided
                const searchCity = city || '';
                const searchState = state || '';
                
                // Remove emojis from names before searching
                const cleanNameForSearch = (name) => {
                    if (!name) return '';
                    let cleaned = name.replace(/[\u{1F600}-\u{1F64F}]/gu, ''); // Emoticons
                    cleaned = cleaned.replace(/[\u{1F300}-\u{1F5FF}]/gu, ''); // Misc Symbols and Pictographs
                    cleaned = cleaned.replace(/[\u{1F680}-\u{1F6FF}]/gu, ''); // Transport and Map
                    cleaned = cleaned.replace(/[\u{1F1E0}-\u{1F1FF}]/gu, ''); // Flags (country flags)
                    cleaned = cleaned.replace(/[\u{2600}-\u{26FF}]/gu, ''); // Misc symbols
                    cleaned = cleaned.replace(/[\u{2700}-\u{27BF}]/gu, ''); // Dingbats
                    cleaned = cleaned.replace(/[\u{FE00}-\u{FE0F}]/gu, ''); // Variation Selectors
                    cleaned = cleaned.replace(/[\u{200D}]/gu, ''); // Zero Width Joiner
                    cleaned = cleaned.replace(/[\u{20E3}]/gu, ''); // Combining Enclosing Keycap
                    return cleaned.trim().replace(/\s+/g, ' ');
                };
                
                const cleanedFirstName = cleanNameForSearch(firstName);
                const cleanedLastName = cleanNameForSearch(lastName);
                
                if (cleanedFirstName !== firstName || cleanedLastName !== lastName) {
                    console.log(`🧹 Cleaned names in server: "${firstName}" -> "${cleanedFirstName}", "${lastName}" -> "${cleanedLastName}"`);
                }
                
                console.log(`Searching Missing Money for ${cleanedFirstName} ${cleanedLastName}${searchCity ? `, ${searchCity}` : ''}${searchState ? `, ${searchState}` : ''}`);
                console.log(`2captcha enabled: ${use2Captcha}, API key provided: ${!!captchaApiKey}`);
                if (captchaApiKey) {
                    console.log(`API key (first 10 chars): ${captchaApiKey.substring(0, 10)}...`);
                }
                
                // Execute search with timeout protection and retry logic
                // Increased retries to ensure searches never fail
                let result;
                let retries = 0;
                const MAX_RETRIES = 5; // Increased from 2 to 5 to ensure searches complete
                
                while (retries <= MAX_RETRIES) {
                    try {
                        result = await searchMissingMoney(cleanedFirstName, cleanedLastName, searchCity, searchState, use2Captcha || false, captchaApiKey || null);
                        
                        // If successful, break immediately
                        if (result.success) {
                            break;
                        }
                        
                        // Check if error is retryable (resource exhaustion, timeouts, etc.)
                        const isRetryableError = result._isRetryable || 
                            (result.error && (
                                result.error.includes('Server is processing') ||
                                result.error.includes('timed out') ||
                                result.error.includes('timeout')
                            ));
                        
                        // If non-retryable error, break
                        if (!isRetryableError) {
                            break;
                        }
                        
                        // If retryable error, retry with exponential backoff
                        retries++;
                        if (retries <= MAX_RETRIES) {
                            const waitTime = Math.min(1000 * Math.pow(2, retries), 10000); // Exponential backoff, max 10s
                            console.log(`[SEARCH] Retryable error detected: "${result.error}". Waiting ${waitTime}ms before retry ${retries}/${MAX_RETRIES}...`);
                            await new Promise(resolve => setTimeout(resolve, waitTime));
                            continue;
                        }
                        
                        // Max retries reached but still retryable - return the error
                        break;
                    } catch (searchError) {
                        console.error('[SEARCH] Error in searchMissingMoney:', searchError);
                        
                        // Check if it's a retryable error (timeout, resource exhaustion, etc.)
                        const isRetryable = searchError._isRetryable || 
                            searchError._isTimeout ||
                            (searchError.message && (
                                searchError.message.includes('Resource temporarily unavailable') ||
                                searchError.message.includes('ENOMEM') ||
                                searchError.message.includes('EMFILE') ||
                                searchError.message.includes('pthread_create') ||
                                searchError.message.includes('timed out') ||
                                searchError.message.includes('timeout')
                            ));
                        
                        if (isRetryable && retries < MAX_RETRIES) {
                            retries++;
                            const waitTime = Math.min(1000 * Math.pow(2, retries), 10000); // Exponential backoff, max 10s
                            console.log(`[SEARCH] Retryable error detected: "${searchError.message}". Waiting ${waitTime}ms before retry ${retries}/${MAX_RETRIES}...`);
                            await new Promise(resolve => setTimeout(resolve, waitTime));
                            continue;
                        }
                        
                        // Non-retryable or max retries reached - convert to result format
                        result = {
                            success: false,
                            error: searchError.message || 'Search failed due to server error. Please try again.',
                            results: []
                        };
                        break;
                    }
                }
                
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify(result));
            } catch (error) {
                console.error('[SEARCH API] Unexpected error:', error);
                res.writeHead(500, corsHeaders);
                res.end(JSON.stringify({ 
                    success: false, 
                    error: error.message || 'An unexpected error occurred. Please try again.',
                    results: []
                }));
            }
        });
    } else if (parsedUrl.pathname === '/api/health' && req.method === 'GET') {
        // Health check endpoint to monitor system status
        const browserStats = getBrowserStats();
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ 
            status: 'ok',
            timestamp: new Date().toISOString(),
            message: 'Server is running',
            browserStats: browserStats
        }));
    } else if (parsedUrl.pathname === '/api/leaderboard' && req.method === 'GET') {
        // Get leaderboard entries from PostgreSQL
        (async () => {
            try {
                if (!pool) {
                    console.warn(`[LEADERBOARD] GET request - database not available, returning empty array`);
                    res.writeHead(200, corsHeaders);
                    res.end(JSON.stringify({ success: true, leaderboard: [] }));
                    return;
                }
                
                console.log(`[LEADERBOARD] GET request - fetching from database`);
                
                const result = await pool.query(`
                    SELECT 
                        name,
                        handle,
                        amount,
                        is_placeholder as "isPlaceholder",
                        entities,
                        profile_pic as "profilePic",
                        created_at as "createdAt",
                        updated_at as "updatedAt"
                    FROM leaderboard
                    ORDER BY 
                        CASE WHEN is_placeholder THEN 1 ELSE 0 END,
                        amount DESC
                `);
                
                const leaderboard = result.rows.map(row => ({
                    name: row.name,
                    handle: row.handle,
                    amount: row.amount,
                    isPlaceholder: row.isPlaceholder,
                    entities: row.entities ? (typeof row.entities === 'string' ? JSON.parse(row.entities) : row.entities) : null,
                    profilePic: row.profilePic || null,
                    createdAt: row.createdAt,
                    updatedAt: row.updatedAt
                }));
                
                console.log(`[LEADERBOARD] Loaded ${leaderboard.length} entries from database`);
                
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify({ success: true, leaderboard: leaderboard }));
            } catch (error) {
                console.error(`[LEADERBOARD] GET error:`, error);
                res.writeHead(500, corsHeaders);
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
        })();
    } else if (parsedUrl.pathname === '/api/migrate-profile-pics' && req.method === 'POST') {
        // Migrate all existing profile picture URLs to base64
        (async () => {
            try {
                if (!pool) {
                    res.writeHead(503, corsHeaders);
                    res.end(JSON.stringify({ success: false, error: 'Database not available' }));
                    return;
                }
                
                console.log(`[MIGRATION] Starting profile picture migration to base64...`);
                
                // Fetch all entries with profile pics that are URLs (not base64)
                const result = await pool.query(`
                    SELECT handle, profile_pic
                    FROM leaderboard
                    WHERE profile_pic IS NOT NULL 
                    AND profile_pic != ''
                    AND profile_pic NOT LIKE 'data:image%'
                    AND profile_pic LIKE 'http%'
                `);
                
                console.log(`[MIGRATION] Found ${result.rows.length} entries with URL profile pics to convert`);
                
                let converted = 0;
                let failed = 0;
                
                // Convert each URL to base64
                for (const row of result.rows) {
                    try {
                        const imageUrl = row.profile_pic;
                        const handle = row.handle;
                        
                        console.log(`[MIGRATION] Converting ${handle}...`);
                        
                        // Download image
                        const https = require('https');
                        const http = require('http');
                        const urlObj = new URL(imageUrl);
                        const client = urlObj.protocol === 'https:' ? https : http;
                        
                        const imageBuffer = await new Promise((resolve, reject) => {
                            const request = client.get(imageUrl, (response) => {
                                if (response.statusCode !== 200) {
                                    reject(new Error(`Failed to fetch image: ${response.statusCode}`));
                                    return;
                                }
                                
                                const chunks = [];
                                response.on('data', chunk => chunks.push(chunk));
                                response.on('end', () => resolve(Buffer.concat(chunks)));
                                response.on('error', reject);
                            });
                            request.on('error', reject);
                            request.setTimeout(10000, () => {
                                request.destroy();
                                reject(new Error('Request timeout'));
                            });
                        });
                        
                        // Determine content type
                        let contentType = 'image/jpeg';
                        if (imageUrl.includes('.png')) contentType = 'image/png';
                        else if (imageUrl.includes('.webp')) contentType = 'image/webp';
                        else if (imageUrl.includes('.gif')) contentType = 'image/gif';
                        
                        // Convert to base64
                        const base64Data = imageBuffer.toString('base64');
                        const base64DataUrl = `data:${contentType};base64,${base64Data}`;
                        
                        // Update database
                        await pool.query(
                            `UPDATE leaderboard SET profile_pic = $1 WHERE handle = $2`,
                            [base64DataUrl, handle]
                        );
                        
                        converted++;
                        console.log(`[MIGRATION] ✅ Converted ${handle} to base64 (${base64DataUrl.substring(0, 50)}...)`);
                    } catch (error) {
                        failed++;
                        console.error(`[MIGRATION] ❌ Failed to convert ${row.handle}:`, error.message);
                    }
                }
                
                console.log(`[MIGRATION] Complete: ${converted} converted, ${failed} failed`);
                
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify({ 
                    success: true, 
                    converted: converted,
                    failed: failed,
                    total: result.rows.length,
                    message: `Migrated ${converted} profile pictures to base64`
                }));
            } catch (error) {
                console.error(`[MIGRATION] Error:`, error);
                res.writeHead(500, corsHeaders);
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
        })();
    } else if (parsedUrl.pathname === '/api/leaderboard/clear-handles' && req.method === 'POST') {
        // Clear all entries from leaderboard
        (async () => {
            try {
                if (!pool) {
                    console.warn(`[LEADERBOARD] CLEAR ALL request - database not available`);
                    res.writeHead(503, corsHeaders);
                    res.end(JSON.stringify({ success: false, error: 'Database not available' }));
                    return;
                }
                
                console.log(`[LEADERBOARD] Clearing all entries from leaderboard`);
                
                // Delete all entries from leaderboard
                const deleteResult = await pool.query(
                    'DELETE FROM leaderboard'
                );
                
                console.log(`[LEADERBOARD] Deleted ${deleteResult.rowCount} entries from leaderboard`);
                
                // Return empty leaderboard
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify({ 
                    success: true, 
                    deleted: deleteResult.rowCount,
                    leaderboard: [] 
                }));
            } catch (error) {
                console.error(`[LEADERBOARD] CLEAR ALL error:`, error);
                res.writeHead(500, corsHeaders);
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
        })();
    } else if (parsedUrl.pathname === '/api/leaderboard' && parsedUrl.query.handle && req.method === 'DELETE') {
        // Delete entry from leaderboard
        (async () => {
            try {
                if (!pool) {
                    console.warn(`[LEADERBOARD] DELETE request - database not available`);
                    res.writeHead(503, corsHeaders);
                    res.end(JSON.stringify({ success: false, error: 'Database not available' }));
                    return;
                }
                
                const handle = decodeURIComponent(parsedUrl.query.handle);
                console.log(`[LEADERBOARD] DELETE request for handle: ${handle}`);
                
                const result = await pool.query(
                    'DELETE FROM leaderboard WHERE handle = $1 RETURNING *',
                    [handle]
                );
                
                if (result.rows.length > 0) {
                    console.log(`[LEADERBOARD] Deleted entry: ${handle}`);
                    
                    // Fetch updated leaderboard
                    const leaderboardResult = await pool.query(`
                        SELECT 
                            name,
                            handle,
                            amount,
                            is_placeholder as "isPlaceholder",
                            entities,
                            created_at as "createdAt",
                            updated_at as "updatedAt"
                        FROM leaderboard
                        WHERE is_placeholder = false
                        ORDER BY 
                            CASE WHEN is_placeholder THEN 1 ELSE 0 END,
                            amount DESC
                    `);
                    
                    const leaderboard = leaderboardResult.rows.map(row => ({
                        name: row.name,
                        handle: row.handle,
                        amount: row.amount,
                        isPlaceholder: row.isPlaceholder,
                        entities: row.entities ? (typeof row.entities === 'string' ? JSON.parse(row.entities) : row.entities) : null,
                        createdAt: row.createdAt,
                        updatedAt: row.updatedAt
                    }));
                    
                    res.writeHead(200, corsHeaders);
                    res.end(JSON.stringify({ success: true, leaderboard: leaderboard }));
                } else {
                    console.log(`[LEADERBOARD] Entry not found: ${handle}`);
                    res.writeHead(404, corsHeaders);
                    res.end(JSON.stringify({ success: false, error: 'Entry not found' }));
                }
            } catch (error) {
                console.error(`[LEADERBOARD] DELETE error:`, error);
                res.writeHead(500, corsHeaders);
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
        })();
    } else if (parsedUrl.pathname === '/api/submit-mailing-address') {
        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
            res.writeHead(200, corsHeaders);
            res.end();
            return;
        }
        
        // Handle mailing address form submission
        if (req.method !== 'POST') {
            res.writeHead(405, corsHeaders);
            res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
            return;
        }
        
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', async () => {
            try {
                console.log('[MAILING ADDRESS] Request received, parsing body...');
                console.log('[MAILING ADDRESS] Raw body:', body.substring(0, 200));
                
                const mailingData = JSON.parse(body);
                console.log('[MAILING ADDRESS] Parsed data:', {
                    firstName: mailingData.firstName,
                    lastName: mailingData.lastName,
                    email: mailingData.email,
                    phone: mailingData.phone,
                    city: mailingData.city,
                    state: mailingData.state,
                    hasSSN: !!mailingData.ssn
                });
                
                // Validate required fields
                if (!mailingData.firstName || !mailingData.lastName || !mailingData.email || 
                    !mailingData.phone || !mailingData.address1 || !mailingData.city || 
                    !mailingData.state || !mailingData.zipCode) {
                    res.writeHead(400, corsHeaders);
                    res.end(JSON.stringify({ success: false, error: 'Missing required fields' }));
                    return;
                }
                
                // Format date of birth
                const dob = mailingData.dateOfBirth;
                const dobString = (dob.month && dob.day && dob.year) 
                    ? `${dob.month}/${dob.day}/${dob.year}` 
                    : 'Not provided';
                
                // Format email body
                const emailBody = `
New Mailing Address Submission

Personal Information:
- Name: ${mailingData.firstName} ${mailingData.lastName}
- Date of Birth: ${dobString}
- Email: ${mailingData.email}
- Phone: ${mailingData.phone}${mailingData.phone2 ? `\n- Phone 2: ${mailingData.phone2}` : ''}
- SSN/Tax ID: ${mailingData.ssn || 'Not provided'}

Mailing Address:
- Address 1: ${mailingData.address1}
- City: ${mailingData.city}
- State: ${mailingData.state}
- Zip Code: ${mailingData.zipCode}
- Country: ${mailingData.country || 'US'}

Submitted: ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })} CST
                `.trim();
                
                // Send email using SendGrid
                if (!sendGridConfigured) {
                    console.error('[MAILING ADDRESS] ❌ SendGrid not configured');
                    console.error('[MAILING ADDRESS] SENDGRID_API_KEY:', process.env.SENDGRID_API_KEY ? 'SET' : 'NOT SET');
                    res.writeHead(500, corsHeaders);
                    res.end(JSON.stringify({ success: false, error: 'Email service not configured. Please check SENDGRID_API_KEY environment variable.' }));
                    return;
                }
                
                const fromEmail = process.env.SENDGRID_FROM_EMAIL || 'owedtoyoucontact@gmail.com';
                const toEmail = 'owedtoyoucontact@gmail.com';
                
                const msg = {
                    to: toEmail,
                    from: {
                        email: fromEmail,
                        name: 'OwedToYou.ai'
                    },
                    subject: `New Mailing Address Submission - ${mailingData.firstName} ${mailingData.lastName}`,
                    text: emailBody,
                    html: `
                        <h2>New Mailing Address Submission</h2>
                        <h3>Personal Information:</h3>
                        <ul>
                            <li><strong>Name:</strong> ${mailingData.firstName} ${mailingData.lastName}</li>
                            <li><strong>Date of Birth:</strong> ${dobString}</li>
                            <li><strong>Email:</strong> ${mailingData.email}</li>
                            <li><strong>Phone:</strong> ${mailingData.phone}</li>
                            ${mailingData.phone2 ? `<li><strong>Phone 2:</strong> ${mailingData.phone2}</li>` : ''}
                            <li><strong>SSN/Tax ID:</strong> ${mailingData.ssn || 'Not provided'}</li>
                        </ul>
                        <h3>Mailing Address:</h3>
                        <ul>
                            <li><strong>Address 1:</strong> ${mailingData.address1}</li>
                            <li><strong>City:</strong> ${mailingData.city}</li>
                            <li><strong>State:</strong> ${mailingData.state}</li>
                            <li><strong>Zip Code:</strong> ${mailingData.zipCode}</li>
                            <li><strong>Country:</strong> ${mailingData.country || 'US'}</li>
                        </ul>
                        <p><em>Submitted: ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })} CST</em></p>
                    `
                };
                
                console.log('[MAILING ADDRESS] Attempting to send email via SendGrid...');
                console.log('[MAILING ADDRESS] From:', fromEmail);
                console.log('[MAILING ADDRESS] To:', toEmail);
                console.log('[MAILING ADDRESS] Subject:', msg.subject);
                
                // Send email with SendGrid (has built-in timeout handling)
                try {
                    console.log('[MAILING ADDRESS] Sending email via SendGrid...');
                    console.log('[MAILING ADDRESS] Message details:', JSON.stringify({
                        to: msg.to,
                        from: msg.from,
                        subject: msg.subject,
                        hasText: !!msg.text,
                        hasHtml: !!msg.html
                    }, null, 2));
                    
                    const emailResult = await sgMail.send(msg);
                    console.log('[MAILING ADDRESS] ✅ Email sent successfully to owedtoyoucontact@gmail.com');
                    console.log('[MAILING ADDRESS] Email status code:', emailResult[0]?.statusCode);
                    console.log('[MAILING ADDRESS] Email response:', JSON.stringify(emailResult, null, 2));
                } catch (sgError) {
                    // Handle connection errors gracefully
                    if (sgError.code === 'ECONNRESET' || sgError.code === 'ETIMEDOUT' || sgError.message?.includes('aborted')) {
                        console.error('[MAILING ADDRESS] ⚠️ Connection error (non-fatal):', sgError.code, sgError.message);
                        // Don't throw - allow the request to complete, email may have been sent
                        // SendGrid will retry on their end if needed
                    } else {
                        console.error('[MAILING ADDRESS] ❌ SendGrid error:', sgError);
                        console.error('[MAILING ADDRESS] SendGrid error response:', sgError.response?.body);
                        console.error('[MAILING ADDRESS] SendGrid error code:', sgError.code);
                        console.error('[MAILING ADDRESS] SendGrid error message:', sgError.message);
                        throw sgError;
                    }
                }
                
                // Ensure response is sent
                console.log('[MAILING ADDRESS] Sending success response...');
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify({ success: true, message: 'Mailing address submitted successfully' }));
                console.log('[MAILING ADDRESS] ✅ Success response sent');
            } catch (error) {
                console.error('[MAILING ADDRESS] ❌ Error:', error);
                console.error('[MAILING ADDRESS] Error message:', error.message);
                console.error('[MAILING ADDRESS] Error stack:', error.stack);
                
                // Check if it's a SendGrid error
                let errorMessage = error.message || 'Unknown error';
                if (error.response) {
                    console.error('[MAILING ADDRESS] SendGrid response status:', error.response.statusCode);
                    console.error('[MAILING ADDRESS] SendGrid response body:', JSON.stringify(error.response.body, null, 2));
                    
                    if (error.response.statusCode === 403) {
                        errorMessage = 'SendGrid Forbidden: Please verify your sender email address in SendGrid. Go to Settings → Sender Authentication → Verify a Single Sender, then use that email in SENDGRID_FROM_EMAIL variable.';
                    } else if (error.response.body && error.response.body.errors) {
                        errorMessage = 'SendGrid error: ' + error.response.body.errors.map(e => e.message).join(', ');
                    }
                }
                
                // Make sure to send a response even on error
                res.writeHead(500, corsHeaders);
                res.end(JSON.stringify({ 
                    success: false, 
                    error: 'Failed to submit mailing address: ' + errorMessage
                }));
            }
        });
        
        // Handle request errors
        req.on('error', (error) => {
            console.error('[MAILING ADDRESS] ❌ Request error:', error);
            res.writeHead(500, corsHeaders);
            res.end(JSON.stringify({ success: false, error: 'Request error: ' + error.message }));
        });
    } else if (parsedUrl.pathname === '/api/leaderboard' && req.method === 'POST') {
        // Add entry to leaderboard
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', async () => {
            try {
                const entry = JSON.parse(body);
                
                // Validate entry (amount can be 0, but must be a number)
                if (!entry.name || !entry.handle || typeof entry.amount !== 'number') {
                    res.writeHead(400, corsHeaders);
                    res.end(JSON.stringify({ success: false, error: 'Missing required fields or invalid amount' }));
                    return;
                }
                
                console.log(`[LEADERBOARD] Processing entry:`, {
                    handle: entry.handle,
                    name: entry.name,
                    amount: entry.amount,
                    isPlaceholder: entry.isPlaceholder || false,
                    hasProfilePic: !!entry.profilePic
                });
                
                if (!pool) {
                    console.warn(`[LEADERBOARD] Database not available, cannot save entry`);
                    res.writeHead(503, corsHeaders);
                    res.end(JSON.stringify({ success: false, error: 'Database not available. Please add PostgreSQL database in Railway.' }));
                    return;
                }
                
                // Check if entry already exists (handle is UNIQUE in database)
                const existingResult = await pool.query(
                    'SELECT id, amount, is_placeholder FROM leaderboard WHERE handle = $1',
                    [entry.handle]
                );
                
                if (existingResult.rows.length > 0) {
                    // Update existing entry (prevents duplicates)
                    const existing = existingResult.rows[0];
                    console.log(`[LEADERBOARD] Existing entry found, updating (preventing duplicate):`, {
                        id: existing.id,
                        handle: entry.handle,
                        existingAmount: existing.amount,
                        newAmount: entry.amount,
                        existingIsPlaceholder: existing.is_placeholder,
                        newIsPlaceholder: entry.isPlaceholder || false
                    });
                    
                    // UPDATE existing entry - this prevents duplicates
                    // CRITICAL: Include profile_pic in UPDATE
                    await pool.query(
                        `UPDATE leaderboard 
                         SET name = $1, amount = $2, is_placeholder = $3, entities = $4, profile_pic = $5, updated_at = CURRENT_TIMESTAMP
                         WHERE handle = $6`,
                        [
                            entry.name, 
                            entry.amount, 
                            entry.isPlaceholder || false, 
                            entry.entities ? JSON.stringify(entry.entities) : null,
                            entry.profilePic || null,
                            entry.handle
                        ]
                    );
                    console.log(`[LEADERBOARD] Updated existing entry for handle: ${entry.handle} (duplicate prevented)`);
                } else {
                    // Insert new entry (only if it doesn't exist)
                    // CRITICAL: Include profile_pic in INSERT
                    await pool.query(
                        `INSERT INTO leaderboard (name, handle, amount, is_placeholder, entities, profile_pic)
                         VALUES ($1, $2, $3, $4, $5, $6)`,
                        [
                            entry.name, 
                            entry.handle, 
                            entry.amount, 
                            entry.isPlaceholder || false, 
                            entry.entities ? JSON.stringify(entry.entities) : null,
                            entry.profilePic || null
                        ]
                    );
                    console.log(`[LEADERBOARD] Added new entry for handle: ${entry.handle}`);
                }
                
                // Fetch updated leaderboard - deduplicate by handle (case-insensitive)
                // Use DISTINCT ON to ensure only one entry per handle
                // CRITICAL: Include profile_pic in SELECT
                const result = await pool.query(`
                    SELECT DISTINCT ON (LOWER(handle))
                        name,
                        handle,
                        amount,
                        is_placeholder as "isPlaceholder",
                        entities,
                        profile_pic as "profilePic",
                        created_at as "createdAt",
                        updated_at as "updatedAt"
                    FROM leaderboard
                    ORDER BY 
                        LOWER(handle),
                        CASE WHEN is_placeholder THEN 1 ELSE 0 END,
                        amount DESC,
                        created_at DESC
                `);
                
                const leaderboard = result.rows.map(row => ({
                    name: row.name,
                    handle: row.handle,
                    amount: row.amount,
                    isPlaceholder: row.isPlaceholder,
                    entities: row.entities ? (typeof row.entities === 'string' ? JSON.parse(row.entities) : row.entities) : null,
                    profilePic: row.profilePic || null,
                    createdAt: row.createdAt,
                    updatedAt: row.updatedAt
                }));
                
                console.log(`[LEADERBOARD] Returning ${leaderboard.length} entries`);
                
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify({ success: true, leaderboard: leaderboard }));
            } catch (error) {
                console.error(`[LEADERBOARD] POST error:`, error);
                res.writeHead(500, corsHeaders);
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
        });
    } else {
        // Serve static files (HTML, CSS, JS)
        // Handle /search route - serve search.html
        let filePath;
        if (parsedUrl.pathname === '/search' || parsedUrl.pathname === '/search/') {
            filePath = '/search.html';
        } else {
            filePath = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;
        }
        const extname = String(path.extname(filePath)).toLowerCase();
        const mimeTypes = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.wav': 'audio/wav',
            '.mp4': 'video/mp4',
            '.woff': 'application/font-woff',
            '.ttf': 'application/font-ttf',
            '.eot': 'application/vnd.ms-fontobject',
            '.otf': 'application/font-otf',
            '.wasm': 'application/wasm'
        };

        const contentType = mimeTypes[extname] || 'application/octet-stream';
        const safePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
        const fullPath = path.join(__dirname, safePath);

        // Security: Only serve files from the project directory
        if (!fullPath.startsWith(__dirname)) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Forbidden');
            return;
        }

        fs.readFile(fullPath, (error, content) => {
            if (error) {
                if (error.code === 'ENOENT') {
                    // If file not found, serve index.html (for SPA routing)
                    fs.readFile(path.join(__dirname, 'index.html'), (error, content) => {
                        if (error) {
                            res.writeHead(404, { 'Content-Type': 'text/plain' });
                            res.end('File not found');
                        } else {
                            res.writeHead(200, { 'Content-Type': 'text/html' });
                            res.end(content, 'utf-8');
                        }
                    });
                } else {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end(`Server error: ${error.code}`);
                }
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content, 'utf-8');
            }
        });
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`API endpoint: /api/profile-pic?username=USERNAME`);
    console.log(`API endpoint: /api/instagram-name?username=USERNAME`);
});

