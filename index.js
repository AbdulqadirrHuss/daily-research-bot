const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const UserPreferencesPlugin = require('puppeteer-extra-plugin-user-preferences');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// 1. SETUP PLUGINS
puppeteer.use(StealthPlugin());

// --- YOUR REQUESTED FIX #2: DISABLE PDF VIEWER ---
// This forces Chrome to treat PDFs as files, not web pages.
puppeteer.use(UserPreferencesPlugin({
    userPrefs: {
        download: {
            prompt_for_download: false,
            open_pdf_in_system_reader: false,
            default_directory: path.resolve(__dirname, 'downloads'),
        },
        plugins: {
            always_open_pdf_externally: true // <--- THE KEY FIX
        }
    }
}));

// --- CONFIGURATION ---
const TASKS = (process.env.TASKS || "Renewable Energy").split(';').map(t => t.trim());
const MAX_FILES = parseInt(process.env.MAX_FILES) || 10;
// --- YOUR REQUESTED FIX #1: ABSOLUTE PATH ---
const DOWNLOAD_DIR = path.resolve(__dirname, 'downloads'); 

if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

(async () => {
    console.log("🤖 BROWSER-NATIVE BOT ONLINE");
    console.log(`📂 Absolute Path: ${DOWNLOAD_DIR}`);
    
    const browser = await puppeteer.launch({
        headless: "new", 
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    });

    const page = await browser.newPage();

    // --- YOUR REQUESTED FIX #1: CDP SESSION ---
    // This tells the browser engine EXACTLY where to put files
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: DOWNLOAD_DIR, // Must be absolute
    });
    console.log("   ✅ CDP Download Behavior Configured");

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    for (const topic of TASKS) {
        console.log(`\n🚀 HUNTING: "${topic}"`);
        // Update CDP path for this specific topic folder
        const topicDir = path.join(DOWNLOAD_DIR, topic.replace(/[^a-z0-9]/gi, '_'));
        if (!fs.existsSync(topicDir)) fs.mkdirSync(topicDir, { recursive: true });
        
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: topicDir,
        });

        try {
            // HTML DuckDuckGo
            const q = encodeURIComponent(`${topic} filetype:pdf`);
            const url = `https://html.duckduckgo.com/html/?q=${q}`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // Extract Links
            const pdfLinks = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('a'))
                    .map(a => a.href)
                    .filter(href => href.toLowerCase().endsWith('.pdf'));
            });

            console.log(`   🔗 Found ${pdfLinks.length} candidates.`);
            
            let count = 0;
            const uniqueLinks = [...new Set(pdfLinks)];

            for (const link of uniqueLinks) {
                if (count >= MAX_FILES) break;
                
                try {
                    console.log(`   ⬇️ Processing: ${link.substring(0,40)}...`);
                    
                    // METHOD A: BROWSER DOWNLOAD (Using your fixes)
                    // We trigger a "navigation" to the file. 
                    // Because 'always_open_pdf_externally' is TRUE, this should force a download.
                    try {
                        await page.goto(link, { timeout: 5000, waitUntil: 'networkidle2' });
                    } catch (e) {
                        // Chrome cancels navigation when download starts. This is GOOD.
                    }

                    // Wait for file to appear
                    const savedFile = await waitForFile(topicDir, 5000);
                    
                    if (savedFile) {
                        console.log(`      ✅ Saved (Browser): ${savedFile}`);
                        count++;
                    } else {
                        // METHOD B: FALLBACK (Axios)
                        // If Browser fails (some sites block headless downloads), use Axios
                        console.log(`      ⚠️ Browser download skipped. Retrying with Axios...`);
                        const filename = `fallback_${count}.pdf`;
                        await downloadAxios(link, path.join(topicDir, filename));
                        console.log(`      ✅ Saved (Axios)`);
                        count++;
                    }
                } catch (e) {
                    console.log(`      ❌ Error: ${e.message}`);
                }
            }

        } catch (err) {
            console.error(`   ❌ Task Error: ${err.message}`);
        }
    }

    await browser.close();
    
    // Final Audit
    console.log("\n📦 FINAL INVENTORY:");
    printTree(DOWNLOAD_DIR);
})();

// Helper: Wait for file
async function waitForFile(dir, timeout) {
    const start = Date.now();
    const initialFiles = fs.readdirSync(dir);
    while (Date.now() - start < timeout) {
        const currentFiles = fs.readdirSync(dir);
        const newFile = currentFiles.find(f => !initialFiles.includes(f) && !f.endsWith('.crdownload'));
        if (newFile) return newFile;
        await new Promise(r => setTimeout(r, 500));
    }
    return null;
}

// Helper: Axios Fallback
async function downloadAxios(url, dest) {
    const writer = fs.createWriteStream(dest);
    const response = await axios({
        url, method: 'GET', responseType: 'stream',
        headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000
    });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

function printTree(dir) {
    try {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
             const fp = path.join(dir, file);
             if (fs.statSync(fp).isDirectory()) printTree(fp);
             else console.log(`     - ${file} (${Math.round(fs.statSync(fp).size/1024)} KB)`);
        });
    } catch(e) {}
}
