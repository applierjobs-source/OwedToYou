# Cloudflare Evasion Strategies

## Current Issues
Cloudflare is detecting non-human traffic because:
1. **Automation signatures** - Playwright/Chromium leaves traces
2. **Behavioral patterns** - Too fast, too consistent
3. **IP reputation** - Datacenter IPs are flagged
4. **Missing browser features** - Canvas, WebGL, fonts don't match real browsers
5. **TLS fingerprinting** - TLS handshake doesn't match real Chrome

## Strategy 1: Enhanced Stealth with playwright-extra + stealth-plugin

**Pros:** Easy to implement, handles many detection vectors automatically
**Cons:** Adds dependency, may not be enough alone

```javascript
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

chromium.use(StealthPlugin());

// Then use chromium as normal - it will have enhanced stealth
```

## Strategy 2: Residential Proxies

**Pros:** Most effective - real residential IPs
**Cons:** Costs money ($50-200/month), adds latency

**Providers:**
- Bright Data (formerly Luminati) - Best quality, expensive
- Smartproxy - Good balance
- Oxylabs - Good for high volume
- IPRoyal - Cheaper option

**Implementation:**
```javascript
context = await browser.newContext({
    proxy: {
        server: 'http://residential-proxy-provider.com:8000',
        username: 'user',
        password: 'pass'
    },
    // ... rest of config
});
```

## Strategy 3: Human-like Behavior Simulation

**Pros:** Free, improves success rate
**Cons:** Slower, requires careful tuning

**Techniques:**
- Random mouse movements
- Human-like scrolling (not instant)
- Random delays between actions
- Typing with variable speed
- Reading time (pause on page before action)

```javascript
// Add before form submission
await simulateHumanBehavior(page);

async function simulateHumanBehavior(page) {
    // Random mouse movements
    await page.mouse.move(
        Math.random() * 1920,
        Math.random() * 1080,
        { steps: Math.floor(Math.random() * 10) + 5 }
    );
    
    // Human-like scroll
    await page.evaluate(() => {
        window.scrollTo({
            top: Math.random() * 500,
            behavior: 'smooth'
        });
    });
    await randomDelay(1000, 2000);
    
    // Random pause (reading time)
    await randomDelay(2000, 5000);
}
```

## Strategy 4: Cookie & Session Persistence

**Pros:** Makes requests look like returning user
**Cons:** Requires storage, session management

**Implementation:**
```javascript
// Save cookies after successful session
const cookies = await context.cookies();
fs.writeFileSync('cookies.json', JSON.stringify(cookies));

// Load cookies in next session
const savedCookies = JSON.parse(fs.readFileSync('cookies.json'));
await context.addCookies(savedCookies);
```

## Strategy 5: Canvas & WebGL Fingerprint Spoofing

**Pros:** Makes fingerprint match real browsers
**Cons:** Complex, may break some sites

**Implementation:**
```javascript
await context.addInitScript(() => {
    // Override canvas fingerprinting
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type) {
        if (type === 'image/png') {
            // Add noise to canvas fingerprint
            const context = this.getContext('2d');
            const imageData = context.getImageData(0, 0, this.width, this.height);
            for (let i = 0; i < imageData.data.length; i += 4) {
                imageData.data[i] += Math.floor(Math.random() * 3) - 1;
            }
            context.putImageData(imageData, 0, 0);
        }
        return originalToDataURL.apply(this, arguments);
    };
    
    // Override WebGL fingerprinting
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) { // UNMASKED_VENDOR_WEBGL
            return 'Intel Inc.';
        }
        if (parameter === 37446) { // UNMASKED_RENDERER_WEBGL
            return 'Intel Iris OpenGL Engine';
        }
        return getParameter.apply(this, arguments);
    };
});
```

## Strategy 6: TLS Fingerprint Matching

**Pros:** Very effective - Cloudflare checks TLS fingerprints
**Cons:** Requires custom TLS implementation or proxy

