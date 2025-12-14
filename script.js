// Leaderboard data - loaded from backend
let leaderboardData = [];

// Immediate test to verify script is loading
console.log('✅✅✅✅✅ script.js STARTING TO LOAD');
console.log('✅ script.js loaded successfully');
console.log('✅ Current time:', new Date().toISOString());
console.log('✅✅✅✅✅ About to set placeholder...');

// CRITICAL: Export handleSearch immediately (before function definition)
// This ensures it's available for inline onclick handlers
// The real function will be defined later and will replace this at line ~1635
// Store a reference to check if real function exists
let _realHandleSearch = null;

// CRITICAL: Placeholder function - will be replaced by real function
// Using direct assignment, not IIFE, to avoid closure issues
window.handleSearch = function() {
    console.error('⚠️⚠️⚠️ PLACEHOLDER handleSearch called - this should NOT happen!');
    console.error('⚠️ Real function should have replaced this');
    console.error('⚠️ Current window.handleSearch:', window.handleSearch === this ? 'SELF' : 'OTHER');
    
    // CRITICAL FIX: Check if real function exists using the stored reference
    // The real function will set _realHandleSearch when it's defined
    if (_realHandleSearch && typeof _realHandleSearch === 'function') {
        console.log('✅ Found real handleSearch via _realHandleSearch');
        console.log('🔄 Replacing window.handleSearch with real function NOW');
        
        // CRITICAL: Replace window.handleSearch BEFORE calling to prevent recursion
        // Use Object.defineProperty to force it even if writable is false
        try {
            Object.defineProperty(window, 'handleSearch', {
                value: _realHandleSearch,
                writable: true,
                enumerable: true,
                configurable: true
            });
            console.log('✅✅✅ window.handleSearch replaced via defineProperty');
        } catch (e) {
            // Fallback to direct assignment
            window.handleSearch = _realHandleSearch;
            console.log('✅✅✅ window.handleSearch replaced via direct assignment');
        }
        
        // Verify replacement worked
        const verifyStr = window.handleSearch.toString();
        if (verifyStr.includes('PLACEHOLDER')) {
            console.error('❌❌❌ Replacement FAILED - still placeholder!');
            alert('Search function error. Please refresh the page.');
            return;
        }
        
        console.log('✅✅✅ Replacement verified, calling real function');
        // IMPORTANT: Call the function directly, NOT via window.handleSearch
        // This prevents infinite recursion
        try {
            return _realHandleSearch.apply(this, arguments);
        } catch (e) {
            console.error('❌ Error calling real function:', e);
            alert('An error occurred while searching. Please refresh the page and try again.');
            return;
        }
    }
    
    // Also try to find handleSearchImpl (the actual function declaration)
    // This is a last resort fallback
    try {
        if (typeof handleSearchImpl === 'function') {
            const realFuncStr = handleSearchImpl.toString();
            if (realFuncStr.includes('STARTING SEARCH')) {
                console.log('✅ Found real handleSearchImpl via fallback');
                // Replace and call
                window.handleSearch = handleSearchImpl;
                return handleSearchImpl.apply(this, arguments);
            }
        }
    } catch (e) {
        // Ignore errors
        console.error('Error in fallback:', e);
    }
    
    alert('Search function is still loading. Please wait a moment and try again.');
};
console.log('✅ Placeholder handleSearch exported');

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
    
    // Check localStorage cache first
    const cached = loadInstagramNamesFromStorage();
    if (cached[cleanUsername]) {
        const cachedData = cached[cleanUsername];
        // Check if cache is still valid (7 days)
        const age = Date.now() - cachedData.timestamp;
        const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
        if (age < maxAge) {
            console.log(`✅ Found cached Instagram name for ${cleanUsername}: ${cachedData.fullName} (age: ${Math.round(age / 1000 / 60 / 60)} hours)`);
            return cachedData.fullName;
        } else {
            console.log(`⏰ Cached Instagram name for ${cleanUsername} expired, fetching fresh`);
        }
    }
    
    // Try backend server first (if available)
    try {
        const apiBase = window.location.origin;
        console.log(`🌐 Attempting backend API call to: ${apiBase}/api/instagram-name?username=${encodeURIComponent(cleanUsername)}`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            console.log('⏰ Backend API timeout after 15s, aborting...');
            controller.abort();
        }, 15000); // 15 second timeout
        
        let response;
        try {
            response = await fetch(`${apiBase}/api/instagram-name?username=${encodeURIComponent(cleanUsername)}`, {
                method: 'GET',
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json'
                }
            });
            clearTimeout(timeoutId);
        } catch (fetchError) {
            clearTimeout(timeoutId);
            if (fetchError.name === 'AbortError') {
                console.log('❌ Backend API request timed out after 15s');
                throw new Error('Instagram request timed out. Please try again.');
            }
            console.log(`❌ Backend API fetch error: ${fetchError.message}`);
            throw fetchError;
        }
        
        console.log(`📥 Backend API response status: ${response.status} ${response.statusText}`);
        
        if (response.ok) {
            let data;
            try {
                data = await response.json();
            } catch (jsonError) {
                console.error('❌ Failed to parse backend API JSON response:', jsonError);
                const text = await response.text();
                console.error('Response text:', text.substring(0, 200));
                throw new Error('Invalid response from server');
            }
            
            if (data.success && data.fullName) {
                const fullName = data.fullName.trim();
                console.log(`✅ Found Instagram name via backend: ${fullName}`);
                // Cache the result
                saveInstagramNameToStorage(cleanUsername, fullName);
                return fullName;
            } else {
                const errorMsg = data.error || 'Unknown error';
                console.log(`⚠️ Backend returned but no name found:`, errorMsg);
                // If it's a timeout, throw a specific error
                if (errorMsg.includes('timeout') || errorMsg.includes('Request timeout')) {
                    throw new Error('Instagram request timed out. Please try again.');
                }
                // Don't throw here - let it fall through to proxy methods
                console.log('⚠️ Backend API failed, will try client-side proxies as fallback');
            }
        } else {
            const errorText = await response.text().catch(() => '');
                console.log(`⚠️ Backend request failed with status: ${response.status}`);
            console.log(`⚠️ Error response: ${errorText.substring(0, 200)}`);
            // If backend returns a specific error message, log it
            try {
                const errorData = JSON.parse(errorText);
                if (errorData.error) {
                    console.log(`⚠️ Backend error message: ${errorData.error}`);
                }
            } catch (e) {
                // Not JSON, ignore
            }
            // Don't throw - fall through to proxy methods
        }
    } catch (e) {
        // Check if it's a timeout error
        if (e.name === 'AbortError' || e.message.includes('timeout') || e.message.includes('aborted')) {
            console.log('❌ Backend request timed out');
            throw new Error('Instagram request timed out. Please try again.');
        }
        console.log('⚠️ Backend server not available for name extraction, using browser methods:', e.message);
        // Re-throw if it's a timeout error so caller can handle it
        if (e.message.includes('timeout')) {
            throw e;
        }
        // For other errors, continue to proxy fallback
    }
    
    // Fallback to browser methods - try multiple proxies
    // Using multiple CORS proxies to increase success rate
    const proxies = [
        { url: 'https://api.allorigins.win/raw?url=', name: 'allorigins' },
        { url: 'https://corsproxy.io/?', name: 'corsproxy' },
        { url: 'https://api.codetabs.com/v1/proxy?quest=', name: 'codetabs' },
        { url: 'https://cors-anywhere.herokuapp.com/', name: 'cors-anywhere' },
        { url: 'https://thingproxy.freeboard.io/fetch/', name: 'thingproxy' }
    ];
    
    const apiUrl = `https://www.instagram.com/${cleanUsername}/`;
    console.log(`🌐 Starting client-side Instagram fetch for: ${cleanUsername}`);
    console.log(`📡 Will try ${proxies.length} different CORS proxies`);
    
    for (let i = 0; i < proxies.length; i++) {
        const proxy = proxies[i];
        const proxyUrl = proxy.url;
        const proxyName = proxy.name;
        
        try {
            console.log(`📡 [${i + 1}/${proxies.length}] Trying proxy: ${proxyName} for ${cleanUsername}`);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                console.log(`⏰ [${proxyName}] Timeout after 15s, aborting...`);
                controller.abort();
            }, 15000); // 15 second timeout
            
            let response;
            try {
                let fetchUrl;
                if (proxyUrl.includes('codetabs')) {
                    fetchUrl = `${proxyUrl}${apiUrl}`;
                } else if (proxyUrl.includes('allorigins')) {
                    fetchUrl = `${proxyUrl}${encodeURIComponent(apiUrl)}`;
                } else {
                    fetchUrl = `${proxyUrl}${encodeURIComponent(apiUrl)}`;
                }
                
                console.log(`🔗 [${proxyName}] Fetching: ${fetchUrl.substring(0, 80)}...`);
                
                response = await fetch(fetchUrl, {
                    method: 'GET',
                    signal: controller.signal,
                    headers: {
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Referer': 'https://www.instagram.com/',
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                });
                
                clearTimeout(timeoutId);
                console.log(`📥 [${proxyName}] Response status: ${response.status} ${response.statusText}`);
            } catch (fetchError) {
                clearTimeout(timeoutId);
                if (fetchError.name === 'AbortError') {
                    console.log(`⏰ [${proxyName}] Request timed out after 15s`);
                    if (i === proxies.length - 1) {
                        // Last proxy, throw timeout error
                        throw new Error('Instagram request timed out. All proxies failed.');
                    }
                    continue; // Try next proxy
                }
                console.log(`❌ [${proxyName}] Fetch error: ${fetchError.message}`);
                if (i === proxies.length - 1) {
                    // Last proxy failed
                    console.log(`❌ All ${proxies.length} proxies failed`);
                }
                continue; // Try next proxy
            }
        
            if (response.ok) {
                const html = await response.text();
                console.log(`✅ [${proxyName}] Received HTML, length: ${html.length} characters`);
                
                // Check if we got a valid response (not empty or error page)
                if (html.length === 0) {
                    console.log(`⚠️ [${proxyName}] Empty response, trying next proxy...`);
                    continue;
                }
                
                // Check for login/error pages - be more lenient with large HTML
                // Instagram login pages are usually small, so if HTML is large, try extraction anyway
                const isLoginPage = html.includes('Log in to Instagram') || 
                                   html.includes('login_required') || 
                                   html.includes('/accounts/login/');
                
                if (html.length < 1000) {
                    console.log(`⚠️ [${proxyName}] Insufficient content (${html.length} chars), trying next...`);
                    continue;
                }
                
                // Only skip if it's clearly a login page AND HTML is small
                if (isLoginPage && html.length < 50000) {
                    console.log(`⚠️ [${proxyName}] Got login page (${html.length} chars), trying next...`);
                    continue;
                }
                
                // If HTML is large, try extraction even if login indicators are present
                // (Instagram sometimes includes login indicators in challenge pages but still has profile data)
                if (isLoginPage && html.length >= 50000) {
                    console.log(`⚠️ [${proxyName}] Large HTML with login indicators (${html.length} chars), attempting extraction anyway...`);
                }
                
                console.log(`🔍 [${proxyName}] Attempting to extract name from HTML...`);
                const fullName = await extractNameFromHTML(html, cleanUsername);
                if (fullName) {
                    console.log(`✅ [${proxyName}] Successfully extracted name: ${fullName}`);
                    // Cache the result
                    saveInstagramNameToStorage(cleanUsername, fullName);
                    return fullName;
                } else {
                    console.log(`⚠️ [${proxyName}] Could not extract name from HTML, trying next proxy...`);
                    // Log more details for debugging
                    console.log(`📄 [${proxyName}] HTML length: ${html.length}`);
                    console.log(`📄 [${proxyName}] Contains 'window._sharedData': ${html.includes('window._sharedData')}`);
                    console.log(`📄 [${proxyName}] Contains 'full_name': ${html.includes('full_name')}`);
                    console.log(`📄 [${proxyName}] Contains 'og:title': ${html.includes('og:title')}`);
                    console.log(`📄 [${proxyName}] Contains username '${cleanUsername}': ${html.includes(cleanUsername)}`);
                    // Log a snippet of HTML for debugging
                    const htmlSnippet = html.substring(0, 1000).replace(/\s+/g, ' ');
                    console.log(`📄 [${proxyName}] HTML snippet (first 1000 chars): ${htmlSnippet}...`);
                    continue;
                }
            } else {
                console.log(`❌ [${proxyName}] Response not OK: ${response.status} ${response.statusText}`);
                if (i === proxies.length - 1) {
                    console.log(`❌ All proxies returned non-OK status codes`);
                }
                continue;
            }
        } catch (proxyError) {
            console.log(`❌ [${proxyName}] Proxy error: ${proxyError.message}`);
            // If it's the last proxy and it's a timeout, throw it
            if (i === proxies.length - 1 && (proxyError.message && proxyError.message.includes('timeout'))) {
                throw new Error('Instagram request timed out. All proxies failed.');
            }
            if (i < proxies.length - 1) {
                console.log(`🔄 Continuing to next proxy...`);
                continue;
            }
        }
    }
    
    // All proxies failed
    console.log(`❌ All proxy methods failed for ${cleanUsername}`);
    return null;
}

