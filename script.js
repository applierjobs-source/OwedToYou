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
            if (realFuncStr.includes('searchInProgress')) {
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
    
    // Use backend Playwright API only (no HTML extraction fallback)
    try {
        const apiBase = window.location.origin;
        console.log(`🌐 Attempting backend Playwright API call to: ${apiBase}/api/instagram-name?username=${encodeURIComponent(cleanUsername)}`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            console.log('⏰ Backend API timeout after 30s, aborting...');
            controller.abort();
        }, 30000); // 30 second timeout (Playwright needs more time)
        
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
                console.log(`⚠️ Backend Playwright returned but no name found:`, errorMsg);
                // Return null - no fallback to HTML extraction
                return null;
            }
        } else {
            const errorText = await response.text().catch(() => '');
            console.log(`⚠️ Backend request failed with status: ${response.status}`);
            console.log(`⚠️ Error response: ${errorText.substring(0, 200)}`);
            // Return null - no fallback to HTML extraction
            return null;
        }
    } catch (e) {
        // Check if it's a timeout error
        if (e.name === 'AbortError' || e.message.includes('timeout') || e.message.includes('aborted')) {
            console.log('❌ Backend Playwright request timed out');
            throw new Error('Instagram request timed out. Please try again.');
        }
        console.log('❌ Backend Playwright server error:', e.message);
        // Return null - no fallback to HTML extraction
        return null;
    }
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
    // The name appears near the username in the HTML. Search broadly for any text that looks like a name.
    try {
        const usernameIndex = html.indexOf(cleanUsername);
        if (usernameIndex === -1) {
            console.log(`Username '${cleanUsername}' not found in HTML`);
        } else {
            console.log(`Found username at index ${usernameIndex}, searching for name...`);
            
            // Look in a large window around the username (100000 chars to catch entire profile section)
            const start = Math.max(0, usernameIndex - 50000);
            const end = Math.min(html.length, usernameIndex + 50000);
            const profileArea = html.substring(start, end);
            
            console.log(`Searching for name in profile area (${profileArea.length} chars around username, HTML total: ${html.length})...`);
            
            // Strategy 1: Find all text content between HTML tags near username
            // Look for patterns like: >Name< or >Name Text< that appear before/after username
            // Extract text from all HTML elements and check if any look like names
            // Use a more permissive pattern that matches any text between tags
            const textContentPattern = />([^<>]+)</g;
            const allTextMatches = [...profileArea.matchAll(textContentPattern)];
            console.log(`Found ${allTextMatches.length} text content matches in profile area`);
            
            // Log first 20 matches for debugging
            if (allTextMatches.length > 0) {
                console.log(`First 20 text matches:`);
                for (let i = 0; i < Math.min(20, allTextMatches.length); i++) {
                    const text = allTextMatches[i][1].trim().substring(0, 50);
                    console.log(`  ${i + 1}: "${text}"`);
                }
            }
            
            // Collect potential names (2-4 words, alphabetic only)
            const potentialNames = [];
            for (const match of allTextMatches) {
                if (match && match[1]) {
                    let text = match[1].trim();
                    // Clean HTML entities
                    text = text.replace(/&[^;]+;/g, '').trim();
                    
                    // Skip if it's clearly not a name
                    if (text.length < 3 || text.length > 60) continue;
                    if (text === cleanUsername) continue;
                    if (text.startsWith('@')) continue;
                    if (/^\d+$/.test(text)) continue; // Skip pure numbers
                    if (text.includes('•') || text.includes('|')) continue; // Skip separators
                    
                    const lowerText = text.toLowerCase();
                    if (lowerText.includes('instagram') ||
                        lowerText.includes('login') ||
                        lowerText.includes('follow') ||
                        lowerText.includes('posts') ||
                        lowerText.includes('followers') ||
                        lowerText.includes('following') ||
                        lowerText.includes('edit profile') ||
                        lowerText.includes('message') ||
                        lowerText.includes('view') ||
                        lowerText.includes('share')) {
                        continue;
                    }
                    
                    // Check if it looks like a name (2-4 words, all alphabetic, reasonable length)
                    const words = text.split(/\s+/);
                    if (words.length >= 2 && words.length <= 4) {
                        const isValid = words.every(word => 
                            word.length >= 2 && word.length <= 20 && /^[A-Za-z]+$/.test(word)
                        );
                        
                        if (isValid) {
                            potentialNames.push({
                                name: text,
                                index: match.index,
                                distance: Math.abs(match.index - (usernameIndex - start))
                            });
                        }
                    }
                }
            }
            
            console.log(`Found ${potentialNames.length} potential names near username`);
            
            // Sort by distance from username (closer is better)
            potentialNames.sort((a, b) => a.distance - b.distance);
            
            // Log first 20 potential names for debugging
            for (let i = 0; i < Math.min(20, potentialNames.length); i++) {
                console.log(`  Potential name ${i + 1}: "${potentialNames[i].name}" (distance: ${potentialNames[i].distance})`);
            }
            
            // Return the closest valid name to username (within reasonable distance)
            if (potentialNames.length > 0) {
                // Prefer names that are close to username (within 10000 chars)
                const closeNames = potentialNames.filter(n => n.distance < 10000);
                if (closeNames.length > 0) {
                    const bestMatch = closeNames[0];
                    console.log(`✅ Found Instagram name (closest to username, distance ${bestMatch.distance}): ${bestMatch.name}`);
                    return bestMatch.name;
                }
                // If no close names, use the closest one anyway
                const bestMatch = potentialNames[0];
                console.log(`✅ Found Instagram name (closest overall, distance ${bestMatch.distance}): ${bestMatch.name}`);
                return bestMatch.name;
            }
            
            // Strategy 2: Try span patterns (more specific but might work)
            const spanPatterns = [
                /<span[^>]*class="[^"]*x[a-z0-9]+[^"]*"[^>]*dir="auto"[^>]*>([^<]+)<\/span>/gi,
                /<span[^>]*class="[^"]*x[a-z0-9]+[^"]*"[^>]*>([^<]+)<\/span>/gi,
                /<span[^>]*>([^<]+)<\/span>/gi
            ];
            
            for (let i = 0; i < spanPatterns.length; i++) {
                const pattern = spanPatterns[i];
                const matches = [...profileArea.matchAll(pattern)];
                console.log(`Span pattern ${i + 1} found ${matches.length} matches`);
                
                if (matches.length > 0) {
                    for (let j = 0; j < Math.min(5, matches.length); j++) {
                        const match = matches[j];
                        if (match && match[1]) {
                            const text = match[1].trim().substring(0, 50);
                            console.log(`  Span match ${j + 1}: "${text}"`);
                        }
                    }
                }
                
                for (const match of matches) {
                    if (match && match[1]) {
                        let name = match[1].trim();
                        name = name.replace(/&[^;]+;/g, '').trim();
                        
                        if (name && name.length > 0 && name !== cleanUsername && !name.startsWith('@')) {
                            console.log(`✅ Found Instagram name from span element (pattern ${i + 1}): ${name}`);
                            return name;
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.log(`❌ Error in header area extraction: ${e.message}`);
        console.log(`❌ Error stack: ${e.stack}`);
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
        
        // Try multiple patterns - Instagram might use different quote styles or formats
        const fullNamePatterns = [
            /"full_name"\s*:\s*"([^"]+)"/gi,  // Standard JSON: "full_name":"Name"
            /'full_name'\s*:\s*'([^']+)'/gi,  // Single quotes: 'full_name':'Name'
            /"full_name"\s*:\s*'([^']+)'/gi,  // Mixed: "full_name":'Name'
            /'full_name'\s*:\s*"([^"]+)"/gi,  // Mixed: 'full_name':"Name"
            /full_name\s*:\s*"([^"]+)"/gi,    // No quotes on key: full_name:"Name"
            /full_name\s*:\s*'([^']+)'/gi,    // No quotes on key: full_name:'Name'
            /full_name\s*:\s*([^,}\]]+)/gi    // Unquoted value: full_name:Name
        ];
        
        // First, try to find full_name near the username (most reliable)
        const usernameIndex = html.indexOf(cleanUsername);
        if (usernameIndex !== -1) {
            // Look in a large window around username
            const start = Math.max(0, usernameIndex - 30000);
            const end = Math.min(html.length, usernameIndex + 30000);
            const searchArea = html.substring(start, end);
            
            // Try each pattern
            for (const pattern of fullNamePatterns) {
                const matches = [...searchArea.matchAll(pattern)];
                console.log(`Pattern ${pattern.source.substring(0, 30)}... found ${matches.length} matches near username`);
                
                // Try each match, prefer ones closer to username
                let bestName = null;
                let bestDistance = Infinity;
                
                for (const match of matches) {
                    if (match && match[1]) {
                        let name = match[1].trim();
                        // Clean up any trailing characters
                        name = name.replace(/["'\s,}\]]+$/, '').trim();
                        
                        // Validate it's a real name
                        if (name && name.length > 2 && name.length < 100 &&
                            !name.startsWith('@') && 
                            name !== cleanUsername && 
                            !name.toLowerCase().includes('instagram') &&
                            !name.toLowerCase().includes('null') &&
                            !name.toLowerCase().includes('undefined') &&
                            /[a-zA-Z]/.test(name)) {
                            
                            // Calculate distance from username
                            const nameIndex = searchArea.indexOf(match[0]);
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
                    console.log(`Found Instagram name via full_name search (distance: ${bestDistance}): ${bestName}`);
                    return bestName;
                }
            }
        }
        
        // If not found near username, search entire HTML with all patterns
        for (const pattern of fullNamePatterns) {
            const allMatches = [...html.matchAll(pattern)];
            console.log(`Pattern ${pattern.source.substring(0, 30)}... found ${allMatches.length} total matches in HTML`);
            
            for (const match of allMatches) {
                if (match && match[1]) {
                    let name = match[1].trim();
                    name = name.replace(/["'\s,}\]]+$/, '').trim();
                    
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
    console.log(`[PROFILE PIC] Fetching profile picture for: ${cleanUsername}`);
    
    // Try local backend server first (if available)
    try {
        const controller = new AbortController();
        // Increased timeout to 30 seconds for Playwright operations
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        
        const apiBase = window.location.origin;
        console.log(`[PROFILE PIC] Calling backend API: ${apiBase}/api/profile-pic?username=${encodeURIComponent(cleanUsername)}`);
        
        const response = await fetch(`${apiBase}/api/profile-pic?username=${encodeURIComponent(cleanUsername)}`, {
            method: 'GET',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        console.log(`[PROFILE PIC] Backend API response status: ${response.status}`);
        
        if (response.ok) {
            const data = await response.json();
            console.log(`[PROFILE PIC] ✅✅✅ Backend API response data for ${cleanUsername}:`, data);
            console.log(`[PROFILE PIC] Response success:`, data.success);
            console.log(`[PROFILE PIC] Response URL:`, data.url ? data.url.substring(0, 100) + '...' : 'NO URL');
            if (data.success && data.url) {
                console.log(`[PROFILE PIC] ✅✅✅✅✅ Found profile picture via backend: ${data.url.substring(0, 100)}...`);
                return data.url;
            } else {
                console.log(`[PROFILE PIC] ❌❌❌ Backend returned success=false or no URL for ${cleanUsername}:`, data);
                console.log(`[PROFILE PIC] Error message:`, data.error || 'No error message');
            }
        } else {
            const errorText = await response.text().catch(() => '');
            console.error(`[PROFILE PIC] ❌❌❌ Backend API error (${response.status}) for ${cleanUsername}:`, errorText);
        }
    } catch (e) {
        // Backend not available or error, continue with browser methods
        console.error(`[PROFILE PIC] ❌ Backend server error:`, e.message);
        console.error(`[PROFILE PIC] Error stack:`, e.stack);
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
                // Don't use cached failed searches - they might be temporary issues
                if (cached.result && !cached.result.success) {
                    console.log(`⚠️ Cached result for ${firstName} ${lastName} was a failed search, ignoring cache`);
                    delete parsed[key];
                    localStorage.setItem('missingMoneyResults', JSON.stringify(parsed));
                    return null;
                }
                
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
async function addToLeaderboard(name, handle, amount, isPlaceholder = false, refreshDisplay = false, entities = null, profilePic = null) {
    try {
        console.log(`📝 addToLeaderboard called with profilePic: ${profilePic ? 'provided' : 'not provided'}`);
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
            const cleanHandleValue = cleanHandle(handle);
            console.log(`[PROFILE PIC FLOW] addToLeaderboard: handle="${handle}", cleanHandleValue="${cleanHandleValue}", profilePic=${profilePic ? `SET (${profilePic.substring(0, 40)}...)` : 'NULL'}`);
            
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
                    // If this is the entry we just added and we have a profile pic, use it
                    let finalProfilePic = existingPic || null;
                    console.log(`[PROFILE PIC FLOW] Mapping entry: handle="${entry.handle}", cleanEntryHandle="${cleanEntryHandle}", cleanHandleValue="${cleanHandleValue}", match=${cleanEntryHandle === cleanHandleValue}, profilePic param=${profilePic ? 'SET' : 'NULL'}, existingPic=${existingPic ? 'SET' : 'NULL'}`);
                    
                    // Try multiple matching strategies
                    const handleMatches = (
                        cleanEntryHandle === cleanHandleValue ||
                        entry.handle === handle ||
                        cleanEntryHandle === cleanHandle(handle) ||
                        entry.handle === cleanHandleValue
                    );
                    
                    if (handleMatches && profilePic) {
                        finalProfilePic = profilePic;
                        console.log(`✅✅✅ Set profilePic for ${entry.handle} in leaderboardData (new entry): ${profilePic.substring(0, 50)}...`);
                    } else if (profilePic && !finalProfilePic) {
                        // If we have a profilePic but no match yet, also check localStorage as fallback
                        const storedProfilePics = loadProfilePicsFromStorage();
                        const storedPic = storedProfilePics[entry.handle] || storedProfilePics[cleanEntryHandle] || storedProfilePics[handle] || storedProfilePics[cleanHandleValue];
                        if (storedPic) {
                            finalProfilePic = storedPic;
                            console.log(`✅✅✅ Found profilePic in localStorage fallback for ${entry.handle}`);
                        }
                    }
                    
                    return {
                        ...entry,
                        profilePic: finalProfilePic,
                        isPlaceholder: false
                    };
                });
            
            // Also save profile pic to localStorage if provided
            if (profilePic) {
                const storedProfilePics = loadProfilePicsFromStorage();
                storedProfilePics[handle] = profilePic;
                storedProfilePics[cleanHandleValue] = profilePic;
                saveProfilePicsToStorage(storedProfilePics);
                console.log(`✅✅✅ Saved profilePic to localStorage for ${handle} (new entry): ${profilePic.substring(0, 50)}...`);
            }
            
            // Verify profilePic is set in leaderboardData
            const addedEntry = leaderboardData.find(e => cleanHandle(e.handle) === cleanHandleValue);
            if (addedEntry) {
                console.log(`✅✅✅ Verified entry in leaderboardData: handle=${addedEntry.handle}, profilePic=${addedEntry.profilePic ? addedEntry.profilePic.substring(0, 50) + '...' : 'MISSING'}`);
            } else {
                console.error(`❌❌❌ Entry NOT FOUND in leaderboardData for handle: ${handle}`);
            }
            
            // Only refresh display if explicitly requested (e.g., after a claim submission)
            if (refreshDisplay && !document.getElementById('leaderboard').classList.contains('hidden')) {
                console.log(`🔄 Refreshing leaderboard display with ${leaderboardData.length} entries`);
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
    
    // On mobile, add a small delay to let initial images load first
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Load profile pictures for all users in parallel
    const profilePicPromises = users.map(async (user, index) => {
        console.log(`[${index}] Processing profile picture for ${user.handle} (has profilePic: ${!!user.profilePic})`);
        // Skip if profile picture already exists
        if (user.profilePic) {
            console.log(`[${index}] Profile picture already exists for ${user.handle} (${user.profilePic.substring(0, 50)}...), skipping fetch`);
            // Still update the DOM in case it was cleared
            const cleanUserHandle = cleanHandle(user.handle);
            const entry = document.querySelector(`.leaderboard-entry[data-handle="${cleanUserHandle}"]`);
            if (entry) {
                const profilePictureDiv = entry.querySelector('.profile-picture');
                if (profilePictureDiv && !profilePictureDiv.querySelector('img')) {
                    const img = document.createElement('img');
                    // Use proxy endpoint to bypass CORS
                    const apiBase = window.location.origin;
                    img.src = `${apiBase}/api/profile-pic-proxy?url=${encodeURIComponent(user.profilePic)}`;
                    img.alt = user.name;
                    img.loading = 'eager'; // Force immediate loading on mobile
                    img.decoding = 'sync'; // Synchronous decoding for mobile
                    // CRITICAL: Mobile-optimized styles to ensure display
                    img.style.width = '100%';
                    img.style.height = '100%';
                    img.style.borderRadius = '50%';
                    img.style.objectFit = 'cover';
                    img.style.display = 'block';
                    img.style.visibility = 'visible';
                    img.style.opacity = '1';
                    img.style.position = 'absolute';
                    img.style.top = '0';
                    img.style.left = '0';
                    img.style.zIndex = '2';
                    img.style.maxWidth = '100%';
                    img.style.maxHeight = '100%';
                    img.style.webkitBackfaceVisibility = 'visible'; // Changed to visible for mobile
                    img.style.backfaceVisibility = 'visible'; // Changed to visible for mobile
                    img.style.transform = 'translateZ(0)';
                    img.style.webkitTransform = 'translateZ(0)'; // Safari mobile fix
                    img.onerror = function() {
                        console.log(`[${index}] ❌ Image failed to load for ${user.handle} (CORS or network error), showing initials`);
                        this.onerror = null; // Prevent infinite loop
                        this.remove();
                        if (profilePictureDiv) {
                            profilePictureDiv.innerHTML = getInitials(user.name);
                            profilePictureDiv.style.display = 'flex';
                            profilePictureDiv.style.alignItems = 'center';
                            profilePictureDiv.style.justifyContent = 'center';
                        }
                    };
                    profilePictureDiv.innerHTML = '';
                    profilePictureDiv.appendChild(img);
                }
            }
            return;
        }
        
        console.log(`[${index}] 🔍 Fetching profile picture for ${user.handle}...`);
        let profilePic = null;
        try {
            profilePic = await getInstagramProfilePicture(user.handle);
            console.log(`[${index}] ✅ Profile picture result for ${user.handle}:`, profilePic ? `Found: ${profilePic.substring(0, 80)}...` : '❌ Not found');
        } catch (error) {
            console.error(`[${index}] ❌ Error fetching profile picture for ${user.handle}:`, error);
            console.error(`[${index}] Error message:`, error.message);
            console.error(`[${index}] Error stack:`, error.stack);
            profilePic = null; // Set to null on error
        }
        
        if (profilePic) {
            console.log(`[${index}] ✅✅✅ PROFILE PIC RECEIVED FOR ${user.handle}: ${profilePic.substring(0, 80)}...`);
            
            // Update the user object in leaderboardData to preserve the profile pic
            const userIndex = leaderboardData.findIndex(e => cleanHandle(e.handle) === cleanHandle(user.handle));
            if (userIndex >= 0) {
                leaderboardData[userIndex].profilePic = profilePic;
                console.log(`[${index}] ✅ Updated leaderboardData[${userIndex}].profilePic for ${user.handle}`);
            } else {
                console.log(`[${index}] ⚠️ User not found in leaderboardData for ${user.handle}`);
            }
            
            // Save to localStorage for persistence across page reloads (save with both handle formats)
            const storedProfilePics = loadProfilePicsFromStorage();
            storedProfilePics[user.handle] = profilePic;
            storedProfilePics[cleanHandle(user.handle)] = profilePic; // Also save with cleaned handle
            saveProfilePicsToStorage(storedProfilePics);
            console.log(`[${index}] ✅ Saved profile pic to localStorage for ${user.handle}`);
            
            // Try multiple times to find and update the DOM element (retry logic)
            let attempts = 0;
            const maxAttempts = 10;
            let entry = null;
            const cleanUserHandle = cleanHandle(user.handle);
            
            while (attempts < maxAttempts && !entry) {
                // Wait a bit for DOM to be ready (increasing delay)
                await new Promise(resolve => setTimeout(resolve, 200 * (attempts + 1)));
                
                // Find the entry by data-handle attribute (most reliable)
                entry = document.querySelector(`.leaderboard-entry[data-handle="${cleanUserHandle}"]`);
                
                if (!entry) {
                    // Fallback: try to find by handle in the entry text
                    const entries = document.querySelectorAll('.leaderboard-entry');
                    console.log(`[${index}] Attempt ${attempts + 1}: Found ${entries.length} leaderboard entries in DOM, looking for handle: ${user.handle}`);
                    
                    for (let i = 0; i < entries.length; i++) {
                        const entryHandle = entries[i].getAttribute('data-handle') || '';
                        const entryText = entries[i].innerText || '';
                        const handleInText = entryText.includes(`@${user.handle}`) || 
                                            entryText.includes(`@${cleanUserHandle}`) ||
                                            cleanHandle(entryHandle) === cleanUserHandle ||
                                            entryText.includes(user.name);
                        if (handleInText) {
                            entry = entries[i];
                            console.log(`[${index}] ✅ Found entry at index ${i} for handle ${user.handle} via text match`);
                            break;
                        }
                    }
                } else {
                    console.log(`[${index}] ✅ Found entry for handle ${user.handle} via data-handle attribute`);
                }
                
                // Last fallback: use index if still not found
                if (!entry) {
                    const entries = document.querySelectorAll('.leaderboard-entry');
                    if (entries[index]) {
                        entry = entries[index];
                        console.log(`[${index}] ✅ Using index fallback for ${user.handle}`);
                    }
                }
                
                attempts++;
            }
            
            if (entry) {
                const profilePictureDiv = entry.querySelector('.profile-picture');
                if (profilePictureDiv) {
                    console.log(`[${index}] ✅✅✅ UPDATING DOM: Setting profile picture for ${user.handle} in DOM`);
                    const initials = getInitials(user.name);
                    
                    // Preload image before inserting to prevent flickering
                    const img = new Image();
                    img.alt = user.name;
                    img.loading = 'eager'; // Force immediate loading on mobile
                    img.decoding = 'sync'; // Synchronous decoding for mobile
                    // CRITICAL: Mobile-optimized styles to ensure display
                    img.style.width = '100%';
                    img.style.height = '100%';
                    img.style.borderRadius = '50%';
                    img.style.objectFit = 'cover';
                    img.style.display = 'block';
                    img.style.visibility = 'visible';
                    img.style.opacity = '1';
                    img.style.position = 'absolute';
                    img.style.top = '0';
                    img.style.left = '0';
                    img.style.zIndex = '2';
                    img.style.maxWidth = '100%';
                    img.style.maxHeight = '100%';
                    img.style.webkitBackfaceVisibility = 'visible'; // Changed to visible for mobile
                    img.style.backfaceVisibility = 'visible'; // Changed to visible for mobile
                    img.style.transform = 'translateZ(0)';
                    img.style.webkitTransform = 'translateZ(0)'; // Safari mobile fix
                    
                    img.onload = function() {
                        console.log(`[${index}] ✅✅✅ IMAGE LOADED SUCCESSFULLY for ${user.handle}: ${profilePic.substring(0, 80)}...`);
                        // Only update DOM after image is fully loaded
                        profilePictureDiv.innerHTML = '';
                        profilePictureDiv.appendChild(img);
                        // Force reflow on mobile to ensure image displays
                        profilePictureDiv.offsetHeight;
                        console.log(`[${index}] ✅✅✅ DOM UPDATED: Profile picture displayed for ${user.handle}`);
                    };
                    
                    img.onerror = function() {
                        console.log(`[${index}] ❌ Image failed to load for ${user.handle} (CORS or network error), showing initials`);
                        this.onerror = null; // Prevent infinite loop
                        if (profilePictureDiv) {
                            profilePictureDiv.innerHTML = initials;
                            profilePictureDiv.style.display = 'flex';
                            profilePictureDiv.style.alignItems = 'center';
                            profilePictureDiv.style.justifyContent = 'center';
                        }
                    };
                    img.crossOrigin = 'anonymous'; // Try to allow CORS
                    
                    // Start loading the image via proxy to bypass CORS
                    const apiBase = window.location.origin;
                    const proxyUrl = `${apiBase}/api/profile-pic-proxy?url=${encodeURIComponent(profilePic)}`;
                    console.log(`[${index}] 🖼️ Starting to load image via proxy: ${proxyUrl.substring(0, 80)}...`);
                    img.src = proxyUrl;
                    
                    // Fallback: if image doesn't load within 15 seconds (longer on mobile), show initials
                    const timeoutDuration = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ? 15000 : 10000;
                    setTimeout(() => {
                        if (!img.complete || img.naturalHeight === 0) {
                            console.log(`[${index}] ⏱️ Image load timeout for ${user.handle}, showing initials`);
                            if (profilePictureDiv && profilePictureDiv.querySelector('img') === img) {
                                img.onerror();
                            }
                        }
                    }, timeoutDuration);
                } else {
                    console.error(`[${index}] ❌❌❌ Profile picture div not found for ${user.handle} in entry`);
                }
            } else {
                console.error(`[${index}] ❌❌❌ Entry not found for ${user.handle} after ${maxAttempts} attempts`);
                // Force update by finding all entries and matching by name
                const allEntries = document.querySelectorAll('.leaderboard-entry');
                console.log(`[${index}] 🔍 Trying to find entry by name: ${user.name}`);
                for (let i = 0; i < allEntries.length; i++) {
                    if (allEntries[i].innerText.includes(user.name)) {
                        const profilePictureDiv = allEntries[i].querySelector('.profile-picture');
                        if (profilePictureDiv) {
                            console.log(`[${index}] ✅ Found entry by name match, updating profile picture`);
                            const img = new Image();
                            const apiBase = window.location.origin;
                            img.loading = 'eager'; // Force immediate loading on mobile
                            img.decoding = 'sync'; // Synchronous decoding for mobile
                            // CRITICAL: Mobile-optimized styles to ensure display
                            img.style.width = '100%';
                            img.style.height = '100%';
                            img.style.borderRadius = '50%';
                            img.style.objectFit = 'cover';
                            img.style.display = 'block';
                            img.style.visibility = 'visible';
                            img.style.opacity = '1';
                            img.style.position = 'absolute';
                            img.style.top = '0';
                            img.style.left = '0';
                            img.style.zIndex = '2';
                            img.style.maxWidth = '100%';
                            img.style.maxHeight = '100%';
                            img.style.webkitBackfaceVisibility = 'visible'; // Changed to visible for mobile
                            img.style.backfaceVisibility = 'visible'; // Changed to visible for mobile
                            img.style.transform = 'translateZ(0)';
                            img.style.webkitTransform = 'translateZ(0)'; // Safari mobile fix
                            img.src = `${apiBase}/api/profile-pic-proxy?url=${encodeURIComponent(profilePic)}`;
                            img.onerror = function() {
                                this.onerror = null;
                                if (profilePictureDiv) {
                                    profilePictureDiv.innerHTML = getInitials(user.name);
                                    profilePictureDiv.style.display = 'flex';
                                    profilePictureDiv.style.alignItems = 'center';
                                    profilePictureDiv.style.justifyContent = 'center';
                                }
                            };
                            img.onload = function() {
                                if (profilePictureDiv) {
                                    profilePictureDiv.innerHTML = '';
                                    profilePictureDiv.appendChild(img);
                                    // Force reflow on mobile
                                    profilePictureDiv.offsetHeight;
                                }
                            };
                            break;
                        }
                    }
                }
            }
        } else {
            console.error(`[${index}] ❌❌❌ No profile picture URL returned for ${user.handle}`);
        }
    });
    
    // Don't wait for all to complete, just fire and forget
    Promise.all(profilePicPromises).then(() => {
        console.log('All profile picture requests completed');
        // On mobile, check more aggressively and multiple times
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        if (isMobile) {
            // Check immediately, then again after delays
            setTimeout(() => checkAndRetryFailedProfilePictures(users), 2000);
            setTimeout(() => checkAndRetryFailedProfilePictures(users), 5000);
            setTimeout(() => checkAndRetryFailedProfilePictures(users), 10000);
            setTimeout(() => checkAndRetryFailedProfilePictures(users), 15000);
        } else {
            setTimeout(() => {
                checkAndRetryFailedProfilePictures(users);
            }, 5000);
        }
    }).catch(err => {
        console.error('Some profile pictures failed to load:', err);
        // Still check for failed images even if some promises failed
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        if (isMobile) {
            setTimeout(() => checkAndRetryFailedProfilePictures(users), 2000);
            setTimeout(() => checkAndRetryFailedProfilePictures(users), 5000);
            setTimeout(() => checkAndRetryFailedProfilePictures(users), 10000);
        } else {
            setTimeout(() => {
                checkAndRetryFailedProfilePictures(users);
            }, 5000);
        }
    });
}

// Global function to retry a single profile picture (called from inline onerror handlers)
window.retrySingleProfilePicture = function(handle) {
    console.log(`🔄 Immediate retry triggered for ${handle} from onerror handler`);
    // Find the entry and trigger retry
    const entry = document.querySelector(`.leaderboard-entry[data-handle="${handle}"]`);
    if (entry) {
        const profilePictureDiv = entry.querySelector('.profile-picture');
        const nameElement = entry.querySelector('.entry-name');
        const name = nameElement ? nameElement.textContent.trim() : '';
        
        if (profilePictureDiv && handle) {
            // Get current users from leaderboardData
            const user = leaderboardData.find(u => cleanHandle(u.handle) === cleanHandle(handle));
            if (user) {
                retryProfilePicture({
                    handle: handle,
                    name: name,
                    entry: entry,
                    profilePictureDiv: profilePictureDiv
                }, leaderboardData);
            }
        }
    }
};

// Check all leaderboard entries and retry failed profile pictures
async function checkAndRetryFailedProfilePictures(users) {
    console.log('🔍 Checking for failed profile pictures...');
    const entries = document.querySelectorAll('.leaderboard-entry');
    const failedEntries = [];
    const checkedHandles = new Set(); // Prevent duplicate retries
    
    entries.forEach(entry => {
        const profilePictureDiv = entry.querySelector('.profile-picture');
        if (!profilePictureDiv) return;
        
        const handle = entry.getAttribute('data-handle');
        if (!handle || checkedHandles.has(handle)) return;
        
        const nameElement = entry.querySelector('.entry-name');
        const name = nameElement ? nameElement.textContent.trim() : '';
        
        // Check if it's showing initials (text content) instead of an image
        const hasImage = profilePictureDiv.querySelector('img');
        const hasText = profilePictureDiv.textContent && profilePictureDiv.textContent.trim().length > 0;
        const textContent = profilePictureDiv.textContent.trim();
        
        // More aggressive detection:
        // 1. Has text (initials) but no image
        // 2. Has image but it failed to load (naturalHeight === 0 or not complete)
        // 3. Has image but it's still loading after reasonable time (on mobile)
        // 4. Image exists but src is empty or broken
        let isFailed = false;
        
        if (hasText && !hasImage) {
            // Showing initials - definitely failed
            isFailed = true;
            console.log(`🔍 Detected failed pic for ${handle}: showing initials "${textContent}"`);
        } else if (hasImage) {
            const img = hasImage;
            // Check if image actually loaded
            if (!img.complete || img.naturalHeight === 0 || img.naturalWidth === 0) {
                isFailed = true;
                console.log(`🔍 Detected failed pic for ${handle}: image not loaded (complete=${img.complete}, height=${img.naturalHeight})`);
            } else if (!img.src || img.src.includes('data:') || img.src.length < 10) {
                // Image has invalid src
                isFailed = true;
                console.log(`🔍 Detected failed pic for ${handle}: invalid src`);
            }
        } else {
            // No image and no text - empty div, should have something
            isFailed = true;
            console.log(`🔍 Detected failed pic for ${handle}: empty div`);
        }
        
        if (isFailed) {
            checkedHandles.add(handle);
            failedEntries.push({
                handle: handle,
                name: name,
                entry: entry,
                profilePictureDiv: profilePictureDiv
            });
        }
    });
    
    if (failedEntries.length === 0) {
        console.log('✅ All profile pictures loaded successfully!');
        return;
    }
    
    console.log(`⚠️ Found ${failedEntries.length} failed profile pictures, attempting to retry...`);
    
    // Retry each failed entry with more attempts
    for (const failedEntry of failedEntries) {
        await retryProfilePicture(failedEntry, users);
        // Add delay between retries to avoid rate limiting (shorter on mobile)
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        await new Promise(resolve => setTimeout(resolve, isMobile ? 300 : 500));
    }
}

// Retry loading a profile picture with different methods
async function retryProfilePicture(failedEntry, users) {
    const { handle, name, entry, profilePictureDiv } = failedEntry;
    console.log(`🔄 Retrying profile picture for ${handle}...`);
    
    // Find the user data
    const user = users.find(u => cleanHandle(u.handle) === cleanHandle(handle));
    if (!user) {
        console.log(`⚠️ User data not found for handle: ${handle}`);
        return;
    }
    
    // Method 1: Try fetching fresh from Instagram API
    console.log(`🔄 Method 1: Fetching fresh from Instagram API for ${handle}...`);
    try {
        const freshProfilePic = await getInstagramProfilePicture(handle);
        if (freshProfilePic) {
            console.log(`✅ Fresh profile pic fetched for ${handle}, attempting to load...`);
            await loadProfilePictureImage(freshProfilePic, profilePictureDiv, name, handle, 'fresh-api');
            
            // Check if it loaded successfully
            await new Promise(resolve => setTimeout(resolve, 2000));
            const img = profilePictureDiv.querySelector('img');
            if (img && img.complete && img.naturalHeight > 0) {
                console.log(`✅✅✅ Successfully loaded profile pic for ${handle} using fresh API fetch`);
                // Update localStorage and leaderboardData
                const storedProfilePics = loadProfilePicsFromStorage();
                storedProfilePics[handle] = freshProfilePic;
                storedProfilePics[cleanHandle(handle)] = freshProfilePic;
                saveProfilePicsToStorage(storedProfilePics);
                
                const userIndex = leaderboardData.findIndex(e => cleanHandle(e.handle) === cleanHandle(handle));
                if (userIndex >= 0) {
                    leaderboardData[userIndex].profilePic = freshProfilePic;
                }
                return; // Success, no need to try other methods
            }
        }
    } catch (error) {
        console.log(`❌ Method 1 failed for ${handle}:`, error.message);
    }
    
    // Method 2: Try direct URL (if we have a cached URL)
    const storedProfilePics = loadProfilePicsFromStorage();
    const cachedUrl = storedProfilePics[handle] || storedProfilePics[cleanHandle(handle)] || user.profilePic;
    if (cachedUrl && cachedUrl.startsWith('http')) {
        console.log(`🔄 Method 2: Trying direct URL for ${handle}...`);
        try {
            await loadProfilePictureImage(cachedUrl, profilePictureDiv, name, handle, 'direct-url');
            
            // Check if it loaded successfully
            await new Promise(resolve => setTimeout(resolve, 2000));
            const img = profilePictureDiv.querySelector('img');
            if (img && img.complete && img.naturalHeight > 0) {
                console.log(`✅✅✅ Successfully loaded profile pic for ${handle} using direct URL`);
                return; // Success
            }
        } catch (error) {
            console.log(`❌ Method 2 failed for ${handle}:`, error.message);
        }
    }
    
    // Method 3: Try proxy with cache-busting parameter
    if (cachedUrl) {
        console.log(`🔄 Method 3: Trying proxy with cache-busting for ${handle}...`);
        const apiBase = window.location.origin;
        const cacheBuster = `&_cb=${Date.now()}`;
        const proxyUrl = `${apiBase}/api/profile-pic-proxy?url=${encodeURIComponent(cachedUrl)}${cacheBuster}`;
        
        try {
            await loadProfilePictureImage(proxyUrl, profilePictureDiv, name, handle, 'proxy-cache-bust');
            
            // Check if it loaded successfully
            await new Promise(resolve => setTimeout(resolve, 2000));
            const img = profilePictureDiv.querySelector('img');
            if (img && img.complete && img.naturalHeight > 0) {
                console.log(`✅✅✅ Successfully loaded profile pic for ${handle} using proxy with cache-busting`);
                return; // Success
            }
        } catch (error) {
            console.log(`❌ Method 3 failed for ${handle}:`, error.message);
        }
    }
    
    // Method 4: Try proxy multiple times with different cache-busting (mobile-specific)
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (cachedUrl && isMobile) {
        console.log(`🔄 Method 4: Trying proxy multiple times for ${handle} (mobile)...`);
        const apiBase = window.location.origin;
        
        // Try up to 3 times with different cache busters
        for (let attempt = 1; attempt <= 3; attempt++) {
            const cacheBuster = `&_cb=${Date.now()}-${attempt}`;
            const proxyUrl = `${apiBase}/api/profile-pic-proxy?url=${encodeURIComponent(cachedUrl)}${cacheBuster}`;
            
            try {
                await loadProfilePictureImage(proxyUrl, profilePictureDiv, name, handle, `proxy-retry-${attempt}`);
                
                // Check if it loaded successfully
                await new Promise(resolve => setTimeout(resolve, 3000)); // Longer wait on mobile
                const img = profilePictureDiv.querySelector('img');
                if (img && img.complete && img.naturalHeight > 0) {
                    console.log(`✅✅✅ Successfully loaded profile pic for ${handle} using proxy retry ${attempt}`);
                    return; // Success
                }
            } catch (error) {
                console.log(`❌ Method 4 attempt ${attempt} failed for ${handle}:`, error.message);
            }
            
            // Wait between attempts
            if (attempt < 3) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }
    
    // Method 5: Force reload by clearing and re-adding (last resort)
    if (cachedUrl) {
        console.log(`🔄 Method 5: Force reload for ${handle}...`);
        const apiBase = window.location.origin;
        const proxyUrl = `${apiBase}/api/profile-pic-proxy?url=${encodeURIComponent(cachedUrl)}&_force=${Date.now()}`;
        
        try {
            // Clear the div first
            profilePictureDiv.innerHTML = '';
            
            await loadProfilePictureImage(proxyUrl, profilePictureDiv, name, handle, 'force-reload');
            
            // Check if it loaded successfully
            await new Promise(resolve => setTimeout(resolve, 3000));
            const img = profilePictureDiv.querySelector('img');
            if (img && img.complete && img.naturalHeight > 0) {
                console.log(`✅✅✅ Successfully loaded profile pic for ${handle} using force reload`);
                return; // Success
            }
        } catch (error) {
            console.log(`❌ Method 5 failed for ${handle}:`, error.message);
        }
    }
    
    console.log(`❌ All retry methods failed for ${handle}, keeping initials`);
}

// Helper function to load a profile picture image
function loadProfilePictureImage(imageUrl, profilePictureDiv, name, handle, method) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const initials = getInitials(name);
        
        img.alt = name;
        img.loading = 'eager';
        img.decoding = 'sync';
        // CRITICAL: Mobile-optimized styles to ensure display
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.borderRadius = '50%';
        img.style.objectFit = 'cover';
        img.style.display = 'block';
        img.style.visibility = 'visible';
        img.style.opacity = '1';
        img.style.position = 'absolute';
        img.style.top = '0';
        img.style.left = '0';
        img.style.zIndex = '2';
        img.style.maxWidth = '100%';
        img.style.maxHeight = '100%';
        img.style.webkitBackfaceVisibility = 'visible'; // Changed to visible for mobile
        img.style.backfaceVisibility = 'visible'; // Changed to visible for mobile
        img.style.transform = 'translateZ(0)';
        img.style.webkitTransform = 'translateZ(0)'; // Safari mobile fix
        img.crossOrigin = 'anonymous';
        
        // Set timeout first
        const timeout = setTimeout(() => {
            if (!img.complete || img.naturalHeight === 0) {
                img.onerror();
            }
        }, 10000);
        
        img.onload = function() {
            clearTimeout(timeout);
            console.log(`✅ Image loaded via ${method} for ${handle}`);
            if (profilePictureDiv) {
                profilePictureDiv.innerHTML = '';
                profilePictureDiv.appendChild(img);
                profilePictureDiv.offsetHeight; // Force reflow
            }
            resolve();
        };
        
        img.onerror = function() {
            clearTimeout(timeout);
            console.log(`❌ Image failed to load via ${method} for ${handle}`);
            if (profilePictureDiv && !profilePictureDiv.querySelector('img')) {
                profilePictureDiv.innerHTML = initials;
                profilePictureDiv.style.display = 'flex';
                profilePictureDiv.style.alignItems = 'center';
                profilePictureDiv.style.justifyContent = 'center';
            }
            reject(new Error(`Failed to load image via ${method}`));
        };
        
        img.src = imageUrl;
    });
}

// Create leaderboard entry HTML
function createEntryHTML(user, rank) {
    const initials = getInitials(user.name);
    // Show $500+ for placeholder entries, otherwise show actual amount
    const formattedAmount = user.isPlaceholder ? '$500+' : `$${user.amount}`;
    const escapedName = user.name.replace(/'/g, "\\'");
    
    // Check localStorage for profile pic if not in user object
    let profilePic = user.profilePic;
    const cleanUserHandle = cleanHandle(user.handle);
    
    if (!profilePic || profilePic.length === 0) {
        const storedProfilePics = loadProfilePicsFromStorage();
        // Try multiple handle formats
        profilePic = storedProfilePics[user.handle] || 
                     storedProfilePics[cleanUserHandle] || 
                     storedProfilePics[`@${user.handle}`] ||
                     storedProfilePics[`@${cleanUserHandle}`] ||
                     null;
        if (profilePic) {
            console.log(`🖼️ createEntryHTML: Found profilePic in localStorage for ${user.handle}: ${profilePic.substring(0, 50)}...`);
        } else {
            console.log(`⚠️⚠️⚠️ createEntryHTML: No profilePic found in localStorage for ${user.handle} (tried: ${user.handle}, ${cleanUserHandle}, @${user.handle}, @${cleanUserHandle})`);
        }
    } else {
        console.log(`✅ createEntryHTML: Using profilePic from user object for ${user.handle}: ${profilePic.substring(0, 50)}...`);
    }
    
    // Create profile picture HTML with fallback
    let profilePicHtml = '';
    if (profilePic && profilePic.length > 0) {
        console.log(`🖼️✅✅✅ createEntryHTML: Creating img tag for ${user.handle} with profilePic: ${profilePic.substring(0, 50)}...`);
        // Use proxy endpoint to bypass CORS
        const apiBase = window.location.origin;
        const proxyUrl = `${apiBase}/api/profile-pic-proxy?url=${encodeURIComponent(profilePic)}`;
        const escapedProxyUrl = proxyUrl.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        const escapedInitials = initials.replace(/'/g, "\\'");
        const escapedHandle = user.handle.replace(/'/g, "\\'");
        // Enhanced onerror handler that triggers immediate retry
        // CRITICAL: Mobile-optimized inline styles to ensure display
        profilePicHtml = `<img src="${escapedProxyUrl}" alt="${escapedName}" loading="eager" decoding="sync" style="width: 100% !important; height: 100% !important; border-radius: 50%; object-fit: cover !important; display: block !important; visibility: visible !important; opacity: 1 !important; position: absolute; top: 0; left: 0; z-index: 2; -webkit-backface-visibility: visible !important; backface-visibility: visible !important; transform: translateZ(0) !important; -webkit-transform: translateZ(0) !important; max-width: 100%; max-height: 100%;" onerror="(function(img,handle){img.onerror=null;img.style.display='none';var parent=img.parentElement;if(parent){parent.innerHTML='${escapedInitials}';parent.style.display='flex';parent.style.alignItems='center';parent.style.justifyContent='center';}if(typeof window.retrySingleProfilePicture==='function'){setTimeout(function(){window.retrySingleProfilePicture('${escapedHandle}');},1000);}})(this,'${escapedHandle}');">`;
    } else {
        console.log(`⚠️⚠️⚠️ createEntryHTML: No profilePic for ${user.handle}, using initials: ${initials}`);
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
    console.log(`📊 First user profilePic check:`, users[0] ? { handle: users[0].handle, hasPic: !!users[0].profilePic, pic: users[0].profilePic ? users[0].profilePic.substring(0, 50) + '...' : 'none' } : 'no users');
    
    // Sort users by amount (descending) - highest amount first
    // Placeholders should go to the bottom
    const sortedUsers = [...users].sort((a, b) => {
        // Placeholders always go to bottom
        if (a.isPlaceholder && !b.isPlaceholder) return 1;
        if (!a.isPlaceholder && b.isPlaceholder) return -1;
        // Sort by amount descending (highest first)
        return (b.amount || 0) - (a.amount || 0);
    });
    
    console.log(`📊 Sorted ${sortedUsers.length} users by amount (descending)`);
    
    // Ensure profile pictures from localStorage are loaded before displaying
    const usersWithPics = sortedUsers.map(user => {
        if (!user.profilePic) {
            const storedProfilePics = loadProfilePicsFromStorage();
            const cleanUserHandle = cleanHandle(user.handle);
            // Check both exact handle and cleaned handle
            const storedPic = storedProfilePics[user.handle] || storedProfilePics[cleanUserHandle];
            if (storedPic) {
                console.log(`✅ Found profile pic in localStorage for ${user.handle}: ${storedPic.substring(0, 50)}...`);
                return { ...user, profilePic: storedPic };
            } else {
                console.log(`⚠️ No profile pic in localStorage for ${user.handle}`);
            }
        } else {
            console.log(`✅ User ${user.handle} already has profilePic: ${user.profilePic.substring(0, 50)}...`);
        }
        return user;
    });
    
    console.log(`📊 Users with profile pics:`, usersWithPics.map(u => `${u.handle}: ${u.profilePic ? 'HAS PIC' : 'NO PIC'}`));
    
    // Generate HTML for all entries immediately with profile pics if available
    listContainer.innerHTML = usersWithPics.map((user, index) => 
        createEntryHTML(user, index + 1)
    ).join('');
    
    leaderboard.classList.remove('hidden');
    
    // CRITICAL: Ensure profile pictures display on mobile immediately after rendering
    setTimeout(() => {
        ensureMobileProfilePicturesDisplay();
    }, 100);
    
    // Smooth scroll to leaderboard
    leaderboard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    
    // Load profile pictures in background (non-blocking) - this will fetch missing ones
    console.log(`🖼️ Starting to load profile pictures for ${usersWithPics.length} users...`);
    // On mobile, delay background loading slightly to let initial render complete
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) {
        setTimeout(() => loadProfilePicturesInBackground(usersWithPics), 200);
        // Start continuous monitoring on mobile
        startContinuousProfilePicMonitoring(usersWithPics);
    } else {
        loadProfilePicturesInBackground(usersWithPics);
    }
}

// Start continuous monitoring of profile pictures on mobile
function startContinuousProfilePicMonitoring(users) {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (!isMobile) return;
    
    console.log('🔄 Starting continuous profile picture monitoring on mobile...');
    
    // Check every 10 seconds for the first minute, then every 30 seconds
    let checkCount = 0;
    const intervalId = setInterval(() => {
        checkCount++;
        console.log(`🔍 Continuous check #${checkCount} for failed profile pictures...`);
        checkAndRetryFailedProfilePictures(users);
        
        // After 6 checks (1 minute), reduce frequency
        if (checkCount >= 6) {
            clearInterval(intervalId);
            // Continue checking every 30 seconds
            setInterval(() => {
                console.log('🔍 Periodic check for failed profile pictures...');
                checkAndRetryFailedProfilePictures(users);
            }, 30000);
        }
    }, 10000); // Check every 10 seconds
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
    
    searchInProgress = true;
    
    // Show progress modal IMMEDIATELY - before any other operations
    showProgressModal();
    updateProgressStep(1, 'Extracting name from Instagram...');
    
    const input = document.getElementById('instagramHandle');
    console.log('🔍 Input element:', input ? 'FOUND' : 'NOT FOUND');
    if (!input) {
        console.error('❌ Instagram handle input not found!');
        hideProgressModal(); // Hide modal if input not found
        alert('Error: Search input not found. Please refresh the page.');
        searchInProgress = false;
        return;
    }
    
    const handle = input.value.trim();
    console.log(`🔍 Handle value: "${handle}"`);
    console.log(`🔍 Handle length: ${handle.length}`);
    
    const searchBtn = document.getElementById('searchBtn');
    console.log('🔍 Search button element:', searchBtn ? 'FOUND' : 'NOT FOUND');
    
    if (!searchBtn) {
        console.error('❌ Search button not found!');
        hideProgressModal(); // Hide modal if button not found
        alert('Error: Search button not found. Please refresh the page.');
        searchInProgress = false;
        return;
    }
    
    console.log(`🔍 Search initiated for handle: "${handle}"`);
    if (!handle) {
        hideProgressModal(); // Hide modal if validation fails
        alert('Please enter an Instagram username');
        searchInProgress = false;
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
        // Always proceed with new search - don't redirect to existing entries
        // User doesn't exist or exists - get Instagram full name and start search automatically
        let fullName = null;
        let nameExtractionError = null;
        let profilePic = null;
        
        // Extract name first
        try {
            fullName = await getInstagramFullName(cleanHandleValue);
            if (fullName) {
                console.log(`✅ Extracted name: ${fullName}`);
            }
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
                hideProgressModal(); // Hide progress modal on error
                alert('Instagram request timed out. This can happen if Instagram is slow or blocking requests. Please try again in a moment, or search by name directly using the link below.');
                return;
            }
        }
        
        // ALWAYS fetch profile picture, regardless of whether name extraction succeeded or failed
        console.log(`[PROFILE PIC FLOW] Starting profile picture fetch for handle: ${cleanHandleValue}`);
        console.log(`[PROFILE PIC FLOW] Name extraction result: ${fullName ? `SUCCESS: ${fullName}` : 'FAILED'}`);
        
        // Check localStorage first as a fallback
        const storedProfilePics = loadProfilePicsFromStorage();
        profilePic = storedProfilePics[cleanHandleValue] || storedProfilePics[handle] || null;
        
        if (profilePic) {
            console.log(`[PROFILE PIC FLOW] ✅ Found cached profile picture for ${cleanHandleValue}: ${profilePic.substring(0, 60)}...`);
        } else {
            console.log(`[PROFILE PIC FLOW] 🔄 No cache found, fetching profile picture for ${cleanHandleValue}...`);
            try {
                profilePic = await getInstagramProfilePicture(cleanHandleValue);
                console.log(`[PROFILE PIC FLOW] ✅ Fetch completed for ${cleanHandleValue}: ${profilePic ? `SUCCESS - URL: ${profilePic.substring(0, 60)}...` : 'FAILED - No URL returned'}`);
            } catch (picError) {
                console.error(`[PROFILE PIC FLOW] ❌ Error fetching profile picture for ${cleanHandleValue}:`, picError.message);
                profilePic = null;
            }
        }
        
        // Always save to localStorage if we have a profile pic (from cache or fresh fetch)
        if (profilePic) {
            const storedProfilePicsToSave = loadProfilePicsFromStorage();
            storedProfilePicsToSave[cleanHandleValue] = profilePic;
            storedProfilePicsToSave[handle] = profilePic;
            saveProfilePicsToStorage(storedProfilePicsToSave);
            console.log(`[PROFILE PIC FLOW] 💾 Saved profilePic to localStorage for ${cleanHandleValue}`);
        } else {
            console.log(`[PROFILE PIC FLOW] ⚠️ No profile picture available for ${cleanHandleValue}`);
        }
        
        console.log(`[PROFILE PIC FLOW] Final profilePic value: ${profilePic ? `SET (${profilePic.substring(0, 40)}...)` : 'NULL'}`);
        
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
        
        // Update progress to show extracted name
        if (firstName && lastName) {
            updateProgressStep(1, `Extracted name: ${firstName} ${lastName}`);
            // Mark step 1 as completed and move to step 2
            setTimeout(() => {
                updateProgressStep(2, 'Opening Missing Money website...');
            }, 500);
        } else if (firstName) {
            updateProgressStep(1, `Extracted name: ${firstName}`);
            setTimeout(() => {
                updateProgressStep(2, 'Opening Missing Money website...');
            }, 500);
        } else {
            // If extraction failed, still move to next step
            updateProgressStep(1, 'Name extraction completed');
            setTimeout(() => {
                updateProgressStep(2, 'Opening Missing Money website...');
            }, 500);
        }
        
            // If we got a valid name, start the search automatically
            if (firstName && lastName) {
                console.log(`✅ Starting search with extracted Instagram name: "${firstName} ${lastName}"`);
                console.log(`[PROFILE PIC FLOW] About to call startMissingMoneySearch with profilePic: ${profilePic ? `YES (${profilePic.substring(0, 40)}...)` : 'NO'}`);
                // Re-enable button immediately
                searchBtn.disabled = false;
                searchBtn.textContent = 'Search';
                
                // Start the search automatically (pass profile pic if available)
                await startMissingMoneySearch(firstName, lastName, cleanHandleValue, profilePic);
                searchInProgress = false;
            } else if (firstName && !lastName && fullName) {
                // Handle single-word names (e.g., "Naval", "Madonna")
                // Use the first name as both first and last name for the search
                console.log(`⚠️ Single-word name detected: "${firstName}". Using as both first and last name.`);
                searchBtn.disabled = false;
                searchBtn.textContent = 'Search';
                
                // Use firstName as both first and last name
                await startMissingMoneySearch(firstName, firstName, cleanHandleValue, profilePic);
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
                        hideProgressModal(); // Hide progress modal on error
                        alert('Instagram request timed out. This can happen if Instagram is slow or blocking requests. Please try again in a moment, or search by name directly using the link below.');
                        return;
                    }
                    
                    // For other errors, show a helpful message with more details
                    const errorDetails = nameExtractionError ? ` Error: ${nameExtractionError.message}` : '';
                    hideProgressModal(); // Hide progress modal on error
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
                        await startMissingMoneySearch(firstName, lastName, cleanHandleValue, profilePic);
                        searchInProgress = false;
                        return;
                    } else if (nameParts.length === 1) {
                        // Single word name - use as both first and last
                        firstName = nameParts[0];
                        console.log(`✅ Using single-word name as both first and last: "${firstName}"`);
                        searchBtn.disabled = false;
                        searchBtn.textContent = 'Search';
                        await startMissingMoneySearch(firstName, firstName, cleanHandleValue, profilePic);
                        searchInProgress = false;
                        return;
                    }
                }
                
                // If we still don't have a name, silently fail
                console.log('⚠️ Instagram name extraction failed - not using unreliable fallback methods');
                searchBtn.disabled = false;
                searchBtn.textContent = 'Search';
                searchInProgress = false;
                hideProgressModal(); // Hide progress modal on failure
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
// Export handleSearchImpl to window.handleSearch
if (typeof window.handleSearch === 'function') {
    const currentStr = window.handleSearch.toString();
    if (currentStr.includes('PLACEHOLDER')) {
        console.log('⚠️ Replacing placeholder handleSearch');
    }
}

// CRITICAL FIX: Export the function using its actual name (handleSearchImpl)
// This avoids identifier resolution conflicts - handleSearchImpl can never resolve to window.handleSearch
try {
    if (typeof window !== 'undefined' && typeof handleSearchImpl === 'function') {
        // Verify it's the real function (contains 'searchInProgress' which is unique to the real function)
        const funcStr = handleSearchImpl.toString();
        if (!funcStr.includes('searchInProgress')) {
            console.error('❌ CRITICAL: handleSearchImpl is not the real function!');
            throw new Error('handleSearchImpl is not the real function');
        }
        
        console.log('✅✅✅ Found handleSearchImpl - verified it contains searchInProgress');
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
        const hasSearchInProgress = newFuncStr.includes('searchInProgress');
        console.log('✅✅✅ New function is placeholder:', newIsPlaceholder);
        console.log('✅✅✅ New function has searchInProgress:', hasSearchInProgress);
        
        if (newIsPlaceholder || !hasSearchInProgress) {
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
                console.log('✅✅✅ After defineProperty, has searchInProgress:', verifyStr.includes('searchInProgress'));
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
            if (funcStr.includes('searchInProgress')) {
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
    
    // Reset all steps (now 6 steps total)
    for (let i = 1; i <= 6; i++) {
        const step = document.getElementById(`step${i}`);
        step.classList.remove('active', 'completed');
    }
    
    // Start with step 1 (Instagram name extraction)
    updateProgressStep(1, 'Extracting name from Instagram...');
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

// Remove emojis and special characters from names for Missing Money search
function cleanNameForSearch(name) {
    if (!name) return '';
    // Remove emojis using Unicode ranges
    // This covers most emoji ranges: Emoticons, Miscellaneous Symbols, Dingbats, etc.
    let cleaned = name.replace(/[\u{1F600}-\u{1F64F}]/gu, ''); // Emoticons
    cleaned = cleaned.replace(/[\u{1F300}-\u{1F5FF}]/gu, ''); // Misc Symbols and Pictographs
    cleaned = cleaned.replace(/[\u{1F680}-\u{1F6FF}]/gu, ''); // Transport and Map
    cleaned = cleaned.replace(/[\u{1F1E0}-\u{1F1FF}]/gu, ''); // Flags (country flags)
    cleaned = cleaned.replace(/[\u{2600}-\u{26FF}]/gu, ''); // Misc symbols
    cleaned = cleaned.replace(/[\u{2700}-\u{27BF}]/gu, ''); // Dingbats
    cleaned = cleaned.replace(/[\u{FE00}-\u{FE0F}]/gu, ''); // Variation Selectors
    cleaned = cleaned.replace(/[\u{200D}]/gu, ''); // Zero Width Joiner
    cleaned = cleaned.replace(/[\u{20E3}]/gu, ''); // Combining Enclosing Keycap
    // Clean up extra spaces
    cleaned = cleaned.trim().replace(/\s+/g, ' ');
    return cleaned;
}

// Start missing money search directly with first and last name
async function startMissingMoneySearch(firstName, lastName, handle, profilePic = null) {
    console.log(`🚀 startMissingMoneySearch called with: firstName="${firstName}", lastName="${lastName}", handle="${handle}"`);
    console.log(`[PROFILE PIC FLOW] startMissingMoneySearch received profilePic: ${profilePic ? `YES (${profilePic.substring(0, 40)}...)` : 'NO (null/undefined)'}`);
    
    // Remove emojis from names before searching
    const cleanedFirstName = cleanNameForSearch(firstName);
    const cleanedLastName = cleanNameForSearch(lastName);
    
    console.log(`🧹 Cleaned names: "${firstName}" -> "${cleanedFirstName}", "${lastName}" -> "${cleanedLastName}"`);
    
    // Basic validation - only check for empty or obviously invalid values
    if (!cleanedFirstName || !cleanedLastName || cleanedFirstName.trim().length === 0 || cleanedLastName.trim().length === 0) {
        console.error('❌ Invalid name extracted:', { firstName, lastName, cleanedFirstName, cleanedLastName });
        alert(`Unable to extract a valid name from Instagram profile @${handle}. Please try searching by name instead using the link below.`);
        return;
    }
    
    // Only reject if the name is exactly "Login" or "Instagram" (not if it contains those words)
    const fullName = `${cleanedFirstName} ${cleanedLastName}`.trim();
    if (fullName === 'Login' || fullName === 'Instagram' || fullName === 'Login • Instagram') {
        console.error('❌ Invalid name extracted (login page):', { firstName, lastName, fullName });
        alert(`Unable to extract a valid name from Instagram profile @${handle}. Please try searching by name instead using the link below.`);
        return;
    }
    
    const claimData = {
        firstName: cleanedFirstName.trim(),
        lastName: cleanedLastName.trim(),
        city: '', // Not required by missingmoney.com
        state: '', // Not required by missingmoney.com
        phone: '', // Not required
        name: handle || `${firstName} ${lastName}`.toLowerCase().replace(/\s+/g, ''),
        amount: 0,
        profilePic: profilePic // Include profile picture if available
    };
    
    console.log(`[PROFILE PIC FLOW] claimData.profilePic: ${claimData.profilePic ? `SET (${claimData.profilePic.substring(0, 40)}...)` : 'NOT SET'}`);
    
    console.log(`📝 claimData created:`, {
        firstName: claimData.firstName,
        lastName: claimData.lastName,
        fullName: `${claimData.firstName} ${claimData.lastName}`,
        name: claimData.name,
        profilePic: claimData.profilePic ? `SET (${claimData.profilePic.substring(0, 40)}...)` : 'NOT SET'
    });
    
    // Check localStorage cache first
    const cachedResult = loadMissingMoneyResultsFromStorage(claimData.firstName, claimData.lastName);
    if (cachedResult) {
        console.log('✅ Using cached MissingMoney results');
        hideProgressModal();
        
        // Process cached result same as fresh result
        // Note: Failed searches should not be cached, but double-check just in case
        if (!cachedResult.success) {
            console.log('⚠️ Cached result was a failed search, ignoring cache and performing fresh search');
            // Don't return - continue to fresh search below
        } else if (cachedResult.results && cachedResult.results.length > 0) {
            console.log('✅ Showing cached results modal with', cachedResult.results.length, 'results');
            await addToLeaderboard(claimData.firstName + ' ' + claimData.lastName, claimData.name || (claimData.firstName + claimData.lastName).toLowerCase().replace(/\s+/g, ''), cachedResult.totalAmount, false, true, cachedResult.results || [], claimData.profilePic);
            showResultsModal(claimData, cachedResult);
            return;
        } else {
            console.log('✅ Cached search completed successfully but no results found');
            await addToLeaderboard(claimData.firstName + ' ' + claimData.lastName, claimData.name || (claimData.firstName + claimData.lastName).toLowerCase().replace(/\s+/g, ''), 0, false, true, [], claimData.profilePic);
            showNoResultsModal(claimData);
            return;
        }
    }
    
    // Progress modal should already be shown from handleSearchImpl
    // But ensure it's visible and update to step 2 (since step 1 was Instagram extraction)
    if (!document.getElementById('progressModal').classList.contains('hidden')) {
        // Already shown, just update to step 2
        updateProgressStep(2, 'Opening Missing Money website...');
    } else {
        // Not shown yet, show it
        showProgressModal();
        updateProgressStep(2, 'Opening Missing Money website...');
    }
    
    // Track start time to ensure minimum display time
    const startTime = Date.now();
    const MIN_DISPLAY_TIME = 5000; // Minimum 5 seconds
    
    // Progress update timers (steps 2-6, since step 1 was Instagram extraction)
    const progressTimers = [];
    
    // Continue progress updates (step 2 onwards)
    progressTimers.push(setTimeout(() => updateProgressStep(3, 'Filling out your information...'), 2000));
    progressTimers.push(setTimeout(() => updateProgressStep(4, 'Solving security verification... This may take 10-30 seconds...'), 5000));
    progressTimers.push(setTimeout(() => updateProgressStep(5, 'Searching database...'), 15000));
    progressTimers.push(setTimeout(() => updateProgressStep(6, 'Compiling results...'), 30000));
    
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
        
        // Only cache successful searches (not failed ones)
        // Failed searches might be due to temporary issues (browser closed, network error, etc.)
        if (result.success) {
            saveMissingMoneyResultsToStorage(claimData.firstName, claimData.lastName, result);
        } else {
            console.log('⚠️ Not caching failed search result (may be temporary issue)');
        }
        
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
            
            // Add to leaderboard with real amount, entities, profile pic, and refresh display
            await addToLeaderboard(claimData.firstName + ' ' + claimData.lastName, claimData.name || (claimData.firstName + claimData.lastName).toLowerCase().replace(/\s+/g, ''), result.totalAmount, false, true, result.results || [], claimData.profilePic);
            
            // Show results modal
            showResultsModal(claimData, result);
        } else if (result.success) {
            // Search completed successfully but no results found - still save to leaderboard with $0
            console.log('✅ Search completed successfully but no results found');
            console.log('💾 Saving claim to leaderboard with $0 amount');
            
            // Add to leaderboard with $0 amount (still a successful claim) and refresh display
            await addToLeaderboard(claimData.firstName + ' ' + claimData.lastName, claimData.name || (claimData.firstName + claimData.lastName).toLowerCase().replace(/\s+/g, ''), 0, false, true, [], claimData.profilePic);
            
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
// CRITICAL: Mobile-specific function to ensure profile pictures display
function ensureMobileProfilePicturesDisplay() {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth <= 768;
    if (!isMobile) return;
    
    console.log('📱 Mobile device detected - ensuring profile pictures display...');
    
    // Force all profile picture images to be visible
    const profilePics = document.querySelectorAll('.profile-picture img');
    profilePics.forEach((img, index) => {
        // Force display styles
        img.style.display = 'block';
        img.style.visibility = 'visible';
        img.style.opacity = '1';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.position = 'absolute';
        img.style.top = '0';
        img.style.left = '0';
        img.style.zIndex = '2';
        
        // If image failed to load, trigger retry
        if (!img.complete || img.naturalHeight === 0) {
            const handle = img.closest('.leaderboard-entry')?.getAttribute('data-handle');
            if (handle && typeof window.retrySingleProfilePicture === 'function') {
                console.log(`📱 Retrying profile picture for ${handle} on mobile`);
                setTimeout(() => window.retrySingleProfilePicture(handle), 500 * (index + 1));
            }
        }
    });
    
    // Ensure containers are properly sized
    const containers = document.querySelectorAll('.profile-picture');
    containers.forEach(container => {
        container.style.position = 'relative';
        container.style.overflow = 'hidden';
        if (container.querySelector('img')) {
            container.style.minHeight = '50px';
            container.style.minWidth = '50px';
        }
    });
    
    console.log(`📱 Processed ${profilePics.length} profile pictures on mobile`);
}

document.addEventListener('DOMContentLoaded', async function() {
    const searchBtn = document.getElementById('searchBtn');
    const searchInput = document.getElementById('instagramHandle');
    
    // CRITICAL: Ensure profile pictures display on mobile
    ensureMobileProfilePicturesDisplay();
    
    // Also check after a delay to catch dynamically loaded images
    setTimeout(ensureMobileProfilePicturesDisplay, 1000);
    setTimeout(ensureMobileProfilePicturesDisplay, 3000);
    
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
// Final safety check - ensure handleSearch is exported
if (typeof window !== 'undefined' && typeof handleSearchImpl === 'function') {
    const beforeStr = window.handleSearch ? window.handleSearch.toString() : 'undefined';
    const beforeIsPlaceholder = beforeStr.includes('PLACEHOLDER');
    
    window.handleSearch = handleSearchImpl;
    _realHandleSearch = handleSearchImpl;
    
    const afterStr = window.handleSearch.toString();
    const afterIsPlaceholder = afterStr.includes('PLACEHOLDER');
    
    if (afterIsPlaceholder) {
        console.error('❌ CRITICAL: Placeholder still active after replacement');
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
} else if (typeof _realHandleSearch === 'function') {
    console.log('🔍 Final check: Using _realHandleSearch...');
    window.handleSearch = _realHandleSearch;
} else {
    console.error('❌❌❌ CRITICAL: handleSearchImpl function not defined when trying to export!');
}

// CRITICAL BACKUP: Also export on DOMContentLoaded in case script loaded before DOM
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    function forceExportIfNeeded() {
        if (typeof handleSearchImpl === 'function') {
            const funcStr = handleSearchImpl.toString();
            if (funcStr.includes('searchInProgress')) {
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
console.log('✅ Stripe initialized with public key:', stripePublishableKey.substring(0, 20) + '...');
let stripe = null;
try {
    stripe = Stripe(stripePublishableKey);
} catch (e) {
    console.error('Failed to initialize Stripe:', e);
}

// Handle Buy Now button click
async function handleBuyNow(firstName, lastName, amount) {
    console.log('🛒 Buy Now clicked:', { firstName, lastName, amount });
    
    // Get the button element
    const button = document.querySelector('.btn-buy-now');
    if (!button) {
        console.error('❌ Buy Now button not found');
        alert('Error: Buy Now button not found. Please refresh the page.');
        return;
    }
    
    const originalText = button.textContent;
    
    try {
        // Check if Stripe is initialized
        if (!stripe) {
            console.error('❌ Stripe not initialized');
            console.error('Stripe publishable key:', stripePublishableKey ? stripePublishableKey.substring(0, 20) + '...' : 'NOT SET');
            throw new Error('Stripe payment system not initialized. Please refresh the page.');
        }
        
        console.log('✅ Stripe initialized, creating checkout session...');
        
        // Disable button and show loading
        button.disabled = true;
        button.textContent = 'Processing...';
        
        // Create checkout session via backend
        const apiBase = window.location.origin;
        console.log('📡 Calling checkout API:', `${apiBase}/api/create-checkout-session`);
        
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
        
        console.log('📥 Checkout API response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            console.error('❌ Checkout API error response:', errorText);
            let errorData;
            try {
                errorData = JSON.parse(errorText);
            } catch (e) {
                errorData = { error: errorText || 'Failed to create checkout session' };
            }
            throw new Error(errorData.error || 'Failed to create checkout session');
        }
        
        const session = await response.json();
        console.log('✅ Checkout session created:', session.id);
        
        if (!session || !session.id) {
            throw new Error('Invalid checkout session response');
        }
        
        // Redirect to Stripe Checkout
        console.log('🔄 Redirecting to Stripe Checkout...');
        const result = await stripe.redirectToCheckout({
            sessionId: session.id
        });
        
        if (result.error) {
            console.error('❌ Stripe redirect error:', result.error);
            throw new Error(result.error.message || 'Failed to redirect to checkout');
        }
    } catch (error) {
        console.error('❌ Error processing payment:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        alert('Error processing payment: ' + error.message + '\n\nPlease check the browser console for more details.');
        if (button) {
            button.disabled = false;
            button.textContent = originalText;
        }
    }
}

window.handleBuyNow = handleBuyNow;

