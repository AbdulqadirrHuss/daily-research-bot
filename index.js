const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const axios = require('axios'); // The secret weapon

puppeteer.use(StealthPlugin());

// --- CONFIGURATION ---
const TASKS = (process.env.TASKS || "Renewable Energy").split(';').map(t => t.trim());
const MAX_FILES = parseInt(process.env.MAX_FILES) || 10;
// CRITICAL: Use absolute path for GitHub Actions
const DOWNLOAD_DIR = path.resolve(__dirname, 'downloads');

// Ensure folder exists
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

(async () => {
    console.log("🤖 HYBRID BOT ONLINE (Puppeteer + Axios)");
    console.log(`📂 Saving to: ${DOWNLOAD_DIR}`);

    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-features=IsolateOrigins,site-per-process' // 2025 stability fix
        ]
    });

    const page = await browser.newPage();
    
    // Set a consistent User Agent (Update for 2026)
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

    for (const topic of TASKS) {
        console.log(`\n🚀 HUNTING: "${topic}"`);
        const topicDir = path.join(DOWNLOAD_DIR, topic.replace(/[^a-z0-9]/gi, '_'));
        if (!fs.existsSync(topicDir)) fs.mkdirSync(topicDir, { recursive: true });

        try {
            // STRATEGY: HTML-Only DuckDuckGo (Fastest, least blocks)
            const q = encodeURIComponent(`${topic} filetype:pdf`);
            const url = `https://html.duckduckgo.com/html/?q=${q}`;
            
            console.log(`   📡 Scanning...`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // 1. EXTRACT LINKS (Do not click them!)
            const pdfLinks = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('a'))
                    .map(a => a.href)
                    .filter(href => href.toLowerCase().endsWith('.pdf'));
            });

            console.log(`   🔗 Found ${pdfLinks.length} candidates.`);

            // 2. DOWNLOAD WITH AXIOS (Bypasses Headless Chrome issues)
            let count = 0;
            const uniqueLinks = [...new Set(pdfLinks)];

            for (const link of uniqueLinks) {
                if (count >= MAX_FILES) break;
                
                const filename = `doc_${count + 1}.pdf`;
                const savePath = path.join(topicDir, filename);
                
                try {
                    console.log(`   ⬇️ Downloading: ${filename}...`);
                    await downloadViaAxios(link, savePath);
                    console.log(`      ✅ Success`);
                    count++;
                } catch (e) {
                    console.log(`      ❌ Failed: ${e.message}`);
                }
                
                // Be polite to the server
                await new Promise(r => setTimeout(r, 1000));
            }

        } catch (err) {
            console.error(`   ❌ Task Error: ${err.message}`);
        }
    }

    await browser.close();
    
    // FINAL CHECK
    console.log("\n📦 FINAL CONTENTS:");
    const files = findFiles(DOWNLOAD_DIR);
    console.log(files);

})();

// --- THE 2026 DOWNLOADER ---
// Does not use the browser. Uses direct HTTP stream.
async function downloadViaAxios(url, dest) {
    const writer = fs.createWriteStream(dest);
    
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        headers: {
            // Fake the header so servers think we are a browser
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Referer': 'https://www.google.com/'
        },
        timeout: 15000
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

// Helper to list files
function findFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
            findFiles(filePath, fileList);
        } else {
            fileList.push(file);
        }
    });
    return fileList;
}
