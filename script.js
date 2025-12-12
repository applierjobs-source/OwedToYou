// Leaderboard data - loaded from backend
let leaderboardData = [];

// Immediate test to verify script is loading
console.log('✅ script.js loaded successfully');
console.log('✅ Current time:', new Date().toISOString());

// Get initials from name
function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
}

// Clean Instagram handle
function cleanHandle(handle) {
    return handle.replace('@', '').trim().toLowerCase();
}

// Get Instagram full name from profile
async function getInstagramFullName(username) {
    const cleanUsername = cleanHandle(username);
    console.log(`🔍 Attempting to extract Instagram name for: ${cleanUsername}`);
    
    // Try backend server first (if available)
    try {
        const apiBase = window.location.origin;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch(`${apiBase}/api/instagram-name?username=${encodeURIComponent(cleanUsername)}`, {
            method: 'GET',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.fullName) {
                console.log(`✅ Found Instagram name via backend: ${data.fullName}`);
                return data.fullName.trim();
            }
        }
    } catch (e) {
        console.log('Backend server not available for name extraction, using browser methods');
    }
    
    // Fallback to browser methods
    try {
        const apiUrl = `https://www.instagram.com/${cleanUsername}/`;
        const proxyUrl = 'https://api.allorigins.win/raw?url=';
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // Increased timeout
        
        console.log(`📡 Fetching Instagram profile: ${apiUrl}`);
        const response = await fetch(`${proxyUrl}${encodeURIComponent(apiUrl)}`, {
            method: 'GET',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
            const html = await response.text();
            console.log(`✅ Received HTML response, length: ${html.length} characters`);
            
            // Try to extract from window._sharedData
            const sharedDataPatterns = [
                /window\._sharedData\s*=\s*({[\s\S]+?});\s*<\/script>/,
                /window\._sharedData\s*=\s*({.+?});/s,
                /window\._sharedData\s*=\s*({[\s\S]+?});/,
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
                                console.log(`Found Instagram full name: ${fullName}`);
                                return fullName.trim();
                            }
                        }
                    } catch (e) {
                        console.log(`Failed to parse _sharedData for name:`, e.message);
                        continue;
                    }
                }
            }
            
            // Try alternative method: look for meta tags or title
            const metaNameMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
                                        html.match(/<title>([^<]+)<\/title>/i);
            if (metaNameMatch && metaNameMatch[1]) {
                const title = metaNameMatch[1].trim();
                // Extract name from title (format is usually "Name (@username) • Instagram")
                const nameMatch = title.match(/^([^(]+)/);
                if (nameMatch && nameMatch[1]) {
                    const extractedName = nameMatch[1].trim();
                    // Only return if it doesn't look like just a username
                    if (extractedName && !extractedName.startsWith('@') && extractedName.length > 0 && extractedName !== 'Instagram') {
                        console.log(`Found Instagram name from title: ${extractedName}`);
                        return extractedName;
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
                        return jsonLd.name.trim();
                    }
                } catch (e) {
                    // Not valid JSON, continue
                }
            }
            
            // Try to find name in various script tags with JSON data
            const scriptMatches = html.match(/<script[^>]*>(.*?)<\/script>/gis);
            if (scriptMatches) {
                for (const scriptContent of scriptMatches) {
                    // Look for full_name in script content
                    const fullNamePatterns = [
                        /"full_name"\s*:\s*"([^"]+)"/i,
                        /"fullName"\s*:\s*"([^"]+)"/i,
                        /full_name["\s]*:["\s]*([^",\s}]+)/i,
                        /"name"\s*:\s*"([^"]+)"[^}]*"username"\s*:\s*"[^"]*"/i
                    ];
                    
                    for (const pattern of fullNamePatterns) {
                        const match = scriptContent.match(pattern);
                        if (match && match[1]) {
                            const name = match[1].trim();
                            // Skip if it looks like a username or is too short
                            if (name && name.length > 2 && !name.startsWith('@') && !name.includes('instagram') && name !== cleanUsername) {
                                console.log(`Found Instagram name from script: ${name}`);
                                return name;
                            }
                        }
                    }
                }
            }
            
            // Try to find name in profile header or h1/h2 tags
            const headerMatches = html.match(/<h[12][^>]*>([^<]+)<\/h[12]>/gi);
            if (headerMatches) {
                for (const header of headerMatches) {
                    const textMatch = header.match(/>([^<]+)</);
                    if (textMatch && textMatch[1]) {
                        const text = textMatch[1].trim();
                        // If it's not the username and looks like a name (has space or is capitalized)
                        if (text && text !== cleanUsername && !text.startsWith('@') && 
                            (text.includes(' ') || (text.length > 3 && text[0] === text[0].toUpperCase()))) {
                            console.log(`Found Instagram name from header: ${text}`);
                            return text;
                        }
                    }
                }
            }
            
            // Try to find in span or div with profile name classes
            const profileNamePatterns = [
                /<span[^>]*class="[^"]*profile[^"]*name[^"]*"[^>]*>([^<]+)<\/span>/i,
                /<div[^>]*class="[^"]*profile[^"]*name[^"]*"[^>]*>([^<]+)<\/div>/i,
                /<span[^>]*data-testid="[^"]*name[^"]*"[^>]*>([^<]+)<\/span>/i
            ];
            
            for (const pattern of profileNamePatterns) {
                const match = html.match(pattern);
                if (match && match[1]) {
                    const name = match[1].trim();
                    if (name && name.length > 2 && !name.startsWith('@') && name !== cleanUsername) {
                        console.log(`Found Instagram name from profile element: ${name}`);
                        return name;
                    }
                }
            }
        } else {
            console.log(`❌ Instagram fetch failed with status: ${response.status}`);
        }
    } catch (e) {
        console.log(`❌ Error fetching Instagram name for ${cleanUsername}:`, e.message);
    }
    
    // Fallback: return null if not found
    console.log(`⚠️ Could not extract name from Instagram for ${cleanUsername}`);
    return null;
}

