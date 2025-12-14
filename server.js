const http = require('http');
const https = require('https');
const url = require('url');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { searchMissingMoney } = require('./missingMoneySearch');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { chromium } = require('playwright');

const PORT = process.env.PORT || 3000;

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
        
        // Create index on handle for faster lookups
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_leaderboard_handle ON leaderboard(handle)
        `);
        
        console.log('[DATABASE] Leaderboard table initialized successfully');
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

// Fetch Instagram profile picture
async function fetchInstagramProfile(username) {
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
    // Use Playwright to render the page and extract name from visible DOM
    // Use same stealth settings as missingMoneySearch.js to avoid detection
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
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        });
        
        // Create context with realistic browser fingerprint (same as missingMoneySearch.js)
        const context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            locale: 'en-US',
            timezoneId: 'America/Chicago',
            permissions: ['geolocation'],
            geolocation: { latitude: 30.2672, longitude: -97.7431 }, // Austin, TX
            colorScheme: 'light',
            extraHTTPHeaders: {
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Cache-Control': 'max-age=0'
            }
        });
        
        const page = await context.newPage();
        
        // Override webdriver property to hide automation (same as missingMoneySearch.js)
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
        });
        
        const instagramUrl = `https://www.instagram.com/${username}/`;
        
        console.log(`[INSTAGRAM] Navigating to ${instagramUrl}`);
        await page.goto(instagramUrl, { waitUntil: 'networkidle', timeout: 20000 });
        
        // Wait for content to load
        await page.waitForTimeout(3000);
        
        // Check if we got redirected to login page
        const currentUrl = page.url();
        console.log(`[INSTAGRAM] Final URL after navigation: ${currentUrl}`);
        
        if (currentUrl.includes('/accounts/login/') || currentUrl.includes('login')) {
            console.log(`[INSTAGRAM] ⚠️ Redirected to login page: ${currentUrl}`);
            console.log(`[INSTAGRAM] ⚠️ Instagram is blocking Playwright requests`);
            await browser.close();
            return { success: false, error: 'Instagram is requiring login (blocking detected). Try using the browser-based search method.' };
        }
        
        // Check page title to see if we got blocked
        const pageTitle = await page.title();
        console.log(`[INSTAGRAM] Page title: ${pageTitle}`);
        
        if (pageTitle.includes('Login') || pageTitle.includes('Instagram')) {
            // Check if there's a login form visible
            const loginForm = await page.$('input[name="username"], input[type="password"]');
            if (loginForm) {
                console.log(`[INSTAGRAM] ⚠️ Login form detected on page`);
                await browser.close();
                return { success: false, error: 'Instagram is requiring login (blocking detected). Try using the browser-based search method.' };
            }
        }
        
        // Try to find the name element - Instagram displays it in a span near the username
        // The name is in a span with obfuscated classes, usually with dir="auto"
        console.log(`[INSTAGRAM] Searching for name element in DOM...`);
        
        // Strategy 1: Look for span with dir="auto" that contains text (this is usually the name)
        let fullName = null;
        
        try {
            // Find span elements with dir="auto" that contain text (2-4 words)
            const nameSpans = await page.$$eval('span[dir="auto"]', spans => {
                return spans.map(span => span.textContent.trim())
                    .filter(text => {
                        const words = text.split(/\s+/);
                        return words.length >= 2 && words.length <= 4 && 
                               words.every(w => w.length >= 2 && w.length <= 20 && /^[A-Za-z]+$/.test(w));
                    })
                    .filter(text => !text.toLowerCase().includes('instagram') &&
                                    !text.toLowerCase().includes('login') &&
                                    !text.toLowerCase().includes('follow') &&
                                    !text.toLowerCase().includes('posts') &&
                                    !text.toLowerCase().includes('followers') &&
                                    !text.toLowerCase().includes('following'));
            });
            
            console.log(`[INSTAGRAM] Found ${nameSpans.length} potential name spans`);
            if (nameSpans.length > 0) {
                console.log(`[INSTAGRAM] Name spans found:`, nameSpans);
                // Use the first one (usually the name is the first span with dir="auto")
                fullName = nameSpans[0];
                console.log(`[INSTAGRAM] ✅ Extracted name from span[dir="auto"]: ${fullName}`);
            }
        } catch (e) {
            console.log(`[INSTAGRAM] Error finding span[dir="auto"]: ${e.message}`);
            console.log(`[INSTAGRAM] Error stack: ${e.stack}`);
        }
        
        // Strategy 2: If not found, look for h1/h2 tags (sometimes Instagram uses these)
        if (!fullName) {
            try {
                const headers = await page.$$eval('h1, h2', headers => {
                    return headers.map(h => h.textContent.trim())
                        .filter(text => {
                            const words = text.split(/\s+/);
                            return words.length >= 2 && words.length <= 4;
                        });
                });
                
                if (headers.length > 0) {
                    fullName = headers[0];
                    console.log(`[INSTAGRAM] Extracted name from header: ${fullName}`);
                }
            } catch (e) {
                console.log(`[INSTAGRAM] Error finding headers: ${e.message}`);
            }
        }
        
        // Strategy 3: Look for any text content near the username
        if (!fullName) {
            try {
                // Find the username element first - try multiple selectors
                let usernameElement = await page.$(`text=${username}`);
                if (!usernameElement) {
                    // Try finding by link href
                    usernameElement = await page.$(`a[href*="${username}"]`);
                }
                
                if (usernameElement) {
                    console.log(`[INSTAGRAM] Found username element, searching for nearby name...`);
                    // Get parent container and look for text siblings
                    const parent = await usernameElement.evaluateHandle(el => el.closest('section, article, div, header'));
                    if (parent) {
                        const nearbyText = await parent.evaluate(el => {
                            const texts = [];
                            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
                            let node;
                            while (node = walker.nextNode()) {
                                const text = node.textContent.trim();
                                const words = text.split(/\s+/);
                                if (words.length >= 2 && words.length <= 4 && 
                                    words.every(w => w.length >= 2 && w.length <= 20 && /^[A-Za-z]+$/.test(w))) {
                                    texts.push(text);
                                }
                            }
                            return texts;
                        });
                        
                        console.log(`[INSTAGRAM] Found ${nearbyText ? nearbyText.length : 0} nearby text matches`);
                        if (nearbyText && nearbyText.length > 0) {
                            console.log(`[INSTAGRAM] Nearby texts:`, nearbyText);
                            fullName = nearbyText[0];
                            console.log(`[INSTAGRAM] ✅ Extracted name from nearby text: ${fullName}`);
                        }
                    }
                } else {
                    console.log(`[INSTAGRAM] Could not find username element in DOM`);
                }
            } catch (e) {
                console.log(`[INSTAGRAM] Error finding nearby text: ${e.message}`);
                console.log(`[INSTAGRAM] Error stack: ${e.stack}`);
            }
        }
        
        // Strategy 4: Get all visible text and find name-like patterns
        if (!fullName) {
            try {
                console.log(`[INSTAGRAM] Trying to extract all visible text...`);
                const allText = await page.evaluate(() => {
                    const texts = [];
                    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                    let node;
                    while (node = walker.nextNode()) {
                        const text = node.textContent.trim();
                        if (text.length > 3 && text.length < 60) {
                            texts.push(text);
                        }
                    }
                    return texts;
                });
                
                console.log(`[INSTAGRAM] Found ${allText.length} text nodes on page`);
                
                // Filter for name-like text (2-4 words, alphabetic)
                const nameLikeTexts = allText.filter(text => {
                    const words = text.split(/\s+/);
                    return words.length >= 2 && words.length <= 4 &&
                           words.every(w => w.length >= 2 && w.length <= 20 && /^[A-Za-z]+$/.test(w)) &&
                           !text.toLowerCase().includes('instagram') &&
                           !text.toLowerCase().includes('login') &&
                           !text.toLowerCase().includes('follow') &&
                           !text.toLowerCase().includes('posts');
                });
                
                console.log(`[INSTAGRAM] Found ${nameLikeTexts.length} name-like texts:`, nameLikeTexts.slice(0, 10));
                
                if (nameLikeTexts.length > 0) {
                    fullName = nameLikeTexts[0];
                    console.log(`[INSTAGRAM] ✅ Extracted name from all visible text: ${fullName}`);
                }
            } catch (e) {
                console.log(`[INSTAGRAM] Error extracting all text: ${e.message}`);
            }
        }
        
        await browser.close();
        
        if (fullName && fullName.length > 0) {
            console.log(`[INSTAGRAM] Successfully extracted name: ${fullName}`);
            return { success: true, fullName: fullName.trim() };
        } else {
            console.log(`[INSTAGRAM] Could not extract name from visible DOM`);
            return { success: false, error: 'Full name not found in HTML' };
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
    
    // Handle profile picture fetch
    if (parsedUrl.pathname === '/api/profile-pic' && parsedUrl.query.username) {
        const username = parsedUrl.query.username.replace('@', '').trim();
        
        fetchInstagramProfile(username)
            .then(result => {
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify(result));
            })
            .catch(error => {
                res.writeHead(500, corsHeaders);
                res.end(JSON.stringify({ success: false, error: error.message }));
            });
    }
    // Handle Instagram name fetch
    else if (parsedUrl.pathname === '/api/instagram-name' && parsedUrl.query.username) {
        const username = parsedUrl.query.username.replace('@', '').trim();
        
        fetchInstagramFullName(username)
            .then(result => {
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify(result));
            })
            .catch(error => {
                res.writeHead(500, corsHeaders);
                res.end(JSON.stringify({ success: false, error: error.message }));
            });
    }
    // Handle Stripe checkout session creation
    else if (parsedUrl.pathname === '/api/create-checkout-session' && req.method === 'POST') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', async () => {
            try {
                if (!stripe) {
                    res.writeHead(500, corsHeaders);
                    res.end(JSON.stringify({ error: 'Stripe not configured. Please set STRIPE_SECRET_KEY environment variable.' }));
                    return;
                }
                
                const data = JSON.parse(body);
                const { firstName, lastName, amount, processingFee } = data;
                
                if (!firstName || !lastName) {
                    res.writeHead(400, corsHeaders);
                    res.end(JSON.stringify({ error: 'First name and last name are required' }));
                    return;
                }
                
                // Create Stripe Checkout Session
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
                
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify({ id: session.id }));
            } catch (error) {
                console.error('Error creating checkout session:', error);
                res.writeHead(500, corsHeaders);
                res.end(JSON.stringify({ error: error.message }));
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
                
                console.log(`Searching Missing Money for ${firstName} ${lastName}${searchCity ? `, ${searchCity}` : ''}${searchState ? `, ${searchState}` : ''}`);
                console.log(`2captcha enabled: ${use2Captcha}, API key provided: ${!!captchaApiKey}`);
                if (captchaApiKey) {
                    console.log(`API key (first 10 chars): ${captchaApiKey.substring(0, 10)}...`);
                }
                const result = await searchMissingMoney(firstName, lastName, searchCity, searchState, use2Captcha || false, captchaApiKey || null);
                
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify(result));
            } catch (error) {
                res.writeHead(500, corsHeaders);
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
        });
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
                    isPlaceholder: entry.isPlaceholder || false
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
                    await pool.query(
                        `UPDATE leaderboard 
                         SET name = $1, amount = $2, is_placeholder = $3, entities = $4, updated_at = CURRENT_TIMESTAMP
                         WHERE handle = $5`,
                        [entry.name, entry.amount, entry.isPlaceholder || false, entry.entities ? JSON.stringify(entry.entities) : null, entry.handle]
                    );
                    console.log(`[LEADERBOARD] Updated existing entry for handle: ${entry.handle} (duplicate prevented)`);
                } else {
                    // Insert new entry (only if it doesn't exist)
                    await pool.query(
                        `INSERT INTO leaderboard (name, handle, amount, is_placeholder, entities)
                         VALUES ($1, $2, $3, $4, $5)`,
                        [entry.name, entry.handle, entry.amount, entry.isPlaceholder || false, entry.entities ? JSON.stringify(entry.entities) : null]
                    );
                    console.log(`[LEADERBOARD] Added new entry for handle: ${entry.handle}`);
                }
                
                // Fetch updated leaderboard - deduplicate by handle (case-insensitive)
                // Use DISTINCT ON to ensure only one entry per handle
                const result = await pool.query(`
                    SELECT DISTINCT ON (LOWER(handle))
                        name,
                        handle,
                        amount,
                        is_placeholder as "isPlaceholder",
                        entities,
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
        const filePath = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;
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

