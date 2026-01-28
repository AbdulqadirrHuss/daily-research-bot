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
const TARGET_COUNT = parseInt(process.env.MAX_FILES) || 10;
const MIN_SIZE_BYTES = 50 * 1024; // 50KB Minimum

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
    console.log("🤖 STRICT VALIDATOR BOT ONLINE");
    console.log(`📂 Target: ${DOWNLOAD_DIR}`);
    console.log(`🔒 Strict Mode: Files must be > 50KB and start with %PDF`);
    
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
                    console.log(`      ✅ Found ${links.length} potential links.`);
                    candidates = links;
                    break; 
                }
            } catch (e) { console.log(`      ❌ Error: ${e.message}`); }
        }

        // --- DOWNLOAD LOOP (Strict Enforcement) ---
        let validCount = 0;
        let attemptIndex = 0;
        const uniqueLinks = [...new Set(candidates)];

        console.log(`   🎯 Goal: ${TARGET_COUNT} valid files.`);

        // Keep trying until we hit the target or run out of links
        while (validCount < TARGET_COUNT && attemptIndex < uniqueLinks.length) {
            const link = uniqueLinks[attemptIndex];
            const filename = `doc_${validCount + 1}.pdf`;
            const savePath = path.join(topicDir, filename);

            try {
                process.stdout.write(`   [${validCount}/${TARGET_COUNT}] Trying link ${attemptIndex+1}... `);
                
                // METHOD 1: High-Fidelity Axios
                await downloadAxios(link, savePath);

                // STRICT VALIDATION
                if (isRealPDF(savePath)) {
                    console.log(`✅ Valid PDF (${getFileSizeKB(savePath)} KB)`);
                    validCount++;
                } else {
                    // It failed validation. Delete it.
                    // console.log(`❌ Invalid (Too small or HTML junk). Deleted.`);
                    if (fs.existsSync(savePath)) fs.unlinkSync(savePath);

                    // METHOD 2: Browser Backup (Last Resort)
                    try {
                        await page.goto(link, { timeout: 8000 });
                        await new Promise(r => setTimeout(r, 4000)); // Wait for chrome to write
                        
                        const browserFile = findNewFile(topicDir);
                        if (browserFile) {
                            const bPath = path.join(topicDir, browserFile);
                            if (isRealPDF(bPath)) {
                                // Rename it to standard format
                                fs.renameSync(bPath, savePath);
                                console.log(`✅ Valid (Browser Backup)`);
                                validCount++;
                            } else {
                                console.log(`❌ Browser fetched junk.`);
                                fs.unlinkSync(bPath);
                            }
                        } else {
                            console.log(`❌ Failed.`);
                        }
                    } catch (e) { console.log(`❌ Failed.`); }
                }
            } catch (e) { console.log(`❌ Error.`); }
            
            attemptIndex++;
        }
        
        if (validCount < TARGET_COUNT) {
            console.log(`   ⚠️ Warning: Ran out of links. Got ${validCount}/${TARGET_COUNT} valid files.`);
        }
    }

    await browser.close();
    console.log("\n🏁 JOB DONE");
})();

// --- HELPERS ---

async function downloadAxios(url, dest) {
    const writer = fs.createWriteStream(dest);
    try {
        const response = await axios({
            url, 
            method: 'GET', 
            responseType: 'stream',
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://www.google.com/',
                'Upgrade-Insecure-Requests': '1'
            }, 
            timeout: 10000,
            maxRedirects: 5
        });
        response.data.pipe(writer);
        return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    } catch (e) { writer.close(); fs.unlink(dest, ()=>{}); }
}

// THE JUDGE: Checks if file is > 50KB AND starts with %PDF
function isRealPDF(filepath) {
    if (!fs.existsSync(filepath)) return false;
    
    const size = fs.statSync(filepath).size;
    if (size < MIN_SIZE_BYTES) return false; // Too small (28KB files die here)

    // Check Magic Bytes
    const buffer = Buffer.alloc(4);
    const fd = fs.openSync(filepath, 'r');
    fs.readSync(fd, buffer, 0, 4, 0);
    fs.closeSync(fd);
    
    // Header must be %PDF
    if (buffer.toString() === '%PDF') return true;

    // Edge case: Some PDFs have junk before header, check first 1024 bytes
    const largeBuffer = fs.readFileSync(filepath, { start: 0, end: 1024 });
    return largeBuffer.includes('%PDF');
}

function getFileSizeKB(filepath) {
    return Math.round(fs.statSync(filepath).size / 1024);
}

function findNewFile(dir) {
    try {
        const files = fs.readdirSync(dir);
        // Find newest file that isn't temp
        return files.find(f => !f.endsWith('.crdownload') && !f.endsWith('.png') && fs.statSync(path.join(dir, f)).size > MIN_SIZE_BYTES);
    } catch (e) { return null; }
}
