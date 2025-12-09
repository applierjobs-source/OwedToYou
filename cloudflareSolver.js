// Cloudflare Turnstile solver using 2captcha API v2
const axios = require('axios');

class CloudflareSolver {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.2captcha.com';
    }
    
    async solveTurnstile(siteKey, pageUrl, action = null, cData = null, pagedata = null) {
        if (!this.apiKey) {
            throw new Error('2captcha API key not provided');
        }
        
        console.log('🚀🚀🚀 SOLVING CLOUDFLARE TURNSTILE WITH 2CAPTCHA API v2 🚀🚀🚀');
        console.log(`Site key: ${siteKey}`);
        console.log(`Page URL: ${pageUrl}`);
        console.log(`Action: ${action || 'not provided (standalone)'}`);
        console.log(`API key (first 10 chars): ${this.apiKey.substring(0, 10)}...`);
        
        try {
            // Build task object
            const task = {
                type: 'TurnstileTaskProxyless',
                websiteURL: pageUrl,
                websiteKey: siteKey
            };
            
            // Add Cloudflare Challenge page parameters if provided
            // Note: For Cloudflare Challenge pages, these parameters help 2captcha solve more accurately
            if (action || cData || pagedata) {
                if (action) {
                    task.action = action;
                    console.log(`📋 Action parameter: ${action.substring(0, 50)}...`);
                }
                if (cData) {
                    task.data = cData;
                    console.log(`📋 cData parameter: ${cData.substring(0, 50)}...`);
                }
                if (pagedata) {
                    task.pagedata = pagedata;
                    console.log(`📋 pagedata parameter: ${pagedata.substring(0, 50)}...`);
                }
                console.log('📋 Using Cloudflare Challenge page mode (with available parameters)');
            } else {
                console.log('📋 Using Standalone Captcha mode (no challenge page parameters)');
            }
            
            // Submit task to 2captcha API v2
            console.log('📤 SUBMITTING TASK TO 2CAPTCHA API v2...');
            console.log(`URL: ${this.baseUrl}/createTask`);
            console.log(`API Key (first 10 chars): ${this.apiKey.substring(0, 10)}...`);
            console.log(`Task object:`, JSON.stringify(task, null, 2));
            
            const requestBody = {
                clientKey: this.apiKey,
                task: task
            };
            console.log(`Full request body:`, JSON.stringify(requestBody, null, 2));
            
            const createTaskResponse = await axios.post(`${this.baseUrl}/createTask`, requestBody, {
                timeout: 30000,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            console.log('📥 2CAPTCHA CREATE TASK RESPONSE:', JSON.stringify(createTaskResponse.data, null, 2));
            
            if (createTaskResponse.data.errorId !== 0) {
                throw new Error(`2captcha error: ${createTaskResponse.data.errorCode} - ${createTaskResponse.data.errorDescription}`);
            }
            
            const taskId = createTaskResponse.data.taskId;
            console.log(`✅ Task submitted to 2captcha, ID: ${taskId}`);
            console.log('⏳ Waiting for 2captcha to solve (this may take 10-30 seconds)...');
            
            // Poll for result (max 2 minutes, check every 3 seconds for faster response)
            for (let i = 0; i < 40; i++) { // More iterations but shorter delays
                await new Promise(resolve => setTimeout(resolve, 3000)); // Reduced from 5 to 3 seconds
                
                if (i % 3 === 0) {
                    console.log(`🔍 Checking 2captcha status... (${(i + 1) * 3} seconds)`);
                }
                
                const getResultResponse = await axios.post(`${this.baseUrl}/getTaskResult`, {
                    clientKey: this.apiKey,
                    taskId: taskId
                }, {
                    timeout: 10000,
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                
                console.log(`📊 Status check ${i + 1}:`, JSON.stringify(getResultResponse.data, null, 2));
                
                if (getResultResponse.data.status === 'ready') {
                    const solution = getResultResponse.data.solution;
                    const token = solution.token;
                    const userAgent = solution.userAgent;
                    
                    console.log('✅✅✅ CLOUDFLARE CHALLENGE SOLVED BY 2CAPTCHA! ✅✅✅');
                    console.log(`Token received (first 50 chars): ${token.substring(0, 50)}...`);
                    if (userAgent) {
                        console.log(`User Agent from 2captcha: ${userAgent}`);
                    }
                    
                    return {
                        token: token,
                        userAgent: userAgent
                    };
                } else if (getResultResponse.data.status === 'processing') {
                    // Continue polling
                    continue;
                } else {
                    throw new Error(`2captcha error: ${getResultResponse.data.errorCode || 'Unknown error'} - ${getResultResponse.data.errorDescription || 'Unknown'}`);
                }
            }
            
            throw new Error('2captcha timeout after 2 minutes');
        } catch (error) {
            console.error('❌ 2captcha error:', error.message);
            if (error.response) {
                console.error('❌ 2captcha response:', JSON.stringify(error.response.data, null, 2));
            }
            throw error;
        }
    }
}

module.exports = { CloudflareSolver };
