const http = require('http');
const https = require('https');
const url = require('url');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { searchMissingMoney } = require('./missingMoneySearch');

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
                'Referer': 'https://www.instagram.com/'
            }
        };
        
        const req = https.get(options, (res) => {
            console.log(`[PROFILE] Response status: ${res.statusCode} for ${username}`);
            console.log(`[PROFILE] Content-Type: ${res.headers['content-type']}`);
            console.log(`[PROFILE] Content-Length: ${res.headers['content-length']}`);
            console.log(`[PROFILE] Content-Encoding: ${res.headers['content-encoding']}`);
            
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
                'Referer': 'https://www.instagram.com/'
            }
        };
        
        const req = https.get(options, (res) => {
            console.log(`[INSTAGRAM] Response status: ${res.statusCode} for ${username}`);
            console.log(`[INSTAGRAM] Response headers:`, JSON.stringify(res.headers, null, 2));
            
            // Handle redirects
            if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
                const location = res.headers.location;
                console.log(`[INSTAGRAM] Redirect detected to: ${location}`);
                if (location) {
                    // Follow redirect
                    const redirectUrl = location.startsWith('http') ? location : `https://www.instagram.com${location}`;
                    const urlParts = new URL(redirectUrl);
                    const redirectOptions = {
                        hostname: urlParts.hostname,
                        path: urlParts.pathname + urlParts.search,
                        method: 'GET',
                        headers: options.headers
                    };
                    return https.get(redirectOptions, req.callback).on('error', reject);
                }
            }
            
            // Check for error status codes
            if (res.statusCode !== 200) {
                console.log(`[INSTAGRAM] Non-200 status code: ${res.statusCode} for ${username}`);
                resolve({ success: false, error: `HTTP ${res.statusCode}: ${res.statusMessage || 'Request failed'}` });
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
                    
                    // Check for login page
                    if ((html.includes('Log in to Instagram') || html.includes('login_required') || html.includes('Please wait')) && html.length < 100000) {
                        console.log(`[INSTAGRAM] Login page or challenge detected for ${username}`);
                        resolve({ success: false, error: 'Login required or challenge page' });
                        return;
                    }
                    
                    if (html.length < 10000) {
                        console.log(`[INSTAGRAM] Insufficient HTML for name extraction: ${html.length} bytes`);
                        if (html.length > 0) {
                            console.log(`[INSTAGRAM] Response preview:`, html.substring(0, 200));
                        }
                        resolve({ success: false, error: 'Insufficient HTML received' });
                        return;
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
                                    sharedData?.graphql?.user?.fullName
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
                    
                    // Try meta tags (og:title)
                    const metaTitleMatch = html.match(/property="og:title"\s+content="([^"]+)"/i);
                    if (metaTitleMatch && metaTitleMatch[1]) {
                        const title = metaTitleMatch[1].trim();
                        // Extract name from title (format is usually "Name (@username) • Instagram")
                        const nameMatch = title.match(/^([^(]+)/);
                        if (nameMatch && nameMatch[1]) {
                            const extractedName = nameMatch[1].trim();
                            // Only return if it doesn't look like just a username
                            // Basic check: reject if it's exactly "Login" or "Instagram" or contains "Login • Instagram"
                            if (extractedName && !extractedName.startsWith('@') && extractedName.length > 0 && 
                                extractedName !== 'Instagram' && 
                                extractedName !== 'Login' &&
                                !extractedName.includes('Login • Instagram')) {
                                console.log(`Found Instagram name from og:title: ${extractedName}`);
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
                    
                    // Try to find full_name in script tags (multiple patterns)
                    const fullNamePatterns = [
                        /"full_name"\s*:\s*"([^"]+)"/i,
                        /"fullName"\s*:\s*"([^"]+)"/i,
                        /full_name["\s]*:["\s]*"([^"]+)"/i,
                        /"profilePage_[\d]+":\s*\{[^}]*"full_name":\s*"([^"]+)"/i,
                        /"user":\s*\{[^}]*"full_name":\s*"([^"]+)"/i,
                        /"full_name":\s*"([^"]+)"[^}]*"username":\s*"([^"]+)"/i,
                        /"biography":\s*"[^"]*"[^}]*"full_name":\s*"([^"]+)"/i,
                        /"edge_owner_to_timeline_media":\s*\{[^}]*"full_name":\s*"([^"]+)"/i
                    ];
                    
                    for (const pattern of fullNamePatterns) {
                        const match = html.match(pattern);
                        if (match && match[1]) {
                            const name = match[1].trim();
                            // Skip if it looks like a username or is too short
                            if (name && name.length > 2 && !name.startsWith('@') && !name.includes('instagram') && name !== username) {
                                console.log(`Found Instagram name from script pattern: ${name}`);
                                resolve({ success: true, fullName: name });
                                return;
                            }
                        }
                    }
                    
                    // Try searching in all script tags for JSON data
                    const scriptMatches = html.match(/<script[^>]*>(.*?)<\/script>/gis);
                    if (scriptMatches) {
                        for (const scriptContent of scriptMatches) {
                            // Look for full_name in script content
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
                    
                    // Try to find in profile name elements
                    const profileNamePatterns = [
                        /<span[^>]*class="[^"]*profile[^"]*name[^"]*"[^>]*>([^<]+)<\/span>/i,
                        /<div[^>]*class="[^"]*profile[^"]*name[^"]*"[^>]*>([^<]+)<\/div>/i,
                        /<span[^>]*data-testid="[^"]*name[^"]*"[^>]*>([^<]+)<\/span>/i
                    ];
                    
                    for (const pattern of profileNamePatterns) {
                        const match = html.match(pattern);
                        if (match && match[1]) {
                            const name = match[1].trim();
                            if (name && name.length > 2 && !name.startsWith('@') && name !== username && 
                                !name.toLowerCase().includes('instagram')) {
                                console.log(`Found Instagram name from profile element: ${name}`);
                                resolve({ success: true, fullName: name });
                                return;
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
        
        req.setTimeout(10000, () => {
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
                
                // Check if entry already exists
                const existingResult = await pool.query(
                    'SELECT id, amount, is_placeholder FROM leaderboard WHERE handle = $1',
                    [entry.handle]
                );
                
                if (existingResult.rows.length > 0) {
                    // Update existing entry
                    const existing = existingResult.rows[0];
                    console.log(`[LEADERBOARD] Existing entry found:`, {
                        id: existing.id,
                        existingAmount: existing.amount,
                        newAmount: entry.amount,
                        existingIsPlaceholder: existing.is_placeholder,
                        newIsPlaceholder: entry.isPlaceholder || false
                    });
                    
                    // ALWAYS UPDATE - no conditions, just update the entry
                    await pool.query(
                        `UPDATE leaderboard 
                         SET name = $1, amount = $2, is_placeholder = $3, entities = $4, updated_at = CURRENT_TIMESTAMP
                         WHERE handle = $5`,
                        [entry.name, entry.amount, entry.isPlaceholder || false, entry.entities ? JSON.stringify(entry.entities) : null, entry.handle]
                    );
                    console.log(`[LEADERBOARD] Updated existing entry for handle: ${entry.handle}`);
                } else {
                    // Insert new entry
                    await pool.query(
                        `INSERT INTO leaderboard (name, handle, amount, is_placeholder, entities)
                         VALUES ($1, $2, $3, $4, $5)`,
                        [entry.name, entry.handle, entry.amount, entry.isPlaceholder || false, entry.entities ? JSON.stringify(entry.entities) : null]
                    );
                    console.log(`[LEADERBOARD] Added new entry for handle: ${entry.handle}`);
                }
                
                // Fetch updated leaderboard
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