// Helper function to extract name from HTML
async function extractNameFromHTML(html, cleanUsername) {
    // Recursive function to search for full_name in JSON objects
    function findFullNameInObject(obj, cleanUsername, depth = 0) {
        // Prevent infinite recursion
        if (depth > 10) return null;
        if (typeof obj !== 'object' || obj === null) return null;
        
        // Check if this object has full_name
        if (obj.full_name && typeof obj.full_name === 'string' && obj.full_name.trim().length > 0) {
            const name = obj.full_name.trim();
            if (name.length > 2 && !name.startsWith('@') && !name.includes('instagram') && name !== cleanUsername) {
                return name;
            }
        }
        if (obj.fullName && typeof obj.fullName === 'string' && obj.fullName.trim().length > 0) {
            const name = obj.fullName.trim();
            if (name.length > 2 && !name.startsWith('@') && !name.includes('instagram') && name !== cleanUsername) {
                return name;
            }
        }
        
        // Also check for 'name' field if it looks like a full name (has space)
        if (obj.name && typeof obj.name === 'string' && obj.name.trim().length > 0) {
            const name = obj.name.trim();
            // Check if it's a full name (has space and doesn't start with @)
            if (name.includes(' ') && name.length > 3 && !name.startsWith('@') && 
                name !== cleanUsername && !name.toLowerCase().includes('instagram')) {
                return name;
            }
        }
        
        // Recursively search in all properties
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                const result = findFullNameInObject(obj[key], cleanUsername, depth + 1);
                if (result) return result;
            }
        }
        return null;
    }
    
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
                    sharedData?.graphql?.user?.fullName,
                    // Try recursive search in sharedData
                    findFullNameInObject(sharedData, cleanUsername)
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
    
    // PRIORITY: Look for name in visible HTML structure (Instagram always displays it)
    // The name appears in a <span> with obfuscated classes like "x1lliihq x1plvlek..." near the username
    try {
        const usernameIndex = html.indexOf(cleanUsername);
        if (usernameIndex !== -1) {
            // Look in a larger window around the username (30000 chars to catch header area)
            const start = Math.max(0, usernameIndex - 15000);
            const end = Math.min(html.length, usernameIndex + 15000);
            const headerArea = html.substring(start, end);
            
            // Look for span elements with obfuscated Instagram classes that contain names
            // Pattern: <span class="x1lliihq x1plvlek..." dir="auto">Name</span>
            // Instagram uses obfuscated classes starting with 'x' followed by alphanumeric
            const spanPatterns = [
                // Match spans with obfuscated classes (x followed by alphanumeric)
                /<span[^>]*class="[^"]*x[a-z0-9]+[^"]*"[^>]*dir="auto"[^>]*>([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)<\/span>/gi,
                // Also try without dir="auto" requirement
                /<span[^>]*class="[^"]*x[a-z0-9]+[^"]*"[^>]*>([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)<\/span>/gi,
                // Look for any span near username with proper name format
                /<span[^>]*>([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)<\/span>/g
            ];
            
            for (const pattern of spanPatterns) {
                const matches = [...headerArea.matchAll(pattern)];
                for (const match of matches) {
                    if (match && match[1]) {
                        let name = match[1].trim();
                        // Clean up any HTML entities or extra whitespace
                        name = name.replace(/&[^;]+;/g, '').trim();
                        
                        // Validate it's a real name (not username, not too short/long)
                        if (name && name.length > 3 && name.length < 50 &&
                            name !== cleanUsername && 
                            !name.startsWith('@') &&
                            !name.toLowerCase().includes('instagram') &&
                            !name.toLowerCase().includes('login') &&
                            !name.toLowerCase().includes('follow') &&
                            name.includes(' ') && // Must have space (first and last name)
                            /^[A-Z][a-z]+(\s+[A-Z][a-z]+)+$/.test(name)) { // Must be proper case
                            console.log(`Found Instagram name from span element: ${name}`);
                            return name;
                        }
                    }
                }
            }
            
            // Also look for h1/h2 tags near username
            const headerPatterns = [
                /<h[12][^>]*>([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)<\/h[12]>/gi
            ];
            
            for (const pattern of headerPatterns) {
                const matches = [...headerArea.matchAll(pattern)];
                for (const match of matches) {
                    if (match && match[1]) {
                        let name = match[1].trim();
                        name = name.replace(/&[^;]+;/g, '').trim();
                        
                        if (name && name.length > 3 && name.length < 50 &&
                            name !== cleanUsername && 
                            !name.startsWith('@') &&
                            !name.toLowerCase().includes('instagram') &&
                            name.includes(' ') &&
                            /^[A-Z][a-z]+(\s+[A-Z][a-z]+)+$/.test(name)) {
                            console.log(`Found Instagram name from header tag: ${name}`);
                            return name;
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.log(`Error in header area extraction: ${e.message}`);
    }
    
    // Try alternative method: look for meta tags or title - multiple patterns
    const metaTitlePatterns = [
        /<meta\s+property="og:title"\s+content="([^"]+)"/i,
        /<meta\s+property='og:title'\s+content='([^']+)'/i,
        /<meta[^>]*og:title[^>]*content="([^"]+)"/i,
        /<title>([^<]+)<\/title>/i
    ];
    
    for (const pattern of metaTitlePatterns) {
        const metaNameMatch = html.match(pattern);
        if (metaNameMatch && metaNameMatch[1]) {
            const title = metaNameMatch[1].trim();
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
                    console.log(`Found Instagram name from title: ${extractedName}`);
                    return extractedName;
                }
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
    
    // PRIORITY: If HTML contains 'full_name', search comprehensively for it
    // Instagram always includes full_name somewhere in the HTML, even if not in _sharedData
    if (html.includes('full_name')) {
        console.log(`HTML contains 'full_name' - searching comprehensively...`);
        
        // First, try to find full_name near the username (most reliable)
        const usernameIndex = html.indexOf(cleanUsername);
        if (usernameIndex !== -1) {
            // Look in a large window around username
            const start = Math.max(0, usernameIndex - 30000);
            const end = Math.min(html.length, usernameIndex + 30000);
            const searchArea = html.substring(start, end);
            
            // Find ALL full_name occurrences in this area
            const fullNameMatches = [...searchArea.matchAll(/"full_name"\s*:\s*"([^"]+)"/gi)];
            console.log(`Found ${fullNameMatches.length} full_name matches near username`);
            
            // Try each match, prefer ones closer to username
            let bestName = null;
            let bestDistance = Infinity;
            
            for (const match of fullNameMatches) {
                if (match && match[1]) {
                    const name = match[1].trim();
                    // Validate it's a real name
                    if (name && name.length > 2 && name.length < 100 &&
                        !name.startsWith('@') && 
                        name !== cleanUsername && 
                        !name.toLowerCase().includes('instagram') &&
                        !name.toLowerCase().includes('null') &&
                        !name.toLowerCase().includes('undefined') &&
                        /[a-zA-Z]/.test(name)) {
                        
                        // Calculate distance from username
                        const nameIndex = searchArea.indexOf(`"full_name":"${name}"`);
                        if (nameIndex !== -1) {
                            const distance = Math.abs(nameIndex - (usernameIndex - start));
                            if (distance < bestDistance) {
                                bestName = name;
                                bestDistance = distance;
                            }
                        }
                    }
                }
            }
            
            if (bestName) {
                console.log(`Found Instagram name via comprehensive full_name search (distance: ${bestDistance}): ${bestName}`);
                return bestName;
            }
        }
        
        // If not found near username, search entire HTML
        const allFullNameMatches = [...html.matchAll(/"full_name"\s*:\s*"([^"]+)"/gi)];
        console.log(`Found ${allFullNameMatches.length} total full_name matches in HTML`);
        
        for (const match of allFullNameMatches) {
            if (match && match[1]) {
                const name = match[1].trim();
                // Validate it's a real name
                if (name && name.length > 2 && name.length < 100 &&
                    !name.startsWith('@') && 
                    name !== cleanUsername && 
                    !name.toLowerCase().includes('instagram') &&
                    !name.toLowerCase().includes('null') &&
                    !name.toLowerCase().includes('undefined') &&
                    /[a-zA-Z]/.test(name)) {
                    console.log(`Found Instagram name via full_name search: ${name}`);
                    return name;
                }
            }
        }
    }
    
    // Try to find name in various script tags with JSON data
    const scriptMatches = html.match(/<script[^>]*>(.*?)<\/script>/gis);
    if (scriptMatches) {
        for (const scriptContent of scriptMatches) {
            // Look for full_name in script content with regex first (faster)
            const fullNamePatterns = [
                /"full_name"\s*:\s*"([^"]+)"/i,
                /"fullName"\s*:\s*"([^"]+)"/i,
                /full_name["\s]*:["\s]*"([^"]+)"/i,
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
            
            // Try to parse as JSON and search recursively
            try {
                // Look for JSON objects in script tags (larger objects that might contain nested data)
                const jsonMatches = scriptContent.match(/\{[\s\S]{100,50000}\}/g);
                if (jsonMatches) {
                    for (const jsonStr of jsonMatches) {
                        try {
                            const jsonObj = JSON.parse(jsonStr);
                            const foundName = findFullNameInObject(jsonObj, cleanUsername);
                            if (foundName) {
                                console.log(`Found Instagram name via recursive JSON search: ${foundName}`);
                                return foundName;
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
    
    // Try to find in span or div with profile name classes - expanded patterns
    const profileNamePatterns = [
        /<span[^>]*class="[^"]*profile[^"]*name[^"]*"[^>]*>([^<]+)<\/span>/i,
        /<div[^>]*class="[^"]*profile[^"]*name[^"]*"[^>]*>([^<]+)<\/div>/i,
        /<span[^>]*data-testid="[^"]*name[^"]*"[^>]*>([^<]+)<\/span>/i,
        /<span[^>]*class="[^"]*x1lliihq[^"]*"[^>]*>([^<]+)<\/span>/i, // Instagram's obfuscated class names
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
                    if (name && name.length > 2 && !name.startsWith('@') && name !== cleanUsername && 
                        !name.toLowerCase().includes('instagram') && 
                        !name.toLowerCase().includes('follow') &&
                        !name.toLowerCase().includes('login') &&
                        // Must contain at least one letter
                        /[a-zA-Z]/.test(name)) {
                        console.log(`Found Instagram name from profile element: ${name}`);
                        return name;
                    }
                }
            }
        }
    }
    
    // Try to find name in React/JSON data structures (newer Instagram format)
    const reactDataPatterns = [
        /"profilePage_[\d]+":\s*\{[^}]*"full_name":\s*"([^"]+)"/i,
        /"user":\s*\{[^}]*"full_name":\s*"([^"]+)"/i,
        /"full_name":\s*"([^"]+)"[^}]*"username":\s*"[^"]*"/i,
        /"biography":\s*"[^"]*"[^}]*"full_name":\s*"([^"]+)"/i,
        /"edge_owner_to_timeline_media":\s*\{[^}]*"full_name":\s*"([^"]+)"/i,
        /"edge_felix_video_timeline":\s*\{[^}]*"full_name":\s*"([^"]+)"/i
    ];
    
    for (const pattern of reactDataPatterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
            const name = match[1].trim();
            if (name && name.length > 2 && !name.startsWith('@') && name !== cleanUsername && 
                !name.toLowerCase().includes('instagram')) {
                console.log(`Found Instagram name from React data: ${name}`);
                return name;
            }
        }
    }
    
    
    // Try to find name near username in HTML (Instagram often places them close together)
    try {
        const usernameIndex = html.indexOf(cleanUsername);
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
                        name !== cleanUsername && !name.toLowerCase().includes('instagram') &&
                        /[a-zA-Z]/.test(name)) {
                        console.log(`Found Instagram name near username: ${name}`);
                        return name;
                    }
                }
            }
        }
    } catch (e) {
        console.log(`Error in near-username extraction: ${e.message}`);
    }
    
    // Try to find in all script tags for any JSON data containing full_name
    const allScriptMatches = html.match(/<script[^>]*type="application\/json"[^>]*>(.*?)<\/script>/gis);
    if (allScriptMatches) {
        for (const scriptContent of allScriptMatches) {
            try {
                const jsonMatch = scriptContent.match(/<script[^>]*>(.*?)<\/script>/is);
                if (jsonMatch && jsonMatch[1]) {
                    const jsonData = JSON.parse(jsonMatch[1]);
                    // Recursively search for full_name in JSON
                    const findNameInObject = (obj) => {
                        if (typeof obj !== 'object' || obj === null) return null;
                        for (const key in obj) {
                            if (key === 'full_name' || key === 'fullName') {
                                const name = obj[key];
                                if (typeof name === 'string' && name.length > 2 && !name.startsWith('@') && name !== cleanUsername) {
                                    return name;
                                }
                            }
                            const found = findNameInObject(obj[key]);
                            if (found) return found;
                        }
                        return null;
                    };
                    const foundName = findNameInObject(jsonData);
                    if (foundName) {
                        console.log(`Found Instagram name from JSON script: ${foundName}`);
                        return foundName;
                    }
                }
            } catch (e) {
                // Not valid JSON, continue
            }
        }
    }
    
    // Try to extract from article or section tags that might contain profile info
    const articleMatches = html.match(/<article[^>]*>([\s\S]{0,2000})<\/article>/i);
    if (articleMatches) {
        const articleContent = articleMatches[1];
        // Look for text that appears before the username in the article
        const nameInArticle = articleContent.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)(?:\s*@|•|\|)/);
        if (nameInArticle && nameInArticle[1]) {
            const name = nameInArticle[1].trim();
            if (name && name.length > 3 && name !== cleanUsername) {
                console.log(`Found Instagram name from article: ${name}`);
                return name;
            }
        }
    }
    
    // If we get here, no name was found
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

