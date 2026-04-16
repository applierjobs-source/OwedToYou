(function () {
    'use strict';

    const STORAGE_KEY = 'moneyOwedReportPayload';

    const STATE_PORTALS = {
        AL: 'https://alabamaunclaimed.gov',
        AK: 'https://unclaimedproperty.alaska.gov',
        AZ: 'https://aztreasury.gov/unclaimed-property',
        AR: 'https://claimitar.com',
        CA: 'https://claimit.ca.gov',
        CO: 'https://colorado.findyourunclaimedproperty.com',
        CT: 'https://portal.ct.gov/UCT',
        DE: 'https://unclaimedproperty.delaware.gov',
        FL: 'https://www.fltreasurehunt.gov',
        GA: 'https://etax.georgia.gov/unclaimed-property-program',
        HI: 'https://unclaimedproperty.ehawaii.gov',
        ID: 'https://yourmoney.idaho.gov',
        IL: 'https://icash.illinoistreasurer.gov',
        IN: 'https://www.indianaunclaimed.gov',
        IA: 'https://greatiowatreasurehunt.gov',
        KS: 'https://www.kansascash.ks.gov',
        KY: 'https://missingmoney.com/app/claim-search',
        LA: 'https://www.treasury.la.gov/unclaimed-property',
        ME: 'https://www.maineunclaimedproperty.gov',
        MD: 'https://interactive.marylandtaxes.gov/webapps/unclaim/default.aspx',
        MA: 'https://www.findmassmoney.gov',
        MI: 'https://michigan.gov/unclaimedproperty',
        MN: 'https://missingmoney.com/app/claim-search',
        MS: 'https://www.treasurer.ms.gov/unclaimedproperty',
        MO: 'https://treasurer.mo.gov/UnclaimedProperty',
        MT: 'https://mtrevenue.gov/unclaimed-property',
        NE: 'https://treasurer.nebraska.gov/unclaimed-property',
        NV: 'https://nevadatreasurer.gov/unclaimed-property',
        NH: 'https://www.nhtreasury.org/unclaimed-property',
        NJ: 'https://www.unclaimedproperty.nj.gov',
        NM: 'https://www.tax.newmexico.gov/unclaimed-property',
        NY: 'https://www.osc.state.ny.us/unclaimed-funds',
        NC: 'https://www.nctreasurer.com/unclaimed-property',
        ND: 'https://www.land.nd.gov/unclaimed-property',
        OH: 'https://unclaimedproperty.ohio.gov',
        OK: 'https://www.ok.gov/treasurer/Unclaimed_Property',
        OR: 'https://unclaimed.oregon.gov',
        PA: 'https://www.patreasury.gov/unclaimed-property',
        RI: 'https://www.findrimoney.com',
        SC: 'https://sctreasurer.gov/unclaimed-property',
        SD: 'https://sdtreasurer.gov/unclaimed-property',
        TN: 'https://treasury.tn.gov/unclaimed-property',
        TX: 'https://claimittexas.org',
        UT: 'https://mycash.utah.gov',
        VT: 'https://www.vermonttreasurer.gov/content/unclaimed-property',
        VA: 'https://www.vamoneysearch.org',
        WA: 'https://claimyourcash.org',
        WV: 'https://www.wvtreasury.com/Unclaimed_Property',
        WI: 'https://www.wicashsearch.gov',
        WY: 'https://treasurer.wyo.gov/unclaimed-property'
    };

    const US_STATE_NAMES = {
        AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
        CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
        HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
        KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
        MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
        MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
        NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
        ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
        RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
        TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
        WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia'
    };

    function escapeHtml(text) {
        if (text == null) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }

    function formatMoney(n) {
        const num = Number(n);
        if (!Number.isFinite(num)) return '$0.00';
        return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function parseLocalDate(isoYmd) {
        const [y, m, d] = isoYmd.split('-').map(Number);
        return new Date(y, m - 1, d);
    }

    function startOfToday() {
        const t = new Date();
        return new Date(t.getFullYear(), t.getMonth(), t.getDate());
    }

    function formatLongDate(d) {
        return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    }

    function formatShortDate(isoYmd) {
        return parseLocalDate(isoYmd).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
    }

    function loadPayload() {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (_) {
            return null;
        }
    }

    function activeSettlements(all) {
        const today = startOfToday();
        return all.filter((s) => parseLocalDate(s.deadline) >= today).sort((a, b) => a.deadline.localeCompare(b.deadline));
    }

    function groupSettlementsByMonth(rows) {
        const map = new Map();
        for (const s of rows) {
            const key = s.deadline.slice(0, 7);
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(s);
        }
        return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    }

    function federalSection() {
        const rows = [
            ['IRS', 'Tax Refunds', 'irs.gov/refunds'],
            ['US Treasury', 'Matured Savings Bonds', 'treasurydirect.gov/treasury-hunt'],
            ['PBGC', 'Unclaimed Pensions', 'pbgc.gov/search-unclaimed-pensions'],
            ['HUD/FHA', 'Mortgage Refunds', 'entp.hud.gov/dsrs/refunds'],
            ['DOL', 'Unpaid Wages', 'webapps.dol.gov/wow'],
            ['SEC', 'Investment Enforcement', 'sec.gov/harmed-investors'],
            ['FDIC', 'Failed Bank Funds', 'closedbanks.fdic.gov/funds'],
            ['US Courts', 'Bankruptcy Funds', 'ucf.uscourts.gov'],
            ['NCUA', 'Credit Union Deposits', 'ncua.gov/unclaimed-deposits']
        ];
        let html = '<h2>Section 3: Federal unclaimed money — check personally</h2>';
        html += '<p>Federal agencies hold various types of unclaimed funds. Search each database using your full name (and SSN where required).</p>';
        html += '<table><thead><tr><th>Agency</th><th>Fund type</th><th>Search URL</th></tr></thead><tbody>';
        for (const [a, t, u] of rows) {
            html += `<tr><td>${escapeHtml(a)}</td><td>${escapeHtml(t)}</td><td>https://${escapeHtml(u)}</td></tr>`;
        }
        html += '</tbody></table>';
        return html;
    }

    function statesSection(stateAbbr, displayName, totalAmount, resultCount) {
        const ab = (stateAbbr || '').toUpperCase().trim();
        const stateName = US_STATE_NAMES[ab] || '';
        const portal = STATE_PORTALS[ab] || 'https://unclaimed.org/';
        let html = '<h2>Section 4: Additional states to check</h2>';
        html += '<p>Many people have unclaimed property in multiple states. Search all states at once: <strong>https://unclaimed.org/</strong> and cross-check <strong>https://missingmoney.com</strong>.</p>';
        html += '<h3>Priority states</h3><table><thead><tr><th>State</th><th>Why check</th><th>Portal</th></tr></thead><tbody>';

        if (ab && stateName) {
            html += `<tr><td>${escapeHtml(stateName)}</td><td>Matches your search location / common residence.</td><td>${escapeHtml(portal)}</td></tr>`;
        }

        html += `<tr><td>All states</td><td>Nationwide portal (NAUPA)</td><td>https://unclaimed.org/</td></tr>`;
        html += `<tr><td>Texas</td><td>If you lived or worked in TX — official state site</td><td>https://claimittexas.org</td></tr>`;
        html += `<tr><td>Delaware</td><td>Many companies incorporate in DE — separate DE records are common</td><td>https://unclaimedproperty.delaware.gov</td></tr>`;

        html += '</tbody></table>';

        if (resultCount > 0) {
            html += `<p class="footnote">Your MissingMoney-style matches in this report: <strong>${resultCount}</strong> line item(s); confirmed total shown in the summary: <strong>${formatMoney(totalAmount)}</strong>. Amounts come from public unclaimed-property databases and may change.</p>`;
        }
        return html;
    }

    function renderReport(payload, settlements) {
        const displayName = (payload.displayName || `${payload.firstName || ''} ${payload.lastName || ''}`).trim();
        const city = (payload.city || '').trim();
        const state = (payload.state || '').trim();
        const locationLine = [city, state].filter(Boolean).join(', ') || 'Location not specified';
        const generated = payload.generatedAt ? new Date(payload.generatedAt) : new Date();
        const results = Array.isArray(payload.results) ? payload.results : [];
        const totalAmount = Number(payload.totalAmount) || 0;

        const active = activeSettlements(settlements);
        const monthGroups = groupSettlementsByMonth(active);

        let html = '';
        html += `<p class="eyebrow">Confidential</p>`;
        html += `<h1>Money Owed to ${escapeHtml(displayName)}</h1>`;
        html += `<p class="meta">Report date: ${escapeHtml(formatLongDate(generated))} · ${escapeHtml(locationLine)}</p>`;

        html += '<div class="stats">';
        html += `<div class="stat"><div class="stat-value">${escapeHtml(formatMoney(totalAmount))}</div><div class="stat-label">Confirmed-style unclaimed (from this search)</div></div>`;
        html += '<div class="stat"><div class="stat-value">$25,000+</div><div class="stat-label">Potential from settlements (varies)</div></div>';
        html += `<div class="stat"><div class="stat-value">${active.length}</div><div class="stat-label">Active settlements listed</div></div>`;
        html += '</div>';

        html += '<h2>Section 1: Unclaimed property (MissingMoney / state databases)</h2>';
        html += `<p>Records below are from your OwedToYou.ai search (typically MissingMoney.com and similar sources). Verify each entry on the official state site when you file a claim.</p>`;

        if (results.length === 0) {
            html += '<p><em>No per-entity breakdown was returned for this search. You should still run your name on MissingMoney.com and your state portal.</em></p>';
        } else {
            html += '<table><thead><tr><th>#</th><th>Reporting business / holder</th><th>Amount (as reported)</th></tr></thead><tbody>';
            results.forEach((r, i) => {
                const ent = r.entity || r.ReportingBusiness || '—';
                const amt = r.amount || '—';
                html += `<tr><td>${i + 1}</td><td>${escapeHtml(ent)}</td><td>${escapeHtml(amt)}</td></tr>`;
            });
            html += '</tbody></table>';
            html += `<p class="footnote">Total from listed rows (site calculation): <strong>${escapeHtml(formatMoney(totalAmount))}</strong>. Claim via your state treasurer / <strong>https://missingmoney.com</strong> — search your name and verify addresses.</p>`;
        }

        html += '<h2>Section 2: Class action settlements (public list — review eligibility)</h2>';
        html += `<p><strong>Profile summary:</strong> This section lists widely reported open settlements with future deadlines. It is <em>not</em> a determination that you qualify; read each settlement’s official rules before filing.</p>`;

        if (active.length === 0) {
            html += '<p><em>No upcoming deadlines in our curated list at this time. Check <strong>https://topclassactions.com</strong> for updates.</em></p>';
        } else {
            let globalN = 1;
            for (const [ym, list] of monthGroups) {
                const d = parseLocalDate(ym + '-01');
                const title = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                html += `<h3>Deadlines — ${escapeHtml(title)}</h3>`;
                html += '<table><thead><tr><th>#</th><th>Company</th><th>What it’s about</th><th>Deadline</th><th>Potential payout</th><th>Claim / info</th></tr></thead><tbody>';
                for (const s of list) {
                    const link = s.url && /^https?:\/\//i.test(s.url)
                        ? `<a href="${escapeHtml(s.url)}">${escapeHtml(s.url)}</a>`
                        : escapeHtml(s.url || '');
                    html += `<tr><td>${globalN++}</td><td>${escapeHtml(s.company)}</td><td>${escapeHtml(s.what)}</td><td>${escapeHtml(formatShortDate(s.deadline))}</td><td>${escapeHtml(s.payout)}</td><td>${link}</td></tr>`;
                }
                html += '</tbody></table>';
            }
        }

        html += federalSection();
        html += statesSection(state, displayName, totalAmount, results.length);

        html += '<div class="disclaimer">';
        html += '<p><strong>Disclaimer:</strong> Eligibility for class action settlements varies. Review each settlement’s official eligibility criteria before filing. This report is for informational purposes only and does not constitute legal or financial advice. Unclaimed property amounts are as reported by public databases and may change.</p>';
        html += `<p>Report generated by <strong>OwedToYou.ai</strong> on ${escapeHtml(formatLongDate(generated))}.</p>`;
        html += '<p>Sources: state unclaimed-property programs, MissingMoney.com, Unclaimed.org, class action portals, and the sites linked above.</p>';
        html += '</div>';

        return html;
    }

    async function main() {
        const root = document.getElementById('reportRoot');
        const payload = loadPayload();

        if (!payload) {
            root.innerHTML = '<div class="error-box"><p>No report data found.</p><p>Run a search on the homepage, then open <strong>Full money report</strong> from your results.</p><p><a href="/">Return to OwedToYou.ai</a></p></div>';
            return;
        }

        let settlements = [];
        try {
            const res = await fetch('/settlements.json', { cache: 'no-store' });
            if (res.ok) settlements = await res.json();
        } catch (_) {}

        root.innerHTML = renderReport(payload, Array.isArray(settlements) ? settlements : []);

        document.getElementById('btnPrint').addEventListener('click', () => window.print());
    }

    main();
})();