// Get Instagram profile picture URL with timeout
// First try local backend server, then fallback to browser methods
async function getInstagramProfilePicture(username) {
    const cleanUsername = cleanHandle(username);
    
    // Try local backend server first (if available)
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        
        const apiBase = window.location.origin;
        const response = await fetch(`${apiBase}/api/profile-pic?username=${encodeURIComponent(cleanUsername)}`, {
            method: 'GET',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.url) {
                console.log(`Found profile picture via backend: ${data.url}`);
                return data.url;
            }
        }
    } catch (e) {
        // Backend not available, continue with browser methods
        console.log('Backend server not available, using browser methods');
    }
    
    // Create a promise with timeout
    const timeoutPromise = new Promise((resolve) => {
        setTimeout(() => resolve(null), 4000); // 4 second timeout
    });
    
    const fetchPromise = (async () => {
        // Try multiple methods to get the profile picture
        const methods = [
            // Method 0: Try using a simple public API service first (fastest)
            async () => {
                try {
                    // Use imginn.com or similar service
                    const url = `https://imginn.com/${cleanUsername}/`;
                    const proxyUrl = 'https://api.allorigins.win/raw?url=';
                    
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 2000);
                    
                    const response = await fetch(`${proxyUrl}${encodeURIComponent(url)}`, {
                        method: 'GET',
                        signal: controller.signal
                    });
                    
                    clearTimeout(timeoutId);
                    
                    if (response.ok) {
                        const html = await response.text();
                        // Look for profile picture in imginn
                        const imgMatch = html.match(/<img[^>]*class="[^"]*avatar[^"]*"[^>]*src="([^"]+)"/i) ||
                                        html.match(/<img[^>]*src="([^"]*profile[^"]*\.(jpg|jpeg|png|webp))[^"]*"/i);
                        if (imgMatch && imgMatch[1]) {
                            let imgUrl = imgMatch[1];
                            if (!imgUrl.startsWith('http')) {
                                imgUrl = 'https://imginn.com' + imgUrl;
                            }
                            console.log(`Method 0 found URL: ${imgUrl}`);
                            return imgUrl;
                        }
                    }
                } catch (e) {
                    return null;
                }
                return null;
            },
            // Method 1: Try with allorigins proxy - extract from HTML
            async () => {
                try {
                    const apiUrl = `https://www.instagram.com/${cleanUsername}/`;
                    const proxyUrl = 'https://api.allorigins.win/raw?url=';
                    
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 2500);
                    
                    const response = await fetch(`${proxyUrl}${encodeURIComponent(apiUrl)}`, {
                        method: 'GET',
                        signal: controller.signal
                    });
                    
                    clearTimeout(timeoutId);
                    
                    if (response.ok) {
                        const html = await response.text();
                        console.log(`Fetched HTML for ${cleanUsername}, length:`, html.length);
                        
                        // DEBUG: Save a sample of HTML to see what we're working with
                        if (cleanUsername === 'zach.arrow') {
                            console.log('Sample HTML (first 5000 chars):', html.substring(0, 5000));
                        }
                        
                        // Try to extract from window._sharedData first (most reliable)
                        // Try multiple patterns for _sharedData - Instagram uses different formats
                        const sharedDataPatterns = [
                            /window\._sharedData\s*=\s*({[\s\S]+?});\s*<\/script>/,
                            /window\._sharedData\s*=\s*({.+?});/s,
                            /window\._sharedData\s*=\s*({[\s\S]+?});/,
                            /"_sharedData":\s*({.+?})/s
                        ];
                        
                        for (const pattern of sharedDataPatterns) {
                            const sharedDataMatch = html.match(pattern);
                            if (sharedDataMatch && sharedDataMatch[1]) {
                                try {
                                    // Clean the JSON string - remove any trailing issues
                                    let jsonStr = sharedDataMatch[1].trim();
                                    // Remove trailing semicolons or other characters
                                    jsonStr = jsonStr.replace(/;[\s]*$/, '');
                                    
                                    const sharedData = JSON.parse(jsonStr);
                                    
                                    // Try multiple paths to find the profile picture
                                    const possiblePaths = [
                                        sharedData?.entry_data?.ProfilePage?.[0]?.graphql?.user?.profile_pic_url_hd,
                                        sharedData?.entry_data?.ProfilePage?.[0]?.graphql?.user?.profile_pic_url,
                                        sharedData?.entry_data?.ProfilePage?.[0]?.user?.profile_pic_url_hd,
                                        sharedData?.entry_data?.ProfilePage?.[0]?.user?.profile_pic_url,
                                        sharedData?.graphql?.user?.profile_pic_url_hd,
                                        sharedData?.graphql?.user?.profile_pic_url
                                    ];
                                    
                                    for (const profilePic of possiblePaths) {
                                        if (profilePic && typeof profilePic === 'string' && profilePic.startsWith('http')) {
                                            console.log(`Found profile picture in _sharedData: ${profilePic}`);
                                            return profilePic;
                                        }
                                    }
                                } catch (e) {
                                    console.log(`Failed to parse _sharedData:`, e.message);
                                    // Try next pattern
                                    continue;
                                }
                            }
                        }
                        
                        // Also try to find profile picture URL directly in the HTML
                        // Look for Instagram CDN URLs
                        const cdnPatterns = [
                            /https:\/\/[^"'\s]*\.cdninstagram\.com[^"'\s]*profile[^"'\s]*\.(jpg|jpeg|png|webp)/gi,
                            /https:\/\/[^"'\s]*instagram[^"'\s]*\.(jpg|jpeg|png|webp)[^"'\s]*/gi
                        ];
                        
                        for (const pattern of cdnPatterns) {
                            const matches = html.match(pattern);
                            if (matches && matches.length > 0) {
                                // Get the first match that looks like a profile picture
                                for (const match of matches) {
                                    if (match.includes('profile') || match.includes('s150x150') || match.includes('s320x320')) {
                                        console.log(`Found profile picture URL via CDN pattern: ${match}`);
                                        return match;
                                    }
                                }
                            }
                        }
                        
                        // Try multiple regex patterns to find the profile picture
                        const patterns = [
                            /property="og:image"\s+content="([^"]+)"/i,
                            /<meta\s+name="og:image"\s+content="([^"]+)"/i,
                            /content="([^"]*cdninstagram[^"]*\.(jpg|jpeg|png|webp)[^"]*)"/i,
                            /"profile_pic_url_hd"\s*:\s*"([^"]+)"/,
                            /"profile_pic_url"\s*:\s*"([^"]+)"/,
                            /profile_pic_url_hd["\s]*:["\s]*"([^"]+)"/,
                            /"profile_pic_url":\s*"([^"]+)"/,
                            /https:\/\/[^"]*\.cdninstagram\.com[^"]*\.(jpg|jpeg|png|webp)[^"]*/i
                        ];
                        
                        for (const pattern of patterns) {
                            const match = html.match(pattern);
                            if (match && match[1]) {
                                let url = match[1];
                                // Clean up the URL - handle escaped characters
                                url = url.replace(/\\u0026/g, '&')
                                         .replace(/\\\//g, '/')
                                         .replace(/\\"/g, '"')
                                         .replace(/&amp;/g, '&')
                                         .replace(/\\u003C/g, '<')
                                         .replace(/\\u003E/g, '>');
                                
                                // Check if it's a valid Instagram CDN URL
                                if (url.startsWith('http') && (url.includes('instagram') || url.includes('cdninstagram') || url.includes('fbcdn'))) {
                                    console.log(`Found profile picture URL: ${url}`);
                                    return url;
                                }
                            }
                        }
                        
                        // Try to find in script tags with JSON data
                        const scriptMatches = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/is);
                        if (scriptMatches) {
                            try {
                                const jsonData = JSON.parse(scriptMatches[1]);
                                if (jsonData.image || (jsonData['@graph'] && jsonData['@graph'][0] && jsonData['@graph'][0].image)) {
                                    const imageUrl = jsonData.image || jsonData['@graph'][0].image;
                                    if (imageUrl && typeof imageUrl === 'string' && (imageUrl.includes('instagram') || imageUrl.includes('cdninstagram'))) {
                                        console.log(`Found profile picture in JSON-LD: ${imageUrl}`);
                                        return imageUrl;
                                    }
                                }
                            } catch (e) {
                                // JSON parse failed, continue
                            }
                        }
                    }
                } catch (e) {
                    console.log(`Method 1 failed for ${cleanUsername}:`, e.message);
                    return null;
                }
                return null;
            },
            
            // Method 2: Try with corsproxy.io
            async () => {
                try {
                    const apiUrl = `https://www.instagram.com/${cleanUsername}/`;
                    const proxyUrl = 'https://corsproxy.io/?';
                    
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 2500);
                    
                    const response = await fetch(`${proxyUrl}${encodeURIComponent(apiUrl)}`, {
                        method: 'GET',
                        signal: controller.signal
                    });
                    
                    clearTimeout(timeoutId);
                    
                    if (response.ok) {
                        const html = await response.text();
                        const metaMatch = html.match(/property="og:image"\s+content="([^"]+)"/i);
                        if (metaMatch && metaMatch[1]) {
                            let url = metaMatch[1].replace(/&amp;/g, '&');
                            console.log(`Method 2 found URL: ${url}`);
                            return url;
                        }
                    }
                } catch (e) {
                    console.log(`Method 2 failed:`, e.message);
                    return null;
                }
                return null;
            },
            
            // Method 2.5: Try using instafetch API (if available)
            async () => {
                try {
                    // Some third-party services provide this
                    const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${cleanUsername}`;
                    const proxyUrl = 'https://api.allorigins.win/raw?url=';
                    
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 2000);
                    
                    const response = await fetch(`${proxyUrl}${encodeURIComponent(url)}`, {
                        method: 'GET',
                        headers: {
                            'X-Requested-With': 'XMLHttpRequest'
                        },
                        signal: controller.signal
                    });
                    
                    clearTimeout(timeoutId);
                    
                    if (response.ok) {
                        try {
                            const data = await response.json();
                            if (data.data?.user?.profile_pic_url_hd) {
                                console.log(`Method 2.5 found URL: ${data.data.user.profile_pic_url_hd}`);
                                return data.data.user.profile_pic_url_hd;
                            }
                            if (data.data?.user?.profile_pic_url) {
                                console.log(`Method 2.5 found URL: ${data.data.user.profile_pic_url}`);
                                return data.data.user.profile_pic_url;
                            }
                        } catch (e) {
                            // Not JSON, continue
                        }
                    }
                } catch (e) {
                    console.log(`Method 2.5 failed:`, e.message);
                    return null;
                }
                return null;
            },
            
            // Method 3: Try using a public Instagram API alternative
            async () => {
                try {
                    // Try using picuki or similar service pattern
                    const url = `https://www.picuki.com/profile/${cleanUsername}`;
                    const proxyUrl = 'https://api.allorigins.win/raw?url=';
                    
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 2000);
                    
                    const response = await fetch(`${proxyUrl}${encodeURIComponent(url)}`, {
                        method: 'GET',
                        signal: controller.signal
                    });
                    
                    clearTimeout(timeoutId);
                    
                    if (response.ok) {
                        const html = await response.text();
                        const imgMatch = html.match(/<img[^>]*class="[^"]*profile[^"]*"[^>]*src="([^"]+)"/i);
                        if (imgMatch && imgMatch[1]) {
                            return imgMatch[1];
                        }
                    }
                } catch (e) {
                    return null;
                }
                return null;
            }
        ];
        
        // Try each method sequentially until one works
        for (const method of methods) {
            try {
                const result = await method();
                if (result) {
                    return result;
                }
            } catch (e) {
                continue;
            }
        }
        
        return null;
    })();
    
    // Race between fetch and timeout
    return Promise.race([fetchPromise, timeoutPromise]);
}

// Load leaderboard from backend
async function loadLeaderboard() {
    try {
        const apiBase = window.location.origin;
        console.log('Loading leaderboard from:', `${apiBase}/api/leaderboard`);
        const response = await fetch(`${apiBase}/api/leaderboard`);
        const data = await response.json();
        
        console.log('Leaderboard response:', data);
        
        if (data.success && data.leaderboard && Array.isArray(data.leaderboard)) {
            // Filter out placeholders - only show real claims
            leaderboardData = data.leaderboard
                .filter(entry => !entry.isPlaceholder) // Remove placeholders
                .map(entry => ({
                    ...entry,
                    profilePic: null, // Will be loaded in background
                    isPlaceholder: false
                }));
            console.log(`Loaded ${leaderboardData.length} real leaderboard entries from backend (placeholders filtered out)`);
            return leaderboardData;
        }
        console.log('No leaderboard data in response');
        leaderboardData = [];
        return [];
    } catch (error) {
        console.error('Error loading leaderboard:', error);
        leaderboardData = [];
        return [];
    }
}