// Load profile pictures from localStorage
function loadProfilePicsFromStorage() {
    try {
        const stored = localStorage.getItem('leaderboardProfilePics');
        if (stored) {
            const parsed = JSON.parse(stored);
            console.log(`📦 Loaded ${Object.keys(parsed).length} profile pictures from localStorage`);
            return parsed;
        }
    } catch (e) {
        console.error('Error loading profile pics from storage:', e);
    }
    return {};
}

// Save profile pictures to localStorage
function saveProfilePicsToStorage(profilePics) {
    try {
        localStorage.setItem('leaderboardProfilePics', JSON.stringify(profilePics));
        console.log(`💾 Saved ${Object.keys(profilePics).length} profile pictures to localStorage`);
    } catch (e) {
        console.error('Error saving profile pics to storage:', e);
        // If storage is full, try to clear old entries
        try {
            console.log('⚠️ Storage may be full, attempting to clear and retry...');
            localStorage.removeItem('leaderboardProfilePics');
            localStorage.setItem('leaderboardProfilePics', JSON.stringify(profilePics));
            console.log('✅ Successfully saved after clearing storage');
        } catch (e2) {
            console.error('❌ Failed to save even after clearing:', e2);
        }
    }
}

// Load Instagram names from localStorage
function loadInstagramNamesFromStorage() {
    try {
        const stored = localStorage.getItem('instagramNames');
        if (stored) {
            const parsed = JSON.parse(stored);
            console.log(`📦 Loaded ${Object.keys(parsed).length} Instagram names from localStorage`);
            return parsed;
        }
    } catch (e) {
        console.error('Error loading Instagram names from storage:', e);
    }
    return {};
}

// Save Instagram name to localStorage
function saveInstagramNameToStorage(handle, fullName) {
    try {
        const stored = loadInstagramNamesFromStorage();
        stored[handle] = {
            fullName: fullName,
            timestamp: Date.now()
        };
        localStorage.setItem('instagramNames', JSON.stringify(stored));
        console.log(`💾 Saved Instagram name for ${handle} to localStorage`);
    } catch (e) {
        console.error('Error saving Instagram name to storage:', e);
    }
}

