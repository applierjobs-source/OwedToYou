const { chromium } = require('playwright');
const { CloudflareSolver } = require('./cloudflareSolver');

// Limit concurrent browser instances to prevent resource exhaustion
let activeBrowserCount = 0;
// Make configurable via environment variable, default to 3 for reliability (reduced from 10)
// Lower number = more reliable, less resource exhaustion
const MAX_CONCURRENT_BROWSERS = parseInt(process.env.MAX_CONCURRENT_BROWSERS || '3', 10);
const browserQueue = [];
let processingQueue = false;
const QUEUE_TIMEOUT = 300000; // 5 minutes max wait time in queue (allow searches to wait)
const MAX_RETRIES = 2; // Maximum retries for resource exhaustion errors

// Semaphore to limit concurrent browser launches with timeout
async function acquireBrowserSlot() {
    return new Promise((resolve, reject) => {
        if (activeBrowserCount < MAX_CONCURRENT_BROWSERS) {
            activeBrowserCount++;
            console.log(`[BROWSER] Slot acquired immediately (${activeBrowserCount}/${MAX_CONCURRENT_BROWSERS})`);
            resolve();
        } else {
            console.log(`[BROWSER] All slots busy, queuing request (queue length: ${browserQueue.length + 1})`);
            const queueEntry = { resolve, timestamp: Date.now() };
            browserQueue.push(queueEntry);
            
            // Add timeout to queue entry
            const timeoutId = setTimeout(() => {
                const index = browserQueue.indexOf(queueEntry);
                if (index !== -1) {
                    browserQueue.splice(index, 1);
                    const waitTime = Math.round((Date.now() - queueEntry.timestamp) / 1000);
                    console.warn(`[BROWSER] Queue timeout after ${waitTime}s (queue length: ${browserQueue.length}, active: ${activeBrowserCount}/${MAX_CONCURRENT_BROWSERS})`);
                    reject(new Error('Server is processing many requests. Please wait a moment and try again.'));
                }
            }, QUEUE_TIMEOUT);
            
            queueEntry.timeoutId = timeoutId;
            processBrowserQueue();
        }
    });
}

function releaseBrowserSlot() {
    if (activeBrowserCount > 0) {
        activeBrowserCount--;
        console.log(`[BROWSER] Slot released (${activeBrowserCount}/${MAX_CONCURRENT_BROWSERS} active)`);
    } else {
        console.warn('[BROWSER] WARNING: releaseBrowserSlot called but activeBrowserCount is already 0 - possible double release');
    }
    // Always process queue after release
    processBrowserQueue();
}

function processBrowserQueue() {
    if (processingQueue) return;
    processingQueue = true;
    
    while (activeBrowserCount < MAX_CONCURRENT_BROWSERS && browserQueue.length > 0) {
        const queueEntry = browserQueue.shift();
        if (queueEntry && queueEntry.resolve) {
            clearTimeout(queueEntry.timeoutId);
            activeBrowserCount++;
            console.log(`[BROWSER] Slot acquired from queue (${activeBrowserCount}/${MAX_CONCURRENT_BROWSERS}, queue: ${browserQueue.length})`);
            queueEntry.resolve();
        }
    }
    
    processingQueue = false;
}

// Human-like delay function
function randomDelay(min = 100, max = 500) {
    return new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min) + min)));
}

// Human-like typing
async function humanType(page, selector, text) {
    const element = await page.$(selector);
    if (!element) return false;
    
    await element.click();
    await randomDelay(200, 400);
    
    // Type character by character with random delays
    for (const char of text) {
        await element.type(char, { delay: Math.random() * 100 + 50 });
        await randomDelay(50, 150);
    }
    
    return true;
}