// Delete entry from leaderboard
async function deleteFromLeaderboard(handle) {
    try {
        const apiBase = window.location.origin;
        const response = await fetch(`${apiBase}/api/leaderboard?handle=${encodeURIComponent(handle)}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        if (data.success && data.leaderboard) {
            // Filter out placeholders
            leaderboardData = data.leaderboard
                .filter(entry => !entry.isPlaceholder)
                .map(entry => ({
                    ...entry,
                    profilePic: null,
                    isPlaceholder: false
                }));
            // Refresh display if leaderboard is visible
            if (!document.getElementById('leaderboard').classList.contains('hidden')) {
                displayLeaderboard(leaderboardData);
            }
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error deleting from leaderboard:', error);
        return false;
    }
}

// Clear all entries from leaderboard
async function clearLeaderboardHandles() {
    if (!confirm('Are you sure you want to clear all entries from the leaderboard? This cannot be undone.')) {
        return false;
    }
    
    try {
        const apiBase = window.location.origin;
        const response = await fetch(`${apiBase}/api/leaderboard/clear-handles`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        if (data.success) {
            console.log(`✅ Cleared ${data.deleted} entries from leaderboard`);
            // Clear the local leaderboard data
            leaderboardData = [];
            // Refresh display if leaderboard is visible
            if (!document.getElementById('leaderboard').classList.contains('hidden')) {
                displayLeaderboard(leaderboardData);
            }
            alert(`Successfully cleared ${data.deleted} entries from the leaderboard.`);
            return true;
        } else {
            console.error('Error clearing leaderboard:', data.error);
            alert(`Error: ${data.error}`);
            return false;
        }
    } catch (error) {
        console.error('Error clearing leaderboard:', error);
        alert(`Error clearing leaderboard: ${error.message}`);
        return false;
    }
}

// Add entry to leaderboard (or update if exists)
async function addToLeaderboard(name, handle, amount, isPlaceholder = false, refreshDisplay = false, entities = null) {
    try {
        const apiBase = window.location.origin;
        const response = await fetch(`${apiBase}/api/leaderboard`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: name,
                handle: cleanHandle(handle),
                amount: Math.round(amount),
                isPlaceholder: isPlaceholder,
                entities: entities
            })
        });
        
        const data = await response.json();
        if (data.success && data.leaderboard) {
            // Filter out placeholders - only show real claims
            leaderboardData = data.leaderboard
                .filter(entry => !entry.isPlaceholder) // Remove placeholders
                .map(entry => ({
                    ...entry,
                    profilePic: null,
                    isPlaceholder: false
                }));
            // Only refresh display if explicitly requested (e.g., after a claim submission)
            if (refreshDisplay && !document.getElementById('leaderboard').classList.contains('hidden')) {
                displayLeaderboard(leaderboardData);
            }
        }
    } catch (error) {
        console.error('Error adding to leaderboard:', error);
    }
}

// Generate leaderboard from loaded data
function generateLeaderboard(searchHandle) {
    // Just return the loaded leaderboard data
    // If searchHandle is provided, highlight that user if they exist
    const users = leaderboardData.map(entry => ({
        ...entry,
        isPlaceholder: false, // Real entries are not placeholders
        isSearched: searchHandle && cleanHandle(searchHandle) === cleanHandle(entry.handle)
    }));
    
    return users;
}

// Load profile pictures in background and update UI
async function loadProfilePicturesInBackground(users) {
    console.log(`Loading profile pictures for ${users.length} users...`);
    
    // Load profile pictures for all users in parallel
    const profilePicPromises = users.map(async (user, index) => {
        console.log(`[${index}] Fetching profile picture for ${user.handle}...`);
        const profilePic = await getInstagramProfilePicture(user.handle);
        console.log(`[${index}] Profile picture result for ${user.handle}:`, profilePic ? `Found: ${profilePic}` : 'Not found');
        
        if (profilePic) {
            // Wait a bit for DOM to be ready
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Find the entry by data-handle attribute (most reliable)
            const cleanUserHandle = cleanHandle(user.handle);
            let entry = document.querySelector(`.leaderboard-entry[data-handle="${cleanUserHandle}"]`);
            
            if (!entry) {
                // Fallback: try to find by handle in the entry text
                const entries = document.querySelectorAll('.leaderboard-entry');
                console.log(`[${index}] Found ${entries.length} leaderboard entries in DOM, looking for handle: ${user.handle}`);
                
                for (let i = 0; i < entries.length; i++) {
                    const entryHandle = entries[i].getAttribute('data-handle') || '';
                    const entryText = entries[i].innerText || '';
                    const handleInText = entryText.includes(`@${user.handle}`) || 
                                        entryText.includes(`@${cleanUserHandle}`) ||
                                        cleanHandle(entryHandle) === cleanUserHandle;
                    if (handleInText) {
                        entry = entries[i];
                        console.log(`[${index}] Found entry at index ${i} for handle ${user.handle} via text match`);
                        break;
                    }
                }
            } else {
                console.log(`[${index}] Found entry for handle ${user.handle} via data-handle attribute`);
            }
            
            // Last fallback: use index if still not found
            if (!entry) {
                const entries = document.querySelectorAll('.leaderboard-entry');
                if (entries[index]) {
                    entry = entries[index];
                    console.log(`[${index}] Using index fallback for ${user.handle}`);
                }
            }
            
            if (entry) {
                const profilePictureDiv = entry.querySelector('.profile-picture');
                if (profilePictureDiv) {
                    console.log(`[${index}] Updating profile picture for ${user.handle} in DOM`);
                    const initials = getInitials(user.name);
                    const img = document.createElement('img');
                    img.src = profilePic;
                    img.alt = user.name;
                    img.style.width = '100%';
                    img.style.height = '100%';
                    img.style.borderRadius = '50%';
                    img.style.objectFit = 'cover';
                    img.onerror = function() {
                        console.log(`[${index}] Image failed to load for ${user.handle}, showing initials`);
                        this.remove();
                        profilePictureDiv.innerHTML = initials;
                        profilePictureDiv.style.display = 'flex';
                        profilePictureDiv.style.alignItems = 'center';
                        profilePictureDiv.style.justifyContent = 'center';
                    };
                    img.onload = function() {
                        console.log(`[${index}] Image loaded successfully for ${user.handle}: ${profilePic}`);
                    };
                    profilePictureDiv.innerHTML = '';
                    profilePictureDiv.appendChild(img);
                } else {
                    console.log(`[${index}] Profile picture div not found for ${user.handle}`);
                }
            } else {
                console.log(`[${index}] Entry not found for ${user.handle} (tried index ${index} and handle matching)`);
            }
        } else {
            console.log(`[${index}] No profile picture URL returned for ${user.handle}`);
        }
    });
    
    // Don't wait for all to complete, just fire and forget
    Promise.all(profilePicPromises).then(() => {
        console.log('All profile picture requests completed');
    }).catch(err => {
        console.error('Some profile pictures failed to load:', err);
    });
}

// Create leaderboard entry HTML
function createEntryHTML(user, rank) {
    const initials = getInitials(user.name);
    // Show $500+ for placeholder entries, otherwise show actual amount
    const formattedAmount = user.isPlaceholder ? '$500+' : `$${user.amount}`;
    const escapedName = user.name.replace(/'/g, "\\'");
    
    // Create profile picture HTML with fallback
    let profilePicHtml = '';
    if (user.profilePic) {
        profilePicHtml = `<img src="${user.profilePic}" alt="${escapedName}" onerror="this.onerror=null; this.style.display='none'; this.parentElement.innerHTML='${initials}'; this.parentElement.style.display='flex'; this.parentElement.style.alignItems='center'; this.parentElement.style.justifyContent='center';">`;
    } else {
        profilePicHtml = initials;
    }
    
    return `
        <div class="leaderboard-entry ${user.isSearched ? 'searched-user' : ''}" data-handle="${user.handle}">
            <div class="rank-number">${rank}</div>
            <div class="profile-picture">
                ${profilePicHtml}
            </div>
            <div class="entry-info">
                <div class="entry-name">${escapedName}</div>
                <div class="entry-handle">@${user.handle}</div>
            </div>
            <div class="entry-amount">${formattedAmount}</div>
            <div class="entry-actions">
                <button class="btn btn-claim" onclick="handleView('${escapedName}', '${user.handle}', ${user.amount})">
                    View
                </button>
                <button class="btn btn-notify" onclick="handleNotify('${escapedName}', ${user.amount})">
                    Notify
                </button>
            </div>
        </div>
    `;
}

// Display leaderboard
function displayLeaderboard(users) {
    const leaderboard = document.getElementById('leaderboard');
    const listContainer = document.getElementById('leaderboardList');
    
    // Generate HTML for all entries immediately
    listContainer.innerHTML = users.map((user, index) => 
        createEntryHTML(user, index + 1)
    ).join('');
    
    leaderboard.classList.remove('hidden');
    
    // Smooth scroll to leaderboard
    leaderboard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    
    // Load profile pictures in background (non-blocking)
    loadProfilePicturesInBackground(users);
}

// Handle search
async function handleSearch() {
    console.log('🔍 handleSearch called');
    
    const input = document.getElementById('instagramHandle');
    const handle = input.value.trim();
    const searchBtn = document.getElementById('searchBtn');
    
    if (!input) {
        console.error('❌ Instagram handle input not found!');
        return;
    }
    
    if (!searchBtn) {
        console.error('❌ Search button not found!');
        return;
    }
    
    console.log(`🔍 Search initiated for handle: "${handle}"`);
    
    if (!handle) {
        alert('Please enter an Instagram username');
        return;
    }
    
    // Disable button and show loading
    searchBtn.disabled = true;
    searchBtn.textContent = 'Searching...';
    
    try {
        const cleanHandleValue = cleanHandle(handle);
        
        // Check if this handle exists in the leaderboard (real entries only)
        const foundEntry = leaderboardData.find(entry => cleanHandle(entry.handle) === cleanHandleValue);
        
        if (foundEntry) {
            // User exists in leaderboard - show all entries with this one highlighted
            const usersToShow = generateLeaderboard(handle);
            displayLeaderboard(usersToShow);
            // Re-enable button immediately
            searchBtn.disabled = false;
            searchBtn.textContent = 'Search';
        } else {
            // User doesn't exist - get Instagram full name and start search automatically
            let fullName = null;
            try {
                fullName = await getInstagramFullName(cleanHandleValue);
            } catch (nameError) {
                console.error('Error extracting Instagram name:', nameError);
                // Continue with fallback
            }
            
            // Split full name into first and last name
            let firstName = '';
            let lastName = '';
            if (fullName) {
                const nameParts = fullName.trim().split(/\s+/);
                firstName = nameParts[0] || '';
                lastName = nameParts.slice(1).join(' ') || '';
            }
            
            // Log what we found
            console.log('📋 Instagram name extraction result:', { 
                fullName, 
                firstName, 
                lastName,
                extracted: !!fullName,
                hasBothNames: !!(firstName && lastName)
            });
            
            // If we got a valid name, start the search automatically
            if (firstName && lastName) {
                console.log(`✅ Starting search with extracted Instagram name: "${firstName} ${lastName}"`);
                // Re-enable button immediately
                searchBtn.disabled = false;
                searchBtn.textContent = 'Search';
                
                // Start the search automatically
                await startMissingMoneySearch(firstName, lastName, cleanHandleValue);
            } else {
                console.log('⚠️ Could not extract name from Instagram');
                console.log('⚠️ Attempted extraction but got:', { fullName, firstName, lastName });
                
                // If extraction completely failed, show error instead of using handle
                if (!fullName) {
                    console.error('❌ Instagram name extraction failed completely');
                    searchBtn.disabled = false;
                    searchBtn.textContent = 'Search';
                    alert(`Unable to extract name from Instagram profile @${cleanHandleValue}. Please try searching by name instead using the link below.`);
                    return;
                }
                
                console.log('Could not extract name from Instagram, trying fallback methods...');
                // Fallback: if we can't get the name, try to extract from handle
                // Remove common prefixes like "coach", "the", etc.
                let handleName = cleanHandleValue
                    .replace(/^coach/gi, '')
                    .replace(/^the/gi, '')
                    .replace(/^mr/gi, '')
                    .replace(/^mrs/gi, '')
                    .replace(/^ms/gi, '')
                    .replace(/_/g, ' ')
                    .trim();
                
                // Try to split on common patterns (camelCase, numbers, etc.)
                handleName = handleName.replace(/([a-z])([A-Z])/g, '$1 $2'); // camelCase
                handleName = handleName.replace(/([a-z])(\d)/g, '$1 $2'); // letter then number
                
                let nameParts = handleName.split(/\s+/).filter(part => part.length > 0);
                
                // If we only have one part (like "chriscerda"), try to intelligently split it
                if (nameParts.length === 1 && nameParts[0].length > 6) {
                    const combined = nameParts[0].toLowerCase();
                    // Try to find a split point - look for common name patterns
                    // For "chriscerda", try splitting after "chris" (5 chars)
                    // Common first names: chris, john, mike, dave, etc.
                    const commonFirstNames = ['chris', 'john', 'mike', 'dave', 'joe', 'bob', 'tom', 'dan', 'sam', 'max', 'alex', 'nick', 'josh', 'matt', 'ryan', 'jake', 'luke', 'mark', 'paul', 'steve'];
                    
                    for (const commonName of commonFirstNames) {
                        if (combined.startsWith(commonName) && combined.length > commonName.length) {
                            const firstName = commonName.charAt(0).toUpperCase() + commonName.slice(1);
                            const lastName = combined.slice(commonName.length);
                            // Capitalize first letter of last name
                            const capitalizedLastName = lastName.charAt(0).toUpperCase() + lastName.slice(1);
                            nameParts = [firstName, capitalizedLastName];
                            console.log(`Split combined name "${combined}" into "${firstName} ${capitalizedLastName}"`);
                            break;
                        }
                    }
                }
                
                const capitalizedName = nameParts.map(word => 
                    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
                ).join(' ');
                const finalNameParts = capitalizedName.split(/\s+/).filter(part => part.length > 0);
                
                // If we have at least 2 parts, use them
                if (finalNameParts.length >= 2) {
                    const fallbackFirstName = finalNameParts[0] || '';
                    const fallbackLastName = finalNameParts.slice(1).join(' ') || '';
                    
                    if (fallbackFirstName && fallbackLastName) {
                        console.log(`Starting search with fallback name: ${fallbackFirstName} ${fallbackLastName}`);
                        // Re-enable button immediately
                        searchBtn.disabled = false;
                        searchBtn.textContent = 'Search';
                        
                        // Start search with fallback name
                        await startMissingMoneySearch(fallbackFirstName, fallbackLastName, cleanHandleValue);
                    } else {
                        // Use handle as last name if we can't split it
                        const handleAsName = cleanHandleValue.charAt(0).toUpperCase() + cleanHandleValue.slice(1).toLowerCase();
                        console.log(`Starting search with handle as name: ${handleAsName}`);
                        searchBtn.disabled = false;
                        searchBtn.textContent = 'Search';
                        // Split handle into first and last (use first word as first name, rest as last)
                        const handleParts = handleAsName.split(/\s+|_/).filter(p => p.length > 0);
                        if (handleParts.length >= 2) {
                            await startMissingMoneySearch(handleParts[0], handleParts.slice(1).join(' '), cleanHandleValue);
                        } else {
                            // Use handle as last name, "User" as first name
                            await startMissingMoneySearch('User', handleAsName, cleanHandleValue);
                        }
                    }
                } else {
                    // Use handle as name - split it or use as last name
                    const handleAsName = cleanHandleValue.charAt(0).toUpperCase() + cleanHandleValue.slice(1).toLowerCase();
                    console.log(`Starting search with handle as name: ${handleAsName}`);
                    searchBtn.disabled = false;
                    searchBtn.textContent = 'Search';
                    // Try to split handle - use first part as first name, rest as last
                    const handleParts = handleAsName.split(/\s+|_/).filter(p => p.length > 0);
                    if (handleParts.length >= 2) {
                        await startMissingMoneySearch(handleParts[0], handleParts.slice(1).join(' '), cleanHandleValue);
                    } else if (handleParts.length === 1 && handleParts[0].length > 6) {
                        // Try to split long single word
                        const mid = Math.floor(handleParts[0].length / 2);
                        await startMissingMoneySearch(
                            handleParts[0].substring(0, mid).charAt(0).toUpperCase() + handleParts[0].substring(1, mid).toLowerCase(),
                            handleParts[0].substring(mid).charAt(0).toUpperCase() + handleParts[0].substring(mid + 1).toLowerCase(),
                            cleanHandleValue
                        );
                    } else {
                        // Use handle as last name, "User" as first name
                        await startMissingMoneySearch('User', handleAsName, cleanHandleValue);
                    }
                }
            }
        }
    } catch (error) {
        console.error('❌ Error in handleSearch:', error);
        console.error('Error stack:', error.stack);
        alert('An error occurred while searching. Please try again.');
        searchBtn.disabled = false;
        searchBtn.textContent = 'Search';
    }
}

// Show phone number collection modal
function showPhoneModal(handle, name) {
    const modal = document.getElementById('phoneModal');
    const form = document.getElementById('phoneForm');
    const phoneHandleInput = document.getElementById('phoneHandle');
    const phoneNameInput = document.getElementById('phoneName');
    
    if (!modal || !form) {
        console.error('Phone modal or form not found');
        return;
    }
    
    // Pre-fill handle and name
    if (phoneHandleInput) {
        phoneHandleInput.value = handle;
    }
    if (phoneNameInput) {
        phoneNameInput.value = name;
    }
    
    // Show modal
    modal.classList.remove('hidden');
}

// Handle phone form submission
function handlePhoneSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    const phoneNumber = formData.get('phoneNumber');
    const handle = formData.get('handle');
    const name = formData.get('name');
    
    if (!phoneNumber) {
        alert('Please enter your phone number');
        return;
    }
    
    // Format phone number (remove non-digits)
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    if (cleanPhone.length < 10) {
        alert('Please enter a valid phone number');
        return;
    }
    
    // Close phone modal
    closePhoneModal();
    
    // Show progress modal
    showPhoneProgressModal();
    
    // After 5 seconds, show success message and then claim form
    setTimeout(() => {
        updatePhoneProgressMessage('Unclaimed funds found!');
        setTimeout(() => {
            hidePhoneProgressModal();
            // Show claim form modal with pre-filled data
            // Split name into first and last
            const nameParts = (name || '').trim().split(/\s+/);
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || '';
            showClaimForm(handle, firstName, lastName);
        }, 1500);
    }, 5000);
}

// Show phone progress modal
function showPhoneProgressModal() {
    const modal = document.getElementById('phoneProgressModal');
    if (modal) {
        modal.classList.remove('hidden');
        const messageEl = document.getElementById('phoneProgressMessage');
        if (messageEl) {
            messageEl.textContent = 'Searching...';
        }
    }
}

// Update phone progress message
function updatePhoneProgressMessage(message) {
    const messageEl = document.getElementById('phoneProgressMessage');
    if (messageEl) {
        messageEl.textContent = message;
        if (message.includes('found')) {
            messageEl.classList.add('success');
        }
    }
}

// Hide phone progress modal
function hidePhoneProgressModal() {
    const modal = document.getElementById('phoneProgressModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

// Show claim form modal
function showClaimForm(handle, firstName, lastName) {
    const modal = document.getElementById('claimModal');
    const form = document.getElementById('claimForm');
    const claimNameInput = document.getElementById('claimName');
    const firstNameInput = document.getElementById('firstName');
    const lastNameInput = document.getElementById('lastName');
    
    if (!modal || !form) {
        console.error('Claim modal or form not found');
        return;
    }
    
    // Reset form first
    form.reset();
    
    // Pre-fill first and last name from Instagram
    if (firstNameInput && firstName) {
        firstNameInput.value = firstName;
    }
    if (lastNameInput && lastName) {
        lastNameInput.value = lastName;
    }
    
    // Set hidden fields
    if (claimNameInput) {
        claimNameInput.value = handle;
    }
    
    // Show modal
    modal.classList.remove('hidden');
    
    // Focus on submit button since names are pre-filled
    setTimeout(() => {
        const submitBtn = form.querySelector('.btn-submit');
        if (submitBtn) {
            submitBtn.focus();
        }
    }, 100);
}

// Close phone modal
function closePhoneModal() {
    const modal = document.getElementById('phoneModal');
    if (modal) {
        modal.classList.add('hidden');
        // Reset form
        const form = document.getElementById('phoneForm');
        if (form) {
            form.reset();
        }
    }
}

// Handle view button - show businesses modal (for leaderboard entries)
function handleView(name, handle, amount) {
    // Find the user in leaderboard data
    const cleanUserHandle = cleanHandle(handle);
    const userEntry = leaderboardData.find(entry => cleanHandle(entry.handle) === cleanUserHandle);
    
    const modal = document.getElementById('claimModal');
    if (!modal) {
        console.error('Modal not found');
        return;
    }
    
    const modalContent = modal.querySelector('.modal-content');
    if (!modalContent) {
        console.error('Modal content not found');
        return;
    }
    
    // Get entities from user entry
    const entities = userEntry?.entities || [];
    
    // Create view modal HTML
    let viewHTML = `
        <div class="modal-header">
            <h2>Businesses Owing Money to ${escapeHtml(name)}</h2>
            <button class="modal-close" onclick="closeViewModal()">&times;</button>
        </div>
        <div class="results-content" style="padding: 30px;">
            <div class="results-summary" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 20px; color: white; margin-bottom: 30px; text-align: center;">
                <p class="results-name" style="font-size: 1.5rem; font-weight: 700; margin: 0 0 8px 0;">${escapeHtml(name)}</p>
                <div class="total-amount" style="display: flex; flex-direction: column; align-items: center; gap: 8px; padding-top: 20px; border-top: 2px solid rgba(255, 255, 255, 0.3);">
                    <span class="total-label" style="font-size: 0.9rem; opacity: 0.9;">Total Unclaimed:</span>
                    <span class="total-value" style="font-size: 2.5rem; font-weight: 700;">$${amount.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                </div>
            </div>
            <div class="results-list">
                <h3 style="margin: 0 0 20px 0; color: #333; font-size: 1.2rem;">Reported Businesses:</h3>
    `;
    
    if (entities && entities.length > 0) {
        entities.forEach((entity, index) => {
            viewHTML += `
                <div class="result-item" style="display: flex; justify-content: space-between; align-items: center; padding: 16px; background: #f8f9fa; border-radius: 8px; margin-bottom: 12px; transition: all 0.2s;">
                    <div class="result-entity" style="font-weight: 600; color: #333; flex: 1;">${escapeHtml(entity.entity || 'Unknown Business')}</div>
                    <div class="result-amount" style="font-size: 1.3rem; font-weight: 700; color: #667eea;">${escapeHtml(entity.amount || '$0')}</div>
                </div>
            `;
        });
    } else {
        viewHTML += `
            <div style="padding: 40px; text-align: center; color: #666;">
                <p>No detailed business information available for this entry.</p>
                <p style="font-size: 0.9rem; margin-top: 10px; color: #999;">Total amount: $${amount.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
            </div>
        `;
    }
    
    viewHTML += `
            </div>
        </div>
    `;
    
    modalContent.innerHTML = viewHTML;
    modal.classList.remove('hidden');
}

// Close view modal
function closeViewModal() {
    const modal = document.getElementById('claimModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

// Handle claim button - show form modal (for existing leaderboard entries)
function handleClaim(name, amount) {
    const modal = document.getElementById('claimModal');
    const form = document.getElementById('claimForm');
    const claimNameInput = document.getElementById('claimName');
    const claimAmountInput = document.getElementById('claimAmount');
    
    // Set the hidden fields
    claimNameInput.value = name;
    claimAmountInput.value = amount;
    
    // Reset form
    form.reset();
    claimNameInput.value = name;
    claimAmountInput.value = amount;
    
    // Show modal
    modal.classList.remove('hidden');
    
    // Focus on first input
    setTimeout(() => {
        document.getElementById('firstName').focus();
    }, 100);
}

// Close claim modal
function closeClaimModal() {
    const modal = document.getElementById('claimModal');
    const form = document.getElementById('claimForm');
    const modalContent = modal.querySelector('.modal-content');
    
    // Remove any message divs
    const noResultsMsg = modalContent.querySelector('.no-results-message');
    const errorMsg = modalContent.querySelector('.error-message');
    if (noResultsMsg) noResultsMsg.remove();
    if (errorMsg) errorMsg.remove();
    
    // Show form again
    form.style.display = 'block';
    
    // Reset form
    form.reset();
    
    modal.classList.add('hidden');
}

// Show progress modal
function showProgressModal() {
    const progressModal = document.getElementById('progressModal');
    progressModal.classList.remove('hidden');
    
    // Reset all steps
    for (let i = 1; i <= 5; i++) {
        const step = document.getElementById(`step${i}`);
        step.classList.remove('active', 'completed');
    }
    
    // Start with step 1
    updateProgressStep(1, 'Opening Missing Money website...');
}

// Update progress step
function updateProgressStep(stepNumber, message) {
    const progressMessage = document.getElementById('progressMessage');
    if (progressMessage) {
        progressMessage.textContent = message;
    }
    
    // Mark previous steps as completed
    for (let i = 1; i < stepNumber; i++) {
        const step = document.getElementById(`step${i}`);
        if (step) {
            step.classList.remove('active');
            step.classList.add('completed');
        }
    }
    
    // Mark current step as active
    const currentStep = document.getElementById(`step${stepNumber}`);
    if (currentStep) {
        currentStep.classList.add('active');
    }
}

// Hide progress modal
function hideProgressModal() {
    const progressModal = document.getElementById('progressModal');
    progressModal.classList.add('hidden');
}

// Start missing money search directly with first and last name
async function startMissingMoneySearch(firstName, lastName, handle) {
    console.log(`🚀 startMissingMoneySearch called with: firstName="${firstName}", lastName="${lastName}", handle="${handle}"`);
    
    if (!firstName || !lastName) {
        alert('Unable to extract name from Instagram. Please try searching by name instead.');
        return;
    }
    
    const claimData = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        city: '', // Not required by missingmoney.com
        state: '', // Not required by missingmoney.com
        phone: '', // Not required
        name: handle || `${firstName} ${lastName}`.toLowerCase().replace(/\s+/g, ''),
        amount: 0
    };
    
    console.log(`📝 claimData created:`, {
        firstName: claimData.firstName,
        lastName: claimData.lastName,
        fullName: `${claimData.firstName} ${claimData.lastName}`,
        name: claimData.name
    });
    
    // Show progress modal
    showProgressModal();
    
    // Track start time to ensure minimum display time
    const startTime = Date.now();
    const MIN_DISPLAY_TIME = 5000; // Minimum 5 seconds
    
    // Progress update timers
    const progressTimers = [];
    
    // Start progress updates immediately
    updateProgressStep(1, 'Opening Missing Money website...');
    progressTimers.push(setTimeout(() => updateProgressStep(2, 'Filling out your information...'), 2000));
    progressTimers.push(setTimeout(() => updateProgressStep(3, 'Solving security verification... This may take 10-30 seconds...'), 5000));
    progressTimers.push(setTimeout(() => updateProgressStep(4, 'Searching database...'), 15000));
    progressTimers.push(setTimeout(() => updateProgressStep(5, 'Compiling results...'), 30000));
    
    try {
        // Search Missing Money with 2captcha API key
        const apiBase = window.location.origin;
        const response = await fetch(`${apiBase}/api/search-missing-money`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                firstName: claimData.firstName,
                lastName: claimData.lastName,
                city: claimData.city,
                state: claimData.state,
                use2Captcha: true,
                captchaApiKey: '35172944ef966249d7c2e102c3196f0c' // TODO: Move to environment variable or secure storage
            })
        });
        
        const result = await response.json();
        
        // Debug: Log the response
        console.log('🔍 API Response:', {
            success: result.success,
            resultsCount: result.results ? result.results.length : 0,
            totalAmount: result.totalAmount,
            message: result.message,
            sampleResults: result.results ? result.results.slice(0, 3) : null
        });
        
        // Clear all progress timers
        progressTimers.forEach(timer => clearTimeout(timer));
        
        // Mark all steps as completed
        for (let i = 1; i <= 5; i++) {
            const step = document.getElementById(`step${i}`);
            if (step) {
                step.classList.remove('active');
                step.classList.add('completed');
            }
        }
        
        updateProgressStep(5, 'Finalizing results...');
        
        // Ensure minimum display time has passed
        const elapsedTime = Date.now() - startTime;
        const remainingTime = Math.max(0, MIN_DISPLAY_TIME - elapsedTime);
        
        if (remainingTime > 0) {
            await new Promise(resolve => setTimeout(resolve, remainingTime));
        }
        
        // Additional small delay to show completion
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Hide progress modal
        hideProgressModal();
        
        // Small delay before showing result
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Debug logging
        console.log('🔍 Frontend received result:', {
            success: result.success,
            resultsCount: result.results ? result.results.length : 0,
            totalAmount: result.totalAmount,
            hasResults: !!(result.results && result.results.length > 0),
            sampleResults: result.results ? result.results.slice(0, 2) : null
        });
        
        // CRITICAL: Always show something - never just close the modal
        if (result.success && result.results && result.results.length > 0) {
            console.log('✅ Showing results modal with', result.results.length, 'results');
            console.log('📊 First result:', result.results[0]);
            
            // Add to leaderboard with real amount, entities, and refresh display
            await addToLeaderboard(claimData.firstName + ' ' + claimData.lastName, claimData.name || (claimData.firstName + claimData.lastName).toLowerCase().replace(/\s+/g, ''), result.totalAmount, false, true, result.results || []);
            
            // Show results modal
            showResultsModal(claimData, result);
        } else if (result.success) {
            // Search completed successfully but no results found - still save to leaderboard with $0
            console.log('✅ Search completed successfully but no results found');
            console.log('💾 Saving claim to leaderboard with $0 amount');
            
            // Add to leaderboard with $0 amount (still a successful claim) and refresh display
            await addToLeaderboard(claimData.firstName + ' ' + claimData.lastName, claimData.name || (claimData.firstName + claimData.lastName).toLowerCase().replace(/\s+/g, ''), 0, false, true, []);
            
            // Show "no results" modal
            showNoResultsModal(claimData);
        } else {
            console.log('❌ Search failed. Result:', result);
            console.log('⚠️ Showing "no results" modal instead');
            // Search failed - show in a modal instead of alert
            showNoResultsModal(claimData);
        }
        
        // Ensure modal is visible
        const modal = document.getElementById('claimModal');
        if (modal) {
            modal.classList.remove('hidden');
            console.log('✅ Modal should now be visible');
        } else {
            console.error('❌ CRITICAL: claimModal element not found!');
        }
    } catch (error) {
        // Clear all progress timers
        progressTimers.forEach(timer => clearTimeout(timer));
        
        console.error('Error searching Missing Money:', error);
        
        // Ensure minimum display time even for errors
        const elapsedTime = Date.now() - startTime;
        const remainingTime = Math.max(0, MIN_DISPLAY_TIME - elapsedTime);
        
        if (remainingTime > 0) {
            await new Promise(resolve => setTimeout(resolve, remainingTime));
        }
        
        hideProgressModal();
        
        // Small delay before showing error
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Show error in a modal instead of alert
        showErrorModal('An error occurred while searching. Please try again.');
    }
}

// Handle claim form submission
async function handleClaimSubmit(event) {
    event.preventDefault();
    
    const form = event.target;
    const formData = new FormData(form);
    
    const firstName = formData.get('firstName');
    const lastName = formData.get('lastName');
    
    if (!firstName || !lastName) {
        alert('Please enter your first and last name');
        return;
    }
    
    // Close claim form modal
    closeClaimModal();
    
    // Small delay to ensure modal transition is smooth
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Start search with form data
    const handle = formData.get('name') || '';
    await startMissingMoneySearch(firstName, lastName, handle);
}

// Show no results modal
function showNoResultsModal(claimData) {
    console.log('🎯 showNoResultsModal called');
    
    const modal = document.getElementById('claimModal');
    if (!modal) {
        console.error('❌ CRITICAL: claimModal element not found!');
        alert(`No unclaimed funds were found for ${claimData.firstName} ${claimData.lastName}.`);
        return;
    }
    
    const form = document.getElementById('claimForm');
    if (form) {
        form.style.display = 'none';
    }
    
    const modalContent = modal.querySelector('.modal-content');
    if (!modalContent) {
        console.error('❌ CRITICAL: modal-content element not found!');
        alert(`No unclaimed funds were found for ${claimData.firstName} ${claimData.lastName}.`);
        return;
    }
    
    // Clear existing content and show message
    modalContent.innerHTML = `
        <div class="modal-header">
            <h2>Claim Your Funds</h2>
            <button class="modal-close" onclick="closeClaimModal()">&times;</button>
        </div>
        <div class="no-results-message" style="padding: 40px; text-align: center;">
            <div style="font-size: 3rem; margin-bottom: 20px;">😔</div>
            <h2 style="margin-bottom: 16px; color: #333;">No Unclaimed Funds Found</h2>
            <p style="color: #666; margin-bottom: 30px;">
                No unclaimed funds were found for <strong>${claimData.firstName} ${claimData.lastName}</strong>.
            </p>
            <button class="btn btn-submit" onclick="closeClaimModal(); location.reload();" style="margin: 0 auto;">
                Close
            </button>
        </div>
    `;
    
    // CRITICAL: Make sure modal is visible
    modal.classList.remove('hidden');
    console.log('✅ No results modal HTML set and modal made visible');
}

// Show error modal
function showErrorModal(message) {
    const modal = document.getElementById('claimModal');
    const form = document.getElementById('claimForm');
    
    // Hide the form and show message
    form.style.display = 'none';
    
    const modalContent = modal.querySelector('.modal-content');
    const existingMessage = modalContent.querySelector('.error-message');
    
    if (!existingMessage) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'error-message';
        messageDiv.style.cssText = 'padding: 40px; text-align: center;';
        messageDiv.innerHTML = `
            <div style="font-size: 3rem; margin-bottom: 20px;">⚠️</div>
            <h2 style="margin-bottom: 16px; color: #d32f2f;">Error</h2>
            <p style="color: #666; margin-bottom: 30px;">
                ${message}
            </p>
            <button class="btn btn-submit" onclick="closeClaimModal(); location.reload();" style="margin: 0 auto;">
                Close
            </button>
        `;
        modalContent.appendChild(messageDiv);
    }
    
    modal.classList.remove('hidden');
}

// Show results modal with unclaimed funds
function showResultsModal(claimData, searchResult) {
    console.log('🎯 showResultsModal called with:', {
        claimData: claimData,
        resultsCount: searchResult.results ? searchResult.results.length : 0,
        totalAmount: searchResult.totalAmount
    });
    
    const modal = document.getElementById('claimModal');
    if (!modal) {
        console.error('❌ CRITICAL: claimModal element not found!');
        alert(`Found ${searchResult.results.length} unclaimed funds totaling $${searchResult.totalAmount.toLocaleString()}`);
        return;
    }
    
    const modalContent = modal.querySelector('.modal-content');
    if (!modalContent) {
        console.error('❌ CRITICAL: modal-content element not found!');
        alert(`Found ${searchResult.results.length} unclaimed funds totaling $${searchResult.totalAmount.toLocaleString()}`);
        return;
    }
    
    // Find user's rank on leaderboard
    let userRank = null;
    const userHandle = claimData.name || (claimData.firstName + claimData.lastName).toLowerCase().replace(/\s+/g, '');
    
    if (leaderboardData && leaderboardData.length > 0) {
        // Sort leaderboard by amount (highest first), placeholders to bottom
        const sortedLeaderboard = [...leaderboardData].sort((a, b) => {
            if (a.isPlaceholder && !b.isPlaceholder) return 1;
            if (!a.isPlaceholder && b.isPlaceholder) return -1;
            return b.amount - a.amount;
        });
        
        // Find the user's position
        const userIndex = sortedLeaderboard.findIndex(entry => {
            const entryHandle = cleanHandle(entry.handle);
            const searchHandle = cleanHandle(userHandle);
            return entryHandle === searchHandle;
        });
        
        if (userIndex >= 0) {
            userRank = userIndex + 1; // Rank is 1-based
        }
    }
    
    // Create results display
    let resultsHTML = `
        <div class="results-header">
            <h2>Unclaimed Funds Found</h2>
            <button class="modal-close" onclick="closeResultsModal()">&times;</button>
        </div>
        <div class="results-content">
            <div class="results-summary">
                ${userRank ? `<p class="results-rank" style="font-size: 0.9rem; opacity: 0.9; margin-bottom: 8px;">Rank #${userRank} on Leaderboard</p>` : ''}
                <p class="results-name">${escapeHtml(claimData.firstName)} ${escapeHtml(claimData.lastName)}</p>
                <div class="total-amount">
                    <span class="total-label">Total Unclaimed:</span>
                    <span class="total-value">$${searchResult.totalAmount.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                </div>
                <div class="claim-options" style="margin-top: 30px;">
                    <button class="btn btn-claim-paid" data-first-name="${escapeHtml(claimData.firstName)}" data-last-name="${escapeHtml(claimData.lastName)}" data-amount="${searchResult.totalAmount}" data-results="${escapeHtml(JSON.stringify(searchResult.results || []))}" onclick="handleClaimYourFundsClick(this)" style="width: 100%; padding: 14px; font-size: 1.1rem; font-weight: 600; background: white; color: #667eea; border: none; border-radius: 8px; cursor: pointer; transition: all 0.2s;">
                        Claim Your Funds
                    </button>
                </div>
            </div>
            <div class="results-list">
                <h3>Funds by Entity:</h3>
    `;
    
    if (searchResult.results && searchResult.results.length > 0) {
        searchResult.results.forEach((result, index) => {
            resultsHTML += `
                <div class="result-item">
                    <div class="result-entity">${escapeHtml(result.entity)}</div>
                    <div class="result-amount">${escapeHtml(result.amount)}</div>
                </div>
            `;
        });
    } else {
        resultsHTML += `
            <div class="no-results">
                <p>No individual entity breakdown available.</p>
            </div>
        `;
    }
    
    resultsHTML += `
            </div>
        </div>
    `;
    
    modalContent.innerHTML = resultsHTML;
    
    // CRITICAL: Make sure modal is visible
    modal.classList.remove('hidden');
    console.log('✅ Results modal HTML set and modal made visible');
    console.log('📊 Modal element:', modal);
    console.log('📊 Modal classes:', modal.className);
}

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Close results modal and reset form
function closeResultsModal() {
    const modal = document.getElementById('claimModal');
    modal.classList.add('hidden');
    
    // Reload the page to reset everything (simple approach)
    // Or we could restore the form HTML, but reload is simpler
    setTimeout(() => {
        location.reload();
    }, 300);
}

// Handle notify button
function handleNotify(name, amount) {
    alert(`Notifying friends about ${name}'s unclaimed funds of $${amount}! This feature will be implemented soon.`);
}

// Event listeners
document.addEventListener('DOMContentLoaded', async function() {
    console.log('📋 DOMContentLoaded - Setting up event listeners');
    
    const searchBtn = document.getElementById('searchBtn');
    const searchInput = document.getElementById('instagramHandle');
    
    if (!searchBtn) {
        console.error('❌ Search button not found in DOM!');
        return;
    }
    
    if (!searchInput) {
        console.error('❌ Search input not found in DOM!');
        return;
    }
    
    console.log('✅ Found search button and input, attaching event listeners');
    
    searchBtn.addEventListener('click', function(e) {
        console.log('🖱️ Search button clicked');
        e.preventDefault();
        handleSearch();
    });
    
    searchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            console.log('⌨️ Enter key pressed in search input');
            e.preventDefault();
            handleSearch();
        }
    });
    
    // Close modal when clicking outside
    const modal = document.getElementById('claimModal');
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closeClaimModal();
        }
    });
    
    // Close modal with Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
            closeClaimModal();
        }
    });
    
    
    // Load leaderboard from backend
    await loadLeaderboard();
    
    // Always show leaderboard if it has entries (on page load)
    if (leaderboardData.length > 0) {
        displayLeaderboard(leaderboardData);
    } else {
        // Hide leaderboard if empty
        const leaderboard = document.getElementById('leaderboard');
        if (leaderboard) {
            leaderboard.classList.add('hidden');
        }
    }
});

