const { chromium } = require('playwright');
const { CloudflareSolver } = require('./cloudflareSolver');

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

async function searchMissingMoney(firstName, lastName, city, state, use2Captcha = false, captchaApiKey = null) {
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
    
    let browser = null;
    try {
        // Launch browser with stealth settings
        browser = await chromium.launch({ 
            headless: false, // Run in headed mode to avoid detection (required for Cloudflare)
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
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        });
        
        // Create context with realistic browser fingerprint
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
        
        const page = await context.newPage();
        
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
        
        // IMMEDIATELY start filling form - NO Cloudflare checks before form filling!
        // Cloudflare challenge appears AFTER form submission, not before!
        console.log('🚀🚀🚀 STARTING FORM FILLING IMMEDIATELY - NO CLOUDFLARE CHECKS! 🚀🚀🚀');
        
        // Quick check for form
        try {
            await page.waitForSelector('input, form', { timeout: 2000 });
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
        const lastNameFilled = await fillField(lastName, 'lastName', [
            'input[name*="lastName" i]',
            'input[id*="lastName" i]',
            'input[name*="last" i]',
            'input[id*="last" i]',
            'input[placeholder*="Last" i]',
            'input[type="text"]:nth-of-type(1)'
        ]);
        
        // Try to fill first name
        const firstNameFilled = await fillField(firstName, 'firstName', [
            'input[name*="firstName" i]',
            'input[id*="firstName" i]',
            'input[name*="first" i]',
            'input[id*="first" i]',
            'input[placeholder*="First" i]',
            'input[placeholder*="name" i]',
            'input[type="text"]:nth-of-type(2)'
        ]);
        
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
        
        // If we couldn't fill by name/id, try filling all text inputs in order
        if (!firstNameFilled || !lastNameFilled || !cityFilled || !stateFilled) {
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
            
            if (visibleInputs.length >= 4) {
                const values = [lastName, firstName, city, fullStateName];
                const fieldNames = ['lastName', 'firstName', 'city', 'state'];
                
                // Fill in order: last, first, city, state (based on Missing Money form order)
                for (let i = 0; i < Math.min(4, visibleInputs.length); i++) {
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
        
        // Wait a bit to ensure form is ready
        await randomDelay(1000, 2000);
        
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
                        
                        await button.click();
                        submitted = true;
                        console.log('Form submitted via button click');
                        await randomDelay(500, 1000);
                        break;
                    }
                }
            } catch (e) {
                console.log(`Error with selector ${selector}:`, e.message);
                continue;
            }
        }
        
        if (!submitted) {
            // Try submitting the form directly
            try {
                const form = await page.$('form');
                if (form) {
                    await form.evaluate(f => f.submit());
                    submitted = true;
                    console.log('Form submitted via form.submit()');
                    await randomDelay(1000, 2000);
                }
            } catch (e) {
                console.log('Could not submit form directly');
            }
        }
        
        if (!submitted) {
            // Try pressing Enter on the last filled field
            await page.keyboard.press('Enter');
            console.log('Tried submitting via Enter key');
            await randomDelay(1000, 2000);
        }
        
        // NOW handle Cloudflare challenge that appears AFTER form submission
        console.log('🔍🔍🔍 CHECKING FOR CLOUDFLARE CHALLENGE AFTER FORM SUBMISSION 🔍🔍🔍');
        await randomDelay(2000, 3000); // Wait for Cloudflare to appear
        
        // Check for Cloudflare challenge AFTER submission
        const challengeInfoAfterSubmission = await page.evaluate(() => {
            const info = {
                hasMessage: document.body.innerText.includes('Please wait while we verify your browser') ||
                           document.body.innerText.includes('Checking your browser'),
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
                        }
                    } catch (e) {
                        console.log('Could not resubmit form:', e.message);
                    }
                    
                    console.log('✅ Token injection complete, waiting for Cloudflare to process...');
                    await randomDelay(3000, 5000);
                    
                    // Wait for verification to complete
                    let verificationComplete = false;
                    for (let i = 0; i < 20; i++) {
                        const pageText = await page.evaluate(() => document.body.innerText);
                        const url = page.url();
                        if (!pageText.includes('Please wait while we verify your browser') &&
                            !pageText.includes('Checking your browser') &&
                            !url.includes('challenge')) {
                            console.log('✅ Cloudflare verification completed after submission!');
                            verificationComplete = true;
                            break;
                        }
                        await randomDelay(1000, 2000);
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
            await Promise.race([
                page.waitForNavigation({ waitUntil: 'networkidle', timeout: 25000 }),
                page.waitForSelector('table, [class*="result"], [class*="claim"], [class*="table"], [id*="result"], [id*="claim"], tbody, [role="row"]', { timeout: 25000 }),
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
                    { timeout: 25000 }
                ),
                page.waitForTimeout(10000)
            ]);
        } catch (e) {
            console.log('Waiting for results timed out, continuing...');
        }
        
        // Note: verificationComplete is set in the 2captcha block above if token injection succeeds
        // If we reach here and 2captcha wasn't used or didn't complete, we'll continue to results extraction
        
        // Wait for results to load - try multiple strategies
        console.log('Waiting for results...');
        
        // Wait for navigation or results to appear
        try {
            await Promise.race([
                page.waitForNavigation({ waitUntil: 'networkidle', timeout: 25000 }),
                page.waitForSelector('table, [class*="result"], [class*="claim"], [class*="table"], [id*="result"], [id*="claim"], tbody, [role="row"]', { timeout: 25000 }),
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
                    { timeout: 25000 }
                ),
                page.waitForTimeout(10000)
            ]);
        } catch (e) {
            console.log('Waiting for results timed out, continuing...');
        }
        
        // Wait for any AJAX/API calls to complete
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        
        // Wait a bit more for any dynamic content to render
        await page.waitForTimeout(5000);
        
        // Scroll down to trigger lazy loading if any
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(2000);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(1000);
        
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
        
        // Get all text content to see what's on the page
        const pageText = await page.evaluate(() => document.body.innerText);
        console.log('Page text sample (first 5000 chars):', pageText.substring(0, 5000));
        
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
        const noResults = (pageText.toLowerCase().includes('no unclaimed funds found') ||
                          pageText.toLowerCase().includes('no match') ||
                          (pageText.toLowerCase().includes('no results') && 
                           !pageText.toLowerCase().includes('to begin your search'))) &&
                          !pageText.match(/\$[\d,]+\.?\d*/); // Only consider "no results" if there are NO dollar amounts
        console.log('Page shows "no results":', noResults);
        
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
                // Get header row to find column indices
                // Try to find header row - it might be the first row or a row with "th" elements
                let headerRow = table.querySelector('tr:has(th)') || table.querySelector('tr');
                if (!headerRow) {
                    // If no header row found, check if first row looks like a header
                    const firstRow = table.querySelector('tr');
                    if (firstRow) {
                        const firstRowText = (firstRow.innerText || '').toLowerCase();
                        if (firstRowText.includes('select') && firstRowText.includes('action') && firstRowText.includes('owner')) {
                            headerRow = firstRow;
                        }
                    }
                }
                
                if (!headerRow) {
                    console.log(`Table ${tableIdx}: No header row found, trying to infer columns from first data row`);
                    // Try to infer from first data row
                    const firstDataRow = table.querySelector('tr:nth-child(2)');
                    if (firstDataRow) {
                        const cells = Array.from(firstDataRow.querySelectorAll('td, th'));
                        console.log(`Table ${tableIdx}: First data row has ${cells.length} cells`);
                        // Assume standard structure: [Select, Owner, Co-Owner, Business, Address, City, State, ZIP, Held In, Amount]
                        // Business is usually around index 3-4, Amount is usually last
                        const reportingBusinessIdx = cells.length > 3 ? 3 : -1;
                        const amountIdx = cells.length > 0 ? cells.length - 1 : -1;
                        
                        // Process all rows
                        const rows = Array.from(table.querySelectorAll('tr')).slice(1);
                        console.log(`Table ${tableIdx} has ${rows.length} data rows (inferred structure)`);
                        
                        rows.forEach((row, rowIdx) => {
                            const rowCells = Array.from(row.querySelectorAll('td, th'));
                            if (rowCells.length < 3) return;
                            
                            const rowText = (row.innerText || row.textContent || '').toLowerCase();
                            
                            // Skip header rows
                            if (rowText.includes('select') && rowText.includes('action') && rowText.includes('owner')) {
                                return;
                            }
                            
                            // Check for amount
                            const hasAmount = rowText.includes('$') || 
                                             rowText.includes('over') || 
                                             rowText.includes('to $') ||
                                             /over\s+\$[\d,]+/i.test(rowText) ||
                                             /\$\d+\s+to\s+\$\d+/i.test(rowText);
                            
                            if (!hasAmount) return;
                            
                            // Extract entity from business column (usually index 3)
                            let entity = '';
                            if (reportingBusinessIdx >= 0 && rowCells[reportingBusinessIdx]) {
                                entity = rowCells[reportingBusinessIdx].innerText.trim();
                            }
                            
                            // Extract amount from last column
                            let amount = '';
                            if (amountIdx >= 0 && rowCells[amountIdx]) {
                                amount = rowCells[amountIdx].innerText.trim().toUpperCase();
                            } else {
                                // Fallback: search in row text
                                const amountMatch = rowText.match(/(over\s+\$[\d,]+|\$\d+[\s,]*to[\s,]*\$\d+|\$[\d,]+)/i);
                                if (amountMatch) {
                                    amount = amountMatch[0].toUpperCase();
                                }
                            }
                            
                            // Add if we have both
                            if (entity && entity.length > 2 && amount) {
                                entity = entity.replace(/\s+/g, ' ').trim();
                                data.push({
                                    entity: entity.substring(0, 200),
                                    amount: amount,
                                    details: row.innerText.substring(0, 500)
                                });
                            }
                        });
                        
                        // Skip the normal processing for this table since we handled it
                        return;
                    }
                }
                
                const headerCells = Array.from(headerRow.querySelectorAll('th, td'));
                const headerTexts = headerCells.map(cell => (cell.innerText || cell.textContent || '').toLowerCase());
                
                // Find column indices - be more flexible with matching
                const reportingBusinessIdx = headerTexts.findIndex(h => 
                    h.includes('reporting business') || 
                    h.includes('business name') || 
                    h.includes('holder') ||
                    h.includes('reporting')
                );
                const ownerNameIdx = headerTexts.findIndex(h => 
                    h.includes('owner name') || 
                    h.includes('owner') ||
                    (h.includes('name') && !h.includes('business'))
                );
                const amountIdx = headerTexts.findIndex(h => 
                    h.includes('amount') || 
                    h.includes('value') ||
                    h.includes('held in')
                );
                
                console.log(`Table ${tableIdx} column indices:`, {
                    reportingBusiness: reportingBusinessIdx,
                    ownerName: ownerNameIdx,
                    amount: amountIdx,
                    headerTexts: headerTexts
                });
                
                // Get all data rows (skip header)
                const rows = Array.from(table.querySelectorAll('tr')).slice(1);
                console.log(`Table ${tableIdx} has ${rows.length} data rows`);
                
                rows.forEach((row, rowIdx) => {
                    const cells = Array.from(row.querySelectorAll('td, th'));
                    if (cells.length < 2) return;
                    
                    const rowText = (row.innerText || row.textContent || '').toLowerCase();
                    
                    // Skip if it's a header row or doesn't contain relevant data
                    if (rowText.includes('select') && rowText.includes('action') && rowText.includes('owner')) {
                        return; // This is a header row
                    }
                    
                    // Look for amount indicators (ranges like "OVER $100", "$25 TO $50", or dollar signs)
                    const hasAmount = rowText.includes('$') || 
                                     rowText.includes('over') || 
                                     rowText.includes('to $') ||
                                     /over\s+\$[\d,]+/i.test(rowText) ||
                                     /\$\d+\s+to\s+\$\d+/i.test(rowText);
                    
                    if (!hasAmount) return;
                    
                    // Extract entity name - prioritize Reporting Business Name column
                    let entity = '';
                    let amount = '';
                    
                    // Try to get Reporting Business Name first
                    if (reportingBusinessIdx >= 0 && cells[reportingBusinessIdx]) {
                        entity = cells[reportingBusinessIdx].innerText.trim();
                    }
                    
                    // Fallback to Owner Name if no Reporting Business
                    if ((!entity || entity.length < 2) && ownerNameIdx >= 0 && cells[ownerNameIdx]) {
                        entity = cells[ownerNameIdx].innerText.trim();
                    }
                    
                    // If still no entity, try first few cells
                    if ((!entity || entity.length < 2)) {
                        for (let i = 0; i < Math.min(5, cells.length); i++) {
                            const cellText = cells[i].innerText.trim();
                            if (cellText && 
                                cellText.length > 2 && 
                                cellText.length < 200 &&
                                !cellText.match(/^(claim|select|view|info)$/i) &&
                                !cellText.match(/^\$[\d,]+\.?\d*$/) &&
                                !cellText.match(/^(over|to|\$25|\$50|\$100)$/i) &&
                                !cellText.match(/^[A-Z]{2}$/) && // Not state code
                                !cellText.match(/^\d{5}$/)) { // Not ZIP
                                entity = cellText;
                                break;
                            }
                        }
                    }
                    
                    // Extract amount - look for amount column or ranges
                    if (amountIdx >= 0 && cells[amountIdx]) {
                        amount = cells[amountIdx].innerText.trim();
                    } else {
                        // Look for amount patterns in the row
                        const amountPatterns = [
                            /over\s+\$[\d,]+/i,
                            /\$\d+[\s,]*to[\s,]*\$\d+/i,
                            /\$[\d,]+\.?\d*/g
                        ];
                        
                        for (const pattern of amountPatterns) {
                            const match = rowText.match(pattern);
                            if (match) {
                                amount = match[0].toUpperCase();
                                break;
                            }
                        }
                    }
                    
                    // If we found an entity and amount indicator, add it
                    if (entity && entity.length > 2 && amount) {
                        // Clean up entity name
                        entity = entity.replace(/\s+/g, ' ').trim();
                        
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
                        
                        // Find entity (usually a business name or owner name)
                        let entity = '';
                        let amount = '';
                        
                        // Look for business/company names (usually longer text, contains common business words)
                        for (const cellText of cellTexts) {
                            if (cellText.length > 5 && 
                                cellText.length < 200 &&
                                !cellText.match(/^(claim|select|view|info|undisclosed)$/i) &&
                                !cellText.match(/^\$[\d,]+\.?\d*$/) &&
                                !cellText.match(/^(over|to|\$25|\$50|\$100)$/i) &&
                                !cellText.match(/^[A-Z]{2}$/) &&
                                !cellText.match(/^\d{5}$/) &&
                                !cellText.match(/^[A-Z]+\s+ARROW$/i) && // Skip owner name if it's just "ZACH ARROW"
                                (cellText.includes(' ') || 
                                 cellText.includes('LLC') || 
                                 cellText.includes('INC') || 
                                 cellText.includes('CORP') ||
                                 cellText.includes('BANK') ||
                                 cellText.includes('CO'))) {
                                entity = cellText;
                                break;
                            }
                        }
                        
                        // If no business name found, try owner name (but only if it's different from search name)
                        if ((!entity || entity.length < 2)) {
                            for (const cellText of cellTexts) {
                                if (cellText.length > 2 && 
                                    cellText.length < 100 &&
                                    !cellText.match(/^(claim|select|view|info|undisclosed)$/i) &&
                                    !cellText.match(/^\$[\d,]+\.?\d*$/) &&
                                    !cellText.match(/^(over|to|\$25|\$50|\$100)$/i) &&
                                    !cellText.match(/^[A-Z]{2}$/) &&
                                    !cellText.match(/^\d{5}$/)) {
                                    entity = cellText;
                                    break;
                                }
                            }
                        }
                        
                        // Extract amount
                        const amountMatch = rowText.match(/(over\s+\$[\d,]+|\$\d+[\s,]*to[\s,]*\$\d+|\$[\d,]+\.?\d*)/i);
                        if (amountMatch) {
                            amount = amountMatch[0].toUpperCase().trim();
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
                            const amountMatch = rowText.match(/(over\s+\$[\d,]+|\$\d+[\s,]*to[\s,]*\$\d+|\$[\d,]+\.?\d*)/i);
                            if (amountMatch) {
                                amount = amountMatch[0].toUpperCase().trim();
                            }
                            
                            // Find ANY entity name from cells (more lenient)
                            let entity = '';
                            for (const cell of cells) {
                                const cellText = cell.innerText.trim();
                                if (cellText && 
                                    cellText.length > 2 && 
                                    cellText.length < 200 &&
                                    !cellText.match(/^(claim|select|view|info|undisclosed|undisclosed)$/i) &&
                                    !cellText.match(/^\$[\d,]+\.?\d*$/) &&
                                    !cellText.match(/^(over|to|\$25|\$50|\$100)$/i) &&
                                    !cellText.match(/^[A-Z]{2}$/) &&
                                    !cellText.match(/^\d{5}$/) &&
                                    !cellText.match(/^[A-Z]{2}\s+\d{5}$/)) { // Not "TX 78731"
                                    entity = cellText;
                                    break;
                                }
                            }
                            
                            // If still no entity, use a generic name based on row content
                            if (!entity || entity.length < 2) {
                                // Try to extract from row text - look for capitalized words
                                const words = rowText.match(/\b[A-Z][A-Z\s&.,]+/g);
                                if (words && words.length > 0) {
                                    // Find the longest capitalized phrase that's not a state/city
                                    const phrases = words.filter(w => 
                                        w.length > 3 && 
                                        !w.match(/^(TX|CA|NY|FL|OVER|TO|CLAIM|SELECT|VIEW)$/i)
                                    );
                                    if (phrases.length > 0) {
                                        entity = phrases[0].trim();
                                    }
                                }
                            }
                            
                            // Default entity if still nothing
                            if (!entity || entity.length < 2) {
                                entity = 'Unclaimed Property';
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
        
        // Remove duplicates
        const uniqueResults = [];
        const seen = new Set();
        results.forEach(r => {
            const key = `${r.entity}-${r.amount}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueResults.push(r);
            }
        });
        
        console.log(`Final results count: ${uniqueResults.length}`);
        if (uniqueResults.length > 0) {
            console.log('Sample results:', uniqueResults.slice(0, 3).map(r => `${r.entity}: ${r.amount}`));
        } else if (noResults) {
            console.log('⚠️ Page explicitly shows "no results" message and no dollar amounts found');
        } else {
            console.log('⚠️ No results extracted, but page does not show explicit "no results" message');
            console.log('Page URL:', page.url());
            console.log('Page title:', await page.title());
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
            console.log(`✅ Returning ${uniqueResults.length} results`);
            return {
                success: true,
                results: uniqueResults,
                totalAmount: uniqueResults.reduce((sum, r) => {
                    // Handle amount ranges - use minimum value for ranges
                    let amountStr = r.amount;
                    if (amountStr.includes('OVER')) {
                        // For "OVER $100", use 100 as minimum
                        const match = amountStr.match(/\$?([\d,]+)/);
                        if (match) {
                            amountStr = match[1];
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
        
        // If we still have no results, return empty
        if (uniqueResults.length === 0) {
            return {
                success: true,
                results: [],
                totalAmount: 0,
                message: 'No unclaimed funds found'
            };
        }
        
        // Return results
        return {
            success: true,
            results: uniqueResults,
            totalAmount: uniqueResults.reduce((sum, r) => {
                // Handle amount ranges - use minimum value for ranges
                let amountStr = r.amount;
                if (amountStr.includes('OVER')) {
                    // For "OVER $100", use 100 as minimum
                    const match = amountStr.match(/\$?([\d,]+)/);
                    if (match) {
                        amountStr = match[1];
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
        return {
            success: false,
            error: error.message,
            results: []
        };
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

module.exports = { searchMissingMoney };