// Convert state abbreviation to full state name
function getFullStateName(abbreviation) {
    const stateMap = {
        'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
        'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
        'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
        'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
        'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
        'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
        'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
        'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
        'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
        'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
        'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
        'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
        'WI': 'Wisconsin', 'WY': 'Wyoming', 'DC': 'District of Columbia'
    };
    
    const upperAbbr = abbreviation.toUpperCase().trim();
    return stateMap[upperAbbr] || abbreviation; // Return original if not found
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

// Expand a name to include common aliases/nicknames
function expandNameWithAliases(name) {
    if (!name) return [''];
    
    const normalizedName = name.trim().toLowerCase();
    const aliases = new Set([normalizedName]); // Always include the original name
    
    // Common name alias mappings (nickname -> full name and vice versa)
    const aliasMap = {
        // Common first name aliases
        'matt': ['matthew'],
        'matthew': ['matt'],
        'mike': ['michael'],
        'michael': ['mike'],
        'joe': ['joseph'],
        'joseph': ['joe'],
        'jim': ['james'],
        'james': ['jim', 'jimmy'],
        'jimmy': ['james'],
        'bob': ['robert'],
        'robert': ['bob', 'rob'],
        'rob': ['robert'],
        'dick': ['richard'],
        'richard': ['dick', 'rick'],
        'rick': ['richard'],
        'bill': ['william'],
        'william': ['bill', 'will'],
        'will': ['william'],
        'tom': ['thomas'],
        'thomas': ['tom'],
        'dan': ['daniel'],
        'daniel': ['dan'],
        'dave': ['david'],
        'david': ['dave'],
        'chris': ['christopher'],
        'christopher': ['chris'],
        'steve': ['steven', 'stephen'],
        'steven': ['steve'],
        'stephen': ['steve'],
        'andy': ['andrew'],
        'andrew': ['andy'],
        'brian': ['bryan'],
        'bryan': ['brian'],
        'phil': ['philip'],
        'philip': ['phil'],
        'tim': ['timothy'],
        'timothy': ['tim'],
        'jeff': ['jeffrey'],
        'jeffrey': ['jeff'],
        'greg': ['gregory'],
        'gregory': ['greg'],
        'ken': ['kenneth'],
        'kenneth': ['ken'],
        'larry': ['lawrence'],
        'lawrence': ['larry'],
        'ron': ['ronald'],
        'ronald': ['ron'],
        'don': ['donald'],
        'donald': ['don'],
        'ed': ['edward'],
        'edward': ['ed'],
        'frank': ['franklin'],
        'franklin': ['frank'],
        'jack': ['john'],
        'john': ['jack'],
        'nick': ['nicholas'],
        'nicholas': ['nick'],
        'pat': ['patrick', 'patricia'],
        'patrick': ['pat'],
        'ray': ['raymond'],
        'raymond': ['ray'],
        'sam': ['samuel'],
        'samuel': ['sam'],
        'tony': ['anthony'],
        'anthony': ['tony'],
        'alex': ['alexander'],
        'alexander': ['alex'],
        'ben': ['benjamin'],
        'benjamin': ['ben'],
        'charlie': ['charles'],
        'charles': ['charlie'],
        'fred': ['frederick'],
        'frederick': ['fred'],
        'harry': ['henry'],
        'henry': ['harry'],
        'louis': ['lewis'],
        'lewis': ['louis'],
        'mark': ['marcus'],
        'marcus': ['mark'],
        'nate': ['nathaniel'],
        'nathaniel': ['nate'],
        'pete': ['peter'],
        'peter': ['pete'],
        'ralph': ['ralph'],
        'sean': ['shawn', 'shaun'],
        'shawn': ['sean'],
        'shaun': ['sean'],
        'ted': ['theodore'],
        'theodore': ['ted'],
        'vince': ['vincent'],
        'vincent': ['vince'],
        'zach': ['zachary'],
        'zachary': ['zach'],
        // Common last name aliases (less common but possible)
        'smith': ['smyth'],
        'smyth': ['smith'],
        'johnson': ['johnston'],
        'johnston': ['johnson'],
        'brown': ['braun'],
        'braun': ['brown'],
        'miller': ['muller'],
        'muller': ['miller'],
        'wilson': ['willson'],
        'willson': ['wilson'],
        'moore': ['more'],
        'more': ['moore'],
        'taylor': ['tailor'],
        'tailor': ['taylor'],
        'anderson': ['andersen'],
        'andersen': ['anderson'],
        'thomas': ['tomas'],
        'tomas': ['thomas'],
        'jackson': ['jaxon'],
        'jaxon': ['jackson'],
        'white': ['whyte'],
        'whyte': ['white'],
        'harris': ['harries'],
        'harries': ['harris'],
        'martin': ['martyn'],
        'martyn': ['martin'],
        'thompson': ['thomson'],
        'thomson': ['thompson'],
        'garcia': ['garcia'],
        'rodriguez': ['rodrigues'],
        'rodrigues': ['rodriguez'],
        'lewis': ['louis'],
        'lee': ['leigh'],
        'leigh': ['lee'],
        'walker': ['wallker'],
        'hall': ['halle'],
        'allen': ['alan'],
        'alan': ['allen'],
        'young': ['younge'],
        'king': ['kinge'],
        'wright': ['write'],
        'lopez': ['lopaz'],
        'hill': ['hille'],
        'scott': ['scot'],
        'green': ['greene'],
        'adams': ['adam'],
        'baker': ['bakker'],
        'gonzalez': ['gonzales'],
        'nelson': ['nelsen'],
        'carter': ['karter'],
        'mitchell': ['mitchel'],
        'perez': ['perez'],
        'roberts': ['robert'],
        'turner': ['turnor'],
        'phillips': ['philips'],
        'campbell': ['campbel'],
        'parker': ['parkar'],
        'evans': ['evan'],
        'edwards': ['edward'],
        'collins': ['colin'],
        'stewart': ['stuart'],
        'sanchez': ['sanches'],
        'morris': ['morries'],
        'rogers': ['roger'],
        'reed': ['reid'],
        'cook': ['cooke'],
        'morgan': ['morgane'],
        'bell': ['belle'],
        'murphy': ['murphie'],
        'bailey': ['baile'],
        'rivera': ['riviera'],
        'cooper': ['cooper'],
        'richardson': ['richard'],
        'cox': ['cocks'],
        'howard': ['howarde'],
        'ward': ['warde'],
        'torres': ['torrez'],
        'peterson': ['petersen'],
        'gray': ['grey'],
        'ramirez': ['ramires'],
        'james': ['jame'],
        'watson': ['wattson'],
        'brooks': ['brook'],
        'kelly': ['kellie'],
        'sanders': ['sander'],
        'price': ['pryce'],
        'bennett': ['bennet'],
        'wood': ['woode'],
        'barnes': ['barn'],
        'ross': ['ros'],
        'henderson': ['henderson'],
        'coleman': ['cole'],
        'jenkins': ['jenkin'],
        'perry': ['perrie'],
        'powell': ['powel'],
        'long': ['longe'],
        'patterson': ['paterson'],
        'hughes': ['hugh'],
        'flores': ['flor'],
        'washington': ['wasington'],
        'butler': ['buttler'],
        'simmons': ['simon'],
        'foster': ['forster'],
        'gonzales': ['gonzalez'],
        'bryant': ['briant'],
        'alexander': ['alex'],
        'russell': ['russel'],
        'griffin': ['griffen'],
        'diaz': ['dias'],
        'hayes': ['hays']
    };
    
    // Check if the name has aliases
    if (aliasMap[normalizedName]) {
        aliasMap[normalizedName].forEach(alias => {
            aliases.add(alias.toLowerCase());
        });
    }
    
    // Also check reverse mappings (if someone searches for "Matthew", also check "Matt")
    // This is already handled by the bidirectional mapping above
    
    return Array.from(aliases);
}

async function searchMissingMoney(firstName, lastName, city, state, use2Captcha = false, captchaApiKey = null) {
    // CRITICAL: Log the exact names being searched for debugging
    console.log(`🔍🔍🔍 SEARCHING MISSING MONEY 🔍🔍🔍`);
    console.log(`🔍 Original names received: firstName="${firstName}", lastName="${lastName}"`);
    
    // Remove emojis from names before searching (safety measure)
    let cleanedFirstName = cleanNameForSearch(firstName);
    let cleanedLastName = cleanNameForSearch(lastName);
    
    console.log(`🔍 Cleaned names: "${firstName}" -> "${cleanedFirstName}", "${lastName}" -> "${cleanedLastName}"`);
    
    if (cleanedFirstName !== firstName || cleanedLastName !== lastName) {
        console.log(`🧹 Names were cleaned (emoji removal)`);
    }
    
    // CRITICAL FIX: Expand common nicknames to full names for better matching
    // missingmoney.com often has full names (e.g., "Benjamin") even if Instagram has nickname (e.g., "Ben")
    const firstNameAliases = expandNameWithAliases(cleanedFirstName);
    // Prefer full names over nicknames (e.g., "benjamin" over "ben")
    // Full names are typically longer, so sort by length descending
    const sortedAliases = firstNameAliases.sort((a, b) => b.length - a.length);
    if (sortedAliases.length > 0 && sortedAliases[0] !== cleanedFirstName.toLowerCase()) {
        // Use the longest alias (usually the full name) for the search
        const preferredFirstName = sortedAliases[0];
        console.log(`🔄 Expanding first name "${cleanedFirstName}" to "${preferredFirstName}" for better matching`);
        cleanedFirstName = preferredFirstName.charAt(0).toUpperCase() + preferredFirstName.slice(1);
    }
    
    // Convert state abbreviation to full name
    const fullStateName = getFullStateName(state);
    console.log(`Converting state "${state}" to "${fullStateName}"`);
    
    // Initialize 2captcha solver if API key provided
    let captchaSolver = null;
    console.log('🔍 Initializing 2captcha solver...');
    console.log('🔍 use2Captcha:', use2Captcha);
    console.log('🔍 captchaApiKey provided:', !!captchaApiKey);
    if (captchaApiKey) {
        console.log('🔍 API key (first 10 chars):', captchaApiKey.substring(0, 10) + '...');
    }
    if (use2Captcha && captchaApiKey) {
        captchaSolver = new CloudflareSolver(captchaApiKey);
        console.log('✅✅✅ 2CAPTCHA SOLVER INITIALIZED SUCCESSFULLY! ✅✅✅');
    } else {
        console.log('⚠️⚠️⚠️ 2CAPTCHA SOLVER NOT INITIALIZED ⚠️⚠️⚠️');
        console.log('⚠️ Reason: use2Captcha=' + use2Captcha + ', captchaApiKey=' + !!captchaApiKey);
    }
    
    // Acquire browser slot to limit concurrent instances (with timeout)
    let browser = null;
    let slotAcquired = false;
    
    try {
        await acquireBrowserSlot();
        slotAcquired = true;
        console.log(`[BROWSER] Acquired browser slot (${activeBrowserCount}/${MAX_CONCURRENT_BROWSERS} active)`);
    } catch (queueError) {
        // Queue timeout or other acquisition error
        // Convert to user-friendly message if it's a queue timeout
        let errorMessage = queueError.message || 'Unable to acquire browser slot. Please try again.';
        if (errorMessage.includes('Queue timeout') || errorMessage.includes('browser slots are busy')) {
            errorMessage = 'Server is processing many requests. Please wait a moment and try again.';
        }
        return {
            success: false,
            error: errorMessage,
            results: []
        };
    }
    
    // Overall timeout wrapper (5 minutes max) to allow searches to complete
    // Increased from 75s to allow for Cloudflare challenges and slow networks
    const overallTimeout = new Promise((_, reject) => {
        setTimeout(() => {
            const timeoutError = new Error('Search operation timed out - this is retryable');
            timeoutError._isRetryable = true;
            timeoutError._isTimeout = true;
            reject(timeoutError);
        }, 300000); // 5 minutes
    });
    
    const searchOperation = (async () => {
    let context = null;
    let page = null;
    try {
        // Launch browser with stealth settings
        // Note: Must use headless: true on Railway (no display server available)
        // The stealth techniques (user agent, viewport, etc.) still work in headless mode
        console.log('[BROWSER] Launching Chromium browser...');
        
        // Add timeout for browser launch to prevent hanging
        const browserLaunchPromise = chromium.launch({ 
            headless: true, // Required for Railway deployment (no X server)
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
                '--max-old-space-size=512' // Limit memory usage
            ],
            timeout: 60000 // 60 second timeout for browser launch (increased for reliability)
        });
        
        // Race browser launch against timeout
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                const timeoutError = new Error('Browser launch timeout - this is retryable');
                timeoutError._isRetryable = true;
                timeoutError._isTimeout = true;
                reject(timeoutError);
            }, 60000); // 60 seconds
        });
        
        browser = await Promise.race([browserLaunchPromise, timeoutPromise]);
        console.log('[BROWSER] Browser launched successfully');
        
        // Create context with realistic browser fingerprint
        // Updated user agent to Chrome 131 (more recent) to avoid outdated browser detection
        context = await browser.newContext({
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
        
        // Override webdriver property
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => false,
            });
            
            // Override chrome property
            window.chrome = {
                runtime: {},
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
        });
        
        page = await context.newPage();
        
        // Track form submission requests and responses
        const formSubmissionRequests = [];
        const ajaxResponses = [];
        
        // Set up network request interception to monitor form submissions
        await page.route('**/*', async (route) => {
            const request = route.request();
            const url = request.url();
            const method = request.method();
            
            // Log ALL POST requests to missingmoney.com to debug form submission
            if (method === 'POST' && url.includes('missingmoney.com')) {
                const postData = request.postData();
                const hasToken = postData && (postData.includes('cf-turnstile-response') || postData.includes('turnstile'));
                
                formSubmissionRequests.push({
                    url,
                    method,
                    timestamp: Date.now(),
                    hasToken: !!hasToken,
                    postData: postData ? postData.substring(0, 500) : null // First 500 chars for logging
                });
                
                console.log(`📤 POST request to missingmoney.com: ${method} ${url}`);
                console.log(`   Token present: ${hasToken}`);
                if (postData) {
                    console.log(`   POST data preview: ${postData.substring(0, 300)}`);
                }
            }
            
            // Also monitor POST requests that might be form submissions (broader pattern)
            if (method === 'POST' && (url.includes('claim-search') || url.includes('search') || url.includes('submit') || url.includes('/app/'))) {
                const postData = request.postData();
                const hasToken = postData && (postData.includes('cf-turnstile-response') || postData.includes('turnstile'));
                
                // Avoid duplicates
                const alreadyTracked = formSubmissionRequests.some(req => req.url === url && req.timestamp > Date.now() - 1000);
                if (!alreadyTracked) {
                    formSubmissionRequests.push({
                        url,
                        method,
                        timestamp: Date.now(),
                        hasToken: !!hasToken,
                        postData: postData ? postData.substring(0, 500) : null
                    });
                    
                    console.log(`📤 Form submission request detected: ${method} ${url}`);
                    console.log(`   Token present: ${hasToken}`);
                }
            }
            
            // Continue with the request
            await route.continue();
        });
        
        // Set up response monitoring to detect Cloudflare blocking
        page.on('response', async (response) => {
            const url = response.url();
            const status = response.status();
            
            // Monitor AJAX responses that might be blocked by Cloudflare
            if ((url.includes('claim-search') || url.includes('search') || url.includes('results') || url.includes('api'))) {
                if (status === 403 || status === 429 || status === 503) {
                    console.warn(`🚨 Cloudflare blocking detected in response: ${status} ${url}`);
                    ajaxResponses.push({
                        url: url,
                        status: status,
                        timestamp: Date.now(),
                        blocked: true
                    });
                } else if (status >= 200 && status < 300) {
                    ajaxResponses.push({
                        url: url,
                        status: status,
                        timestamp: Date.now(),
                        blocked: false
                    });
                    console.log(`✅ AJAX response received: ${status} ${url}`);
                }
            }
        });
        
        // Inject script to intercept turnstile.render BEFORE navigating
        // This is critical for Cloudflare Challenge pages
        await page.addInitScript(() => {
            // Intercept turnstile.render to capture cData, chlPageData, and action
            const originalRender = window.turnstile?.render;
            
            if (window.turnstile) {
                window.turnstile.render = function(container, options) {
                    console.log('🔍 Intercepted turnstile.render call');
                    const params = {
                        sitekey: options.sitekey,
                        cData: options.cData || null,
                        chlPageData: options.chlPageData || null,
                        action: options.action || null,
                        callback: options.callback || null
                    };
                    console.log('📋 Turnstile params:', JSON.stringify(params, null, 2));
                    
                    // Store globally for later use
                    window.__turnstileParams = params;
                    window.__turnstileCallback = options.callback;
                    
                    // Call original if it exists
                    if (originalRender) {
                        return originalRender.call(this, container, options);
                    }
                    return 'intercepted';
                };
            } else {
                // Wait for turnstile to load
                const checkInterval = setInterval(() => {
                    if (window.turnstile && !window.turnstile.__intercepted) {
                        window.turnstile.__intercepted = true;
                        const originalRender = window.turnstile.render;
                        window.turnstile.render = function(container, options) {
                            console.log('🔍 Intercepted turnstile.render call (delayed)');
                            const params = {
                                sitekey: options.sitekey,
                                cData: options.cData || null,
                                chlPageData: options.chlPageData || null,
                                action: options.action || null,
                                callback: options.callback || null
                            };
                            console.log('📋 Turnstile params:', JSON.stringify(params, null, 2));
                            
                            window.__turnstileParams = params;
                            window.__turnstileCallback = options.callback;
                            
                            if (originalRender) {
                                return originalRender.call(this, container, options);
                            }
                            return 'intercepted';
                        };
                        clearInterval(checkInterval);
                    }
                }, 100);
            }
        });
        
        // Navigate to Missing Money search page
        console.log('Navigating to Missing Money...');
        await page.goto('https://missingmoney.com/app/claim-search', { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });
        
        // IMMEDIATELY start filling form - Cloudflare happens AFTER submission, not before!
        console.log('🚀🚀🚀 FILLING FORM IMMEDIATELY - CLOUDFLARE COMES AFTER SUBMISSION! 🚀🚀🚀');
        
        // Minimal wait for page to settle
        await randomDelay(500, 800);
        
        // Human-like behavior: scroll and move mouse (minimal delay)
        await page.mouse.move(100, 100);
        await randomDelay(100, 200);
        await page.evaluate(() => window.scrollTo(0, 200));
        
        // Check for Cloudflare challenge BEFORE form filling (it might appear on initial page load)
        console.log('🔍 Checking for Cloudflare challenge on initial page load...');
        const initialChallengeCheck = await page.evaluate(() => {
            const hasCloudflare = document.body.innerText.includes('Please wait while we verify your browser') ||
                                 document.body.innerText.includes('Checking your browser') ||
                                 document.querySelectorAll('iframe[src*="cloudflare"], iframe[src*="challenge"]').length > 0 ||
                                 document.querySelectorAll('[data-sitekey], [class*="cf-"], [id*="cf-"]').length > 0;
            return hasCloudflare;
        });
        
        if (initialChallengeCheck && captchaSolver) {
            console.log('🚨 Cloudflare challenge detected BEFORE form filling! Solving...');
            
            // Extract site key and parameters
            const preSubmissionChallenge = await page.evaluate(() => {
                const info = {
                    siteKey: null,
                    action: null,
                    cData: null,
                    pagedata: null
                };
                
                // Try to get intercepted params
                if (window.__turnstileParams) {
                    info.siteKey = window.__turnstileParams.sitekey;
                    info.action = window.__turnstileParams.action;
                    info.cData = window.__turnstileParams.cData;
                    info.pagedata = window.__turnstileParams.chlPageData;
                }
                
                // Try to find site key in elements
                const turnstileEl = document.querySelector('[data-sitekey]');
                if (turnstileEl && !info.siteKey) {
                    info.siteKey = turnstileEl.getAttribute('data-sitekey');
                }
                
                // Try to extract from HTML
                if (!info.siteKey) {
                    const html = document.body.innerHTML + document.documentElement.outerHTML;
                    const matches = [
                        html.match(/sitekey["\s:=]+([^"'\s]{20,})/i),
                        html.match(/data-sitekey=["']([^"']+)["']/i),
                        html.match(/"sitekey":\s*"([^"]+)"/i)
                    ];
                    for (const match of matches) {
                        if (match && match[1] && match[1].length > 20) {
                            info.siteKey = match[1];
                            break;
                        }
                    }
                }
                
                return info;
            });
            
            if (preSubmissionChallenge.siteKey && preSubmissionChallenge.siteKey.length > 20) {
                try {
                    console.log('🎯 Solving pre-submission Cloudflare challenge...');
                    const result = await captchaSolver.solveTurnstile(
                        preSubmissionChallenge.siteKey,
                        page.url(),
                        preSubmissionChallenge.action,
                        preSubmissionChallenge.cData,
                        preSubmissionChallenge.pagedata
                    );
                    
                    // Inject token
                    const tokenInjected = await page.evaluate(({ token }) => {
                        const selectors = [
                            'input[name="cf-turnstile-response"]',
                            'input[id*="cf-turnstile"]',
                            'input[id*="turnstile"]',
                            'textarea[name="cf-turnstile-response"]'
                        ];
                        
                        for (const selector of selectors) {
                            const input = document.querySelector(selector);
                            if (input) {
                                input.value = token;
                                input.dispatchEvent(new Event('input', { bubbles: true }));
                                input.dispatchEvent(new Event('change', { bubbles: true }));
                                return true;
                            }
                        }
                        
                        // Try callback
                        if (window.__turnstileCallback && typeof window.__turnstileCallback === 'function') {
                            window.__turnstileCallback(token);
                            return true;
                        }
                        
                        return false;
                    }, { token: result.token });
                    
                    if (tokenInjected) {
                        console.log('✅ Pre-submission Cloudflare token injected');
                        // Wait longer and verify Cloudflare is cleared
                        await randomDelay(3000, 5000);
                        
                        // Verify Cloudflare challenge is gone
                        const cloudflareCleared = await page.evaluate(() => {
                            const hasChallenge = document.body.innerText.includes('Please wait while we verify your browser') ||
                                               document.body.innerText.includes('Checking your browser') ||
                                               document.querySelectorAll('iframe[src*="cloudflare"], iframe[src*="challenge"]').length > 0;
                            return !hasChallenge;
                        });
                        
                        if (cloudflareCleared) {
                            console.log('✅ Cloudflare challenge cleared, proceeding with form filling');
                        } else {
                            console.warn('⚠️ Cloudflare challenge may still be present, but proceeding anyway');
                        }
                    } else {
                        console.warn('⚠️ Could not inject pre-submission token');
                    }
                } catch (e) {
                    console.error('❌ Error solving pre-submission Cloudflare:', e.message);
                }
            } else {
                console.warn('⚠️ Pre-submission Cloudflare detected but no site key found');
            }
        } else {
            console.log('✅ No Cloudflare challenge detected on initial page load');
        }
        
        // Check for Cloudflare one more time right before form filling
        const finalPreFillCheck = await page.evaluate(() => {
            return {
                hasChallenge: document.body.innerText.includes('Please wait while we verify your browser') ||
                              document.body.innerText.includes('Checking your browser') ||
                              document.querySelectorAll('iframe[src*="cloudflare"], iframe[src*="challenge"]').length > 0,
                hasTurnstile: document.querySelectorAll('[data-sitekey], [class*="cf-"], [id*="cf-"]').length > 0
            };
        });
        
        if ((finalPreFillCheck.hasChallenge || finalPreFillCheck.hasTurnstile) && captchaSolver) {
            console.warn('⚠️ Cloudflare challenge detected right before form filling - waiting longer...');
            await randomDelay(5000, 7000); // Wait longer for Cloudflare to clear
        }
        
        // IMMEDIATELY start filling form
        console.log('🚀🚀🚀 STARTING FORM FILLING 🚀🚀🚀');
        
        // Quick check for form
        try {
            await page.waitForSelector('input, form', { timeout: 10000 }); // Increased timeout for reliability
        } catch (e) {
            console.log('Form not immediately visible, but continuing anyway...');
        }
        
        // List all inputs on the page
        const allInputs = await page.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input, select, textarea'));
            return inputs.map((inp, idx) => ({
                index: idx,
                type: inp.type || inp.tagName,
                name: inp.name || '',
                id: inp.id || '',
                placeholder: inp.placeholder || '',
                value: inp.value || ''
            }));
        });
        console.log(`Found ${allInputs.length} inputs on page`);
        
        // Fill out the form NOW - NO Cloudflare checks before!
        console.log('🚀 FILLING OUT FORM NOW...');
        
        // Use a more robust approach - fill by index if we can't find by name/id
        const fillField = async (value, fieldName, selectors) => {
            // If value is empty, consider it optional and return true (field doesn't need to be filled)
            if (!value || value.trim().length === 0) {
                console.log(`⏭️ Skipping ${fieldName} - value is empty (optional field)`);
                return true; // Return true for optional empty fields
            }
            
            for (const selector of selectors) {
                try {
                    const element = await page.$(selector);
                    if (element) {
                        const isVisible = await element.isVisible();
                        const isEnabled = await element.isEnabled();
                        if (!isVisible || !isEnabled) {
                            console.log(`Skipping ${fieldName} - element not visible or enabled`);
                            continue;
                        }
                        
                        // Scroll element into view
                        await element.scrollIntoViewIfNeeded();
                        await randomDelay(300, 500);
                        
                        // Move mouse to element (human-like)
                        const box = await element.boundingBox();
                        if (box) {
                            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                            await randomDelay(200, 400);
                        }
                        
                        const tagName = await element.evaluate(el => el.tagName.toLowerCase());
                        if (tagName === 'select') {
                            // Click to open dropdown
                            await element.click();
                            await randomDelay(500, 800);
                            
                            // For select, try by label/text first (most reliable), then value
                            try {
                                await element.selectOption({ label: value });
                                console.log(`✅ Filled ${fieldName} select with label: ${value}`);
                            } catch (e) {
                                try {
                                    await element.selectOption({ value: value });
                                    console.log(`✅ Filled ${fieldName} select with value: ${value}`);
                                } catch (e2) {
                                    // Try to find option by text content (case-insensitive partial match)
                                    const options = await element.$$('option');
                                    let found = false;
                                    for (const opt of options) {
                                        const optText = (await opt.textContent()).trim();
                                        if (optText.toLowerCase() === value.toLowerCase() || 
                                            optText.toLowerCase().includes(value.toLowerCase()) ||
                                            value.toLowerCase().includes(optText.toLowerCase())) {
                                            await opt.click();
                                            console.log(`✅ Selected option: ${optText}`);
                                            found = true;
                                            break;
                                        }
                                    }
                                    if (!found) {
                                        console.log(`⚠️ Could not find option matching: ${value}`);
                                    }
                                }
                            }
                            await randomDelay(300, 500);
                        } else {
                            // Simple, reliable method: focus, clear, fill
                            await element.focus();
                            await randomDelay(200, 300);
                            
                            // Select all and delete
                            await page.keyboard.press('Control+A');
                            await randomDelay(50, 100);
                            await page.keyboard.press('Delete');
                            await randomDelay(50, 100);
                            
                            // Type the value
                            await element.type(value, { delay: 50 });
                            
                            // Also use fill as backup
                            await element.fill(value);
                            
                            // Trigger events
                            await element.dispatchEvent('input');
                            await element.dispatchEvent('change');
                            await element.dispatchEvent('blur');
                            
                            // Verify
                            await randomDelay(100, 200);
                            const actualValue = await element.inputValue();
                            if (actualValue && actualValue.length > 0) {
                                console.log(`✅ Filled ${fieldName} with: ${value} (got: ${actualValue})`);
                            } else {
                                // Force it with evaluate
                                await element.evaluate((el, val) => {
                                    el.value = val;
                                    el.dispatchEvent(new Event('input', { bubbles: true }));
                                    el.dispatchEvent(new Event('change', { bubbles: true }));
                                }, value);
                                const forcedValue = await element.inputValue();
                                console.log(`✅ Force-filled ${fieldName}: ${forcedValue}`);
                            }
                        }
                        
                        await randomDelay(400, 600);
                        return true;
                    }
                } catch (e) {
                    console.log(`Error with selector ${selector} for ${fieldName}:`, e.message);
                    continue;
                }
            }
            return false;
        };
        
        // NOW FILL THE FORM FIELDS IMMEDIATELY - NO CLOUDFLARE CHECKS!
        // Try to fill last name first (it's the first field on Missing Money)
        console.log(`🔍 About to fill last name: "${cleanedLastName}"`);
        const lastNameFilled = await fillField(cleanedLastName, 'lastName', [
            'input[name*="lastName" i]',
            'input[id*="lastName" i]',
            'input[name*="last" i]',
            'input[id*="last" i]',
            'input[placeholder*="Last" i]',
            'input[type="text"]:nth-of-type(1)'
        ]);
        
        // CRITICAL: Log exactly what we're searching for
        console.log(`🔍🔍🔍 ABOUT TO SEARCH MISSING MONEY WEBSITE 🔍🔍🔍`);
        console.log(`🔍 Searching for: "${cleanedFirstName}" "${cleanedLastName}"`);
        console.log(`🔍 City: "${city || 'NOT PROVIDED'}", State: "${fullStateName || 'NOT PROVIDED'}"`);
        
        // Try to fill first name
        const firstNameFilled = await fillField(cleanedFirstName, 'firstName', [
            'input[name*="firstName" i]',
            'input[id*="firstName" i]',
            'input[name*="first" i]',
            'input[id*="first" i]',
            'input[placeholder*="First" i]',
            'input[placeholder*="name" i]',
            'input[type="text"]:nth-of-type(2)'
        ]);
        
        console.log(`🔍 First name filled: ${firstNameFilled ? 'YES' : 'NO'} with value: "${cleanedFirstName}"`);
        
        // Try to fill city
        const cityFilled = await fillField(city, 'city', [
            'input[name*="city" i]',
            'input[id*="city" i]',
            'input[placeholder*="City" i]',
            'input[type="text"]:nth-of-type(3)'
        ]);
        
        // Try to fill state (use full state name)
        const stateFilled = await fillField(fullStateName, 'state', [
            'select[name*="state" i]',
            'select[id*="state" i]',
            'select'
        ]);
        
        // If we couldn't fill required fields (first/last name), try filling all text inputs in order
        // Note: city and state are optional, so we only require first and last name
        if (!firstNameFilled || !lastNameFilled) {
            console.log('Trying to fill inputs by order (fallback method)...');
            
            // Get all visible inputs, excluding hidden and Turnstile inputs
            const allInputs = await page.$$('input, select');
            const visibleInputs = [];
            
            for (const input of allInputs) {
                try {
                    const isVisible = await input.isVisible();
                    const inputType = await input.evaluate(el => el.type || '');
                    const inputName = await input.evaluate(el => el.name || el.id || '');
                    
                    if (isVisible && 
                        inputType !== 'hidden' && 
                        !inputName.includes('turnstile') && 
                        !inputName.includes('cf-') &&
                        !inputName.includes('vendor') &&
                        !inputName.includes('host')) {
                        visibleInputs.push(input);
                    }
                } catch (e) {
                    continue;
                }
            }
            
            console.log(`Found ${visibleInputs.length} visible inputs to fill`);
            
            // Only fill first and last name if we have at least 2 inputs
            // City and state are optional on missingmoney.com
            if (visibleInputs.length >= 2) {
                const values = [lastName, firstName]; // Only required fields
                const fieldNames = ['lastName', 'firstName'];
                
                // Fill in order: last, first (based on Missing Money form order)
                for (let i = 0; i < Math.min(2, visibleInputs.length); i++) {
                    try {
                        const input = visibleInputs[i];
                        const tagName = await input.evaluate(el => el.tagName.toLowerCase());
                        
                        if (tagName === 'select') {
                            // For select dropdowns
                            await input.scrollIntoViewIfNeeded();
                            await randomDelay(200, 300);
                            await input.click();
                            await randomDelay(200, 300);
                            
                            try {
                                await input.selectOption({ label: values[i] });
                            } catch (e) {
                                try {
                                    await input.selectOption({ value: values[i] });
                                } catch (e2) {
                                    const options = await input.$$('option');
                                    for (const opt of options) {
                                        const optText = (await opt.textContent()).trim();
                                        if (optText.toLowerCase() === values[i].toLowerCase() || 
                                            optText.toLowerCase().includes(values[i].toLowerCase()) ||
                                            values[i].toLowerCase().includes(optText.toLowerCase())) {
                                            await opt.click();
                                            break;
                                        }
                                    }
                                }
                            }
                        } else {
                            // Simple, reliable method: focus, clear, fill
                            await visibleInputs[i].scrollIntoViewIfNeeded();
                            await randomDelay(200, 300);
                            
                            await visibleInputs[i].focus();
                            await randomDelay(200, 300);
                            
                            // Select all and delete
                            await page.keyboard.press('Control+A');
                            await randomDelay(50, 100);
                            await page.keyboard.press('Delete');
                            await randomDelay(50, 100);
                            
                            // Type the value
                            await visibleInputs[i].type(values[i], { delay: 50 });
                            
                            // Also use fill as backup
                            await visibleInputs[i].fill(values[i]);
                            
                            // Trigger events
                            await visibleInputs[i].dispatchEvent('input');
                            await visibleInputs[i].dispatchEvent('change');
                            await visibleInputs[i].dispatchEvent('blur');
                            
                            // Verify
                            await randomDelay(100, 200);
                            const actualValue = await visibleInputs[i].inputValue();
                            if (actualValue && actualValue.length > 0) {
                                console.log(`✅ Filled input ${i} (${fieldNames[i]}) with: ${values[i]} (got: ${actualValue})`);
                            } else {
                                // Force it with evaluate
                                await visibleInputs[i].evaluate((el, val) => {
                                    el.value = val;
                                    el.dispatchEvent(new Event('input', { bubbles: true }));
                                    el.dispatchEvent(new Event('change', { bubbles: true }));
                                }, values[i]);
                                const forcedValue = await visibleInputs[i].inputValue();
                                console.log(`✅ Force-filled input ${i} (${fieldNames[i]}): ${forcedValue}`);
                            }
                        }
                        
                        await randomDelay(300, 600);
                    } catch (e) {
                        console.log(`Error filling input ${i}:`, e.message);
                        continue;
                    }
                }
            } else {
                console.log('⚠️ Not enough visible inputs found for fallback method');
            }
        } else {
            console.log('✅ All fields filled successfully by name/id selectors');
        }
        
        // Check for required checkboxes (like "I agree" or captcha checkboxes)
        const checkboxes = await page.$$('input[type="checkbox"]');
        for (const checkbox of checkboxes) {
            try {
                const isVisible = await checkbox.isVisible();
                const isChecked = await checkbox.isChecked();
                const checkboxName = await checkbox.evaluate(el => el.name || el.id || '');
                
                // Skip hidden checkboxes and Turnstile-related checkboxes
                if (isVisible && !isChecked && 
                    !checkboxName.includes('turnstile') && 
                    !checkboxName.includes('cf-') &&
                    !checkboxName.includes('vendor') &&
                    !checkboxName.includes('host')) {
                    await checkbox.scrollIntoViewIfNeeded();
                    await randomDelay(200, 400);
                    await checkbox.click();
                    console.log('✅ Checked checkbox');
                    await randomDelay(300, 600);
                }
            } catch (e) {
                continue;
            }
        }
        
        // Take screenshot after filling
        await page.screenshot({ path: '/tmp/missing-money-filled.png', fullPage: true });
        console.log('Screenshot saved: /tmp/missing-money-filled.png');
        
        // Submit the form with human-like behavior
        console.log('Submitting form...');
        
        // Final check for Cloudflare right before submission and solve if needed
        const preSubmitCheck = await page.evaluate(() => {
            const turnstileEl = document.querySelector('[data-sitekey]');
            const tokenInput = document.querySelector('input[name="cf-turnstile-response"]');
            return {
                hasChallenge: document.body.innerText.includes('Please wait while we verify your browser') ||
                              document.body.innerText.includes('Checking your browser'),
                hasTurnstile: turnstileEl !== null,
                hasTokenInput: tokenInput !== null,
                siteKey: turnstileEl ? turnstileEl.getAttribute('data-sitekey') : null,
                tokenValue: tokenInput ? tokenInput.value : null
            };
        });
        
        // If Cloudflare challenge detected but no token, try to solve it
        if ((preSubmitCheck.hasChallenge || preSubmitCheck.hasTurnstile) && !preSubmitCheck.tokenValue && captchaSolver && preSubmitCheck.siteKey) {
            console.warn('⚠️ Cloudflare challenge detected right before submission - solving...');
            try {
                const result = await captchaSolver.solveTurnstile(preSubmitCheck.siteKey, page.url());
                const tokenInjected = await page.evaluate((token) => {
                    const input = document.querySelector('input[name="cf-turnstile-response"]') ||
                                 document.querySelector('input[id*="turnstile"]') ||
                                 document.querySelector('textarea[name="cf-turnstile-response"]');
                    if (input) {
                        input.value = token;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    }
                    return false;
                }, result.token);
                
                if (tokenInjected) {
                    console.log('✅ Cloudflare token injected before submission');
                    await randomDelay(3000, 5000); // Wait for Cloudflare to process
                }
            } catch (e) {
                console.error('❌ Error solving Cloudflare before submission:', e.message);
            }
        } else if (preSubmitCheck.hasChallenge || (preSubmitCheck.hasTurnstile && !preSubmitCheck.tokenValue)) {
            console.warn('⚠️ Cloudflare challenge detected but no solver available - waiting...');
            await randomDelay(5000, 7000); // Wait longer if we can't solve
        }
        
        // Verify Cloudflare token is in form before submitting (check multiple selectors for dynamic IDs)
        const tokenVerification = await page.evaluate(() => {
            const selectors = [
                'input[name="cf-turnstile-response"]',
                'input[id*="turnstile"]',
                'input[id*="cf-chl-widget"]',
                'input[id*="cf-turnstile"]',
                'textarea[name="cf-turnstile-response"]'
            ];
            
            let tokenInput = null;
            for (const selector of selectors) {
                tokenInput = document.querySelector(selector);
                if (tokenInput && tokenInput.value && tokenInput.value.length > 10) {
                    break;
                }
            }
            
            return {
                hasTokenInput: tokenInput !== null,
                tokenValue: tokenInput ? tokenInput.value : null,
                tokenLength: tokenInput ? tokenInput.value.length : 0,
                inputId: tokenInput ? tokenInput.id : null,
                inputName: tokenInput ? tokenInput.name : null
            };
        });
        
        console.log('🔍 Token verification before submission:', {
            hasTokenInput: tokenVerification.hasTokenInput,
            tokenLength: tokenVerification.tokenLength,
            hasToken: tokenVerification.tokenValue && tokenVerification.tokenValue.length > 0
        });
        
        if (!tokenVerification.hasTokenInput || !tokenVerification.tokenValue || tokenVerification.tokenValue.length < 10) {
            console.warn('⚠️⚠️⚠️ WARNING: Cloudflare token missing or invalid before form submission! ⚠️⚠️⚠️');
            console.warn('Token input exists:', tokenVerification.hasTokenInput);
            console.warn('Token value length:', tokenVerification.tokenLength);
            
            // Try to solve Cloudflare one more time if we have a solver
            if (captchaSolver && preSubmitCheck.siteKey) {
                console.log('🔄 Attempting to solve Cloudflare one more time before submission...');
                try {
                    const result = await captchaSolver.solveTurnstile(preSubmitCheck.siteKey, page.url());
                    const tokenInjected = await page.evaluate((token) => {
                        // Try multiple ways to inject token
                        const selectors = [
                            'input[name="cf-turnstile-response"]',
                            'input[id*="turnstile"]',
                            'input[id*="cf-"]',
                            'textarea[name="cf-turnstile-response"]'
                        ];
                        
                        for (const selector of selectors) {
                            const input = document.querySelector(selector);
                            if (input) {
                                input.value = token;
                                input.setAttribute('value', token);
                                input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                                input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                                input.dispatchEvent(new Event('keyup', { bubbles: true, cancelable: true }));
                                
                                // Also try to trigger Cloudflare callback if it exists
                                if (window.__turnstileCallback && typeof window.__turnstileCallback === 'function') {
                                    try {
                                        window.__turnstileCallback(token);
                                    } catch (e) {
                                        console.error('Callback error:', e);
                                    }
                                }
                                
                                return true;
                            }
                        }
                        
                        // If no input found, try to create one
                        const form = document.querySelector('form');
                        if (form) {
                            const hiddenInput = document.createElement('input');
                            hiddenInput.type = 'hidden';
                            hiddenInput.name = 'cf-turnstile-response';
                            hiddenInput.value = token;
                            form.appendChild(hiddenInput);
                            return true;
                        }
                        
                        return false;
                    }, result.token);
                    
                    if (tokenInjected) {
                        console.log('✅ Cloudflare token injected successfully before submission');
                        await randomDelay(5000, 7000); // Wait longer for Cloudflare to process
                    } else {
                        console.error('❌ Failed to inject Cloudflare token before submission');
                    }
                } catch (e) {
                    console.error('❌ Error solving Cloudflare before submission:', e.message);
                }
            }
        } else {
            console.log('✅ Cloudflare token verified in form before submission');
            // Still wait a bit to ensure Cloudflare has processed the token
            await randomDelay(3000, 5000);
        }
        
        // Wait a bit to ensure form is ready
        await randomDelay(2000, 3000); // Increased wait time
        
        let submitted = false;
        
        // Try multiple selectors for submit button
        const submitSelectors = [
            'button[type="submit"]',
            'input[type="submit"]',
            'button:has-text("Search")',
            'button:has-text("Submit")',
            'button:has-text("Find")',
            'button:has-text("Claim")',
            '[class*="submit"]',
            '[id*="submit"]',
            '[class*="search"]',
            '[id*="search"]',
            'button',
            'input[type="button"]'
        ];
        
        for (const selector of submitSelectors) {
            try {
                const button = await page.$(selector);
                if (button) {
                    const isVisible = await button.isVisible();
                    const buttonText = await button.textContent();
                    
                    if (isVisible && (buttonText.toLowerCase().includes('search') || 
                        buttonText.toLowerCase().includes('submit') ||
                        buttonText.toLowerCase().includes('find') ||
                        buttonText.toLowerCase().includes('claim') ||
                        selector.includes('submit') ||
                        selector.includes('search'))) {
                        await button.scrollIntoViewIfNeeded();
                        await randomDelay(300, 600);
                        
                        // Move mouse to button (human-like)
                        const box = await button.boundingBox();
                        if (box) {
                            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                            await randomDelay(200, 400);
                        }
                        
                        // Verify token one more time before clicking (check multiple selectors for dynamic IDs)
                        const tokenBeforeClick = await page.evaluate(() => {
                            const selectors = [
                                'input[name="cf-turnstile-response"]',
                                'input[id*="turnstile"]',
                                'input[id*="cf-chl-widget"]',
                                'input[id*="cf-turnstile"]',
                                'textarea[name="cf-turnstile-response"]'
                            ];
                            
                            for (const selector of selectors) {
                                const tokenInput = document.querySelector(selector);
                                if (tokenInput && tokenInput.value && tokenInput.value.length > 10) {
                                    return true;
                                }
                            }
                            return false;
                        });
                        
                        if (!tokenBeforeClick) {
                            console.warn('⚠️ Token missing before button click - skipping this button');
                            continue;
                        }
                        
                        await button.click();
                        submitted = true;
                        console.log('Form submitted via button click');
                        
                        // Wait for network request to complete
                        await randomDelay(2000, 3000);
                        
                        // Check if form submission request was made
                        const recentSubmissions = formSubmissionRequests.filter(req => req.timestamp > Date.now() - 5000);
                        const submissionMade = recentSubmissions.length > 0;
                        
                        if (!submissionMade) {
                            console.warn('⚠️ No form submission request detected after button click');
                        } else {
                            const latest = recentSubmissions[recentSubmissions.length - 1];
                            console.log(`✅ Form submission request detected: ${latest.method} ${latest.url}`);
                            console.log(`   Token present in request: ${latest.hasToken}`);
                        }
                        
                        await randomDelay(2000, 3000); // Additional wait
                        break;
                    }
                }
            } catch (e) {
                console.log(`Error with selector ${selector}:`, e.message);
                continue;
            }
        }
        
        if (!submitted) {
            // Try submitting the form directly - ensure Cloudflare token is included
            try {
                const form = await page.$('form');
                if (form) {
                    // Check if form has Cloudflare token before submitting
                    const hasToken = await form.evaluate((f) => {
                        const tokenInput = f.querySelector('input[name="cf-turnstile-response"]') ||
                                         f.querySelector('input[id*="turnstile"]');
                        return tokenInput && tokenInput.value && tokenInput.value.length > 10;
                    });
                    
                    if (!hasToken) {
                        console.warn('⚠️⚠️⚠️ Form does not have Cloudflare token - cannot submit! ⚠️⚠️⚠️');
                        // Don't submit without token - it will fail
                    } else {
                        console.log('✅ Form has Cloudflare token - submitting via form.submit()...');
                        await form.evaluate(f => f.submit());
                        submitted = true;
                        console.log('Form submitted via form.submit()');
                        await randomDelay(3000, 5000); // Wait longer after submission
                    }
                }
            } catch (e) {
                console.log('Could not submit form directly:', e.message);
            }
        }
        
        if (!submitted) {
            // Try pressing Enter on the last filled field
            await page.keyboard.press('Enter');
            console.log('Tried submitting via Enter key');
            await randomDelay(1000, 2000);
        }
        
        // CRITICAL: Verify form was actually submitted by checking URL change
        const urlBeforeWait = page.url();
        console.log('URL before waiting for navigation:', urlBeforeWait);
        
        // Wait a bit to see if URL changes (indicating form submission)
        await randomDelay(2000, 3000);
        const urlAfterWait = page.url();
        console.log('URL after waiting:', urlAfterWait);
        
        if (urlBeforeWait === urlAfterWait && urlBeforeWait.includes('claim-search')) {
            console.warn('⚠️⚠️⚠️ URL did not change - form submission may have failed! ⚠️⚠️⚠️');
            console.warn('Attempting to find and click submit button directly...');
            
            // Try to find and click submit button
            try {
                const submitClicked = await page.evaluate(() => {
                    const submitButtons = [
                        ...document.querySelectorAll('button[type="submit"]'),
                        ...document.querySelectorAll('input[type="submit"]'),
                        ...document.querySelectorAll('button:not([type])'),
                        ...document.querySelectorAll('[onclick*="submit"]')
                    ];
                    
                    for (const btn of submitButtons) {
                        if (btn.offsetParent !== null) { // Button is visible
                            btn.click();
                            return true;
                        }
                    }
                    return false;
                });
                
                if (submitClicked) {
                    console.log('✅ Submit button clicked directly');
                    await randomDelay(2000, 3000);
                } else {
                    console.warn('⚠️ Could not find visible submit button');
                }
            } catch (e) {
                console.error('Error clicking submit button:', e.message);
            }
        }
        
        // Wait for navigation OR results to appear (form might submit via AJAX)
        console.log('🔍🔍🔍 WAITING FOR FORM SUBMISSION RESPONSE 🔍🔍🔍');
        
        // Wait for either navigation OR results table to appear (AJAX submission)
        let resultsAppeared = false;
        let navigationOccurred = false;
        let ajaxBlocked = false;
        
        try {
            await Promise.race([
                // Wait for navigation
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).then(() => {
                    navigationOccurred = true;
                    console.log('✅ Navigation occurred');
                }).catch(() => {}),
                // Wait for results table to appear (AJAX submission)
                // Check for table with data OR "No properties" message (both indicate form submitted)
                page.waitForSelector('table, table tbody, .results-table, [class*="result"]', { timeout: 30000 }).then(() => {
                    resultsAppeared = true;
                    console.log('✅ Results table appeared on page (AJAX submission)');
                }).catch(() => {}),
                // Wait longer for AJAX responses
                page.waitForTimeout(10000) // Increased from 5s to 10s
            ]);
        } catch (e) {
            console.log('Wait completed or timed out');
        }
        
        // Check for Cloudflare blocking in AJAX responses
        const recentAjaxResponses = ajaxResponses.filter(resp => resp.timestamp > Date.now() - 15000);
        const blockedResponses = recentAjaxResponses.filter(resp => resp.blocked);
        
        if (blockedResponses.length > 0) {
            ajaxBlocked = true;
            console.warn(`🚨🚨🚨 CLOUDFLARE BLOCKING AJAX RESPONSES! 🚨🚨🚨`);
            console.warn(`   Blocked ${blockedResponses.length} response(s):`, blockedResponses.map(r => `${r.status} ${r.url}`));
        }
        
        // Check current URL to see if we navigated away from form page
        const currentUrlAfterSubmit = page.url();
        console.log('URL after form submission attempt:', currentUrlAfterSubmit);
        
        // Check if results table exists (even if empty - "No properties to display" means form submitted)
        const hasResultsTable = await page.evaluate(() => {
            const tables = document.querySelectorAll('table');
            return tables.length > 0;
        });
        
        if (hasResultsTable) {
            const tableContent = await page.evaluate(() => {
                const table = document.querySelector('table');
                if (!table) return null;
                return {
                    hasRows: table.querySelectorAll('tbody tr').length > 0,
                    text: table.innerText.substring(0, 200)
                };
            });
            
            console.log('📊 Results table status:', {
                exists: true,
                hasRows: tableContent?.hasRows || false,
                content: tableContent?.text || 'empty'
            });
            
            // If table exists (even with "No properties"), form submitted successfully
            if (tableContent && (tableContent.hasRows || tableContent.text.includes('No properties'))) {
                resultsAppeared = true;
                console.log('✅ Form submitted successfully - results table found');
            }
        }
        
        // If results appeared via AJAX, check if Cloudflare challenge is blocking results
        if (resultsAppeared || navigationOccurred) {
            console.log('✅ Form submission successful - results or navigation detected');
            
            // Even if results appeared, check if Cloudflare challenge is blocking actual data
            const cloudflareBlocking = await page.evaluate(() => {
                return document.body.innerText.includes('Please wait while we verify your browser') ||
                       document.body.innerText.includes('Checking your browser') ||
                       document.body.innerText.includes('Please check the box below to continue');
            });
            
            if (cloudflareBlocking) {
                console.warn('⚠️⚠️⚠️ Cloudflare challenge detected AFTER form submission - blocking results! ⚠️⚠️⚠️');
                console.log('⚠️ Solving Cloudflare challenge to load results...');
                ajaxBlocked = true; // Treat as blocked so we solve it
                resultsAppeared = false; // Reset so we go through Cloudflare solving flow
            }
        }
        
        // Handle Cloudflare challenges (either blocking AJAX or appearing after submission)
        if (ajaxBlocked || (!resultsAppeared && !navigationOccurred)) {
            console.warn('⚠️⚠️⚠️ AJAX responses blocked by Cloudflare - form may have submitted but results blocked ⚠️⚠️⚠️');
            console.log('⚠️ Checking for Cloudflare challenge to solve...');
        } else {
            console.log('⚠️ No results or navigation detected - checking for Cloudflare challenge...');
        }
        
        // ALWAYS check for Cloudflare challenge AFTER form submission (regardless of results status)
        // This handles cases where Cloudflare appears after submission and blocks results
        console.log('🔍🔍🔍 CHECKING FOR CLOUDFLARE CHALLENGE AFTER SUBMISSION 🔍🔍🔍');
        await randomDelay(2000, 3000); // Wait for Cloudflare to appear
        
        // Check for Cloudflare challenge AFTER submission
        const challengeInfoAfterSubmission = await page.evaluate(() => {
            const info = {
                hasMessage: document.body.innerText.includes('Please wait while we verify your browser') ||
                           document.body.innerText.includes('Checking your browser') ||
                           document.body.innerText.includes('Please check the box below to continue'),
                iframes: [],
                turnstileElements: []
            };
            
            // Find all iframes
            document.querySelectorAll('iframe').forEach((iframe, idx) => {
                const src = iframe.getAttribute('src') || '';
                const id = iframe.getAttribute('id') || '';
                const name = iframe.getAttribute('name') || '';
                info.iframes.push({
                    index: idx,
                    src: src.substring(0, 200),
                    id: id,
                    name: name,
                    isCloudflare: src.includes('cloudflare') || src.includes('challenge') || 
                                 id.includes('cf-') || name.includes('cf-')
                });
            });
            
            // Find Turnstile elements
            document.querySelectorAll('[data-sitekey], [class*="cf-"], [id*="cf-"], [data-ray], [id*="turnstile"]').forEach((el, idx) => {
                info.turnstileElements.push({
                    index: idx,
                    tag: el.tagName,
                    id: el.id || '',
                    className: el.className || '',
                    dataSitekey: el.getAttribute('data-sitekey') || '',
                    dataRay: el.getAttribute('data-ray') || ''
                });
            });
            
            return info;
        });
        
        console.log('Cloudflare detection after submission:', JSON.stringify(challengeInfoAfterSubmission, null, 2));
        
        // Handle Cloudflare challenge if present AFTER submission
        if (challengeInfoAfterSubmission.hasMessage || challengeInfoAfterSubmission.iframes.some(f => f.isCloudflare) || challengeInfoAfterSubmission.turnstileElements.length > 0) {
            console.log('🚨 Cloudflare challenge detected AFTER submission! Solving with 2captcha...');
            
            // Get intercepted params if available
            const interceptedParams = await page.evaluate(() => {
                return window.__turnstileParams || null;
            });
            
            let siteKey = null;
            let action = null;
            let cData = null;
            let pagedata = null;
            let callback = null;
            
            if (interceptedParams) {
                siteKey = interceptedParams.sitekey;
                action = interceptedParams.action;
                cData = interceptedParams.cData;
                pagedata = interceptedParams.chlPageData;
                callback = interceptedParams.callback;
            } else if (challengeInfoAfterSubmission.turnstileElements.length > 0) {
                const elemWithKey = challengeInfoAfterSubmission.turnstileElements.find(e => e.dataSitekey && e.dataSitekey.length > 20);
                if (elemWithKey) {
                    siteKey = elemWithKey.dataSitekey;
                }
            }
            
            // If no site key found, try to extract from page HTML
            if (!siteKey) {
                const extractedSiteKey = await page.evaluate(() => {
                    const html = document.body.innerHTML + document.documentElement.outerHTML;
                    const matches = [
                        html.match(/sitekey["\s:=]+([^"'\s]{20,})/i),
                        html.match(/data-sitekey=["']([^"']+)["']/i),
                        html.match(/"sitekey":\s*"([^"]+)"/i),
                        html.match(/sitekey:\s*"([^"]+)"/i),
                        html.match(/sitekey=([^"'\s&]{20,})/i)
                    ];
                    for (const match of matches) {
                        if (match && match[1] && match[1].length > 20) {
                            return match[1];
                        }
                    }
                    return null;
                });
                if (extractedSiteKey) {
                    siteKey = extractedSiteKey;
                }
            }
            
            // Use 2captcha to solve if available
            if (captchaSolver && siteKey && siteKey.length > 20) {
                console.log('🎯🎯🎯 SOLVING CLOUDFLARE WITH 2CAPTCHA AFTER SUBMISSION 🎯🎯🎯');
                console.log(`Site key: ${siteKey.substring(0, 40)}...`);
                try {
                    const result = await captchaSolver.solveTurnstile(siteKey, page.url(), action, cData, pagedata);
                    const token = result.token;
                    const userAgent = result.userAgent;
                    console.log('✅✅✅ 2CAPTCHA TOKEN RECEIVED AFTER SUBMISSION! ✅✅✅');
                    
                    // Inject token - try multiple selectors to find the correct input field
                    const tokenInjected = await page.evaluate(({ token }) => {
                        // Try multiple selectors for Cloudflare Turnstile token input
                        const selectors = [
                            'input[name="cf-turnstile-response"]',
                            'input[id*="cf-turnstile"]',
                            'input[id*="turnstile"]',
                            'input[name*="turnstile"]',
                            '#cf-chl-widget-khne3_response',
                            'input[type="hidden"][name*="cf"]'
                        ];
                        
                        let tokenInput = null;
                        for (const selector of selectors) {
                            tokenInput = document.querySelector(selector);
                            if (tokenInput) {
                                console.log(`Found token input with selector: ${selector}`);
                                break;
                            }
                        }
                        
                        if (tokenInput) {
                            tokenInput.value = token;
                            // Trigger multiple events to ensure Cloudflare detects the token
                            tokenInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                            tokenInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                            tokenInput.dispatchEvent(new Event('keyup', { bubbles: true, cancelable: true }));
                            
                            // Also set as attribute (some implementations check this)
                            tokenInput.setAttribute('value', token);
                            
                            console.log('Token injected into input field');
                            return true;
                        } else {
                            console.error('Could not find token input field!');
                            // Log all inputs for debugging
                            const allInputs = Array.from(document.querySelectorAll('input'));
                            console.log('Available inputs:', allInputs.map(inp => ({
                                name: inp.name,
                                id: inp.id,
                                type: inp.type,
                                className: inp.className
                            })));
                            return false;
                        }
                    }, { token });
                    
                    if (!tokenInjected) {
                        console.error('❌ Failed to inject token - input field not found!');
                    } else {
                        console.log('✅ Token injected into input field');
                    }
                    
                    // Set token in window for any scripts that might check it
                    await page.evaluate((token) => {
                        window.cfTurnstileToken = token;
                        window.dispatchEvent(new CustomEvent('cf-turnstile-token', { detail: { token } }));
                    }, token);
                    
                    // Try to execute stored callback if available
                    await page.evaluate((token) => {
                        if (window.__turnstileCallback && typeof window.__turnstileCallback === 'function') {
                            try { 
                                window.__turnstileCallback(token); 
                                console.log('Executed stored callback');
                            } catch (e) { 
                                console.error('Stored callback error:', e); 
                            }
                        }
                    }, token);
                    
                    // Execute callback if provided
                    if (callback && typeof callback === 'function') {
                        try {
                            await page.evaluate((token) => {
                                if (window.__turnstileCallback && typeof window.__turnstileCallback === 'function') {
                                    window.__turnstileCallback(token);
                                }
                            }, token);
                        } catch (e) {
                            console.error('Callback execution error:', e);
                        }
                    }
                    
                    // Try to trigger form submission if there's a form with the token
                    try {
                        const formSubmitted = await page.evaluate(() => {
                            // Look for form that might need resubmission
                            const forms = document.querySelectorAll('form');
                            for (const form of forms) {
                                const hasTokenInput = form.querySelector('input[name*="turnstile"], input[id*="turnstile"]');
                                if (hasTokenInput) {
                                    // Try to find and click submit button
                                    const submitBtn = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
                                    if (submitBtn) {
                                        submitBtn.click();
                                        return true;
                                    }
                                }
                            }
                            return false;
                        });
                        
                        if (formSubmitted) {
                            console.log('✅ Form resubmitted with token');
                            // Wait longer after resubmission
                            await randomDelay(5000, 7000);
                            
                            // Check if navigation occurred
                            const urlAfterResubmit = page.url();
                            console.log('URL after resubmission:', urlAfterResubmit);
                            
                            // Wait for navigation
                            try {
                                await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
                            } catch (e) {
                                console.log('Navigation wait after resubmission completed');
                            }
                        }
                    } catch (e) {
                        console.log('Could not resubmit form:', e.message);
                    }
                    
                    console.log('✅ Token injected, waiting for Cloudflare to process...');
                    await randomDelay(5000, 7000); // Increased wait time
                    
                    // Wait for verification to complete AND form to resubmit
                    let verificationComplete = false;
                    let formResubmitted = false;
                    const originalUrl = page.url();
                    
                    for (let i = 0; i < 30; i++) { // Increased from 20 to 30 iterations
                        const pageText = await page.evaluate(() => document.body.innerText);
                        const url = page.url();
                        console.log(`[CLOUDFLARE] Verification check ${i + 1}/30 - URL: ${url.substring(0, 100)}`);
                        
                        // Check if Cloudflare verification completed
                        const cloudflareGone = !pageText.includes('Please wait while we verify your browser') &&
                                             !pageText.includes('Checking your browser') &&
                                             !pageText.includes('Please check the box below to continue') &&
                                             !url.includes('challenge');
                        
                        // Check if form was resubmitted (URL changed or results appeared)
                        const urlChanged = url !== originalUrl && !url.includes('claim-search');
                        const hasResultsTable = await page.evaluate(() => {
                            return document.querySelector('table tbody') !== null;
                        });
                        const resultsAppeared = pageText.includes('No properties to display') || 
                                               hasResultsTable ||
                                               (pageText.match(/\$[\d,]+\.?\d*/) !== null);
                        
                        if (cloudflareGone && (urlChanged || resultsAppeared)) {
                            console.log('✅ Cloudflare verification completed AND form resubmitted!');
                            verificationComplete = true;
                            formResubmitted = true;
                            break;
                        } else if (cloudflareGone && i > 10) {
                            // Cloudflare is gone but form hasn't resubmitted - try to trigger it
                            console.log('⚠️ Cloudflare gone but form not resubmitted - attempting to trigger submission...');
                            const formTriggered = await page.evaluate(() => {
                                // Try to find and click submit button
                                const submitBtn = document.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
                                if (submitBtn && submitBtn.offsetParent !== null) { // Check if visible
                                    submitBtn.click();
                                    return true;
                                }
                                // Try to submit form directly
                                const form = document.querySelector('form');
                                if (form) {
                                    form.submit();
                                    return true;
                                }
                                return false;
                            });
                            
                            if (formTriggered) {
                                console.log('✅ Form submission triggered - waiting for results...');
                                await randomDelay(5000, 7000);
                                // Check again after triggering
                                const newUrl = page.url();
                                const newText = await page.evaluate(() => document.body.innerText);
                                const hasNewResultsTable = await page.evaluate(() => {
                                    return document.querySelector('table tbody') !== null;
                                });
                                if (newUrl !== url || newText.includes('No properties to display') || newText.match(/\$[\d,]+\.?\d*/) !== null || hasNewResultsTable) {
                                    formResubmitted = true;
                                    break;
                                }
                            }
                        }
                        
                        await randomDelay(1000, 2000);
                    }
                    
                    if (!verificationComplete) {
                        console.warn('⚠️ Cloudflare verification may not have completed - continuing anyway');
                    }
                    if (formResubmitted) {
                        console.log('✅ Form resubmitted after Cloudflare solve - updating flags...');
                        // Update flags to indicate form was resubmitted
                        resultsAppeared = true;
                        const currentUrlAfterResubmit = page.url();
                        navigationOccurred = (currentUrlAfterResubmit !== originalUrl && !currentUrlAfterResubmit.includes('claim-search'));
                        console.log(`Navigation occurred: ${navigationOccurred}, URL changed from ${originalUrl.substring(0, 50)} to ${currentUrlAfterResubmit.substring(0, 50)}`);
                        // Wait a bit more for results to load
                        await randomDelay(3000, 5000);
                    } else {
                        console.warn('⚠️ Form may not have resubmitted after Cloudflare solve - will check results anyway');
                    }
                } catch (e) {
                    console.error('❌ 2captcha failed after submission:', e.message);
                }
            } else {
                console.log('⚠️ No 2captcha solver or site key found after submission');
            }
        } else {
            console.log('✅ No Cloudflare challenge detected after submission');
        }
        
        // Wait for results to load - try multiple strategies
        console.log('Waiting for results...');
        
        // Wait for navigation or results to appear
        try {
            // Reduced timeouts to prevent hanging - use Promise.race with shorter timeouts
            await Promise.race([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {}), // Increased timeout
                page.waitForSelector('table, [class*="result"], [class*="claim"], [class*="table"], [id*="result"], [id*="claim"], tbody, [role="row"]', { timeout: 45000 }).catch(() => {}), // Increased timeout
                page.waitForFunction(
                    () => {
                        const text = document.body.innerText;
                        // Look for dollar signs that aren't in navigation/headers
                        const hasAmount = text.match(/\$[\d,]+\.?\d*/);
                        const hasResultIndicators = text.includes('Amount') || 
                                                   text.includes('Property') || 
                                                   text.includes('Claim') ||
                                                   text.includes('Entity') ||
                                                   text.includes('Holder');
                        return hasAmount && hasResultIndicators;
                    },
                    { timeout: 15000 }
                ).catch(() => {}),
                page.waitForTimeout(8000) // Reduced from 10s to 8s
            ]);
        } catch (e) {
            console.log('Waiting for results timed out, continuing...');
        }
        
        // Note: verificationComplete is set in the 2captcha block above if token injection succeeds
        // If we reach here and 2captcha wasn't used or didn't complete, we'll continue to results extraction
        
        // Wait for any AJAX/API calls to complete (with shorter timeout to prevent hanging)
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {
            console.log('Networkidle timeout - continuing anyway');
        });
        
        // Wait a bit more for any dynamic content to render (reduced from 5s to 2s)
        await page.waitForTimeout(2000);
        
        // Scroll down to trigger lazy loading if any
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1000); // Reduced from 2s to 1s
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(500); // Reduced from 1s to 0.5s
        
        // Take a screenshot for debugging
        await page.screenshot({ path: '/tmp/missing-money-results.png', fullPage: true });
        console.log('Screenshot saved: /tmp/missing-money-results.png');
        
        // Save page HTML for inspection
        const pageHTMLContent = await page.content();
        const fs = require('fs');
        fs.writeFileSync('/tmp/missing-money-page.html', pageHTMLContent);
        console.log('Page HTML saved to /tmp/missing-money-page.html');
        
        // Get page content after submission
        const finalUrl = page.url();
        const finalTitle = await page.title();
        console.log('Final URL:', finalUrl);
        console.log('Final title:', finalTitle);
        
        // Get all text content to see what's on the page (needed for error detection)
        const pageText = await page.evaluate(() => document.body.innerText);
        console.log('Page text sample (first 5000 chars):', pageText.substring(0, 5000));
        
        // CRITICAL: Check if we're still on the search form page (form submission may have failed)
        const isStillOnFormPage = finalUrl.includes('claim-search') && !finalUrl.includes('results') && !finalUrl.includes('claim-detail');
        if (isStillOnFormPage) {
            console.warn('⚠️⚠️⚠️ WARNING: Still on search form page - form submission may have failed! ⚠️⚠️⚠️');
            console.warn('This could indicate Cloudflare blocking or form submission failure');
            console.warn('Attempting to detect if form was actually submitted...');
            
            // Check if there's an error message on the page
            const hasError = pageText.toLowerCase().includes('error') || 
                            pageText.toLowerCase().includes('invalid') ||
                            pageText.toLowerCase().includes('required');
            if (hasError) {
                console.error('❌ Form submission error detected on page');
            }
        }
        
        // Check if URL changed (indicating form submission)
        const currentUrl = page.url();
        console.log('Current URL after submission:', currentUrl);
        
        // Get HTML structure for debugging
        const pageStructure = await page.evaluate(() => {
            // Get all tables
            const tables = Array.from(document.querySelectorAll('table')).map((table, idx) => {
                const rows = Array.from(table.querySelectorAll('tr')).map(row => {
                    const cells = Array.from(row.querySelectorAll('td, th')).map(cell => cell.innerText.trim());
                    return { cells, text: row.innerText.trim() };
                });
                return { index: idx, rows: rows.slice(0, 10) }; // First 10 rows
            });
            
            // Get all divs with dollar amounts
            const divsWithMoney = Array.from(document.querySelectorAll('div, span, p, td')).filter(el => {
                const text = el.innerText || '';
                return text.includes('$') && /\$[\d,]+\.?\d*/.test(text);
            }).slice(0, 20).map(el => ({
                tag: el.tagName,
                text: (el.innerText || '').substring(0, 200),
                html: el.innerHTML.substring(0, 300)
            }));
            
            return { tables, divsWithMoney, fullText: document.body.innerText.substring(0, 10000) };
        });
        
        console.log('Page structure:', JSON.stringify(pageStructure, null, 2));
        
        // Check if there are any results indicators
        const hasResults = pageText.toLowerCase().includes('found') || 
                          pageText.toLowerCase().includes('result') ||
                          pageText.toLowerCase().includes('claim') ||
                          pageText.toLowerCase().includes('property') ||
                          pageText.toLowerCase().includes('unclaimed');
        console.log('Page contains result indicators:', hasResults);
        
        // Check for "no results" messages (but be careful - "no results" might appear in instructions)
        // IMPORTANT: Be more strict - only mark as "no results" if we're CERTAIN there are no results
        const hasExplicitNoResults = pageText.toLowerCase().includes('no unclaimed funds found') ||
                                     pageText.toLowerCase().includes('no match');
        const hasDollarAmounts = pageText.match(/\$[\d,]+\.?\d*/);
        const noResults = hasExplicitNoResults && !hasDollarAmounts; // Only if explicit message AND no dollar amounts
        console.log('Page shows "no results":', noResults);
        console.log('Has explicit "no results" message:', hasExplicitNoResults);
        console.log('Has dollar amounts:', !!hasDollarAmounts);
        
        // Check for dollar amounts in the page
        const dollarAmounts = pageText.match(/\$[\d,]+\.?\d*/g);
        console.log('Dollar amounts found in page text:', dollarAmounts ? dollarAmounts.length : 0);
        if (dollarAmounts && dollarAmounts.length > 0) {
            console.log('Sample amounts:', dollarAmounts.slice(0, 10));
        }
        
        // Try to find results - look for amounts, entities, or result containers
        const results = await page.evaluate(() => {
            const data = [];
            
            // Strategy 1: Look for table rows with results (most common format)
            const tables = document.querySelectorAll('table');
            console.log('Found', tables.length, 'tables');
            
            // Debug: Log first table structure
            if (tables.length > 0) {
                const firstTable = tables[0];
                const firstRows = Array.from(firstTable.querySelectorAll('tr')).slice(0, 3);
                console.log('First table sample rows:', firstRows.map(row => ({
                    cellCount: row.querySelectorAll('td, th').length,
                    firstCells: Array.from(row.querySelectorAll('td, th')).slice(0, 5).map(c => c.innerText.trim().substring(0, 50)),
                    fullText: row.innerText.substring(0, 200)
                })));
            }
            tables.forEach((table, tableIdx) => {
                // Strategy: Use the `headers` attribute on td elements to find columns
                // This is more reliable than parsing header rows, especially when headers are hidden
                
                // Get all data rows (skip thead if present)
                const tbody = table.querySelector('tbody');
                const rows = tbody ? Array.from(tbody.querySelectorAll('tr')) : Array.from(table.querySelectorAll('tr')).slice(1);
                console.log(`Table ${tableIdx} has ${rows.length} data rows`);
                
                if (rows.length === 0) return;
                
                // Use first row to determine column structure via headers attribute
                const firstRow = rows[0];
                const firstRowCells = Array.from(firstRow.querySelectorAll('td, th'));
                
                // Find indices by looking for cells with specific headers attributes
                let reportingBusinessIdx = -1;
                let ownerNameIdx = -1;
                let amountIdx = -1;
                
                firstRowCells.forEach((cell, idx) => {
                    const headers = cell.getAttribute('headers') || '';
                    const cellText = (cell.innerText || cell.textContent || '').toLowerCase();
                    
                    // Check headers attribute first (most reliable)
                    if (headers.includes('propholderName') || headers.includes('holderName') || headers.includes('holder')) {
                        reportingBusinessIdx = idx;
                    } else if (headers.includes('propownerName') || headers.includes('ownerName') || headers.includes('owner')) {
                        ownerNameIdx = idx;
                    } else if (headers.includes('proppropertyValueDescription') || headers.includes('amount') || headers.includes('value')) {
                        amountIdx = idx;
                    }
                    // Fallback: check cell text for header-like content
                    else if (cellText.includes('reporting business') || cellText.includes('business name') || cellText.includes('holder')) {
                        if (reportingBusinessIdx === -1) reportingBusinessIdx = idx;
                    } else if (cellText.includes('owner name') || (cellText.includes('owner') && !cellText.includes('co-owner'))) {
                        if (ownerNameIdx === -1) ownerNameIdx = idx;
                    } else if (cellText.includes('amount') || cellText.includes('value')) {
                        if (amountIdx === -1) amountIdx = idx;
                    }
                });
                
                // If we couldn't find via headers, try to infer from structure
                // Standard structure: [Select, Owner, Co-Owner, Business, Address, City, State, ZIP, Held In, Amount]
                if (reportingBusinessIdx === -1 && firstRowCells.length > 3) {
                    // Try index 3 first (most common), but also check if any cell looks like a business name
                    reportingBusinessIdx = 3; // Usually index 3
                    
                    // Also try to find by scanning cells for business-like text
                    for (let i = 0; i < firstRowCells.length; i++) {
                        const cellText = (firstRowCells[i].innerText || '').toLowerCase();
                        if (cellText.includes('business') || cellText.includes('holder') || 
                            cellText.includes('reporting')) {
                            reportingBusinessIdx = i;
                            break;
                        }
                    }
                }
                if (amountIdx === -1 && firstRowCells.length > 0) {
                    amountIdx = firstRowCells.length - 1; // Usually last column
                    
                    // Also try to find by scanning for amount-like text
                    for (let i = firstRowCells.length - 1; i >= 0; i--) {
                        const cellText = (firstRowCells[i].innerText || '').toUpperCase();
                        if (cellText.includes('AMOUNT') || cellText.includes('$') || 
                            cellText.includes('UNDER') || cellText.includes('OVER') ||
                            cellText.includes('TO')) {
                            amountIdx = i;
                            break;
                        }
                    }
                }
                
                console.log(`Table ${tableIdx} column indices (via headers):`, {
                    reportingBusiness: reportingBusinessIdx,
                    ownerName: ownerNameIdx,
                    amount: amountIdx,
                    totalCells: firstRowCells.length
                });
                
                rows.forEach((row, rowIdx) => {
                    const cells = Array.from(row.querySelectorAll('td, th'));
                    if (cells.length < 2) return;
                    
                    const rowText = (row.innerText || row.textContent || '').toLowerCase();
                    
                    // Skip if it's a header row or doesn't contain relevant data
                    if (rowText.includes('select') && rowText.includes('action') && rowText.includes('owner')) {
                        return; // This is a header row
                    }
                    
                    // Look for amount indicators (ranges like "OVER $100", "$25 TO $50", "UNDER $250", or dollar signs)
                    const hasAmount = rowText.includes('$') || 
                                     rowText.includes('over') || 
                                     rowText.includes('under') ||
                                     rowText.includes('to $') ||
                                     rowText.includes('undisclosed') ||
                                     /over\s+\$[\d,]+/i.test(rowText) ||
                                     /under\s+\$[\d,]+/i.test(rowText) ||
                                     /\$\d+\s+to\s+\$\d+/i.test(rowText);
                    
                    if (!hasAmount) return;
                    
                    // CRITICAL FIX: Extract entity name - use Reporting Business column (the company holding the funds)
                    // NOT the Owner Name column (which is the person's name we searched for)
                    let entity = '';
                    let amount = '';
                    let ownerName = ''; // Store owner name separately for validation
                    
                    // Extract Reporting Business (the entity/company holding the funds)
                    if (reportingBusinessIdx >= 0 && cells[reportingBusinessIdx]) {
                        entity = cells[reportingBusinessIdx].innerText.trim();
                    }
                    
                    // Also try to find by headers attribute as fallback (for Reporting Business)
                    if ((!entity || entity.length < 2)) {
                        for (const cell of cells) {
                            const headers = cell.getAttribute('headers') || '';
                            if (headers.includes('propholderName') || headers.includes('holderName') || headers.includes('holder') ||
                                headers.includes('reporting') || headers.includes('business')) {
                                entity = cell.innerText.trim();
                                break;
                            }
                        }
                    }
                    
                    // Fallback: try to infer Reporting Business column (usually index 3 or 4)
                    if ((!entity || entity.length < 2) && cells.length > 3) {
                        // Standard structure: [Select, Owner, Co-Owner, Business, Address, City, State, ZIP, Held In, Amount]
                        // Business is usually at index 3 or 4
                        for (let i = 3; i < Math.min(5, cells.length); i++) {
                            const cellText = cells[i].innerText.trim();
                            // Look for business-like text (longer names, may contain business indicators)
                            if (cellText && cellText.length > 2 && cellText.length < 200 &&
                                !cellText.match(/^(claim|select|view|info|undisclosed)$/i) &&
                                !cellText.match(/^\$[\d,]+\.?\d*$/) &&
                                !cellText.match(/^(over|under|to|\$25|\$50|\$100|\$250)$/i) &&
                                !cellText.match(/^[A-Z]{2}$/) && // Not state code
                                !cellText.match(/^\d{5}$/) && // Not ZIP
                                !cellText.match(/^[A-Z]{2}\s+\d{5}$/)) { // Not "TX 78731"
                                entity = cellText;
                                break;
                            }
                        }
                    }
                    
                    // Extract Owner Name for validation (to ensure this row matches the person we're searching for)
                    if (ownerNameIdx >= 0 && cells[ownerNameIdx]) {
                        ownerName = cells[ownerNameIdx].innerText.trim();
                    } else {
                        // Fallback: try to find Owner Name column
                        for (const cell of cells) {
                            const headers = cell.getAttribute('headers') || '';
                            if (headers.includes('propownerName') || headers.includes('ownerName') || headers.includes('owner')) {
                                ownerName = cell.innerText.trim();
                                break;
                            }
                        }
                    }
                    
                    // If no Reporting Business found, skip this row
                    if ((!entity || entity.length < 2)) {
                        // Skip rows without a valid Reporting Business
                        return;
                    }
                    
                    // Extract amount - look for amount column using index or headers
                    // CRITICAL: Must find the actual dollar amount, not button text
                    if (amountIdx >= 0 && cells[amountIdx]) {
                        const amountCellText = cells[amountIdx].innerText.trim().toUpperCase();
                        // Convert "UNDISCLOSED" to "$100"
                        if (amountCellText === 'UNDISCLOSED') {
                            amount = '$100';
                        } else if (amountCellText.includes('$') || 
                                   /over|under|to\s+\$|\$\d+/i.test(amountCellText) ||
                                   amountCellText.includes('UNDER') ||
                                   amountCellText.includes('OVER')) {
                            amount = amountCellText;
                        }
                    }
                    
                    // Try to find by headers attribute (most reliable)
                    if (!amount || !amount.includes('$')) {
                        for (const cell of cells) {
                            const headers = cell.getAttribute('headers') || '';
                            if (headers.includes('proppropertyValueDescription') || headers.includes('amount')) {
                                const cellText = cell.innerText.trim().toUpperCase();
                                // Convert "UNDISCLOSED" to "$100"
                                if (cellText === 'UNDISCLOSED') {
                                    amount = '$100';
                                    break;
                                } else if (cellText.includes('$') || /over|to\s+\$|\$\d+/i.test(cellText)) {
                                    amount = cellText;
                                    break;
                                }
                            }
                        }
                    }
                    
                    // Fallback: search in row text for amount patterns (MUST have dollar sign)
                    // Also check for "UNDISCLOSED"
                    if (!amount || !amount.includes('$')) {
                        // Check for "UNDISCLOSED" first
                        if (rowText.toUpperCase().includes('UNDISCLOSED')) {
                            amount = '$100';
                        } else {
                            const amountPatterns = [
                                /over\s+\$[\d,]+/i,
                                /\$\d+[\s,]*to[\s,]*\$\d+/i,
                                /\$[\d,]+\.?\d*/g
                            ];
                            
                            for (const pattern of amountPatterns) {
                                const match = rowText.match(pattern);
                                if (match && match[0].includes('$')) {
                                    amount = match[0].toUpperCase();
                                    break;
                                }
                            }
                        }
                    }
                    
                    // CRITICAL: If amount is still "CLAIM" or doesn't have $, search entire row more aggressively
                    if (!amount || amount === 'CLAIM' || !amount.includes('$')) {
                        // Search all cells for amount patterns or UNDISCLOSED
                        for (const cell of cells) {
                            const cellText = cell.innerText.trim().toUpperCase();
                            // Check for UNDISCLOSED first
                            if (cellText === 'UNDISCLOSED') {
                                amount = '$100';
                                break;
                            } else if (cellText.includes('$') && (cellText.includes('OVER') || cellText.includes('TO') || /\$\d+/.test(cellText))) {
                                amount = cellText;
                                break;
                            }
                        }
                    }
                    
                    // If we found an entity and amount indicator, add it
                    if (entity && entity.length > 2 && amount) {
                        // Clean up entity name - handle HTML entities like &amp;
                        entity = entity.replace(/\s+/g, ' ').trim();
                        entity = entity.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                        
                        // Remove button text and action words (CLAIM, VIEW, SELECT, INFO, etc.)
                        // Be careful - only remove if it's at the end, not if it's part of the entity name
                        entity = entity.replace(/\s*:\s*(CLAIM|VIEW|SELECT|INFO|REMOVE|SHARE)\s*$/i, '');
                        entity = entity.replace(/\s+(CLAIM|VIEW|SELECT|INFO|REMOVE|SHARE)\s*$/i, '');
                        entity = entity.trim();
                        
                        // Only skip if entity is completely empty after cleaning
                        // DO NOT filter based on specific names or "Undisclosed" - include everything
                        if (!entity || entity.length < 1) {
                            return;
                        }
                        
                        data.push({
                            entity: entity.substring(0, 200),
                            amount: amount,
                            details: row.innerText.substring(0, 500)
                        });
                    } else {
                        // Debug: log rows that didn't match
                        if (rowIdx < 5) {
                            console.log(`Row ${rowIdx} skipped:`, {
                                hasEntity: !!entity,
                                entityLength: entity ? entity.length : 0,
                                hasAmount: !!amount,
                                rowText: rowText.substring(0, 200)
                            });
                        }
                    }
                });
            });
            
            console.log(`Strategy 1 found ${data.length} results from tables`);
            
            // If Strategy 1 found results but they're too few, try a more aggressive approach
            if (data.length > 0 && data.length < 10) {
                console.log('Strategy 1 found some results but fewer than expected, trying enhanced extraction...');
                
                tables.forEach((table, tableIdx) => {
                    const rows = Array.from(table.querySelectorAll('tr')).slice(1);
                    
                    rows.forEach((row) => {
                        const cells = Array.from(row.querySelectorAll('td, th'));
                        if (cells.length < 3) return;
                        
                        const rowText = row.innerText || row.textContent || '';
                        const lowerRowText = rowText.toLowerCase();
                        
                        // Skip header rows
                        if (lowerRowText.includes('select') && lowerRowText.includes('action') && lowerRowText.includes('owner')) {
                            return;
                        }
                        
                        // Look for any amount indicator
                        const hasAmount = /over\s+\$[\d,]+/i.test(rowText) ||
                                        /\$\d+[\s,]*to[\s,]*\$\d+/i.test(rowText) ||
                                        /\$[\d,]+\.?\d*/.test(rowText) ||
                                        lowerRowText.includes('over $') ||
                                        lowerRowText.includes('to $');
                        
                        if (!hasAmount) return;
                        
                        // Extract all cell texts
                        const cellTexts = cells.map(cell => cell.innerText.trim()).filter(t => t.length > 0);
                        
                        // CRITICAL FIX: Find entity - use Reporting Business (the company holding the funds)
                        // NOT Owner Name (which is the person's name)
                        let entity = '';
                        let amount = '';
                        let ownerName = '';
                        
                        // Try to find Reporting Business column first
                        // Look for business names (may be longer, can contain business indicators)
                        for (const cellText of cellTexts) {
                            if (cellText.length > 2 && 
                                cellText.length < 200 &&
                                !cellText.match(/^(claim|select|view|info|undisclosed)$/i) &&
                                !cellText.match(/^\$[\d,]+\.?\d*$/) &&
                                !cellText.match(/^(over|to|\$25|\$50|\$100)$/i) &&
                                !cellText.match(/^[A-Z]{2}$/) &&
                                !cellText.match(/^\d{5}$/) &&
                                !cellText.match(/^[A-Z]{2}\s+\d{5}$/)) {
                                // Accept business names (can be longer, may contain LLC, INC, etc.)
                                // OR personal names (for cases where business name isn't clearly identified)
                                entity = cellText;
                                break;
                            }
                        }
                        
                        // If no entity found, skip this row
                        if ((!entity || entity.length < 2)) {
                            return; // Skip rows without a valid entity
                        }
                        
                        // Extract amount
                        // Check for "UNDISCLOSED" first
                        if (rowText.toUpperCase().includes('UNDISCLOSED')) {
                            amount = '$100';
                        } else {
                            const amountMatch = rowText.match(/(over\s+\$[\d,]+|\$\d+[\s,]*to[\s,]*\$\d+|\$[\d,]+\.?\d*)/i);
                            if (amountMatch) {
                                amount = amountMatch[0].toUpperCase().trim();
                            }
                        }
                        
                        // Add if we have both
                        if (entity && entity.length > 2 && amount) {
                            // Check if we already have this entity-amount combination
                            const key = `${entity}-${amount}`;
                            if (!data.some(r => `${r.entity}-${r.amount}` === key)) {
                                data.push({
                                    entity: entity.substring(0, 200),
                                    amount: amount,
                                    details: rowText.substring(0, 500)
                                });
                            }
                        }
                    });
                });
                
                console.log(`Enhanced extraction found ${data.length} total results`);
            }
            
            // CRITICAL FALLBACK: If we still have very few results but page shows results exist, 
            // extract ALL table rows with amounts regardless of entity detection
            if (data.length < 20) {
                console.log('⚠️ Still have few results, trying critical fallback extraction...');
                
                // Check if page text indicates results exist
                const pageText = document.body.innerText || '';
                const resultsCountMatch = pageText.match(/returned\s+(\d+)\s+unclaimed/i) || 
                                         pageText.match(/(\d+)\s+unclaimed\s+propert/i);
                
                if (resultsCountMatch) {
                    const expectedCount = parseInt(resultsCountMatch[1]);
                    console.log(`Page indicates ${expectedCount} results should exist, but we only found ${data.length}`);
                    
                    // Extract ALL rows with amounts, even if entity detection fails
                    tables.forEach((table) => {
                        const rows = Array.from(table.querySelectorAll('tr')).slice(1);
                        if (rows.length === 0) return;
                        
                        // Calculate column indices for this table (same logic as above)
                        const firstRow = rows[0];
                        const firstRowCells = Array.from(firstRow.querySelectorAll('td, th'));
                        let reportingBusinessIdx = -1;
                        
                        // Find Reporting Business column index
                        firstRowCells.forEach((cell, idx) => {
                            const headers = cell.getAttribute('headers') || '';
                            const cellText = (cell.innerText || cell.textContent || '').toLowerCase();
                            
                            if (headers.includes('propholderName') || headers.includes('holderName') || headers.includes('holder') ||
                                headers.includes('reporting') || headers.includes('business')) {
                                reportingBusinessIdx = idx;
                            } else if (cellText.includes('reporting business') || cellText.includes('business name') || 
                                      cellText.includes('holder') || cellText.includes('reporting')) {
                                if (reportingBusinessIdx === -1) reportingBusinessIdx = idx;
                            }
                        });
                        
                        // Fallback: try index 3 or 4 if not found (Business is usually at index 3 or 4)
                        if (reportingBusinessIdx === -1 && firstRowCells.length > 3) {
                            reportingBusinessIdx = 3; // Usually index 3
                        }
                        
                        rows.forEach((row) => {
                            const cells = Array.from(row.querySelectorAll('td, th'));
                            if (cells.length < 3) return;
                            
                            const rowText = row.innerText || row.textContent || '';
                            const lowerRowText = rowText.toLowerCase();
                            
                            // Skip header rows
                            if (lowerRowText.includes('select') && lowerRowText.includes('action') && lowerRowText.includes('owner')) {
                                return;
                            }
                            
                            // Must have amount indicator
                            const hasAmount = /over\s+\$[\d,]+/i.test(rowText) ||
                                            /\$\d+[\s,]*to[\s,]*\$\d+/i.test(rowText) ||
                                            /\$[\d,]+\.?\d*/.test(rowText);
                            
                            if (!hasAmount) return;
                            
                            // Extract amount
                            let amount = '';
                            // Check for "UNDISCLOSED" first
                            if (rowText.toUpperCase().includes('UNDISCLOSED')) {
                                amount = '$100';
                            } else {
                                const amountMatch = rowText.match(/(over\s+\$[\d,]+|\$\d+[\s,]*to[\s,]*\$\d+|\$[\d,]+\.?\d*)/i);
                                if (amountMatch) {
                                    amount = amountMatch[0].toUpperCase().trim();
                                }
                            }
                            
                            // CRITICAL FIX: Find Reporting Business from cells (NOT Owner Name)
                            let entity = '';
                            // Try to find Reporting Business column by checking headers
                            let foundBusiness = false;
                            for (const cell of cells) {
                                const headers = cell.getAttribute('headers') || '';
                                const cellText = cell.innerText.trim();
                                // Extract from Reporting Business column
                                if ((headers.includes('propholderName') || headers.includes('holderName') || headers.includes('holder') ||
                                     headers.includes('reporting') || headers.includes('business')) &&
                                    cellText && 
                                    cellText.length > 1 && 
                                    cellText.length < 200 &&
                                    !cellText.match(/^(claim|select|view|info|undisclosed)$/i) &&
                                    !cellText.match(/^\$[\d,]+\.?\d*$/) &&
                                    !cellText.match(/^(over|to|\$25|\$50|\$100)$/i) &&
                                    !cellText.match(/^[A-Z]{2}$/) &&
                                    !cellText.match(/^\d{5}$/) &&
                                    !cellText.match(/^[A-Z]{2}\s+\d{5}$/)) {
                                    entity = cellText;
                                    foundBusiness = true;
                                    break;
                                }
                            }
                            
                            // If we found Reporting Business column by index, use that
                            if (!foundBusiness && reportingBusinessIdx >= 0 && cells[reportingBusinessIdx]) {
                                const cellText = cells[reportingBusinessIdx].innerText.trim();
                                if (cellText && cellText.length > 1 && cellText.length < 200) {
                                    entity = cellText;
                                    foundBusiness = true;
                                }
                            }
                            
                            // Fallback: try index 3 or 4 if still not found
                            if (!foundBusiness && cells.length > 3) {
                                for (let i = 3; i < Math.min(5, cells.length); i++) {
                                    const cellText = cells[i].innerText.trim();
                                    if (cellText && cellText.length > 2 && cellText.length < 200 &&
                                        !cellText.match(/^(claim|select|view|info|undisclosed)$/i) &&
                                        !cellText.match(/^\$[\d,]+\.?\d*$/) &&
                                        !cellText.match(/^[A-Z]{2}$/) &&
                                        !cellText.match(/^\d{5}$/)) {
                                        entity = cellText;
                                        foundBusiness = true;
                                        break;
                                    }
                                }
                            }
                            
                            // If still no entity from Reporting Business column, skip this row
                            if (!foundBusiness || !entity || entity.length < 2) {
                                return; // Skip rows without a valid Reporting Business
                            }
                            
                            // Add if we have amount
                            if (amount) {
                                const key = `${entity}-${amount}`;
                                if (!data.some(r => `${r.entity}-${r.amount}` === key)) {
                                    data.push({
                                        entity: entity.substring(0, 200),
                                        amount: amount,
                                        details: rowText.substring(0, 500)
                                    });
                                }
                            }
                        });
                    });
                    
                    console.log(`Critical fallback extraction found ${data.length} total results`);
                }
            }
            
            // Strategy 2: Look for result containers (divs, spans, etc. with dollar amounts)
            // Only use if Strategy 1 found nothing
            if (data.length === 0) {
                console.log('Trying Strategy 2: Looking for result containers...');
                
                // Get all elements that contain dollar amounts
                const allElements = Array.from(document.querySelectorAll('*'));
                const elementsWithMoney = allElements.filter(el => {
                    const text = (el.innerText || el.textContent || '').trim();
                    return text.includes('$') && /\$[\d,]+\.?\d*/.test(text) && text.length > 10 && text.length < 1000;
                });
                
                console.log(`Found ${elementsWithMoney.length} elements with dollar amounts`);
                
                elementsWithMoney.forEach((el, idx) => {
                    if (idx > 50) return; // Limit to first 50
                    
                    const text = (el.innerText || el.textContent || '').trim();
                    const amountMatch = text.match(/\$[\d,]+\.?\d*/g);
                    
                    if (amountMatch && amountMatch.length > 0) {
                        // Skip if it's navigation, header, footer, or instructions
                        const lowerText = text.toLowerCase();
                        const skipPatterns = ['search', 'menu', 'nav', 'header', 'footer', 
                                             'instruction', 'privacy', 'cookie', 'home',
                                             'to begin your search', 'exact name matches',
                                             'when you are ready', 'select "view claimed"'];
                        
                        if (!skipPatterns.some(pattern => lowerText.includes(pattern))) {
                            // Extract entity name (text before the amount)
                            const amountIndex = text.indexOf(amountMatch[0]);
                            const beforeAmount = text.substring(0, amountIndex).trim();
                            const lines = beforeAmount.split('\n').filter(l => l.trim() && l.length > 2);
                            
                            let entity = '';
                            if (lines.length > 0) {
                                // Take the last meaningful line before the amount
                                entity = lines[lines.length - 1].trim();
                                
                                // If it's too short or looks like a label, try previous line
                                if (entity.length < 3 || entity.match(/^(amount|property|entity|holder)$/i)) {
                                    entity = lines.length > 1 ? lines[lines.length - 2].trim() : entity;
                                }
                            }
                            
                            // If still no entity, try splitting by spaces
                            if (!entity || entity.length < 2) {
                                const words = beforeAmount.split(/\s+/).filter(w => 
                                    w.length > 1 && 
                                    !w.match(/^[A-Z]{2}$/) && // Not state code
                                    !w.match(/^\d+$/) // Not just numbers
                                );
                                if (words.length > 0) {
                                    entity = words.slice(-3).join(' ').trim();
                                }
                            }
                            
                            // Only add if it looks like a real result
                            if (entity && entity.length > 2 && !entity.match(/^(amount|property|entity|holder|state|city|date|id|view|claim|search)$/i)) {
                                data.push({
                                    entity: entity.substring(0, 200),
                                    amount: amountMatch[0],
                                    details: text.substring(0, 500)
                                });
                            }
                        }
                    }
                });
                
                console.log(`Strategy 2 found ${data.length} results`);
            }
            
            // Strategy 3: Look for divs or sections that might contain results
            if (data.length === 0) {
                // Look for any element containing dollar amounts
                const allElements = document.querySelectorAll('div, span, p, td, li');
                allElements.forEach(el => {
                    const text = el.innerText || el.textContent;
                    if (text && text.includes('$')) {
                        const amountMatch = text.match(/\$[\d,]+\.?\d*/g);
                        if (amountMatch && amountMatch.length > 0) {
                            // Skip if it's just a header or navigation
                            const parentText = el.parentElement ? el.parentElement.innerText : '';
                            if (!text.match(/search|menu|nav|header|footer/i) && text.length < 500) {
                                const lines = text.split('\n').filter(l => l.trim());
                                let entity = lines.find(l => l.trim().length > 2 && !l.match(/^\$[\d,]+\.?\d*$/)) || 'Unknown Entity';
                                
                                data.push({
                                    entity: entity.trim().substring(0, 100),
                                    amount: amountMatch[0],
                                    details: text.substring(0, 500)
                                });
                            }
                        }
                    }
                });
            }
            
            // Strategy 4: Look for any elements containing dollar amounts (more aggressive)
            if (data.length === 0) {
                // Get all elements that might contain results
                const allElements = Array.from(document.querySelectorAll('*'));
                allElements.forEach(el => {
                    const text = (el.innerText || el.textContent || '').trim();
                    if (text && text.length > 10 && text.length < 1000) {
                        const amountMatch = text.match(/\$[\d,]+\.?\d*/g);
                        if (amountMatch && amountMatch.length > 0) {
                            // Skip if it's navigation, header, footer, or instructions
                            const lowerText = text.toLowerCase();
                            const skipPatterns = ['search', 'menu', 'nav', 'header', 'footer', 
                                                 'instruction', 'privacy', 'cookie', 'home',
                                                 'to begin your search', 'exact name matches'];
                            
                            if (!skipPatterns.some(pattern => lowerText.includes(pattern))) {
                                // Extract entity name (text before the amount)
                                const amountIndex = text.indexOf(amountMatch[0]);
                                const beforeAmount = text.substring(0, amountIndex).trim();
                                const words = beforeAmount.split(/\s+/).filter(w => w.length > 1);
                                
                                // Take last few words as entity name
                                let entity = words.slice(-3).join(' ').trim();
                                if (!entity || entity.length < 2) {
                                    entity = 'Unknown Entity';
                                }
                                
                                // Only add if it looks like a real result (has some text before amount)
                                if (words.length > 0) {
                                    data.push({
                                        entity: entity.substring(0, 150),
                                        amount: amountMatch[0],
                                        details: text.substring(0, 500)
                                    });
                                }
                            }
                        }
                    }
                });
            }
            
            // Strategy 5: Look for any dollar amounts with context in page text (fallback)
            if (data.length === 0) {
                const allText = document.body.innerText;
                const amountMatches = [...allText.matchAll(/\$[\d,]+\.?\d*/g)];
                
                if (amountMatches.length > 0) {
                    const lines = allText.split('\n');
                    amountMatches.forEach(match => {
                        const amount = match[0];
                        const matchIndex = match.index;
                        
                        // Find which line contains this amount
                        let currentIndex = 0;
                        let lineIndex = -1;
                        for (let i = 0; i < lines.length; i++) {
                            if (matchIndex >= currentIndex && matchIndex < currentIndex + lines[i].length) {
                                lineIndex = i;
                                break;
                            }
                            currentIndex += lines[i].length + 1;
                        }
                        
                        if (lineIndex >= 0) {
                            // Skip if it's in navigation or header
                            const lineText = lines[lineIndex].toLowerCase();
                            if (!lineText.includes('search') && !lineText.includes('menu') && 
                                !lineText.includes('home') && !lineText.includes('claim') &&
                                !lineText.includes('instruction') && !lineText.includes('privacy')) {
                                // Get context around the amount (2 lines before and after)
                                const contextStart = Math.max(0, lineIndex - 2);
                                const contextEnd = Math.min(lines.length, lineIndex + 3);
                                const context = lines.slice(contextStart, contextEnd);
                                
                                // Try to find entity name (usually before the amount)
                                let entity = 'Unknown Entity';
                                for (let i = lineIndex - 1; i >= Math.max(0, lineIndex - 3); i--) {
                                    const line = lines[i].trim();
                                    if (line && !line.match(/^\$[\d,]+\.?\d*$/) && line.length > 2 && line.length < 100) {
                                        entity = line;
                                        break;
                                    }
                                }
                                
                                data.push({
                                    entity: entity,
                                    amount: amount,
                                    details: context.join(' ')
                                });
                            }
                        }
                    });
                }
            }
            
            // Remove duplicates based on entity and amount
            const unique = [];
            const seen = new Set();
            data.forEach(item => {
                const key = `${item.entity}-${item.amount}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    unique.push(item);
                }
            });
            
            return unique;
        });
        
        console.log(`Found ${results.length} results`);
        
        // If no results found but we know there should be results, try one more aggressive search
        if (results.length === 0) {
            console.log('⚠️ No results found with standard methods, trying aggressive search...');
            
            const aggressiveResults = await page.evaluate(() => {
                const data = [];
                const allText = document.body.innerText;
                
                // Find all dollar amounts with more context
                const amountRegex = /\$[\d,]+\.?\d*/g;
                let match;
                const amounts = [];
                while ((match = amountRegex.exec(allText)) !== null) {
                    amounts.push({
                        amount: match[0],
                        index: match.index
                    });
                }
                
                console.log(`Found ${amounts.length} dollar amounts in page text`);
                
                // For each amount, get surrounding context
                amounts.forEach(({ amount, index }) => {
                    // Get 500 chars before and after
                    const start = Math.max(0, index - 500);
                    const end = Math.min(allText.length, index + 500);
                    const context = allText.substring(start, end);
                    
                    // Skip if it's in navigation/header/footer
                    if (!context.toLowerCase().includes('search') && 
                        !context.toLowerCase().includes('menu') &&
                        !context.toLowerCase().includes('home') &&
                        !context.toLowerCase().includes('instruction')) {
                        
                        // Try to extract entity name from before the amount
                        const beforeAmount = allText.substring(start, index).trim();
                        const lines = beforeAmount.split('\n').filter(l => l.trim() && l.length > 2);
                        
                        let entity = '';
                        if (lines.length > 0) {
                            // Take the last meaningful line
                            for (let i = lines.length - 1; i >= 0; i--) {
                                const line = lines[i].trim();
                                if (line.length > 3 && 
                                    !line.match(/^\$[\d,]+\.?\d*$/) &&
                                    !line.match(/^(amount|property|entity|holder|state|city|date|id|view|claim|search)$/i) &&
                                    !line.match(/^[A-Z]{2}$/)) { // Not state code
                                    entity = line;
                                    break;
                                }
                            }
                        }
                        
                        if (entity && entity.length > 2) {
                            data.push({
                                entity: entity.substring(0, 200),
                                amount: amount,
                                details: context.substring(0, 500)
                            });
                        }
                    }
                });
                
                return data;
            });
            
            if (aggressiveResults.length > 0) {
                console.log(`Aggressive search found ${aggressiveResults.length} results`);
                results.push(...aggressiveResults);
            }
        }
        
        // Clean up results and remove duplicates
        // CRITICAL: NO NAME FILTERING - Include ALL results returned by missingmoney.com
        // missingmoney.com already matched results to the person we searched for
        // People have aliases, so filtering by name would exclude valid results
        let uniqueResults = [];
        const seen = new Set();
        let filteredCount = 0;
        
        results.forEach(r => {
            // Clean entity name one more time to remove any remaining button text
            let cleanEntity = r.entity.trim();
            const originalEntity = cleanEntity;
            
            // Remove button text patterns (only at the end)
            cleanEntity = cleanEntity.replace(/\s*:\s*(CLAIM|VIEW|SELECT|INFO|REMOVE|SHARE)\s*$/i, '');
            cleanEntity = cleanEntity.replace(/\s+(CLAIM|VIEW|SELECT|INFO|REMOVE|SHARE)\s*$/i, '');
            cleanEntity = cleanEntity.trim();
            
            // CRITICAL: Fix amount if it's "CLAIM" or doesn't have a dollar sign
            let cleanAmount = r.amount;
            // Convert "UNDISCLOSED" to "$100"
            if (cleanAmount && cleanAmount.toUpperCase() === 'UNDISCLOSED') {
                cleanAmount = '$100';
                console.log(`🔧 Converted UNDISCLOSED to $100 for entity: "${cleanEntity}"`);
            } else if (cleanAmount && (cleanAmount === 'CLAIM' || cleanAmount === 'VIEW' || cleanAmount === 'SELECT' || !cleanAmount.includes('$'))) {
                // Amount is wrong - try to find it in details
                const detailsMatch = r.details.match(/(over\s+\$[\d,]+|\$\d+[\s,]*to[\s,]*\$\d+|\$[\d,]+)/i);
                if (detailsMatch) {
                    cleanAmount = detailsMatch[0].toUpperCase();
                    console.log(`🔧 Fixed amount: "${r.amount}" -> "${cleanAmount}" for entity: "${cleanEntity}"`);
                } else {
                    // If we can't find amount, use a placeholder but still include the result
                    cleanAmount = 'Amount not specified';
                    console.log(`⚠️ Could not find amount for entity: "${cleanEntity}", using placeholder`);
                }
            }
            
            // Only filter if entity is completely empty or just whitespace
            // NO NAME FILTERING - include all valid entities regardless of name matching
            if (!cleanEntity || cleanEntity.length < 1) {
                filteredCount++;
                if (filteredCount <= 5) {
                    console.log(`Filtered out entity: "${originalEntity}" -> "${cleanEntity}" (completely empty)`);
                }
                return;
            }
            
            // Use original entity if cleaning made it too short, but keep it if it's valid
            if (cleanEntity.length < 2) {
                cleanEntity = originalEntity.trim();
            }
            
            // If still too short, skip only if it's truly invalid
            if (cleanEntity.length < 1) {
                return;
            }
            
            // Include ALL results - missingmoney.com already matched them to the person
            // No name filtering - people have aliases and business names won't contain person's name
            const key = `${cleanEntity}-${cleanAmount}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueResults.push({
                    entity: cleanEntity,
                    amount: cleanAmount,
                    details: r.details
                });
            }
        });
        
        console.log(`Final results count: ${uniqueResults.length} (filtered out ${filteredCount} invalid/empty entities)`);
        if (uniqueResults.length > 0) {
            console.log('Sample results:', uniqueResults.slice(0, 3).map(r => `${r.entity}: ${r.amount}`));
        } else if (noResults) {
            console.log('⚠️ Page explicitly shows "no results" message and no dollar amounts found');
        } else {
            console.log('⚠️ No results extracted, but page does not show explicit "no results" message');
            console.log('Page URL:', page.url());
            console.log('Page title:', await page.title());
        }
        
        // CRITICAL: If we're still on the form page, the search likely failed
        // But first, check if there's a Cloudflare challenge we missed
        if (isStillOnFormPage && uniqueResults.length === 0) {
            console.error('❌❌❌ SEARCH FAILED: Still on form page with no results ❌❌❌');
            console.error('Final URL:', finalUrl);
            console.error('Page title:', finalTitle);
            
            // One more check for Cloudflare challenge
            const finalChallengeCheck = await page.evaluate(() => {
                return {
                    hasMessage: document.body.innerText.includes('Please wait while we verify your browser') ||
                               document.body.innerText.includes('Checking your browser') ||
                               document.body.innerText.includes('Just a moment'),
                    hasIframe: document.querySelectorAll('iframe[src*="cloudflare"], iframe[src*="challenge"]').length > 0,
                    hasTurnstile: document.querySelectorAll('[data-sitekey], [class*="cf-"], [id*="cf-"]').length > 0
                };
            });
            
            if ((finalChallengeCheck.hasMessage || finalChallengeCheck.hasIframe || finalChallengeCheck.hasTurnstile) && captchaSolver) {
                console.log('🚨 Cloudflare challenge still present - attempting to solve...');
                // Try one more time to solve Cloudflare
                try {
                    const siteKey = await page.evaluate(() => {
                        const el = document.querySelector('[data-sitekey]');
                        return el ? el.getAttribute('data-sitekey') : null;
                    });
                    
                    if (siteKey && siteKey.length > 20) {
                        const result = await captchaSolver.solveTurnstile(siteKey, page.url());
                        await page.evaluate((token) => {
                            const input = document.querySelector('input[name="cf-turnstile-response"]') ||
                                         document.querySelector('input[id*="turnstile"]');
                            if (input) {
                                input.value = token;
                                input.dispatchEvent(new Event('input', { bubbles: true }));
                            }
                        }, result.token);
                        
                        // Wait and check again
                        await randomDelay(3000, 5000);
                        const urlAfterRetry = page.url();
                        if (urlAfterRetry !== finalUrl && !urlAfterRetry.includes('claim-search')) {
                            console.log('✅ Form submitted after Cloudflare retry!');
                            // Continue with results extraction
                            return null; // Don't return error, let it continue
                        }
                    }
                } catch (e) {
                    console.error('Error in final Cloudflare retry:', e.message);
                }
            }
            
            console.error('This indicates form submission failed - likely Cloudflare blocking');
            console.error('Page text sample:', pageText.substring(0, 500));
            return {
                success: false,
                error: 'Form submission failed - Cloudflare challenge may be blocking the search. The form was not submitted successfully.',
                results: []
            };
        }
        
        // If we found explicit "no results" message and no dollar amounts, return empty results
        if (noResults && uniqueResults.length === 0) {
            console.log('⚠️ Returning empty results: explicit "no results" message detected');
            return {
                success: true,
                results: [],
                totalAmount: 0,
                message: 'No unclaimed funds found'
            };
        }
        
        // If we have results, return them
        if (uniqueResults.length > 0) {
            console.log(`✅✅✅ RETURNING ${uniqueResults.length} RESULTS TO FRONTEND ✅✅✅`);
            console.log(`📊 Sample results (first 3):`, uniqueResults.slice(0, 3).map(r => ({
                entity: r.entity,
                amount: r.amount
            })));
            const totalAmount = uniqueResults.reduce((sum, r) => {
                // Handle amount ranges - use minimum value for ranges
                let amountStr = r.amount;
                // Convert "UNDISCLOSED" to "$100"
                if (amountStr && amountStr.toUpperCase() === 'UNDISCLOSED') {
                    amountStr = '$100';
                }
                if (amountStr.includes('OVER')) {
                    // For "OVER $100", use 100 as minimum
                    const match = amountStr.match(/\$?([\d,]+)/);
                    if (match) {
                        amountStr = match[1];
                    }
                } else if (amountStr.includes('UNDER')) {
                    // For "UNDER $50", use half the upper bound as estimate (e.g., $25 for UNDER $50)
                    const match = amountStr.match(/\$?([\d,]+)/);
                    if (match) {
                        const upperBound = parseFloat(match[1].replace(/,/g, ''));
                        amountStr = Math.floor(upperBound / 2).toString(); // Use half as estimate
                    }
                } else if (amountStr.includes('TO')) {
                    // For "$25 TO $50", use the first amount
                    const match = amountStr.match(/\$?([\d,]+)/);
                    if (match) {
                        amountStr = match[1];
                    }
                }
                const amount = parseFloat(amountStr.replace(/[$,]/g, ''));
                return sum + (isNaN(amount) ? 0 : amount);
            }, 0);
            console.log(`💰 Total amount calculated: $${totalAmount}`);
            return {
                success: true,
                results: uniqueResults,
                totalAmount: totalAmount
            };
        }
        
        // If no results but page shows results exist, try one more time with most aggressive extraction
        if (!noResults && uniqueResults.length === 0) {
            console.log('⚠️ WARNING: Page shows results exist but extraction found none!');
            console.log('Page text sample:', pageText.substring(0, 1000));
            
            // Last resort: extract ANY row with dollar amounts
            const lastResortResults = await page.evaluate(() => {
                const results = [];
                const tables = document.querySelectorAll('table');
                
                tables.forEach(table => {
                    const rows = Array.from(table.querySelectorAll('tr'));
                    rows.forEach(row => {
                        const text = row.innerText || row.textContent || '';
                        const lowerText = text.toLowerCase();
                        
                        // Skip headers
                        if (lowerText.includes('select') && lowerText.includes('action')) return;
                        
                        // Must have amount
                        const amountMatch = text.match(/(over\s+\$[\d,]+|\$\d+[\s,]*to[\s,]*\$\d+|\$[\d,]+)/i);
                        if (amountMatch) {
                            const cells = Array.from(row.querySelectorAll('td, th'));
                            let entity = 'Unclaimed Property';
                            
                            // Try to find entity in cells
                            for (const cell of cells) {
                                const cellText = cell.innerText.trim();
                                if (cellText && cellText.length > 3 && cellText.length < 200 &&
                                    !cellText.match(/^(claim|select|view|info|undisclosed)$/i) &&
                                    !cellText.match(/^\$[\d,]+/) &&
                                    !cellText.match(/^[A-Z]{2}$/)) {
                                    entity = cellText;
                                    break;
                                }
                            }
                            
                            results.push({
                                entity: entity,
                                amount: amountMatch[0].toUpperCase(),
                                details: text.substring(0, 300)
                            });
                        }
                    });
                });
                
                return results;
            });
            
            if (lastResortResults.length > 0) {
                console.log(`Last resort extraction found ${lastResortResults.length} results`);
                uniqueResults = lastResortResults;
            }
        }
        
        // If we still have no results after filtering, check if we should return empty or original results
        // IMPORTANT: If filtering removed all results due to invalid entities, return empty results (success: true)
        // This means the search worked but no valid entities were extracted
        if (uniqueResults.length === 0 && results.length > 0) {
            console.log(`⚠️⚠️⚠️ WARNING: All ${results.length} results filtered out due to invalid/empty entities`);
            console.log('📊 This means the search worked, but no valid business names were extracted');
            console.log('✅ Returning empty results (success: true) to indicate successful search with no valid entities');

            return {
                success: true,
                results: [],
                totalAmount: 0,
                message: `No unclaimed funds found matching "${normalizedFirstName} ${normalizedLastName}"`
            };
        }
        
        // If we have no results at all (search found nothing), return empty results with success: true
        if (uniqueResults.length === 0 && results.length === 0) {
            console.log('⚠️ No results found at all from Missing Money search');
            return {
                success: true,
                results: [],
                totalAmount: 0,
                message: 'No unclaimed funds found'
            };
        }
        
        // Legacy fallback code (should not be reached, but kept for safety)
        if (uniqueResults.length === 0 && results.length > 0) {
            console.log('⚠️⚠️⚠️ WARNING: All results filtered out during cleaning! Returning original results ⚠️⚠️⚠️');
            console.log('📊 Original results count:', results.length);
            console.log('🔍 Returning original results without cleaning to ensure frontend gets data');
            
            // Return original results with minimal cleaning (just remove obvious button text)
            const fallbackResults = results.map(r => {
                let entity = r.entity.trim();
                entity = entity.replace(/\s*:\s*(CLAIM|VIEW|SELECT|INFO|REMOVE|SHARE)\s*$/i, '');
                entity = entity.replace(/\s+(CLAIM|VIEW|SELECT|INFO|REMOVE|SHARE)\s*$/i, '');
                return {
                    entity: entity || r.entity || 'Unclaimed Property',
                    amount: r.amount,
                    details: r.details
                };
            });
            
            return {
                success: true,
                results: fallbackResults,
                totalAmount: fallbackResults.reduce((sum, r) => {
                    let amountStr = r.amount;
                    // Convert "UNDISCLOSED" to "$100"
                    if (amountStr && amountStr.toUpperCase() === 'UNDISCLOSED') {
                        amountStr = '$100';
                    }
                    if (amountStr.includes('OVER')) {
                        const match = amountStr.match(/\$?([\d,]+)/);
                        if (match) amountStr = match[1];
                    } else if (amountStr.includes('UNDER')) {
                        // For "UNDER $50", use half the upper bound as estimate (e.g., $25 for UNDER $50)
                        const match = amountStr.match(/\$?([\d,]+)/);
                        if (match) {
                            const upperBound = parseFloat(match[1].replace(/,/g, ''));
                            amountStr = Math.floor(upperBound / 2).toString(); // Use half as estimate
                        }
                    } else if (amountStr.includes('TO')) {
                        const match = amountStr.match(/\$?([\d,]+)/);
                        if (match) amountStr = match[1];
                    }
                    const amount = parseFloat(amountStr.replace(/[$,]/g, ''));
                    return sum + (isNaN(amount) ? 0 : amount);
                }, 0)
            };
        }
        
        // If we truly have no results at all, return $100 undisclosed instead of $0
        if (uniqueResults.length === 0) {
            console.log('❌❌❌ NO RESULTS FOUND AT ALL - Returning $100 undisclosed ❌❌❌');
            return {
                success: true,
                results: [{
                    entity: 'Undisclosed Property',
                    amount: 'UNDISCLOSED',
                    details: 'Amount undisclosed - funds may be available'
                }],
                totalAmount: 100, // Show $100 instead of $0
                message: 'No unclaimed funds found - showing $100 undisclosed'
            };
        }
        
        // Return results
        return {
            success: true,
            results: uniqueResults,
            totalAmount: uniqueResults.reduce((sum, r) => {
                // Handle amount ranges - use minimum value for ranges
                let amountStr = r.amount;
                // Convert "UNDISCLOSED" to "$100"
                if (amountStr && amountStr.toUpperCase() === 'UNDISCLOSED') {
                    amountStr = '$100';
                }
                if (amountStr.includes('OVER')) {
                    // For "OVER $100", use 100 as minimum
                    const match = amountStr.match(/\$?([\d,]+)/);
                    if (match) {
                        amountStr = match[1];
                    }
                } else if (amountStr.includes('UNDER')) {
                    // For "UNDER $50", use half the upper bound as estimate (e.g., $25 for UNDER $50)
                    const match = amountStr.match(/\$?([\d,]+)/);
                    if (match) {
                        const upperBound = parseFloat(match[1].replace(/,/g, ''));
                        amountStr = Math.floor(upperBound / 2).toString(); // Use half as estimate
                    }
                } else if (amountStr.includes('TO')) {
                    // For "$25 TO $50", use the first amount
                    const match = amountStr.match(/\$?([\d,]+)/);
                    if (match) {
                        amountStr = match[1];
                    }
                }
                const amount = parseFloat(amountStr.replace(/[$,]/g, ''));
                return sum + (isNaN(amount) ? 0 : amount);
            }, 0)
        };
        
    } catch (error) {
        console.error('Error searching Missing Money:', error);
        console.error('Error stack:', error.stack);
        
        // Check if it's a resource exhaustion error - but DON'T return error immediately
        // Let the finally block clean up first, then we'll handle it
        const isResourceExhaustion = error.message && (
            error.message.includes('Resource temporarily unavailable') ||
            error.message.includes('pthread_create') ||
            error.message.includes('ENOMEM') ||
            error.message.includes('EMFILE') ||
            error.message.includes('Cannot find module') ||
            error.message.includes('spawn') ||
            error.message.includes('ENOSPC')
        );
        
        if (isResourceExhaustion) {
            console.error('❌ Resource exhaustion error detected:', error.message);
            // Store error to return after cleanup
            error._isResourceExhaustion = true;
        }
        
        // Re-throw to be caught by outer handler
        throw error;
    } finally {
        // CRITICAL: Close pages and contexts FIRST, then browser
        // This prevents resource leaks (file descriptors, memory, processes)
        if (page) {
            try {
                await page.close().catch(err => {
                    console.error('[BROWSER] Error closing page:', err);
                });
                console.log('[BROWSER] Page closed');
            } catch (closeError) {
                console.error('[BROWSER] Error closing page:', closeError);
            }
            page = null;
        }
        
        if (context) {
            try {
                await context.close().catch(err => {
                    console.error('[BROWSER] Error closing context:', err);
                });
                console.log('[BROWSER] Context closed');
            } catch (closeError) {
                console.error('[BROWSER] Error closing context:', closeError);
            }
            context = null;
        }
        
        // Always close browser and release slot - CRITICAL for resource management
        if (browser) {
            try {
                // Force close with timeout to prevent hanging
                await Promise.race([
                    browser.close(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Browser close timeout')), 5000))
                ]).catch(err => {
                    console.error('[BROWSER] Error closing browser in finally:', err);
                });
                console.log('[BROWSER] Browser closed successfully');
            } catch (closeError) {
                console.error('[BROWSER] Error closing browser:', closeError);
            }
            browser = null; // Clear reference
        }
        
        // Always release slot if we acquired it
        if (slotAcquired) {
            releaseBrowserSlot();
            console.log(`[BROWSER] Released browser slot (${activeBrowserCount}/${MAX_CONCURRENT_BROWSERS} active)`);
        }
    }
    })();
    
    // Race the search operation against overall timeout
    try {
        const result = await Promise.race([searchOperation, overallTimeout]);
        
        // Check if result indicates resource exhaustion
        if (result && !result.success && result.error && result.error.includes('Server resources temporarily unavailable')) {
            console.warn('[BROWSER] Resource exhaustion detected in result, waiting before retry...');
            // Wait a bit to let resources free up
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        return result;
    } catch (error) {
        // Clean up browser if timeout or error occurred - CRITICAL
        if (browser) {
            try {
                await browser.close().catch(err => {
                    console.error('[BROWSER] Error closing browser after timeout:', err);
                });
            } catch (closeError) {
                console.error('[BROWSER] Error closing browser:', closeError);
            }
            browser = null;
        }
        
        // Release slot if we acquired it - ALWAYS release
        if (slotAcquired) {
            releaseBrowserSlot();
        }
        
        // Check if it's a resource exhaustion error
        if (error._isResourceExhaustion || (error.message && (
            error.message.includes('Resource temporarily unavailable') ||
            error.message.includes('pthread_create') ||
            error.message.includes('ENOMEM') ||
            error.message.includes('EMFILE')
        ))) {
            console.error('❌ Resource exhaustion - returning user-friendly error');
            return {
                success: false,
                error: 'Server is processing many requests. Please wait a moment and try again.',
                results: []
            };
        }
        
        // Check if it's a retryable timeout error
        if (error._isTimeout || (error.message && error.message.includes('timed out'))) {
            console.warn('⚠️ Timeout error detected - marking as retryable');
            return {
                success: false,
                error: 'Server is processing many requests. Please wait a moment and try again.',
                results: [],
                _isRetryable: true
            };
        }
        
        // Return other errors
        return {
            success: false,
            error: error.message || 'Search operation failed',
            results: []
        };
    }
}

// Export browser stats for monitoring
function getBrowserStats() {
    return {
        activeBrowserCount,
        maxConcurrentBrowsers: MAX_CONCURRENT_BROWSERS,
        queueLength: browserQueue.length,
        availableSlots: MAX_CONCURRENT_BROWSERS - activeBrowserCount
    };
}

module.exports = { searchMissingMoney, getBrowserStats };