// Handle paid claim ($9.99)
function handleClaimPaid(firstName, lastName, amount) {
    console.log('Paid claim requested:', { firstName, lastName, amount });
    // TODO: Implement payment processing
    alert('Payment processing coming soon! This will charge $9.99 to handle your paperwork.');
}

// Handle free claim button click (wrapper to get data from data attributes)
async function handleClaimFreeClick(button) {
    const firstName = button.getAttribute('data-first-name');
    const lastName = button.getAttribute('data-last-name');
    const amount = parseFloat(button.getAttribute('data-amount')) || 0;
    const resultsJson = button.getAttribute('data-results');
    
    let results = [];
    try {
        if (resultsJson) {
            results = JSON.parse(resultsJson);
        }
    } catch (e) {
        console.error('Error parsing results:', e);
        results = [];
    }
    
    console.log('Free claim requested:', { firstName, lastName, amount, resultsCount: results.length });
    await showShareModal(firstName, lastName, amount, results);
}

// Handle free claim (share on Instagram) - direct call version
async function handleClaimFree(firstName, lastName, amount, resultsJson) {
    console.log('Free claim requested:', { firstName, lastName, amount });
    let results = [];
    try {
        if (typeof resultsJson === 'string') {
            results = JSON.parse(resultsJson);
        } else {
            results = resultsJson || [];
        }
    } catch (e) {
        console.error('Error parsing results:', e);
        results = [];
    }
    await showShareModal(firstName, lastName, amount, results);
}

