// Leaderboard data - loaded from backend
let leaderboardData = [];

// Get initials from name
function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
}

// Clean Instagram handle
function cleanHandle(handle) {
    return handle.replace('@', '').trim().toLowerCase();
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
            leaderboardData = data.leaderboard.map(entry => ({
                ...entry,
                profilePic: null, // Will be loaded in background
                isPlaceholder: false // Real entries from backend are not placeholders
            }));
            console.log(`Loaded ${leaderboardData.length} leaderboard entries from backend`);
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

// Add entry to leaderboard (or update if exists)
async function addToLeaderboard(name, handle, amount, isPlaceholder = false) {
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
                isPlaceholder: isPlaceholder
            })
        });
        
        const data = await response.json();
        if (data.success && data.leaderboard) {
            leaderboardData = data.leaderboard.map(entry => ({
                ...entry,
                profilePic: null,
                isPlaceholder: entry.isPlaceholder || false
            }));
            // Refresh leaderboard display if it's visible
            if (!document.getElementById('leaderboard').classList.contains('hidden')) {
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
                <button class="btn btn-claim" onclick="handleClaim('${escapedName}', ${user.isPlaceholder ? 500 : user.amount})">
                    Claim It
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
    const input = document.getElementById('instagramHandle');
    const handle = input.value.trim();
    const searchBtn = document.getElementById('searchBtn');
    
    if (!handle) {
        alert('Please enter an Instagram username');
        return;
    }
    
    // Disable button and show loading
    searchBtn.disabled = true;
    searchBtn.textContent = 'Searching...';
    
    try {
        const cleanHandleValue = cleanHandle(handle);
        const handleName = cleanHandleValue.replace(/_/g, ' ');
        const capitalizedName = handleName.split(' ').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
        
        // Check if this handle exists in the leaderboard (real entries only, not placeholders)
        const foundEntry = leaderboardData.find(entry => cleanHandle(entry.handle) === cleanHandleValue);
        
        // Also check if there's already a placeholder for this handle in the current display
        const existingPlaceholders = new Set();
        const currentEntries = document.querySelectorAll('.leaderboard-entry');
        currentEntries.forEach(entry => {
            const handleText = entry.querySelector('.entry-handle')?.textContent || '';
            const handleMatch = handleText.match(/@(.+)/);
            if (handleMatch) {
                existingPlaceholders.add(cleanHandle(handleMatch[1]));
            }
        });
        
        let usersToShow = [];
        
        if (foundEntry) {
            // User exists in leaderboard - show all entries with this one highlighted
            usersToShow = generateLeaderboard(handle);
        } else if (existingPlaceholders.has(cleanHandleValue)) {
            // Placeholder already exists in display - just show current leaderboard
            usersToShow = generateLeaderboard();
        } else {
            // User doesn't exist - create placeholder entry and save it to backend
            const placeholderUser = {
                name: capitalizedName || cleanHandleValue,
                handle: cleanHandleValue,
                amount: 500,
                isPlaceholder: true,
                isSearched: true,
                profilePic: null
            };
            
            // Save placeholder to backend so it persists for all visitors
            try {
                await addToLeaderboard(placeholderUser.name, placeholderUser.handle, placeholderUser.amount, true);
                // Reload leaderboard data after saving
                await loadLeaderboard();
            } catch (error) {
                console.error('Error saving placeholder to leaderboard:', error);
            }
            
            // Get all current displayed entries (including placeholders)
            const currentDisplayedUsers = [];
            currentEntries.forEach((entry, idx) => {
                const nameEl = entry.querySelector('.entry-name');
                const handleEl = entry.querySelector('.entry-handle');
                const amountEl = entry.querySelector('.entry-amount');
                
                if (nameEl && handleEl) {
                    const name = nameEl.textContent.trim();
                    const handleText = handleEl.textContent.trim();
                    const handleMatch = handleText.match(/@(.+)/);
                    const entryHandle = handleMatch ? cleanHandle(handleMatch[1]) : '';
                    const amountText = amountEl?.textContent.trim() || '$0';
                    const amountMatch = amountText.match(/\$(\d+)/);
                    const amount = amountMatch ? parseInt(amountMatch[1]) : 0;
                    
                    // Check if this is a placeholder (has $500+ or is not in leaderboardData)
                    const isPlaceholder = amountText.includes('$500+') || 
                                        !leaderboardData.find(e => cleanHandle(e.handle) === entryHandle);
                    
                    currentDisplayedUsers.push({
                        name: name,
                        handle: entryHandle || handleText.replace('@', ''),
                        amount: amount,
                        isPlaceholder: isPlaceholder,
                        isSearched: false,
                        profilePic: null
                    });
                }
            });
            
            // Add the new placeholder to the list
            currentDisplayedUsers.push(placeholderUser);
            
            // Combine with real leaderboard entries (avoid duplicates)
            const allHandles = new Set(currentDisplayedUsers.map(u => cleanHandle(u.handle)));
            leaderboardData.forEach(entry => {
                if (!allHandles.has(cleanHandle(entry.handle))) {
                    currentDisplayedUsers.push({
                        ...entry,
                        isPlaceholder: false,
                        profilePic: null
                    });
                }
            });
            
            // Sort by amount (highest first), but placeholders go to bottom
            usersToShow = currentDisplayedUsers.sort((a, b) => {
                if (a.isPlaceholder && !b.isPlaceholder) return 1;
                if (!a.isPlaceholder && b.isPlaceholder) return -1;
                return b.amount - a.amount;
            });
        }
        
        // Always show the leaderboard
        displayLeaderboard(usersToShow);
        
        // Re-enable button immediately
        searchBtn.disabled = false;
        searchBtn.textContent = 'Search';
    } catch (error) {
        console.error('Error generating leaderboard:', error);
        alert('An error occurred. Please try again.');
        searchBtn.disabled = false;
        searchBtn.textContent = 'Search';
    }
}

// Handle claim button - show form modal
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

// Handle claim form submission
async function handleClaimSubmit(event) {
    event.preventDefault();
    
    const form = event.target;
    const formData = new FormData(form);
    const submitButton = form.querySelector('.btn-submit');
    
    const claimData = {
        firstName: formData.get('firstName'),
        lastName: formData.get('lastName'),
        city: formData.get('city'),
        state: formData.get('state'),
        name: formData.get('name'),
        amount: formData.get('amount')
    };
    
    // Close claim form modal and show progress modal
    closeClaimModal();
    
    // Small delay to ensure modal transition is smooth
    await new Promise(resolve => setTimeout(resolve, 300));
    
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
            
            // Add to leaderboard with real amount
            await addToLeaderboard(claimData.firstName + ' ' + claimData.lastName, claimData.name || (claimData.firstName + claimData.lastName).toLowerCase().replace(/\s+/g, ''), result.totalAmount, false);
            
            // Show results modal
            showResultsModal(claimData, result);
        } else if (result.success) {
            // Search completed successfully but no results found - still save to leaderboard with $0
            console.log('✅ Search completed successfully but no results found');
            console.log('💾 Saving claim to leaderboard with $0 amount');
            
            // Add to leaderboard with $0 amount (still a successful claim)
            await addToLeaderboard(claimData.firstName + ' ' + claimData.lastName, claimData.name || (claimData.firstName + claimData.lastName).toLowerCase().replace(/\s+/g, ''), 0, false);
            
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

// Show no results modal
function showNoResultsModal(claimData) {
    console.log('🎯 showNoResultsModal called');
    
    const modal = document.getElementById('claimModal');
    if (!modal) {
        console.error('❌ CRITICAL: claimModal element not found!');
        alert(`No unclaimed funds were found for ${claimData.firstName} ${claimData.lastName} in ${claimData.city}, ${claimData.state}.`);
        return;
    }
    
    const form = document.getElementById('claimForm');
    if (form) {
        form.style.display = 'none';
    }
    
    const modalContent = modal.querySelector('.modal-content');
    if (!modalContent) {
        console.error('❌ CRITICAL: modal-content element not found!');
        alert(`No unclaimed funds were found for ${claimData.firstName} ${claimData.lastName} in ${claimData.city}, ${claimData.state}.`);
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
                No unclaimed funds were found for <strong>${claimData.firstName} ${claimData.lastName}</strong> in <strong>${claimData.city}, ${claimData.state}</strong>.
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
    
    // Create results display
    let resultsHTML = `
        <div class="results-header">
            <h2>Unclaimed Funds Found</h2>
            <button class="modal-close" onclick="closeResultsModal()">&times;</button>
        </div>
        <div class="results-content">
            <div class="results-summary">
                <p class="results-name">${escapeHtml(claimData.firstName)} ${escapeHtml(claimData.lastName)}</p>
                <p class="results-location">${escapeHtml(claimData.city)}, ${escapeHtml(claimData.state)}</p>
                <div class="total-amount">
                    <span class="total-label">Total Unclaimed:</span>
                    <span class="total-value">$${searchResult.totalAmount.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
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
            <div class="results-actions">
                <button class="btn btn-submit" onclick="closeResultsModal()">Close</button>
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
    const searchBtn = document.getElementById('searchBtn');
    const searchInput = document.getElementById('instagramHandle');
    
    searchBtn.addEventListener('click', handleSearch);
    
    searchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
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
    
    // Auto-uppercase state input
    const stateInput = document.getElementById('state');
    if (stateInput) {
        stateInput.addEventListener('input', function(e) {
            e.target.value = e.target.value.toUpperCase();
        });
    }
    
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

// Make functions available globally for onclick handlers
window.handleClaim = handleClaim;
window.handleNotify = handleNotify;
window.closeClaimModal = closeClaimModal;
window.closeResultsModal = closeResultsModal;
window.handleClaimSubmit = handleClaimSubmit;

