const http = require('http');
const https = require('https');
const url = require('url');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { searchMissingMoney } = require('./missingMoneySearch');

const PORT = process.env.PORT || 3000;

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
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
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
        
        https.get(options, (res) => {
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
            
            stream.on('end', () => {
                try {
                    // Debug: log HTML length
                    console.log(`Fetched HTML for ${username}, length: ${html.length}`);
                    
                    // Check if we got a login page or error page
                    // Only check for login if it's clearly a login redirect, not just the word "login" in the HTML
                    if ((html.includes('Log in to Instagram') || html.includes('login_required')) && html.length < 100000) {
                        console.log('Login page detected');
                        resolve({ success: false, error: 'Login required' });
                        return;
                    }
                    
                    if (html.length < 10000) {
                        console.log(`Insufficient HTML: ${html.length} bytes`);
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
        }).on('error', (error) => {
            reject(error);
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
                
                if (!firstName || !lastName || !city || !state) {
                    res.writeHead(400, corsHeaders);
                    res.end(JSON.stringify({ success: false, error: 'Missing required fields' }));
                    return;
                }
                
                console.log(`Searching Missing Money for ${firstName} ${lastName}, ${city}, ${state}`);
                console.log(`2captcha enabled: ${use2Captcha}, API key provided: ${!!captchaApiKey}`);
                if (captchaApiKey) {
                    console.log(`API key (first 10 chars): ${captchaApiKey.substring(0, 10)}...`);
                }
                const result = await searchMissingMoney(firstName, lastName, city, state, use2Captcha || false, captchaApiKey || null);
                
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify(result));
            } catch (error) {
                res.writeHead(500, corsHeaders);
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
        });
    } else if (parsedUrl.pathname === '/api/leaderboard' && req.method === 'GET') {
        // Get leaderboard entries
        try {
            const leaderboardPath = path.join(__dirname, 'leaderboard.json');
            let leaderboard = [];
            
            if (fs.existsSync(leaderboardPath)) {
                const data = fs.readFileSync(leaderboardPath, 'utf8');
                leaderboard = JSON.parse(data);
            }
            
            // Sort by amount (highest first)
            leaderboard.sort((a, b) => b.amount - a.amount);
            
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify({ success: true, leaderboard: leaderboard }));
        } catch (error) {
            res.writeHead(500, corsHeaders);
            res.end(JSON.stringify({ success: false, error: error.message }));
        }
    } else if (parsedUrl.pathname === '/api/leaderboard' && req.method === 'POST') {
        // Add entry to leaderboard
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', async () => {
            try {
                const entry = JSON.parse(body);
                
                // Validate entry
                if (!entry.name || !entry.handle || !entry.amount) {
                    res.writeHead(400, corsHeaders);
                    res.end(JSON.stringify({ success: false, error: 'Missing required fields' }));
                    return;
                }
                
                const leaderboardPath = path.join(__dirname, 'leaderboard.json');
                let leaderboard = [];
                
                // Load existing leaderboard
                if (fs.existsSync(leaderboardPath)) {
                    const data = fs.readFileSync(leaderboardPath, 'utf8');
                    leaderboard = JSON.parse(data);
                }
                
                // Check if entry already exists (by handle)
                const existingIndex = leaderboard.findIndex(e => e.handle === entry.handle);
                
                if (existingIndex >= 0) {
                    // Update existing entry if new amount is higher
                    if (entry.amount > leaderboard[existingIndex].amount) {
                        leaderboard[existingIndex] = {
                            ...leaderboard[existingIndex],
                            ...entry,
                            updatedAt: new Date().toISOString()
                        };
                    }
                } else {
                    // Add new entry
                    leaderboard.push({
                        ...entry,
                        createdAt: new Date().toISOString()
                    });
                }
                
                // Save leaderboard
                fs.writeFileSync(leaderboardPath, JSON.stringify(leaderboard, null, 2));
                
                // Sort by amount (highest first)
                leaderboard.sort((a, b) => b.amount - a.amount);
                
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify({ success: true, leaderboard: leaderboard }));
            } catch (error) {
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
});

