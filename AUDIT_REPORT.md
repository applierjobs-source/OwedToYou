# Codebase Audit Report
**Date:** 2025-12-13
**Purpose:** Document all working functionality to prevent regressions

## CRITICAL FUNCTIONALITY - DO NOT BREAK

### 1. Search Functionality
**Status:** ✅ WORKING (with multiple safeguards)
**Location:** `script.js` - `handleSearch()` function
**Dependencies:**
- `getInstagramFullName()` - Extracts name from Instagram
- `startMissingMoneySearch()` - Searches missingmoney.com
- `showShareModal()` - Shows results

**Key Points:**
- ✅ Exported to `window.handleSearch` IMMEDIATELY when script loads (line 2920-2922)
- ✅ Direct `onclick` handler in HTML (index.html line 25) as fallback
- ✅ Event listener attached in DOMContentLoaded (line 2387-2391)
- ✅ Enter key support in input field (line 2393-2399)
- ✅ Uses localStorage cache for Instagram names (7 day expiry)
- ✅ Uses localStorage cache for MissingMoney results (24 hour expiry)

**DO NOT:**
- Remove the immediate window export
- Remove the onclick handler from HTML
- Change function name without updating all references

---

### 2. Profile Picture Loading
**Status:** ✅ WORKING (with localStorage persistence)
**Location:** `script.js` - `loadProfilePicturesInBackground()` function
**Dependencies:**
- `getInstagramProfilePicture()` - Fetches from Instagram
- `loadProfilePicsFromStorage()` - Loads from localStorage
- `saveProfilePicsToStorage()` - Saves to localStorage

**Key Points:**
- ✅ Profile pics saved to localStorage when fetched (line 1097)
- ✅ Profile pics loaded from localStorage on page load (line 1004-1010)
- ✅ Profile pics preserved when leaderboard updates (line 995-1010)
- ✅ Profile pics preserved when adding entries (line 855-875)
- ✅ Profile pics preserved when deleting entries (line 886-915)
- ✅ Profile pics cleared when clearing leaderboard (line 930-950)
- ✅ Saved with both handle formats for better matching (line 1096-1097)

**DO NOT:**
- Remove localStorage save/load functions
- Change how profile pics are preserved in leaderboard updates
- Remove the preservation logic in addToLeaderboard/deleteFromLeaderboard

---

### 3. Leaderboard Functionality
**Status:** ✅ WORKING
**Location:** `script.js` - Multiple functions
**Database:** PostgreSQL table `leaderboard` with columns: id, name, handle, amount, is_placeholder, entities (JSONB)

**Key Functions:**
- `loadLeaderboard()` - Loads from backend, preserves profile pics from localStorage
- `addToLeaderboard()` - Adds/updates entry, preserves profile pics
- `deleteFromLeaderboard()` - Deletes entry, preserves profile pics
- `clearLeaderboardHandles()` - Clears all entries, clears localStorage pics
- `displayLeaderboard()` - Shows leaderboard, loads profile pics from localStorage BEFORE rendering

**Key Points:**
- ✅ Entities stored as JSONB in database
- ✅ Profile pics loaded from localStorage BEFORE HTML generation (line 1227-1237)
- ✅ All operations preserve existing profile pics
- ✅ "View" button shows businesses modal (line 1546)
- ✅ "Notify" button shows shareable modal (line 1991)
- ✅ "Claim Your Funds" button in both View and Notify modals (line 1633, 1991)

**DO NOT:**
- Change database schema without migration
- Remove profile pic preservation logic
- Change how entities are stored/retrieved

---

### 4. View Modal (Businesses Owing Money)
**Status:** ✅ WORKING
**Location:** `script.js` - `handleView()` function
**Features:**
- Shows name, total amount, list of businesses
- "Claim Your Funds" button below total amount (line 1368-1377)
- Button navigates to Instagram instruction modal