// Load MissingMoney search results from localStorage
function loadMissingMoneyResultsFromStorage(firstName, lastName) {
    try {
        const stored = localStorage.getItem('missingMoneyResults');
        if (stored) {
            const parsed = JSON.parse(stored);
            const key = `${firstName.toLowerCase()}_${lastName.toLowerCase()}`;
            const cached = parsed[key];
            if (cached) {
                // Check if cache is still valid (24 hours)
                const age = Date.now() - cached.timestamp;
                const maxAge = 24 * 60 * 60 * 1000; // 24 hours
                if (age < maxAge) {
                    console.log(`📦 Loaded cached MissingMoney results for ${firstName} ${lastName} (age: ${Math.round(age / 1000 / 60)} minutes)`);
                    return cached.result;
                } else {
                    console.log(`⏰ Cached MissingMoney results for ${firstName} ${lastName} expired, removing`);
                    delete parsed[key];
                    localStorage.setItem('missingMoneyResults', JSON.stringify(parsed));
                }
            }
        }
    } catch (e) {
        console.error('Error loading MissingMoney results from storage:', e);
    }
    return null;
}

// Save MissingMoney search results to localStorage
function saveMissingMoneyResultsToStorage(firstName, lastName, result) {
    try {
        const stored = localStorage.getItem('missingMoneyResults');
        const parsed = stored ? JSON.parse(stored) : {};
        const key = `${firstName.toLowerCase()}_${lastName.toLowerCase()}`;
        parsed[key] = {
            result: result,
            timestamp: Date.now()
        };
        // Limit cache size to 100 entries to prevent storage bloat
        const entries = Object.keys(parsed);
        if (entries.length > 100) {
            // Remove oldest entries
            entries.sort((a, b) => parsed[a].timestamp - parsed[b].timestamp);
            entries.slice(0, entries.length - 100).forEach(key => delete parsed[key]);
        }
        localStorage.setItem('missingMoneyResults', JSON.stringify(parsed));
        console.log(`💾 Saved MissingMoney results for ${firstName} ${lastName} to localStorage`);
    } catch (e) {
        console.error('Error saving MissingMoney results to storage:', e);
    }
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
            // Preserve existing profile pictures from memory
            const existingProfilePics = new Map();
            leaderboardData.forEach(entry => {
                if (entry.profilePic) {
                    const cleanEntryHandle = cleanHandle(entry.handle);
                    existingProfilePics.set(cleanEntryHandle, entry.profilePic);
                }
            });
            
            // Load profile pictures from localStorage
            const storedProfilePics = loadProfilePicsFromStorage();
            Object.keys(storedProfilePics).forEach(handle => {
                const cleanHandleKey = cleanHandle(handle);
                if (!existingProfilePics.has(cleanHandleKey)) {
                    existingProfilePics.set(cleanHandleKey, storedProfilePics[handle]);
                }
            });
            
            // Filter out placeholders - only show real claims
            // Also deduplicate by handle (case-insensitive) - keep only the first occurrence
            const seenHandles = new Set();
            leaderboardData = data.leaderboard
                .filter(entry => {
                    if (entry.isPlaceholder) return false; // Remove placeholders
                    const cleanEntryHandle = cleanHandle(entry.handle);
                    if (seenHandles.has(cleanEntryHandle)) {
                        console.log(`⚠️ Duplicate entry detected for handle: ${entry.handle}, skipping`);
                        return false; // Skip duplicates
                    }
                    seenHandles.add(cleanEntryHandle);
                    return true;
                })
                .map(entry => {
                    const cleanEntryHandle = cleanHandle(entry.handle);
                    const existingPic = existingProfilePics.get(cleanEntryHandle);
                    return {
                        ...entry,
                        profilePic: existingPic || null, // Preserve existing profile pic if available
                        isPlaceholder: false
                    };
                });
            console.log(`Loaded ${leaderboardData.length} unique real leaderboard entries from backend (placeholders and duplicates filtered out)`);
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
            // Preserve existing profile pictures from memory
            const existingProfilePics = new Map();
            leaderboardData.forEach(entry => {
                if (entry.profilePic) {
                    const cleanEntryHandle = cleanHandle(entry.handle);
                    existingProfilePics.set(cleanEntryHandle, entry.profilePic);
                }
            });
            
            // Load profile pictures from localStorage
            const storedProfilePics = loadProfilePicsFromStorage();
            Object.keys(storedProfilePics).forEach(storedHandle => {
                const cleanHandleKey = cleanHandle(storedHandle);
                if (!existingProfilePics.has(cleanHandleKey)) {
                    existingProfilePics.set(cleanHandleKey, storedProfilePics[storedHandle]);
                }
            });
            
            // Filter out placeholders
            leaderboardData = data.leaderboard
                .filter(entry => !entry.isPlaceholder)
                .map(entry => {
                    const cleanEntryHandle = cleanHandle(entry.handle);
                    const existingPic = existingProfilePics.get(cleanEntryHandle);
                    return {
                        ...entry,
                        profilePic: existingPic || null, // Preserve existing profile pic if available
                        isPlaceholder: false
                    };
                });
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
            // Clear profile pictures from localStorage when clearing leaderboard
            try {
                localStorage.removeItem('leaderboardProfilePics');
                console.log('✅ Cleared profile pictures from localStorage');
            } catch (e) {
                console.error('Error clearing profile pics from storage:', e);
            }
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
            // Preserve existing profile pictures from memory
            const existingProfilePics = new Map();
            leaderboardData.forEach(entry => {
                if (entry.profilePic) {
                    const cleanEntryHandle = cleanHandle(entry.handle);
                    existingProfilePics.set(cleanEntryHandle, entry.profilePic);
                }
            });
            
            // Load profile pictures from localStorage
            const storedProfilePics = loadProfilePicsFromStorage();
            Object.keys(storedProfilePics).forEach(handle => {
                const cleanHandleKey = cleanHandle(handle);
                if (!existingProfilePics.has(cleanHandleKey)) {
                    existingProfilePics.set(cleanHandleKey, storedProfilePics[handle]);
                }
            });
            
            // Filter out placeholders and deduplicate - only show real claims
            const seenHandles = new Set();
            leaderboardData = data.leaderboard
                .filter(entry => {
                    if (entry.isPlaceholder) return false; // Remove placeholders
                    const cleanEntryHandle = cleanHandle(entry.handle);
                    if (seenHandles.has(cleanEntryHandle)) {
                        console.log(`⚠️ Duplicate entry detected for handle: ${entry.handle}, skipping`);
                        return false; // Skip duplicates
                    }
                    seenHandles.add(cleanEntryHandle);
                    return true;
                })
                .map(entry => {
                    const cleanEntryHandle = cleanHandle(entry.handle);
                    const existingPic = existingProfilePics.get(cleanEntryHandle);
                    return {
                        ...entry,
                        profilePic: existingPic || null, // Preserve existing profile pic if available
                        isPlaceholder: false
                    };
                });
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
        // Skip if profile picture already exists
        if (user.profilePic) {
            console.log(`[${index}] Profile picture already exists for ${user.handle}, skipping fetch`);
            // Still update the DOM in case it was cleared
            const cleanUserHandle = cleanHandle(user.handle);
            const entry = document.querySelector(`.leaderboard-entry[data-handle="${cleanUserHandle}"]`);
            if (entry) {
                const profilePictureDiv = entry.querySelector('.profile-picture');
                if (profilePictureDiv && !profilePictureDiv.querySelector('img')) {
                    const img = document.createElement('img');
                    img.src = user.profilePic;
                    img.alt = user.name;
                    img.style.width = '100%';
                    img.style.height = '100%';
                    img.style.borderRadius = '50%';
                    img.style.objectFit = 'cover';
                    img.onerror = function() {
                        this.remove();
                        profilePictureDiv.innerHTML = getInitials(user.name);
                        profilePictureDiv.style.display = 'flex';
                        profilePictureDiv.style.alignItems = 'center';
                        profilePictureDiv.style.justifyContent = 'center';
                    };
                    profilePictureDiv.innerHTML = '';
                    profilePictureDiv.appendChild(img);
                }
            }
            return;
        }
        
        console.log(`[${index}] Fetching profile picture for ${user.handle}...`);
        const profilePic = await getInstagramProfilePicture(user.handle);
        console.log(`[${index}] Profile picture result for ${user.handle}:`, profilePic ? `Found: ${profilePic}` : 'Not found');
        
        if (profilePic) {
            // Update the user object in leaderboardData to preserve the profile pic
            const userIndex = leaderboardData.findIndex(e => cleanHandle(e.handle) === cleanHandle(user.handle));
            if (userIndex >= 0) {
                leaderboardData[userIndex].profilePic = profilePic;
            }
            
            // Save to localStorage for persistence across page reloads (save with both handle formats)
            const storedProfilePics = loadProfilePicsFromStorage();
            storedProfilePics[user.handle] = profilePic;
            storedProfilePics[cleanHandle(user.handle)] = profilePic; // Also save with cleaned handle
            saveProfilePicsToStorage(storedProfilePics);
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
                <button class="btn btn-notify" onclick="handleNotify('${escapedName}', '${user.handle}', ${user.amount})">
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
    
    console.log(`📊 displayLeaderboard called with ${users.length} users`);
    
    // Ensure profile pictures from localStorage are loaded before displaying
    const usersWithPics = users.map(user => {
        if (!user.profilePic) {
            const storedProfilePics = loadProfilePicsFromStorage();
            const cleanUserHandle = cleanHandle(user.handle);
            // Check both exact handle and cleaned handle
            const storedPic = storedProfilePics[user.handle] || storedProfilePics[cleanUserHandle];
            if (storedPic) {
                console.log(`✅ Found profile pic in localStorage for ${user.handle}`);
                return { ...user, profilePic: storedPic };
            }
        }
        return user;
    });
    
    console.log(`📊 Users with profile pics:`, usersWithPics.filter(u => u.profilePic).map(u => `${u.handle} (${u.profilePic ? 'has pic' : 'no pic'})`));
    
    // Generate HTML for all entries immediately with profile pics if available
    listContainer.innerHTML = usersWithPics.map((user, index) => 
        createEntryHTML(user, index + 1)
    ).join('');
    
    leaderboard.classList.remove('hidden');
    
    // Smooth scroll to leaderboard
    leaderboard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    
    // Load profile pictures in background (non-blocking) - this will fetch missing ones
    console.log(`🖼️ Starting to load profile pictures for ${usersWithPics.length} users...`);
    loadProfilePicturesInBackground(usersWithPics);
}

// Handle search - CRITICAL FUNCTION - MUST WORK
// CRITICAL FIX: Use different name to avoid identifier resolution conflict with window.handleSearch
// This prevents JavaScript from resolving 'handleSearch' to window.handleSearch (placeholder)
// Track if search is in progress to prevent duplicate calls
let searchInProgress = false;

async function handleSearchImpl() {
    // Prevent duplicate calls
    if (searchInProgress) {
        console.log('⚠️ Search already in progress, ignoring duplicate call');
        return;
    }
    
    console.log('🔍🔍🔍 handleSearch CALLED - STARTING SEARCH');
    console.log('🔍🔍🔍 handleSearchImpl function type:', typeof handleSearchImpl);
    console.log('🔍🔍🔍 window.handleSearch type:', typeof window.handleSearch);
    
    searchInProgress = true;
    
    const input = document.getElementById('instagramHandle');
    console.log('🔍 Input element:', input ? 'FOUND' : 'NOT FOUND');
    if (!input) {
        console.error('❌ Instagram handle input not found!');
        alert('Error: Search input not found. Please refresh the page.');
        return;
    }
    
    const handle = input.value.trim();
    console.log(`🔍 Handle value: "${handle}"`);
    console.log(`🔍 Handle length: ${handle.length}`);
    
    const searchBtn = document.getElementById('searchBtn');
    console.log('🔍 Search button element:', searchBtn ? 'FOUND' : 'NOT FOUND');
    
    if (!searchBtn) {
        console.error('❌ Search button not found!');
        alert('Error: Search button not found. Please refresh the page.');
        return;
    }
    
    console.log(`🔍 Search initiated for handle: "${handle}"`);
    console.log(`🔍 About to check if handle exists in leaderboard...`);
    
    if (!handle) {
        alert('Please enter an Instagram username');
        return;
    }
    
    // Disable button and show loading
    try {
        searchBtn.disabled = true;
        const originalText = searchBtn.textContent;
        searchBtn.textContent = 'Searching...';
        console.log('✅ Button disabled and text changed to "Searching..."');
    } catch (e) {
        console.error('Error updating button:', e);
    }
    
    try {
        console.log('🔍 Entering try block...');
        const cleanHandleValue = cleanHandle(handle);
        console.log(`🔍 Cleaned handle value: "${cleanHandleValue}"`);
        console.log(`🔍 Leaderboard data length: ${leaderboardData ? leaderboardData.length : 'NULL'}`);
        
        // Always proceed with new search - don't redirect to existing entries
        // User doesn't exist or exists - get Instagram full name and start search automatically
        console.log(`🔍 Starting new search for ${cleanHandleValue}...`);
        console.log(`🔍 About to call getInstagramFullName...`);
        let fullName = null;
        let nameExtractionError = null;
        try {
            console.log(`📞 Calling getInstagramFullName for: ${cleanHandleValue}`);
            console.log(`📞 getInstagramFullName function type:`, typeof getInstagramFullName);
            fullName = await getInstagramFullName(cleanHandleValue);
            console.log(`📋 getInstagramFullName returned: ${fullName || 'null'}`);
            console.log(`📋 Return type:`, typeof fullName);
        } catch (nameError) {
            console.error('❌ Error extracting Instagram name:', nameError);
            console.error('Error stack:', nameError.stack);
            nameExtractionError = nameError;
            // If it's a timeout, show user feedback
                if (nameError.message && nameError.message.includes('timeout')) {
                    // Re-enable button
                    searchBtn.disabled = false;
                    searchBtn.textContent = 'Search';
                    searchInProgress = false;
                    alert('Instagram request timed out. This can happen if Instagram is slow or blocking requests. Please try again in a moment, or search by name directly using the link below.');
                    return;
                }
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
                searchInProgress = false;
            } else if (firstName && !lastName && fullName) {
                // Handle single-word names (e.g., "Naval", "Madonna")
                // Use the first name as both first and last name for the search
                console.log(`⚠️ Single-word name detected: "${firstName}". Using as both first and last name.`);
                searchBtn.disabled = false;
                searchBtn.textContent = 'Search';
                
                // Use firstName as both first and last name
                await startMissingMoneySearch(firstName, firstName, cleanHandleValue);
                searchInProgress = false;
            } else {
                console.log('⚠️ Could not extract name from Instagram');
                console.log('⚠️ Attempted extraction but got:', { fullName, firstName, lastName });
                
                // If extraction completely failed, show helpful error
                if (!fullName) {
                    console.error('❌ Instagram name extraction failed completely');
                    searchBtn.disabled = false;
                    searchBtn.textContent = 'Search';
                    searchInProgress = false;
                    
                    // Show error if it was a timeout
                    if (nameExtractionError && nameExtractionError.message && nameExtractionError.message.includes('timeout')) {
                        alert('Instagram request timed out. This can happen if Instagram is slow or blocking requests. Please try again in a moment, or search by name directly using the link below.');
                        return;
                    }
                    
                    // For other errors, show a helpful message with more details
                    const errorDetails = nameExtractionError ? ` Error: ${nameExtractionError.message}` : '';
                    alert(`Unable to extract name from Instagram profile.${errorDetails}\n\nThis can happen if:\n- The profile is private\n- The profile doesn't exist\n- Instagram is blocking requests\n\nPlease try searching by name directly using the "Search by Full Name instead" link below.`);
                    return;
                }
                
                // If we have a fullName but couldn't split it properly, try to use it anyway
                // This handles cases where extraction worked but splitting failed
                if (fullName && (!firstName || !lastName)) {
                    console.log('⚠️ Got fullName but couldn\'t split properly, trying to use fullName directly');
                    // Try to split the fullName one more time
                    const nameParts = fullName.trim().split(/\s+/);
                    if (nameParts.length >= 2) {
                        firstName = nameParts[0];
                        lastName = nameParts.slice(1).join(' ');
                        console.log(`✅ Using split name: "${firstName} ${lastName}"`);
                        searchBtn.disabled = false;
                        searchBtn.textContent = 'Search';
                        await startMissingMoneySearch(firstName, lastName, cleanHandleValue);
                        searchInProgress = false;
                        return;
                    } else if (nameParts.length === 1) {
                        // Single word name - use as both first and last
                        firstName = nameParts[0];
                        console.log(`✅ Using single-word name as both first and last: "${firstName}"`);
                        searchBtn.disabled = false;
                        searchBtn.textContent = 'Search';
                        await startMissingMoneySearch(firstName, firstName, cleanHandleValue);
                        searchInProgress = false;
                        return;
                    }
                }
                
                // If we still don't have a name, silently fail
                console.log('⚠️ Instagram name extraction failed - not using unreliable fallback methods');
                searchBtn.disabled = false;
                searchBtn.textContent = 'Search';
                searchInProgress = false;
                // Don't show alert - user can try manual search if needed
                return;
            }
    } catch (error) {
        console.error('❌ Error in handleSearch:', error);
        console.error('Error stack:', error.stack);
        
        // Ensure button is always re-enabled
        try {
            searchBtn.disabled = false;
            searchBtn.textContent = 'Search';
        } catch (btnError) {
            console.error('Error re-enabling button:', btnError);
        }
        
        // Show user-friendly error message
        if (error.message && error.message.includes('timeout')) {
            alert('Request timed out. Instagram may be slow or blocking requests. Please try again in a moment.');
        } else {
            alert('An error occurred while searching. Please try again.');
        }
    }
}
console.log('✅✅✅✅✅ handleSearchImpl FUNCTION DEFINITION COMPLETE');

// CRITICAL: Export handleSearchImpl to window.handleSearch IMMEDIATELY after function definition
// This replaces the placeholder with the real function as soon as script loads
// CRITICAL FIX: Using handleSearchImpl name prevents identifier resolution conflicts
// handleSearchImpl can NEVER resolve to window.handleSearch (placeholder)
console.log('🔍🔍🔍 EXPORT BLOCK STARTING');
console.log('✅✅✅✅✅ REACHED EXPORT BLOCK - FUNCTION SHOULD BE DEFINED');
console.log('🔍 About to export handleSearchImpl - function exists:', typeof handleSearchImpl);
console.log('🔍 About to export handleSearchImpl - window exists:', typeof window !== 'undefined');
console.log('🔍 Current window.handleSearch type:', typeof window.handleSearch);
if (typeof window.handleSearch === 'function') {
    const currentStr = window.handleSearch.toString();
    console.log('🔍 Current window.handleSearch is placeholder:', currentStr.includes('PLACEHOLDER'));
}

// CRITICAL FIX: Export the function using its actual name (handleSearchImpl)
// This avoids identifier resolution conflicts - handleSearchImpl can never resolve to window.handleSearch
try {
    if (typeof window !== 'undefined' && typeof handleSearchImpl === 'function') {
        // Verify it's the real function (contains 'STARTING SEARCH')
        const funcStr = handleSearchImpl.toString();
        if (!funcStr.includes('STARTING SEARCH')) {
            console.error('❌❌❌ CRITICAL: handleSearchImpl is not the real function!');
            console.error('❌ Function string:', funcStr.substring(0, 200));
            throw new Error('handleSearchImpl is not the real function');
        }
        
        console.log('✅✅✅ Found handleSearchImpl - verified it contains STARTING SEARCH');
        console.log('🔍 Setting _realHandleSearch...');
        _realHandleSearch = handleSearchImpl;
        console.log('✅ _realHandleSearch set to REAL function');
        
        console.log('🔍 Replacing window.handleSearch...');
        const oldHandleSearch = window.handleSearch;
        const oldIsPlaceholder = oldHandleSearch ? oldHandleSearch.toString().includes('PLACEHOLDER') : false;
        console.log('🔍 Old function was placeholder:', oldIsPlaceholder);
        
        // DIRECT ASSIGNMENT - export handleSearchImpl to window.handleSearch
        window.handleSearch = handleSearchImpl;
        
        console.log('✅✅✅ window.handleSearch = handleSearchImpl executed');
        console.log('✅✅✅ New window.handleSearch type:', typeof window.handleSearch);
        
        // Immediate verification
        const newFuncStr = window.handleSearch.toString();
        const newIsPlaceholder = newFuncStr.includes('PLACEHOLDER');
        const hasStartingSearch = newFuncStr.includes('STARTING SEARCH');
        console.log('✅✅✅ New function is placeholder:', newIsPlaceholder);
        console.log('✅✅✅ New function has STARTING SEARCH:', hasStartingSearch);
        
        if (newIsPlaceholder || !hasStartingSearch) {
            console.error('❌❌❌ CRITICAL: Export FAILED - still placeholder!');
            console.error('❌ Function string:', newFuncStr.substring(0, 300));
            // Try again with Object.defineProperty
            console.log('🔄 Trying Object.defineProperty...');
            try {
                Object.defineProperty(window, 'handleSearch', {
                    value: handleSearchImpl,
                    writable: true,
                    enumerable: true,
                    configurable: true
                });
                const verifyStr = window.handleSearch.toString();
                console.log('✅✅✅ After defineProperty, is placeholder:', verifyStr.includes('PLACEHOLDER'));
                console.log('✅✅✅ After defineProperty, has STARTING SEARCH:', verifyStr.includes('STARTING SEARCH'));
            } catch (e) {
                console.error('❌ defineProperty failed:', e);
            }
        } else {
            console.log('✅✅✅✅✅ EXPORT SUCCESSFUL - Real function is in window.handleSearch');
            // Lock it in with defineProperty to prevent overwriting
            try {
                Object.defineProperty(window, 'handleSearch', {
                    value: handleSearchImpl,
                    writable: false,  // Make it read-only to prevent overwriting
                    enumerable: true,
                    configurable: false
                });
                console.log('✅✅✅ Locked window.handleSearch to prevent overwriting');
            } catch (e) {
                console.log('⚠️ Could not lock handleSearch (non-critical):', e.message);
            }
        }
    } else {
        console.error('❌❌❌ CRITICAL: window or handleSearchImpl not available!');
        console.error('❌ window:', typeof window);
        console.error('❌ handleSearchImpl:', typeof handleSearchImpl);
    }
} catch (e) {
    console.error('❌❌❌ CRITICAL ERROR in export:', e);
    console.error('Error stack:', e.stack);
    // Last resort - try to set it anyway using handleSearchImpl
    try {
        if (typeof handleSearchImpl === 'function') {
            const funcStr = handleSearchImpl.toString();
            if (funcStr.includes('STARTING SEARCH')) {
                window.handleSearch = handleSearchImpl;
                console.log('🔄 Last resort assignment attempted with handleSearchImpl');
            } else {
                console.error('❌ handleSearchImpl is not the real function in catch block');
            }
        } else {
            console.error('❌ handleSearchImpl not available in catch block');
        }
    } catch (e2) {
        console.error('❌ Even last resort failed:', e2);
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
    
    // Store data in data attributes for safer access
    // First stringify, then escape quotes for HTML attribute
    const entitiesJson = JSON.stringify(entities || []);
    
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
            <div class="claim-button-container" style="margin-bottom: 30px; text-align: center;">
                <button class="btn btn-claim-funds" 
                        data-name="${escapeHtml(name).replace(/"/g, '&quot;')}" 
                        data-amount="${amount}" 
                        data-entities="${entitiesJson.replace(/"/g, '&quot;')}"
                        onclick="handleClaimYourFundsFromView(this)" 
                        style="width: 100%; max-width: 400px; padding: 16px; font-size: 1.2rem; font-weight: 600; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 8px; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);">
                    Claim Your Funds
                </button>
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

