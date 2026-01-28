const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const UserPreferencesPlugin = require('puppeteer-extra-plugin-user-preferences');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// --- SETUP ---
puppeteer.use(StealthPlugin());

// 1. PATHING
const DOWNLOAD_DIR = process.env.PUPPETEER_DOWNLOAD_PATH || path.resolve(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

// 2. PREFERENCES (Force Browser to Download without prompting)
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

// --- SEARCH ENGINES ---
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
    }
];

(async () => {
    console.log("🤖 ANTI-REJECTION BOT ONLINE");
    console.log(`📂 Target: ${DOWNLOAD_DIR}`);
    
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    });

    const page = await browser.newPage();
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR });
    
    // Mimic a standard Windows 10 Chrome user
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    for (const topic of TASKS) {
        console.log(`\n🚀 TASK: "${topic}"`);
        const topicDir = path.join(DOWNLOAD_DIR, topic.replace(/[^a-z0-9]/gi, '_'));
        if (!fs.existsSync(topicDir)) fs.mkdirSync(topicDir, { recursive: true });
        
        await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: topicDir });

        let candidates = [];
        const q = encodeURIComponent(`${topic} filetype:pdf`);

        // --- SEARCH PHASE ---
        for (const engine of ENGINES) {
            console.log(`   📡 Engine: ${engine.name}`);
            try {
                await page.goto(engine.url(q), { waitUntil: 'domcontentloaded', timeout: 15000 });
                const links = await page.evaluate((sel) => {
                    return Array.from(document.querySelectorAll('a'))
                        .map(a => a.href)
                        .filter(href => href && (href.toLowerCase().includes('.pdf')));
                }, engine.selector);

                if (links.length > 0) {
                    console.log(`      ✅ Found ${links.length} links.`);
                    candidates = links;
                    break; 
                }
            } catch (e) { console.log(`      ❌ Error: ${e.message}`); }
        }

        // --- DOWNLOAD PHASE ---
        let count = 0;
        const uniqueLinks = [...new Set(candidates)];

        for (const link of uniqueLinks) {
            if (count >= MAX_FILES) break;
            const filename = `doc_${count + 1}.pdf`;
            const savePath = path.join(topicDir, filename);

            try {
                console.log(`   ⬇️ Fetching: ${link.substring(0,40)}...`);
                
                // METHOD 1: High-Fidelity Axios (The Fix for 0KB)
                try {
                    await downloadAxios(link, savePath);
                    if (isValidFile(savePath)) {
                        console.log(`      ✅ Saved (High-Fi)`);
                        count++;
                        continue;
                    } else {
                        // Garbage Collection: Delete the 0KB failure
                        if (fs.existsSync(savePath)) fs.unlinkSync(savePath);
                    }
                } catch (e) {
                    if (fs.existsSync(savePath)) fs.unlinkSync(savePath);
                }

                // METHOD 2: Browser Backup (If Axios was blocked)
                try {
                    console.log(`      ⚠️ Retrying with Browser...`);
                    await page.goto(link, { timeout: 8000 });
                    // Wait 3s for Chrome to write the file
                    await new Promise(r => setTimeout(r, 3000));
                    
                    // Check if a new file appeared
                    const found = findNewFile(topicDir);
                    if (found) {
                        console.log(`      ✅ Saved (Browser): ${found}`);
                        count++;
                    }
                } catch (e) {}

            } catch (e) { }
        }
    }

    await browser.close();
    console.log("\n🏁 JOB DONE");
})();

// --- THE FIX: FAKE BROWSER HEADERS ---
async function downloadAxios(url, dest) {
    const writer = fs.createWriteStream(dest);
    const response = await axios({
        url, 
        method: 'GET', 
        responseType: 'stream',
        headers: { 
            // This block makes the server think we are a real human
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Referer': 'https://www.google.com/',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'cross-site'
        }, 
        timeout: 10000,
        maxRedirects: 5
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

// Validity Check: Is file > 5KB?
function isValidFile(path) {
    return fs.existsSync(path) && fs.statSync(path).size > 5000;
}

function findNewFile(dir) {
    try {
        const files = fs.readdirSync(dir);
        // Find files that are NOT temporary and > 5KB
        return files.find(f => !f.endsWith('.crdownload') && !f.endsWith('.png') && fs.statSync(path.join(dir, f)).size > 5000);
    } catch (e) { return null; }
}