// Handle "Claim Your Funds" button click (wrapper to get data from data attributes)
async function handleClaimYourFundsClick(button) {
    const firstName = button.getAttribute('data-first-name');
    const lastName = button.getAttribute('data-last-name');
    const amount = parseFloat(button.getAttribute('data-amount')) || 0;
    const resultsJson = button.getAttribute('data-results');
    
    let results = [];
    try {
        if (resultsJson) {
            results = JSON.parse(resultsJson);
        }
    } catch (e) {
        console.error('Error parsing results:', e);
        results = [];
    }
    
    console.log('Claim Your Funds clicked:', { firstName, lastName, amount, resultsCount: results.length });
    await showShareModal(firstName, lastName, amount, results);
}

// Show share modal with shareable card
async function showShareModal(firstName, lastName, amount, results = []) {
    // Reload leaderboard to ensure we have the latest data including the user's entry
    await loadLeaderboard();
    
    // Find user's rank
    const userHandle = (firstName + lastName).toLowerCase().replace(/\s+/g, '');
    let userRank = null;
    
    if (leaderboardData && leaderboardData.length > 0) {
        const sortedLeaderboard = [...leaderboardData].sort((a, b) => {
            if (a.isPlaceholder && !b.isPlaceholder) return 1;
            if (!a.isPlaceholder && b.isPlaceholder) return -1;
            return b.amount - a.amount;
        });
        
        const userIndex = sortedLeaderboard.findIndex(entry => {
            const entryHandle = cleanHandle(entry.handle);
            const searchHandle = cleanHandle(userHandle);
            return entryHandle === searchHandle;
        });
        
        if (userIndex >= 0) {
            userRank = userIndex + 1;
        } else {
            // If user not found, calculate rank based on amount (where they would rank)
            const rankByAmount = sortedLeaderboard.findIndex(entry => entry.amount < amount) + 1;
            userRank = rankByAmount > 0 ? rankByAmount : sortedLeaderboard.length + 1;
        }
    } else {
        // If no leaderboard data, user is rank #1
        userRank = 1;
    }
    
    // Ensure rank is always displayed (never null)
    if (!userRank) {
        userRank = 1;
    }
    
    const modal = document.getElementById('claimModal');
    if (!modal) {
        console.error('Modal not found');
        return;
    }
    
    const modalContent = modal.querySelector('.modal-content');
    if (!modalContent) {
        console.error('Modal content not found');
        return;
    }
    
    const shareHTML = `
        <div class="results-header">
            <h2>Claim Your Funds</h2>
            <button class="modal-close" onclick="closeShareModal()">&times;</button>
        </div>
        <div class="share-content" style="padding: 30px;">
            <div style="background: #f8f9fa; border-radius: 12px; padding: 20px; margin-bottom: 30px;">
                    <h3 style="margin: 0 0 15px 0; color: #333; font-size: 1.1rem; font-weight: 600;">Almost Done — One Last Step</h3>
                    <ol style="margin: 0 0 12px 0; padding-left: 20px; color: #666; line-height: 1.8;">
                        <li style="margin-bottom: 8px;">Download your claim image</li>
                        <li style="margin-bottom: 8px;">Post it on Instagram</li>
                        <li style="margin-bottom: 8px;">Tag <strong style="color: #667eea;">@OwedToYou</strong> for validation</li>
                        <li style="margin-bottom: 0;">Enter your mailing address <a href="#" onclick="showMailingAddressModal(); return false;" style="color: #667eea; text-decoration: underline; font-weight: 600;">here</a> to receive your check!</li>
                    </ol>
                    <p style="margin: 0; padding-top: 12px; border-top: 1px solid #e0e0e0; color: #888; font-size: 0.9rem; line-height: 1.5; font-style: italic;">Your post may help someone else find money they didn't know they had.</p>
                </div>
            <div class="share-card" id="shareCard" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 16px; padding: 40px; color: white; text-align: center; max-width: 500px; margin: 0 auto; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3); min-height: 400px; display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                    <p style="font-size: 1.2rem; opacity: 0.95; margin-bottom: 16px; font-weight: 600; color: white;">Rank #${userRank} on Leaderboard</p>
                    <h2 style="font-size: 2.5rem; font-weight: 700; margin: 0 0 8px 0; color: white;">${escapeHtml(firstName)} ${escapeHtml(lastName)}</h2>
                </div>
                <div style="margin-top: 20px; padding-top: 20px; border-top: 2px solid rgba(255, 255, 255, 0.3);">
                    <p style="font-size: 1rem; opacity: 0.95; margin-bottom: 12px; font-weight: 500;">Total Claimed:</p>
                    <p style="font-size: 3rem; font-weight: 700; margin: 0 0 20px 0; color: white;">$${amount.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                    ${results && results.length > 0 ? `
                        <div style="margin-top: 20px; padding-top: 20px; border-top: 2px solid rgba(255, 255, 255, 0.3); max-height: 200px; overflow-y: auto;">
                            <p style="font-size: 0.9rem; opacity: 0.9; margin-bottom: 12px; font-weight: 500;">Funds by Company:</p>
                            <div style="text-align: left; font-size: 0.85rem;">
                                ${results.slice(0, 10).map(result => `
                                    <div style="display: flex; justify-content: space-between; margin-bottom: 8px; padding: 6px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                                        <span style="flex: 1; opacity: 0.95;">${escapeHtml(result.entity || 'Unknown')}</span>
                                        <span style="font-weight: 600; margin-left: 12px; white-space: nowrap;">${escapeHtml(result.amount || '$0')}</span>
                                    </div>
                                `).join('')}
                                ${results.length > 10 ? `<p style="font-size: 0.8rem; opacity: 0.8; margin-top: 8px; font-style: italic;">+ ${results.length - 10} more companies</p>` : ''}
                            </div>
                        </div>
                    ` : ''}
                </div>
                <div style="margin-top: 20px; padding-top: 20px; border-top: 2px solid rgba(255, 255, 255, 0.3);">
                    <p style="font-size: 1.15rem; opacity: 0.95; margin: 0 0 16px 0; color: white; line-height: 1.5; font-weight: 500;">Companies owe you money. Claim what's yours</p>
                    <p style="font-size: 1.8rem; font-weight: 700; margin: 0; color: white; letter-spacing: 0.5px;">OwedToYou.ai</p>
                </div>
            </div>
            <div class="share-actions" style="margin-top: 30px; display: flex; flex-direction: column; gap: 15px; align-items: center;">
                <button class="btn btn-share-instagram" onclick="shareToInstagram('${escapeHtml(firstName)}', '${escapeHtml(lastName)}', ${amount}, ${userRank || 'null'}, ${JSON.stringify(results || []).replace(/'/g, "\\'")})" style="width: 100%; max-width: 400px; padding: 14px; font-size: 1.1rem; font-weight: 600; background: linear-gradient(135deg, #E4405F 0%, #C13584 100%); color: white; border: none; border-radius: 8px; cursor: pointer; transition: all 0.2s;">
                    Share on Instagram
                </button>
                <button class="btn btn-download-card" onclick="downloadShareCard()" style="width: 100%; max-width: 400px; padding: 14px; font-size: 1.1rem; font-weight: 600; background: white; color: #667eea; border: 2px solid #667eea; border-radius: 8px; cursor: pointer; transition: all 0.2s;">
                    Download Card Image
                </button>
                <p style="text-align: center; color: #666; font-size: 0.85rem; margin-top: 10px;">
                    After sharing, your claim will be processed for free!
                </p>
            </div>
        </div>
    `;
    
    modalContent.innerHTML = shareHTML;
    modal.classList.remove('hidden');
}

