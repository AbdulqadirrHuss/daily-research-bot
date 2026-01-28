const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const UserPreferencesPlugin = require('puppeteer-extra-plugin-user-preferences');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// --- SETUP ---
puppeteer.use(StealthPlugin());

// 1. PATHING: Use the path passed from GitHub Actions, or default to local
const DOWNLOAD_DIR = process.env.PUPPETEER_DOWNLOAD_PATH || path.resolve(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

// 2. PREFERENCES: Force "Save" behavior
puppeteer.use(UserPreferencesPlugin({
    userPrefs: {
        download: {
            prompt_for_download: false,
            open_pdf_in_system_reader: false,
            default_directory: DOWNLOAD_DIR,
        },
        plugins: { always_open_pdf_externally: true }
    }
}));

const TASKS = (process.env.TASKS || "Renewable Energy").split(';').map(t => t.trim());
const MAX_FILES = parseInt(process.env.MAX_FILES) || 10;

// --- SEARCH ENGINES SWARM ---
const ENGINES = [
    {
        name: "DuckDuckGo HTML",
        url: (q) => `https://html.duckduckgo.com/html/?q=${q}`,
        selector: 'a'
    },
    {
        name: "Bing",
        url: (q) => `https://www.bing.com/search?q=${q}`,
        selector: 'li.b_algo h2 a, .b_algo a'
    },
    {
        name: "Yahoo",
        url: (q) => `https://search.yahoo.com/search?p=${q}`,
        selector: 'h3.title a'
    }
];

(async () => {
    console.log("🤖 ARMOR-PLATED BOT ONLINE");
    console.log(`📂 Target Folder: ${DOWNLOAD_DIR}`);
    
    // Launch with system-safe args
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage', // Fix for Docker/CI memory issues
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    });

    const page = await browser.newPage();
    
    // 3. CDP SESSION: The Ultimate Override
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', { 
        behavior: 'allow', 
        downloadPath: DOWNLOAD_DIR 
    });
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    for (const topic of TASKS) {
        console.log(`\n🚀 TASK: "${topic}"`);
        const topicDir = path.join(DOWNLOAD_DIR, topic.replace(/[^a-z0-9]/gi, '_'));
        if (!fs.existsSync(topicDir)) fs.mkdirSync(topicDir, { recursive: true });
        
        // Re-apply CDP for subfolder
        await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: topicDir });

        let candidates = [];
        const q = encodeURIComponent(`${topic} filetype:pdf`);

        // --- ENGINE LOOP ---
        for (const engine of ENGINES) {
            console.log(`   📡 Engine: ${engine.name}`);
            try {
                await page.goto(engine.url(q), { waitUntil: 'domcontentloaded', timeout: 15000 });
                
                // Extract Links
                const links = await page.evaluate((sel) => {
                    return Array.from(document.querySelectorAll('a'))
                        .map(a => a.href)
                        .filter(href => href && (href.toLowerCase().includes('.pdf')));
                }, engine.selector);

                if (links.length > 0) {
                    console.log(`      ✅ Found ${links.length} results.`);
                    candidates = links;
                    break; 
                }
            } catch (e) { console.log(`      ❌ Error: ${e.message}`); }
        }

        if (candidates.length === 0) {
            console.log("   ⚠️ All engines failed. Taking debug snapshot.");
            await page.screenshot({ path: path.join(topicDir, 'debug_fail.png') });
            continue;
        }

        // --- DOWNLOADER ---
        let count = 0;
        const uniqueLinks = [...new Set(candidates)];

        for (const link of uniqueLinks) {
            if (count >= MAX_FILES) break;
            const filename = `doc_${count + 1}.pdf`;
            const savePath = path.join(topicDir, filename);

            try {
                console.log(`   ⬇️ Fetching: ${link.substring(0,40)}...`);
                // Use Axios for 100% reliability in CI
                await downloadAxios(link, savePath);
                
                if (fs.existsSync(savePath) && fs.statSync(savePath).size > 3000) {
                    console.log(`      ✅ Saved`);
                    count++;
                } else {
                    // Try Browser Navigation as Backup
                    try {
                        await page.goto(link, { timeout: 5000 });
                        await new Promise(r => setTimeout(r, 2000)); // Wait for implicit download
                        const found = findNewFile(topicDir);
                        if (found) count++;
                    } catch (e) {}
                }
            } catch (e) {
                // console.log(`      ❌ Skip: ${e.message}`);
            }
        }
    }

    await browser.close();
    console.log("\n🏁 JOB DONE");
})();

async function downloadAxios(url, dest) {
    const writer = fs.createWriteStream(dest);
    const response = await axios({
        url, method: 'GET', responseType: 'stream',
        headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000
    });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

function findNewFile(dir) {
    try {
        const files = fs.readdirSync(dir);
        return files.find(f => !f.endsWith('.crdownload') && !f.endsWith('.png'));
    } catch (e) { return null; }
}