// Handle Claim Your Funds button from view modal
function handleClaimYourFundsFromView(button) {
    // Get data from button's data attributes
    const name = button.getAttribute('data-name') || '';
    const amount = parseFloat(button.getAttribute('data-amount')) || 0;
    let entitiesJson = button.getAttribute('data-entities') || '[]';
    
    // Unescape HTML entities (convert &quot; back to ")
    entitiesJson = entitiesJson.replace(/&quot;/g, '"');
    
    let entities = [];
    try {
        entities = JSON.parse(entitiesJson);
        console.log('✅ Parsed entities from button:', entities);
        console.log('✅ Entities count:', entities.length);
    } catch (e) {
        console.error('❌ Error parsing entities:', e);
        console.error('❌ Raw entitiesJson:', entitiesJson);
        entities = [];
    }
    
    // Close the view modal first
    closeViewModal();
    
    // Split name into firstName and lastName
    // Handle cases with middle names, multiple spaces, etc.
    const nameParts = name.trim().split(/\s+/);
    let firstName = nameParts[0] || '';
    let lastName = nameParts.slice(1).join(' ') || '';
    
    // If no last name, use first name as both (fallback)
    if (!lastName) {
        lastName = firstName;
    }
    
    // Convert entities array to results format if needed
    const results = Array.isArray(entities) && entities.length > 0 ? entities.map(entity => ({
        entity: entity.entity || entity.business || 'Unknown Business',
        amount: entity.amount || '$0'
    })) : [];
    
    console.log('📊 Converted results for share modal:', results);
    console.log('📊 Results count:', results.length);
    
    // Show the Instagram instruction modal
    showShareModal(firstName, lastName, amount, results);
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
    
    // Basic validation - only check for empty or obviously invalid values
    if (!firstName || !lastName || firstName.trim().length === 0 || lastName.trim().length === 0) {
        console.error('❌ Invalid name extracted:', { firstName, lastName });
        alert(`Unable to extract a valid name from Instagram profile @${handle}. Please try searching by name instead using the link below.`);
        return;
    }
    
    // Only reject if the name is exactly "Login" or "Instagram" (not if it contains those words)
    const fullName = `${firstName} ${lastName}`.trim();
    if (fullName === 'Login' || fullName === 'Instagram' || fullName === 'Login • Instagram') {
        console.error('❌ Invalid name extracted (login page):', { firstName, lastName, fullName });
        alert(`Unable to extract a valid name from Instagram profile @${handle}. Please try searching by name instead using the link below.`);
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
    
    // Check localStorage cache first
    const cachedResult = loadMissingMoneyResultsFromStorage(claimData.firstName, claimData.lastName);
    if (cachedResult) {
        console.log('✅ Using cached MissingMoney results');
        hideProgressModal();
        
        // Process cached result same as fresh result
        if (cachedResult.success && cachedResult.results && cachedResult.results.length > 0) {
            console.log('✅ Showing cached results modal with', cachedResult.results.length, 'results');
            await addToLeaderboard(claimData.firstName + ' ' + claimData.lastName, claimData.name || (claimData.firstName + claimData.lastName).toLowerCase().replace(/\s+/g, ''), cachedResult.totalAmount, false, true, cachedResult.results || []);
            showResultsModal(claimData, cachedResult);
        } else if (cachedResult.success) {
            console.log('✅ Cached search completed successfully but no results found');
            await addToLeaderboard(claimData.firstName + ' ' + claimData.lastName, claimData.name || (claimData.firstName + claimData.lastName).toLowerCase().replace(/\s+/g, ''), 0, false, true, []);
            showNoResultsModal(claimData);
        } else {
            showErrorModal(cachedResult.error || 'Search failed');
        }
        return;
    }
    
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
        
        // Cache the result for future use
        saveMissingMoneyResultsToStorage(claimData.firstName, claimData.lastName, result);
        
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

// Handle notify button - show shareable version of view modal
function handleNotify(name, handle, amount) {
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
    
    // Create shareable URL
    const shareableUrl = `${window.location.origin}${window.location.pathname}?share=${encodeURIComponent(handle)}`;
    
    // Store data in data attributes for safer access
    // First stringify, then escape quotes for HTML attribute
    const entitiesJson = JSON.stringify(entities || []);
    
    // Create shareable view modal HTML
    let shareableHTML = `
        <div class="modal-header">
            <h2>Share: ${escapeHtml(name)}'s Unclaimed Funds</h2>
            <button class="modal-close" onclick="closeShareableViewModal()">&times;</button>
        </div>
        <div class="results-content" style="padding: 30px;">
            <div class="results-summary" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 20px; color: white; margin-bottom: 30px; text-align: center;">
                <p class="results-name" style="font-size: 1.5rem; font-weight: 700; margin: 0 0 8px 0;">${escapeHtml(name)}</p>
                <div class="total-amount" style="display: flex; flex-direction: column; align-items: center; gap: 8px; padding-top: 20px; border-top: 2px solid rgba(255, 255, 255, 0.3);">
                    <span class="total-label" style="font-size: 0.9rem; opacity: 0.9;">Total Unclaimed:</span>
                    <span class="total-value" style="font-size: 2.5rem; font-weight: 700;">$${amount.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                </div>
            </div>
            <div class="claim-button-container" style="margin-bottom: 30px; text-align: center;">
                <button class="btn btn-claim-funds" 
                        data-name="${escapeHtml(name).replace(/"/g, '&quot;')}" 
                        data-amount="${amount}" 
                        data-entities="${entitiesJson.replace(/"/g, '&quot;')}"
                        onclick="handleClaimYourFundsFromView(this)" 
                        style="width: 100%; max-width: 400px; padding: 16px; font-size: 1.2rem; font-weight: 600; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 8px; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);">
                    Claim Your Funds
                </button>
            </div>
            <div class="share-actions-container" style="margin-bottom: 30px; padding-bottom: 30px; border-bottom: 2px solid #e0e0e0;">
                <h3 style="margin: 0 0 20px 0; color: #333; font-size: 1.1rem; text-align: center;">Share This Discovery</h3>
                <div style="display: flex; flex-direction: column; gap: 12px; align-items: center;">
                    <button class="btn btn-copy-link" onclick="copyShareableLink('${shareableUrl.replace(/'/g, "\\'")}')" style="width: 100%; max-width: 400px; padding: 14px; font-size: 1.1rem; font-weight: 600; background: white; color: #667eea; border: 2px solid #667eea; border-radius: 8px; cursor: pointer; transition: all 0.2s;">
                        📋 Copy Shareable Link
                    </button>
                    <button class="btn btn-share-twitter" onclick="shareToTwitter('${escapeHtml(name).replace(/'/g, "\\'")}', ${amount}, '${shareableUrl.replace(/'/g, "\\'")}')" style="width: 100%; max-width: 400px; padding: 14px; font-size: 1.1rem; font-weight: 600; background: #1DA1F2; color: white; border: none; border-radius: 8px; cursor: pointer; transition: all 0.2s;">
                        🐦 Share on Twitter
                    </button>
                    <button class="btn btn-share-facebook" onclick="shareToFacebook('${shareableUrl.replace(/'/g, "\\'")}')" style="width: 100%; max-width: 400px; padding: 14px; font-size: 1.1rem; font-weight: 600; background: #1877F2; color: white; border: none; border-radius: 8px; cursor: pointer; transition: all 0.2s;">
                        📘 Share on Facebook
                    </button>
                    <button class="btn btn-share-whatsapp" onclick="shareToWhatsApp('${escapeHtml(name).replace(/'/g, "\\'")}', ${amount}, '${shareableUrl.replace(/'/g, "\\'")}')" style="width: 100%; max-width: 400px; padding: 14px; font-size: 1.1rem; font-weight: 600; background: #25D366; color: white; border: none; border-radius: 8px; cursor: pointer; transition: all 0.2s;">
                        💬 Share on WhatsApp
                    </button>
                    <p style="text-align: center; color: #666; font-size: 0.85rem; margin-top: 10px; line-height: 1.5;">
                        Help ${escapeHtml(name)} discover unclaimed funds! Share this link so they can claim what's theirs.
                    </p>
                </div>
            </div>
            <div class="results-list">
                <h3 style="margin: 0 0 20px 0; color: #333; font-size: 1.2rem;">Reported Businesses:</h3>
    `;
    
    if (entities && entities.length > 0) {
        entities.forEach((entity, index) => {
            shareableHTML += `
                <div class="result-item" style="display: flex; justify-content: space-between; align-items: center; padding: 16px; background: #f8f9fa; border-radius: 8px; margin-bottom: 12px; transition: all 0.2s;">
                    <div class="result-entity" style="font-weight: 600; color: #333; flex: 1;">${escapeHtml(entity.entity || 'Unknown Business')}</div>
                    <div class="result-amount" style="font-size: 1.3rem; font-weight: 700; color: #667eea;">${escapeHtml(entity.amount || '$0')}</div>
                </div>
            `;
        });
    } else {
        shareableHTML += `
            <div style="padding: 40px; text-align: center; color: #666;">
                <p>No detailed business information available for this entry.</p>
                <p style="font-size: 0.9rem; margin-top: 10px; color: #999;">Total amount: $${amount.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
            </div>
        `;
    }
    
    shareableHTML += `
            </div>
        </div>
    `;
    
    modalContent.innerHTML = shareableHTML;
    modal.classList.remove('hidden');
}

// Close shareable view modal
function closeShareableViewModal() {
    const modal = document.getElementById('claimModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

// Handle share parameter from URL - open shareable modal automatically
async function handleNotifyFromUrl(handle) {
    // Wait for leaderboard to load if needed
    if (leaderboardData.length === 0) {
        await loadLeaderboard();
    }
    
    // Find the user entry
    const cleanUserHandle = cleanHandle(handle);
    const userEntry = leaderboardData.find(entry => cleanHandle(entry.handle) === cleanUserHandle);
    
    if (userEntry) {
        // Open the shareable view modal
        handleNotify(userEntry.name, userEntry.handle, userEntry.amount);
    } else {
        console.log('User not found in leaderboard for handle:', handle);
    }
}

// Copy shareable link to clipboard
function copyShareableLink(url) {
    navigator.clipboard.writeText(url).then(() => {
        // Show success feedback
        const button = document.querySelector('.btn-copy-link');
        if (button) {
            const originalText = button.innerHTML;
            button.innerHTML = '✅ Link Copied!';
            button.style.background = '#28a745';
            button.style.color = 'white';
            setTimeout(() => {
                button.innerHTML = originalText;
                button.style.background = 'white';
                button.style.color = '#667eea';
            }, 2000);
        } else {
            alert('Link copied to clipboard!');
        }
    }).catch(err => {
        console.error('Failed to copy link:', err);
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = url;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            alert('Link copied to clipboard!');
        } catch (e) {
            alert('Failed to copy link. Please copy manually: ' + url);
        }
        document.body.removeChild(textArea);
    });
}

// Share to Twitter
function shareToTwitter(name, amount, url) {
    const text = encodeURIComponent(`${name} has $${amount.toLocaleString()} in unclaimed funds! Help them claim it: ${url}`);
    window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank', 'width=550,height=420');
}

// Share to Facebook
function shareToFacebook(url) {
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank', 'width=550,height=420');
}

// Share to WhatsApp
function shareToWhatsApp(name, amount, url) {
    const text = encodeURIComponent(`${name} has $${amount.toLocaleString()} in unclaimed funds! Help them claim it: ${url}`);
    window.open(`https://wa.me/?text=${text}`, '_blank');
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
    
    // Ensure handleSearch is available
    if (typeof handleSearch !== 'function') {
        console.error('❌ CRITICAL: handleSearch function not available!');
        alert('Error: Search function not loaded. Please refresh the page.');
        return;
    }
    
    // Don't add duplicate listener - inline onclick handler already handles clicks
    // The inline onclick is sufficient and prevents duplicate calls
    console.log('✅ Search button found - using inline onclick handler (no duplicate listener needed)');
    
    if (searchInput) {
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                console.log('⌨️ Enter key pressed in search input');
                e.preventDefault();
                e.stopPropagation();
                // Use window.handleSearch to ensure we get the exported version
                if (typeof window.handleSearch === 'function') {
                    const funcStr = window.handleSearch.toString();
                    if (funcStr.includes('PLACEHOLDER')) {
                        console.error('❌❌❌ Placeholder still active in keypress handler!');
                        // Try to force export
                        if (typeof _realHandleSearch === 'function' && !_realHandleSearch.toString().includes('PLACEHOLDER')) {
                            window.handleSearch = _realHandleSearch;
                            console.log('🔄 Force exported from _realHandleSearch in keypress handler');
                        } else if (typeof handleSearchImpl === 'function') {
                            window.handleSearch = handleSearchImpl;
                            console.log('🔄 Force exported from handleSearchImpl in keypress handler');
                        }
                    }
                    console.log('✅ Calling window.handleSearch');
                    window.handleSearch();
                } else if (typeof handleSearch === 'function') {
                    console.log('✅ Falling back to local handleSearch');
                    handleSearch();
                } else {
                    console.error('❌ handleSearch not available in keypress handler!');
                    alert('Error: Search function not available. Please refresh the page.');
                }
            }
        });
        console.log('✅ Keypress listener attached to search input');
    }
    
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
                <div style="background: #fff; border: 2px solid #667eea; border-radius: 12px; padding: 20px; margin-bottom: 20px; text-align: center;">
                    <p style="margin: 0 0 15px 0; color: #333; font-size: 1rem; font-weight: 500;">OR skip notifying others and pay $12.95 processing to begin the claim process now</p>
                    <button class="btn-buy-now" onclick="handleBuyNow('${escapeHtml(firstName)}', '${escapeHtml(lastName)}', ${amount})" style="width: 100%; padding: 14px; font-size: 1.1rem; font-weight: 600; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 8px; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);">
                        Buy Now - $12.95
                    </button>
                </div>
            <div class="share-card" id="shareCard" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 16px; padding: 40px; color: white; text-align: center; max-width: 500px; margin: 0 auto; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3); min-height: 400px; display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                    <p style="font-size: 1.2rem; opacity: 0.95; margin-bottom: 16px; font-weight: 600; color: white;">Rank #${userRank} on Leaderboard</p>
                    <h2 style="font-size: 2.5rem; font-weight: 700; margin: 0 0 8px 0; color: white;">${escapeHtml(firstName)} ${escapeHtml(lastName)}</h2>
                </div>
                <div style="margin-top: 20px; padding-top: 20px; border-top: 2px solid rgba(255, 255, 255, 0.3);">
                    <p style="font-size: 1rem; opacity: 0.95; margin-bottom: 12px; font-weight: 500;">Total Claimed:</p>
                    <p style="font-size: 3rem; font-weight: 700; margin: 0 0 20px 0; color: white;">$${amount.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                    <div style="margin-top: 20px; padding-top: 20px; border-top: 2px solid rgba(255, 255, 255, 0.3); max-height: 200px; overflow-y: auto;">
                        <p style="font-size: 0.9rem; opacity: 0.9; margin-bottom: 12px; font-weight: 500;">Funds by Company:</p>
                        <div style="text-align: left; font-size: 0.85rem;">
                            ${results && results.length > 0 ? `
                                ${results.slice(0, 10).map(result => `
                                    <div style="display: flex; justify-content: space-between; margin-bottom: 8px; padding: 6px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                                        <span style="flex: 1; opacity: 0.95;">${escapeHtml(result.entity || 'Unknown')}</span>
                                        <span style="font-weight: 600; margin-left: 12px; white-space: nowrap;">${escapeHtml(result.amount || '$0')}</span>
                                    </div>
                                `).join('')}
                                ${results.length > 10 ? `<p style="font-size: 0.8rem; opacity: 0.8; margin-top: 8px; font-style: italic;">+ ${results.length - 10} more companies</p>` : ''}
                            ` : `
                                <p style="font-size: 0.85rem; opacity: 0.8; font-style: italic; text-align: center; padding: 10px 0;">No specific companies listed</p>
                            `}
                        </div>
                    </div>
                </div>
                <div style="margin-top: 20px; padding-top: 20px; border-top: 2px solid rgba(255, 255, 255, 0.3);">
                    <p style="font-size: 1.15rem; opacity: 0.95; margin: 0 0 16px 0; color: white; line-height: 1.5; font-weight: 500;">Companies<span style="display: inline-block; width: 8px; min-width: 8px; height: 1px; vertical-align: baseline;"></span>owe you money. Claim what's yours</p>
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
    
    // Ensure spaces are preserved in the card before rendering
    // Fix any collapsed spaces in the "Companies owe" text - use explicit pixel width
    const textElements = card.querySelectorAll('p');
    textElements.forEach(p => {
        if (p.innerHTML && p.innerHTML.includes('Companies')) {
            // Force a visible space using a span with explicit pixel width that html2canvas will definitely render
            let html = p.innerHTML;
            // Replace any variation (with space, without space, with &nbsp;, etc.) with explicit span
            html = html.replace(/Companies\s*owe/gi, 'Companies<span style="display: inline-block; width: 8px; min-width: 8px; height: 1px; vertical-align: baseline;"></span>owe');
            html = html.replace(/Companiesowe/gi, 'Companies<span style="display: inline-block; width: 8px; min-width: 8px; height: 1px; vertical-align: baseline;"></span>owe');
            // Also handle if there's already a span but it's not working
            html = html.replace(/Companies<span[^>]*><\/span>owe/gi, 'Companies<span style="display: inline-block; width: 8px; min-width: 8px; height: 1px; vertical-align: baseline;"></span>owe');
            p.innerHTML = html;
            console.log('Fixed Companies owe spacing in card:', p.innerHTML.substring(0, 100));
        }
    });
    
    // Use html2canvas library if available, or prompt user to screenshot
    if (typeof html2canvas !== 'undefined') {
        html2canvas(card, {
            backgroundColor: null,
            scale: 2,
            logging: false,
            useCORS: true,
            letterRendering: true
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
// CRITICAL: Export handleSearch to window immediately when script loads
// This ensures it's available for inline onclick handlers even if DOMContentLoaded hasn't fired
console.log('🔍🔍🔍 FINAL SAFETY CHECK STARTING');
if (typeof window !== 'undefined') {
    if (typeof handleSearchImpl === 'function') {
        const funcStr = handleSearchImpl.toString();
        if (funcStr.includes('STARTING SEARCH')) {
            console.log('🔍 Final check: handleSearchImpl is the real function, replacing window.handleSearch...');
        const beforeStr = window.handleSearch ? window.handleSearch.toString() : 'undefined';
        const beforeIsPlaceholder = beforeStr.includes('PLACEHOLDER');
        console.log('🔍 Before replacement - is placeholder:', beforeIsPlaceholder);
        
        window.handleSearch = handleSearchImpl;
        _realHandleSearch = handleSearchImpl;
        
        const afterStr = window.handleSearch.toString();
        const afterIsPlaceholder = afterStr.includes('PLACEHOLDER');
        console.log('✅✅✅ Final check: window.handleSearch replaced');
        console.log('✅✅✅ After replacement - is placeholder:', afterIsPlaceholder);
        
        if (afterIsPlaceholder) {
            console.error('❌❌❌ CRITICAL ERROR: Placeholder STILL active in final check!');
            console.error('❌ This means something is overwriting our export!');
            // Try one more time with force
            console.log('🔄🔄🔄 FORCING replacement one more time...');
            Object.defineProperty(window, 'handleSearch', {
                value: handleSearchImpl,
                writable: true,
                enumerable: true,
                configurable: true
            });
            const finalStr = window.handleSearch.toString();
            console.log('✅✅✅ After force - is placeholder:', finalStr.includes('PLACEHOLDER'));
        } else {
            console.log('✅✅✅✅✅ FINAL CHECK SUCCESS: Real function is exported');
        }
        } else {
            console.error('❌❌❌ Final check: handleSearchImpl is not the real function!');
        }
    } else if (typeof _realHandleSearch === 'function') {
        console.log('🔍 Final check: Using _realHandleSearch...');
        window.handleSearch = _realHandleSearch;
    } else {
        console.error('❌❌❌ CRITICAL: handleSearchImpl function not defined when trying to export!');
    }
} else {
    console.error('❌❌❌ CRITICAL: window is undefined in final check!');
}

// CRITICAL BACKUP: Also export on DOMContentLoaded in case script loaded before DOM
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    function forceExportIfNeeded() {
        if (typeof handleSearchImpl === 'function') {
            const funcStr = handleSearchImpl.toString();
            if (funcStr.includes('STARTING SEARCH')) {
                const currentStr = window.handleSearch ? window.handleSearch.toString() : '';
                if (currentStr.includes('PLACEHOLDER')) {
                    console.log('🔄🔄🔄 BACKUP: Replacing placeholder with real function');
                    window.handleSearch = handleSearchImpl;
                    _realHandleSearch = handleSearchImpl;
                    const verifyStr = window.handleSearch.toString();
                    console.log('✅✅✅ Backup export completed, is placeholder:', verifyStr.includes('PLACEHOLDER'));
                }
            }
        } else if (typeof _realHandleSearch === 'function') {
            const currentStr = window.handleSearch ? window.handleSearch.toString() : '';
            if (currentStr.includes('PLACEHOLDER')) {
                console.log('🔄🔄🔄 BACKUP: Using _realHandleSearch');
                window.handleSearch = _realHandleSearch;
            }
        }
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', forceExportIfNeeded);
    } else {
        // DOM already loaded, do it now
        forceExportIfNeeded();
    }
    
    // Also try after a short delay
    setTimeout(forceExportIfNeeded, 100);
    setTimeout(forceExportIfNeeded, 500);
}

window.handleClaim = handleClaim;
window.handleView = handleView;
window.closeViewModal = closeViewModal;
window.handleClaimYourFundsFromView = handleClaimYourFundsFromView;
window.handleNotify = handleNotify;
window.handleNotifyFromUrl = handleNotifyFromUrl;
window.closeShareableViewModal = closeShareableViewModal;
window.copyShareableLink = copyShareableLink;
window.shareToTwitter = shareToTwitter;
window.shareToFacebook = shareToFacebook;
window.shareToWhatsApp = shareToWhatsApp;
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

// Terms and Conditions Modal Functions
function showTermsModal() {
    const modal = document.getElementById('termsModal');
    if (modal) {
        modal.classList.remove('hidden');
        // Scroll to top of terms content
        const termsContent = modal.querySelector('.terms-content');
        if (termsContent) {
            termsContent.scrollTop = 0;
        }
    }
}

function closeTermsModal() {
    const modal = document.getElementById('termsModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

window.showTermsModal = showTermsModal;
window.closeTermsModal = closeTermsModal;

// Initialize Stripe - use environment variable or fallback to public key
// Note: Public key should be set via environment variable or injected at build time
const stripePublishableKey = window.STRIPE_PUBLISHABLE_KEY || 'pk_live_51Se2egIQyA54diWonr9yTd5aQImAqY4Mmp1tQPg3VJXMvfHLM8TxQGqlbNhDlG8MLSwEfqKdsIqS5HwZkbQppCXi00vBXKs9Qh';
let stripe = null;
try {
    stripe = Stripe(stripePublishableKey);
} catch (e) {
    console.error('Failed to initialize Stripe:', e);
}

// Handle Buy Now button click
async function handleBuyNow(firstName, lastName, amount) {
    console.log('Buy Now clicked:', { firstName, lastName, amount });
    
    // Get the button element
    const button = document.querySelector('.btn-buy-now');
    if (!button) {
        console.error('Buy Now button not found');
        return;
    }
    
    const originalText = button.textContent;
    
    try {
        // Disable button and show loading
        button.disabled = true;
        button.textContent = 'Processing...';
        
        // Create checkout session via backend
        const apiBase = window.location.origin;
        const response = await fetch(`${apiBase}/api/create-checkout-session`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                firstName: firstName,
                lastName: lastName,
                amount: amount,
                processingFee: 12.95
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Failed to create checkout session' }));
            throw new Error(errorData.error || 'Failed to create checkout session');
        }
        
        const session = await response.json();
        
        if (!stripe) {
            throw new Error('Stripe not initialized');
        }
        
        // Redirect to Stripe Checkout
        const result = await stripe.redirectToCheckout({
            sessionId: session.id
        });
        
        if (result.error) {
            throw new Error(result.error.message);
        }
    } catch (error) {
        console.error('Error processing payment:', error);
        alert('Error processing payment: ' + error.message);
        if (button) {
            button.disabled = false;
            button.textContent = originalText;
        }
    }
}

window.handleBuyNow = handleBuyNow;