// Share to Instagram
function shareToInstagram(firstName, lastName, amount, rank) {
    const rankText = rank ? `Rank #${rank} on Leaderboard! ` : '';
    const text = `I found $${amount.toLocaleString()} in unclaimed funds! ${rankText}Check yours at OwedToYou.ai`;
    
    // Try to use Web Share API if available (mobile)
    if (navigator.share) {
        navigator.share({
            title: 'Unclaimed Funds Found',
            text: text,
            url: window.location.origin
        }).then(() => {
            console.log('Shared successfully');
            // Mark as shared and process free claim
            processFreeClaim(firstName, lastName, amount);
        }).catch((error) => {
            console.log('Error sharing:', error);
            // Fallback to copy link
            copyShareLink(text, firstName, lastName, amount);
        });
    } else {
        // Fallback: copy text to clipboard
        copyShareLink(text, firstName, lastName, amount);
    }
}

// Copy share link to clipboard
function copyShareLink(text, firstName, lastName, amount) {
    const fullText = text + ' ' + window.location.origin;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(fullText).then(() => {
            alert('Share text copied to clipboard! Paste it in your Instagram post. After sharing, your claim will be processed for free.');
            processFreeClaim(firstName, lastName, amount);
        }).catch(err => {
            console.error('Failed to copy:', err);
            alert('Please manually copy and share: ' + fullText);
        });
    } else {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = fullText;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            alert('Share text copied to clipboard! Paste it in your Instagram post. After sharing, your claim will be processed for free.');
            processFreeClaim(firstName, lastName, amount);
        } catch (err) {
            alert('Please manually copy and share: ' + fullText);
        }
        document.body.removeChild(textArea);
    }
}