**Solutions:**
- Use curl-impersonate (wraps curl with real browser TLS)
- Use residential proxies (they have real TLS fingerprints)
- Use libraries like `tls-client` for Node.js

## Strategy 7: Warm-up Requests

**Pros:** Builds reputation before actual search
**Cons:** Slower, uses resources

**Implementation:**
```javascript
// Before actual search, make some "normal" requests
async function warmUpSession(page) {
    // Visit homepage first
    await page.goto('https://missingmoney.com/', { waitUntil: 'domcontentloaded' });
    await randomDelay(3000, 5000);
    
    // Visit about page
    await page.goto('https://missingmoney.com/about', { waitUntil: 'domcontentloaded' });
    await randomDelay(2000, 4000);
    
    // Then go to search page
    await page.goto('https://missingmoney.com/app/claim-search', { waitUntil: 'domcontentloaded' });
}
```

## Strategy 8: Rate Limiting & Request Spacing

**Pros:** Prevents triggering rate limits
**Cons:** Slower processing

**Implementation:**
```javascript
// Add delays between searches
const MIN_SEARCH_INTERVAL = 30000; // 30 seconds between searches
const lastSearchTime = new Map();

async function rateLimitedSearch(...args) {
    const now = Date.now();
    const lastTime = lastSearchTime.get('default') || 0;
    const timeSinceLastSearch = now - lastTime;
    
    if (timeSinceLastSearch < MIN_SEARCH_INTERVAL) {
        const waitTime = MIN_SEARCH_INTERVAL - timeSinceLastSearch;
        console.log(`Rate limiting: waiting ${waitTime}ms before next search`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    lastSearchTime.set('default', Date.now());
    return searchMissingMoney(...args);
}
```

## Strategy 9: Use Firefox Instead of Chromium

**Pros:** Different fingerprint, may bypass some detection
**Cons:** Slower, less stealth plugins available

**Implementation:**
```javascript
const { firefox } = require('playwright');
browser = await firefox.launch({ headless: true });
```

## Strategy 10: Multi-Layered Approach (RECOMMENDED)

Combine multiple strategies for best results:

1. **Use playwright-extra with stealth plugin** (Strategy 1)
2. **Add residential proxies** (Strategy 2) - if budget allows
3. **Simulate human behavior** (Strategy 3)
4. **Persist cookies/sessions** (Strategy 4)
5. **Add warm-up requests** (Strategy 7)
6. **Implement rate limiting** (Strategy 8)

## Implementation Priority

**Phase 1 (Quick Wins - Free):**
1. Add playwright-extra + stealth plugin
2. Add human behavior simulation
3. Add warm-up requests
4. Implement rate limiting

**Phase 2 (If Phase 1 insufficient):**
1. Add residential proxies
2. Add cookie persistence
3. Enhance fingerprint spoofing

**Phase 3 (Advanced):**
1. TLS fingerprint matching
2. Custom browser builds
3. Distributed requests across multiple IPs

## Testing Strategy

Test each strategy incrementally:
1. Baseline: Current implementation success rate
2. Test Strategy 1: Measure improvement
3. Test Strategy 1 + 3: Measure improvement
4. Continue adding strategies until success rate is acceptable

## Cost-Benefit Analysis

| Strategy | Cost | Effectiveness | Implementation Time |
|----------|------|---------------|---------------------|
| Stealth Plugin | Free | Medium | 1 hour |
| Human Behavior | Free | Medium | 2 hours |
| Warm-up Requests | Free | Low-Medium | 1 hour |
| Rate Limiting | Free | Low | 30 min |
| Residential Proxies | $50-200/mo | High | 2 hours |
| Cookie Persistence | Free | Medium | 1 hour |
| TLS Fingerprinting | Free-$50/mo | High | 4+ hours |

## Recommended Next Steps

1. **Immediate:** Implement playwright-extra + stealth plugin
2. **Short-term:** Add human behavior simulation and warm-up requests
3. **If needed:** Add residential proxies for production
4. **Long-term:** Consider API alternatives if available