**Key Points:**
- ✅ Button positioned below total amount summary
- ✅ Uses data attributes for safe data passing
- ✅ Calls `handleClaimYourFundsFromView()` which calls `showShareModal()`

**DO NOT:**
- Move button position (must be below total amount)
- Remove data attributes
- Change function name

---

### 5. Notify Modal (Shareable View)
**Status:** ✅ WORKING
**Location:** `script.js` - `handleNotify()` function
**Features:**
- Shows same info as View modal
- "Claim Your Funds" button below total amount
- Share buttons (Copy Link, Twitter, Facebook, WhatsApp) below Claim button
- Shareable URL with ?share=handle parameter

**Key Points:**
- ✅ Claim button positioned below total amount (line 1992-2002)
- ✅ Share buttons positioned below Claim button
- ✅ URL parameter handling for auto-opening modal (index.html line 272-278)
- ✅ All sharing functions exported to window

**DO NOT:**
- Change button order
- Remove URL parameter handling
- Remove sharing functions

---

### 6. Instagram Name Extraction
**Status:** ✅ WORKING (with caching)
**Location:** `script.js` - `getInstagramFullName()` function
**Caching:** localStorage with 7 day expiry

**Key Points:**
- ✅ Checks localStorage cache first (line 23-35)
- ✅ Caches results from all extraction methods (line 57, 106, 121)
- ✅ Backend API fallback (line 38-58)
- ✅ Browser-based HTML extraction (line 121)
- ✅ Alternative proxy methods (line 100-112)

**DO NOT:**
- Remove caching
- Change cache expiry without good reason
- Remove extraction methods

---

### 7. MissingMoney.com Search
**Status:** ✅ WORKING (with caching)
**Location:** `script.js` - `startMissingMoneySearch()` function
**Backend:** `server.js` - `/api/search-missing-money` endpoint
**Caching:** localStorage with 24 hour expiry, max 100 entries

**Key Points:**
- ✅ Checks localStorage cache first (line 1762-1785)
- ✅ Caches results after search (line 1840)
- ✅ Only extracts "Reporting Business Name" column (not Owner Name)
- ✅ Converts "UNDISCLOSED" to "$100" (missingMoneySearch.js)
- ✅ Returns entities array for leaderboard

**DO NOT:**
- Remove caching
- Change entity extraction logic
- Remove UNDISCLOSED conversion

---

### 8. Shareable Card Image
**Status:** ✅ WORKING
**Location:** `script.js` - `downloadShareCard()` function and `showShareModal()` function
**Persistence:** Generated on-demand, no persistence needed

**Key Points:**
- ✅ "Funds by Company" section ALWAYS displays (line 2612-2627)
- ✅ Shows company list when results exist
- ✅ Shows "No specific companies listed" when no results
- ✅ Space between "Companies" and "owe" fixed with 8px span (line 2630)
- ✅ downloadShareCard function fixes spacing before rendering (line 2720-2735)
- ✅ Both displayed card and downloaded image use same HTML structure

**DO NOT:**
- Remove "Funds by Company" section
- Change the conditional logic that ensures it always shows
- Change the span width without testing
- Remove the downloadShareCard fix logic
- Create separate card generation paths (there should only be ONE card)

---

### 9. Database Schema
**Status:** ✅ WORKING
**Location:** `server.js` - `initializeDatabase()` function