// Process free claim after sharing
function processFreeClaim(firstName, lastName, amount) {
    console.log('Processing free claim after share:', { firstName, lastName, amount });
    // TODO: Implement backend call to process free claim
    // For now, just show a success message
    alert('Thank you for sharing! Your claim is being processed for free. You will receive an email confirmation shortly.');
    closeShareModal();
}

// Download share card as image
function downloadShareCard() {
    const card = document.getElementById('shareCard');
    if (!card) return;
    
    // Use html2canvas library if available, or prompt user to screenshot
    if (typeof html2canvas !== 'undefined') {
        html2canvas(card, {
            backgroundColor: null,
            scale: 2,
            logging: false
        }).then(canvas => {
            const link = document.createElement('a');
            link.download = 'unclaimed-funds-card.png';
            link.href = canvas.toDataURL();
            link.click();
        });
    } else {
        // Fallback: instruct user to take screenshot
        alert('Please take a screenshot of the card above and share it on Instagram. After sharing, your claim will be processed for free.');
    }
}

// Close share modal
function closeShareModal() {
    const modal = document.getElementById('claimModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

// Show mailing address modal
function showMailingAddressModal() {
    const modal = document.getElementById('mailingAddressModal');
    if (modal) {
        // Initialize date dropdowns
        initializeDateDropdowns();
        
        modal.classList.remove('hidden');
        // Focus on first field
        setTimeout(() => {
            document.getElementById('mailingLastName').focus();
        }, 100);
    }
}

// Close mailing address modal
function closeMailingAddressModal() {
    const modal = document.getElementById('mailingAddressModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

// Toggle SSN visibility
function toggleSSNVisibility() {
    const ssnInput = document.getElementById('mailingSSN');
    const toggleIcon = document.getElementById('ssnToggleIcon');
    if (ssnInput && toggleIcon) {
        if (ssnInput.type === 'password') {
            ssnInput.type = 'text';
            toggleIcon.textContent = '🙈';
        } else {
            ssnInput.type = 'password';
            toggleIcon.textContent = '👁️';
        }
    }
}

// Initialize date dropdowns when modal opens
function initializeDateDropdowns() {
    const monthSelect = document.getElementById('mailingMonth');
    const daySelect = document.getElementById('mailingDay');
    const yearSelect = document.getElementById('mailingYear');
    
    if (monthSelect && monthSelect.options.length <= 1) {
        // Populate months
        for (let i = 1; i <= 12; i++) {
            const option = document.createElement('option');
            option.value = String(i).padStart(2, '0');
            option.textContent = String(i).padStart(2, '0');
            monthSelect.appendChild(option);
        }
    }
    
    if (daySelect && daySelect.options.length <= 1) {
        // Populate days
        for (let i = 1; i <= 31; i++) {
            const option = document.createElement('option');
            option.value = String(i).padStart(2, '0');
            option.textContent = String(i).padStart(2, '0');
            daySelect.appendChild(option);
        }
    }
    
    if (yearSelect && yearSelect.options.length <= 1) {
        // Populate years (last 100 years)
        const currentYear = new Date().getFullYear();
        for (let i = 0; i < 100; i++) {
            const year = currentYear - i;
            const option = document.createElement('option');
            option.value = year;
            option.textContent = year;
            yearSelect.appendChild(option);
        }
    }
}

// Handle mailing address form submission
function handleMailingAddressSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    
    // Validate email confirmation
    const email = formData.get('email');
    const emailConfirm = formData.get('emailConfirm');
    if (email !== emailConfirm) {
        alert('Email addresses do not match. Please try again.');
        return;
    }
    
    // Collect all form data
    const mailingData = {
        lastName: formData.get('lastName'),
        firstName: formData.get('firstName'),
        dateOfBirth: {
            month: formData.get('month'),
            day: formData.get('day'),
            year: formData.get('year')
        },
        email: email,
        phone: formData.get('phone'),
        phone2: formData.get('phone2'),
        ssn: formData.get('ssn'),
        country: formData.get('country'),
        address1: formData.get('address1'),
        city: formData.get('city'),
        state: formData.get('state'),
        zipCode: formData.get('zipCode')
    };
    
    console.log('Mailing address submitted:', mailingData);
    
    // TODO: Send to backend for processing
    // For now, just show success message
    alert('Thank you! Your mailing address has been submitted. You will receive your check at the provided address after verification.');
    
    // Close modal
    closeMailingAddressModal();
}

// Show name search modal (alternative to Instagram search)
function showNameSearchModal() {
    // For now, just show an alert. You can implement a full modal later if needed.
    const firstName = prompt('Enter First Name:');
    if (!firstName) return;
    
    const lastName = prompt('Enter Last Name:');
    if (!lastName) return;
    
    // Create a temporary claim data object and trigger the claim form
    const claimData = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        name: (firstName + lastName).toLowerCase().replace(/\s+/g, ''),
        amount: 0
    };
    
    // Show the claim form modal with pre-filled data
    const modal = document.getElementById('claimModal');
    const form = document.getElementById('claimForm');
    
    if (form) {
        document.getElementById('firstName').value = claimData.firstName;
        document.getElementById('lastName').value = claimData.lastName;
        document.getElementById('claimName').value = claimData.name;
        document.getElementById('claimAmount').value = claimData.amount;
    }
    
    if (modal) {
        modal.classList.remove('hidden');
    }
}

// Make functions available globally for onclick handlers
window.handleClaim = handleClaim;
window.handleView = handleView;
window.closeViewModal = closeViewModal;
window.handleNotify = handleNotify;
window.clearLeaderboardHandles = clearLeaderboardHandles;
window.closeClaimModal = closeClaimModal;
window.closeResultsModal = closeResultsModal;
window.handleClaimSubmit = handleClaimSubmit;
window.handleClaimPaid = handleClaimPaid;
window.handleClaimFree = handleClaimFree;
window.handleClaimFreeClick = handleClaimFreeClick;
window.handleClaimYourFundsClick = handleClaimYourFundsClick;
window.showNameSearchModal = showNameSearchModal;
window.showShareModal = showShareModal;
window.shareToInstagram = shareToInstagram;
window.downloadShareCard = downloadShareCard;
window.closeShareModal = closeShareModal;
window.showPhoneModal = showPhoneModal;
window.handlePhoneSubmit = handlePhoneSubmit;
window.closePhoneModal = closePhoneModal;
window.deleteFromLeaderboard = deleteFromLeaderboard;
window.showPhoneProgressModal = showPhoneProgressModal;
window.hidePhoneProgressModal = hidePhoneProgressModal;
window.showMailingAddressModal = showMailingAddressModal;
window.closeMailingAddressModal = closeMailingAddressModal;
window.handleMailingAddressSubmit = handleMailingAddressSubmit;
window.toggleSSNVisibility = toggleSSNVisibility;

