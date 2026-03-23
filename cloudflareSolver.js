// Cloudflare Turnstile solver via Capsolver (https://www.capsolver.com)
// Same contract as before: returns { token, userAgent } so Playwright can set User-Agent when present.
const axios = require('axios');

const CAPSOLVER_BASE = 'https://api.capsolver.com';

/**
 * Capsolver accepts a single `proxy` string (see their "How to use proxy" docs).
 */
function captchaProxyToCapsolverProxyString(proxy) {
    if (!proxy || !proxy.proxyAddress || !proxy.proxyPort) return null;
    const type = (proxy.proxyType || 'http').toLowerCase();
    const host = proxy.proxyAddress;
    const port = proxy.proxyPort;
    const user = proxy.proxyLogin;
    const pass = proxy.proxyPassword;
    if (user != null && user !== '' && pass != null && pass !== '') {
        return `${type}:${host}:${port}:${user}:${pass}`;
    }
    return `${type}:${host}:${port}`;
}

class CloudflareSolver {
    constructor(apiKey) {
        this.apiKey = apiKey;
    }

    async solveTurnstile(siteKey, pageUrl, action = null, cData = null, pagedata = null, proxy = null) {
        if (!this.apiKey) {
            throw new Error('Capsolver API key not provided (set CAPSOLVER_API_KEY or CAPTCHA_API_KEY)');
        }

        console.log('🚀 SOLVING CLOUDFLARE TURNSTILE WITH CAPSOLVER');
        console.log(`Site key: ${siteKey}`);
        console.log(`Page URL: ${pageUrl}`);
        console.log(`Action: ${action || 'not provided'}`);

        const task = {
            type: 'AntiTurnstileTaskProxyLess',
            websiteURL: pageUrl,
            websiteKey: siteKey
        };

        const metadata = {};
        if (action) metadata.action = action;
        if (cData) metadata.cdata = cData;
        // Some Cloudflare challenge flows pass extra page data; Capsolver may use extended metadata
        if (pagedata) metadata.chlPageData = pagedata;
        if (Object.keys(metadata).length > 0) {
            task.metadata = metadata;
        }

        const proxyStr = captchaProxyToCapsolverProxyString(proxy);
        if (proxyStr) {
            task.proxy = proxyStr;
            console.log(`📡 Capsolver task includes proxy (same IP as browser when possible)`);
        }

        const doCreate = async (taskPayload) => {
            return axios.post(
                `${CAPSOLVER_BASE}/createTask`,
                { clientKey: this.apiKey, task: taskPayload },
                { timeout: 30000, headers: { 'Content-Type': 'application/json' } }
            );
        };

        try {
            let createRes = await doCreate(task);
            let createData = createRes.data;
            // Proxyless task type may reject explicit proxy — retry without it
            if (
                createData.errorId !== 0 &&
                proxyStr &&
                (String(createData.errorDescription || '').toLowerCase().includes('proxy') ||
                    String(createData.errorCode || '').toLowerCase().includes('proxy'))
            ) {
                console.warn('⚠️ Capsolver rejected proxy on Turnstile task; retrying without proxy');
                delete task.proxy;
                createRes = await doCreate(task);
                createData = createRes.data;
            }

            console.log('📥 Capsolver createTask:', JSON.stringify({ errorId: createData.errorId, taskId: createData.taskId, status: createData.status }));

            if (createData.errorId !== 0 && createData.errorId != null) {
                throw new Error(
                    `Capsolver createTask error: ${createData.errorCode || createData.errorId} - ${createData.errorDescription || 'unknown'}`
                );
            }

            const taskId = createData.taskId;
            if (!taskId) {
                throw new Error('Capsolver did not return taskId');
            }

            console.log(`✅ Capsolver taskId: ${taskId}, polling for result...`);

            for (let i = 0; i < 45; i++) {
                await new Promise((r) => setTimeout(r, 3000));

                if (i % 3 === 0) {
                    console.log(`🔍 Capsolver status check ${i + 1}...`);
                }

                const resultRes = await axios.post(
                    `${CAPSOLVER_BASE}/getTaskResult`,
                    { clientKey: this.apiKey, taskId },
                    { timeout: 15000, headers: { 'Content-Type': 'application/json' } }
                );

                const data = resultRes.data;

                if (data.status === 'ready' && data.solution && data.solution.token) {
                    const token = data.solution.token;
                    const userAgent = data.solution.userAgent || null;
                    console.log('✅ CAPSOLVER TURNSTILE SOLVED');
                    console.log(`Token (first 50 chars): ${token.substring(0, 50)}...`);
                    if (userAgent) console.log(`User-Agent from Capsolver: ${userAgent.substring(0, 80)}...`);
                    return { token, userAgent };
                }

                if (data.status === 'failed') {
                    throw new Error(
                        `Capsolver failed: ${data.errorCode || ''} - ${data.errorDescription || JSON.stringify(data)}`
                    );
                }
                if (data.errorId != null && data.errorId !== 0 && data.status !== 'processing' && data.status !== 'idle') {
                    throw new Error(
                        `Capsolver error: ${data.errorCode || data.errorId} - ${data.errorDescription || JSON.stringify(data)}`
                    );
                }
                // status processing / idle — continue polling
            }

            throw new Error('Capsolver timeout waiting for Turnstile solution');
        } catch (err) {
            console.error('❌ Capsolver error:', err.message);
            if (err.response && err.response.data) {
                console.error('❌ Capsolver response:', JSON.stringify(err.response.data, null, 2));
            }
            throw err;
        }
    }
}

module.exports = { CloudflareSolver };