**Schema:**
```sql
CREATE TABLE leaderboard (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    handle VARCHAR(255) UNIQUE NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    is_placeholder BOOLEAN NOT NULL DEFAULT false,
    entities JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

**Key Points:**
- ✅ Entities column added with migration (line 48-57)
- ✅ Index on handle for performance (line 59-62)
- ✅ All queries include entities column
- ✅ Entities stored as JSON string, parsed on retrieval

**DO NOT:**
- Change schema without migration
- Remove entities column
- Change how entities are stored/parsed

---

### 10. API Endpoints
**Status:** ✅ WORKING
**Location:** `server.js`

**Endpoints:**
- `GET /api/leaderboard` - Returns all entries with entities
- `POST /api/leaderboard` - Adds/updates entry with entities
- `DELETE /api/leaderboard?handle=...` - Deletes entry
- `POST /api/leaderboard/clear-handles` - Clears all entries
- `GET /api/instagram-name?username=...` - Extracts Instagram name
- `GET /api/profile-pic?username=...` - Gets profile picture
- `POST /api/search-missing-money` - Searches missingmoney.com

**Key Points:**
- ✅ All leaderboard endpoints return entities
- ✅ All leaderboard endpoints preserve data correctly
- ✅ CORS headers set correctly

**DO NOT:**
- Remove entities from responses
- Change endpoint URLs without updating frontend
- Remove CORS headers

---

## LOCALSTORAGE PERSISTENCE

### What's Cached:
1. **Profile Pictures** (`leaderboardProfilePics`)
   - Key: handle (both original and cleaned)
   - Value: profile picture URL
   - Expiry: None (persists until cleared)

2. **Instagram Names** (`instagramNames`)
   - Key: handle
   - Value: { fullName, timestamp }
   - Expiry: 7 days

3. **MissingMoney Results** (`missingMoneyResults`)
   - Key: `firstName_lastName` (lowercase)
   - Value: { result, timestamp }
   - Expiry: 24 hours
   - Max entries: 100 (oldest removed when full)

**DO NOT:**
- Change localStorage keys
- Remove expiry logic
- Change cache structure

---

## WINDOW EXPORTS

All functions exported to window (line 2917-2957):
- handleSearch ✅
- handleClaim ✅
- handleView ✅
- closeViewModal ✅
- handleClaimYourFundsFromView ✅
- handleNotify ✅
- handleNotifyFromUrl ✅
- closeShareableViewModal ✅
- copyShareableLink ✅
- shareToTwitter ✅
- shareToFacebook ✅
- shareToWhatsApp ✅
- clearLeaderboardHandles ✅
- closeClaimModal ✅
- closeResultsModal ✅
- handleClaimSubmit ✅
- handleClaimPaid ✅
- handleClaimFree ✅
- handleClaimFreeClick ✅
- handleClaimYourFundsClick ✅
- showNameSearchModal ✅
- showShareModal ✅
- shareToInstagram ✅
- downloadShareCard ✅
- closeShareModal ✅
- showPhoneModal ✅
- handlePhoneSubmit ✅
- closePhoneModal ✅
- deleteFromLeaderboard ✅
- showPhoneProgressModal ✅
- hidePhoneProgressModal ✅
- showMailingAddressModal ✅
- closeMailingAddressModal ✅
- handleMailingAddressSubmit ✅
- toggleSSNVisibility ✅

**DO NOT:**
- Remove any window exports
- Change function names without updating exports
- Export functions before they're defined

---

## EVENT LISTENERS

**DOMContentLoaded Handler** (line 2369):
- Search button click ✅
- Search input Enter key ✅
- Modal close on outside click ✅
- Modal close on Escape key ✅
- Load leaderboard on page load ✅
- Handle share URL parameter ✅

**DO NOT:**
- Remove event listeners
- Change event handler logic without testing
- Remove the DOMContentLoaded wrapper

---

## KNOWN ISSUES

1. **Space in downloadable image** - Using 8px span, should work but needs verification
2. **Profile pictures** - Should load from localStorage immediately, verify this works

---

## TESTING CHECKLIST

Before making ANY changes, verify:
- [ ] Search button works (click and Enter key)
- [ ] Profile pictures load and persist
- [ ] Leaderboard displays correctly
- [ ] View button works
- [ ] Notify button works
- [ ] Claim Your Funds button works in both modals
- [ ] Share buttons work
- [ ] Download card image works
- [ ] Space appears in downloaded image
- [ ] localStorage caching works
- [ ] Database operations work

---

## CRITICAL RULES

1. **NEVER remove localStorage persistence logic**
2. **NEVER remove window exports**
3. **NEVER change function names without updating all references**
4. **NEVER remove event listeners**
5. **NEVER change database schema without migration**
6. **ALWAYS preserve profile pictures when updating leaderboard**
7. **ALWAYS check cache before making API calls**
8. **ALWAYS test search button after any changes**
9. **ALWAYS verify profile pictures load after changes**
10. **ALWAYS ensure Claim Your Funds button is below total amount**

---

## CHANGE PERSISTENCE PROTOCOL

**CRITICAL: All changes MUST persist across future updates unless explicitly reverted by the user.**

### Before Making ANY Change:

1. **Read the AUDIT_REPORT.md** - Understand what's critical and what must not be broken
2. **Check existing persistence mechanisms** - Review localStorage, database, window exports
3. **Identify dependencies** - What other code depends on what you're changing?
4. **Document the change** - Update AUDIT_REPORT.md if adding new functionality

### When Making Changes:

1. **Preserve existing functionality** - Never remove working code unless explicitly asked
2. **Maintain localStorage persistence** - If data should persist, use localStorage
3. **Keep window exports** - All user-facing functions must be exported
4. **Preserve event listeners** - Don't remove or break existing listeners
5. **Test immediately** - Verify the change works AND doesn't break existing features
6. **Update documentation** - If adding new persistence, document it in AUDIT_REPORT.md

### After Making Changes:

1. **Verify persistence** - Test that data survives page reload
2. **Check all related features** - Ensure nothing broke
3. **Update AUDIT_REPORT.md** - Document new critical functionality
4. **Test the full flow** - Run through the complete user journey

### What MUST Persist:

1. **Profile Pictures** - localStorage (`leaderboardProfilePics`)
2. **Instagram Names** - localStorage (`instagramNames`) with 7-day expiry
3. **MissingMoney Results** - localStorage (`missingMoneyResults`) with 24-hour expiry
4. **Leaderboard Data** - PostgreSQL database
5. **Window Exports** - All functions accessible via `window.*`
6. **Event Listeners** - All DOM event handlers
7. **UI State** - Modal states, button positions, styling

### Red Flags - STOP and Reconsider:

- ❌ Removing localStorage save/load functions
- ❌ Removing window exports
- ❌ Changing function names without updating all references
- ❌ Removing event listeners
- ❌ Changing database schema without migration
- ❌ Removing profile picture preservation logic
- ❌ Removing cache checks before API calls
- ❌ Changing critical function signatures
- ❌ Removing "Funds by Company" section from shareable card
- ❌ Changing the spacing fix for "Companies owe" text

### Change Documentation Template:

When adding new functionality that should persist, document:

```markdown
### [Feature Name]
**Status:** ✅ WORKING
**Location:** `script.js` - `functionName()` function
**Persistence:** localStorage key `keyName` (expiry: X days/hours)
**Dependencies:** [list dependencies]
**DO NOT:** [list what must not be changed]
```

---

## FILES TO BE CAREFUL WITH

1. **script.js** - Contains all frontend logic
   - Line 1258: handleSearch - CRITICAL
   - Line 1048: loadProfilePicturesInBackground - CRITICAL
   - Line 1219: displayLeaderboard - CRITICAL
   - Line 820: loadLeaderboard - CRITICAL
   - Line 2917-2957: Window exports - CRITICAL

2. **server.js** - Contains all backend logic
   - Line 28: initializeDatabase - CRITICAL
   - Line 750: GET /api/leaderboard - CRITICAL
   - Line 900: POST /api/leaderboard - CRITICAL

3. **index.html** - Contains HTML structure
   - Line 25: Search button onclick - CRITICAL
   - Line 33: Leaderboard header - CRITICAL

---

**END OF AUDIT REPORT**
