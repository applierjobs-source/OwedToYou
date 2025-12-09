// Sample data for randomly generated users with Instagram handles
const sampleUsers = [
    { name: 'Alex Johnson', handle: 'alexjohnson' },
    { name: 'Sarah Martinez', handle: 'sarahmartinez' },
    { name: 'Michael Chen', handle: 'michaelchen' },
    { name: 'Emily Davis', handle: 'emilydavis' },
    { name: 'James Wilson', handle: 'jameswilson' },
    { name: 'Olivia Brown', handle: 'oliviabrown' },
    { name: 'David Lee', handle: 'davidlee' },
    { name: 'Sophia Garcia', handle: 'sophiagarcia' },
    { name: 'Daniel Rodriguez', handle: 'danielrodriguez' },
    { name: 'Isabella Taylor', handle: 'isabellataylor' },
    { name: 'Matthew Anderson', handle: 'matthewanderson' },
    { name: 'Emma Thomas', handle: 'emmathomas' },
    { name: 'Christopher Moore', handle: 'christophermoore' },
    { name: 'Ava Jackson', handle: 'avajackson' },
    { name: 'Andrew White', handle: 'andrewwhite' },
    { name: 'Mia Harris', handle: 'miaharris' },
    { name: 'Joshua Martin', handle: 'joshuamartin' },
    { name: 'Charlotte Thompson', handle: 'charlottethompson' },
    { name: 'Ryan Clark', handle: 'ryanclark' },
    { name: 'Amelia Lewis', handle: 'amelialewis' }
];

// Generate random amount in high hundreds
function generateRandomAmount() {
    return Math.floor(Math.random() * 200 + 800); // 800-999
}

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

// Generate random users for leaderboard (non-blocking, shows immediately)
function generateLeaderboard(searchHandle) {
    const users = [];
    const numUsers = 8;
    
    // Add the searched user first (if provided)
    if (searchHandle) {
        const cleanUsername = cleanHandle(searchHandle);
        const handleName = cleanUsername.replace(/_/g, ' ');
        const capitalizedName = handleName.split(' ').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
        
        users.push({
            name: capitalizedName || cleanUsername,
            handle: cleanUsername,
            amount: generateRandomAmount(),
            isSearched: true,
            profilePic: null // Will be loaded in background
        });
    }
    
    // Add random users
    const availableUsers = [...sampleUsers];
    const numRandomUsers = numUsers - users.length;
    
    for (let i = 0; i < numRandomUsers; i++) {
        const randomIndex = Math.floor(Math.random() * availableUsers.length);
        const user = availableUsers.splice(randomIndex, 1)[0];
        
        users.push({
            name: user.name,
            handle: user.handle,
            amount: generateRandomAmount(),
            isSearched: false,
            profilePic: null // Will be loaded in background
        });
    }
    
    // Sort by amount (highest first)
    users.sort((a, b) => b.amount - a.amount);
    
    return users;
}

// Load profile pictures in background and update UI
async function loadProfilePicturesInBackground(users) {
    // Load profile pictures for all users in parallel
    const profilePicPromises = users.map(async (user, index) => {
        console.log(`Fetching profile picture for ${user.handle}...`);
        const profilePic = await getInstagramProfilePicture(user.handle);
        console.log(`Profile picture result for ${user.handle}:`, profilePic ? 'Found' : 'Not found');
        
        if (profilePic) {
            // Update the profile picture in the DOM
            const entry = document.querySelectorAll('.leaderboard-entry')[index];
            if (entry) {
                const profilePictureDiv = entry.querySelector('.profile-picture');
                if (profilePictureDiv) {
                    const initials = getInitials(user.name);
                    const img = document.createElement('img');
                    img.src = profilePic;
                    img.alt = user.name;
                    img.style.width = '100%';
                    img.style.height = '100%';
                    img.style.borderRadius = '50%';
                    img.style.objectFit = 'cover';
                    img.onerror = function() {
                        this.remove();
                        profilePictureDiv.innerHTML = initials;
                        profilePictureDiv.style.display = 'flex';
                        profilePictureDiv.style.alignItems = 'center';
                        profilePictureDiv.style.justifyContent = 'center';
                    };
                    profilePictureDiv.innerHTML = '';
                    profilePictureDiv.appendChild(img);
                }
            }
        }
    });
    
    // Don't wait for all to complete, just fire and forget
    Promise.all(profilePicPromises).catch(err => {
        console.log('Some profile pictures failed to load:', err);
    });
}

// Create leaderboard entry HTML
function createEntryHTML(user, rank) {
    const initials = getInitials(user.name);
    const formattedAmount = `$${user.amount}`;
    const escapedName = user.name.replace(/'/g, "\\'");
    
    // Create profile picture HTML with fallback
    let profilePicHtml = '';
    if (user.profilePic) {
        profilePicHtml = `<img src="${user.profilePic}" alt="${escapedName}" onerror="this.onerror=null; this.style.display='none'; this.parentElement.innerHTML='${initials}'; this.parentElement.style.display='flex'; this.parentElement.style.alignItems='center'; this.parentElement.style.justifyContent='center';">`;
    } else {
        profilePicHtml = initials;
    }
    
    return `
        <div class="leaderboard-entry ${user.isSearched ? 'searched-user' : ''}">
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
                <button class="btn btn-claim" onclick="handleClaim('${escapedName}', ${user.amount})">
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
function handleSearch() {
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
        // Generate leaderboard immediately (synchronous, fast)
        const users = generateLeaderboard(handle);
        displayLeaderboard(users);
        
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
    modal.classList.add('hidden');
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
    
    // Disable submit button and show loading
    submitButton.disabled = true;
    submitButton.textContent = 'Searching...';
    
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
        
        if (result.success && result.results && result.results.length > 0) {
            // Show results modal
            showResultsModal(claimData, result);
        } else {
            // No results found
            alert(`No unclaimed funds found for ${claimData.firstName} ${claimData.lastName} in ${claimData.city}, ${claimData.state}.`);
            closeClaimModal();
        }
    } catch (error) {
        console.error('Error searching Missing Money:', error);
        alert('An error occurred while searching. Please try again.');
        submitButton.disabled = false;
        submitButton.textContent = 'Submit Claim';
    }
}

// Show results modal with unclaimed funds
function showResultsModal(claimData, searchResult) {
    const modal = document.getElementById('claimModal');
    const modalContent = modal.querySelector('.modal-content');
    
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
document.addEventListener('DOMContentLoaded', function() {
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
});

// Make functions available globally for onclick handlers
window.handleClaim = handleClaim;
window.handleNotify = handleNotify;
window.closeClaimModal = closeClaimModal;
window.closeResultsModal = closeResultsModal;
window.handleClaimSubmit = handleClaimSubmit;

