const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs = require('fs');
const path = require('path');
const https = require('https');

// --- CONFIGURATION ---
const TASKS = (process.env.TASKS || "Renewable Energy").split(';').map(t => t.trim());
const MAX_FILES = parseInt(process.env.MAX_FILES) || 10;
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');

// Ensure the download folder exists immediately
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

(async () => {
    console.log("🤖 PUPPETEER STEALTH BOT ONLINE");
    
    // Launch Browser (Headless for GitHub)
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    for (const topic of TASKS) {
        console.log(`\n🚀 HUNTING: "${topic}"`);
        const topicDir = path.join(DOWNLOAD_DIR, topic.replace(/[^a-z0-9]/gi, '_'));
        if (!fs.existsSync(topicDir)) fs.mkdirSync(topicDir, { recursive: true });

        try {
            // STRATEGY: Use the HTML-only version of DDG. 
            // It is much harder for them to block this than the main JS site.
            const q = encodeURIComponent(`${topic} filetype:pdf`);
            const url = `https://html.duckduckgo.com/html/?q=${q}`;
            
            console.log(`   📡 Connecting...`);
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

            // "Vacuum" Strategy: Get ALL links ending in .pdf
            const pdfLinks = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('a'))
                    .map(a => a.href)
                    .filter(href => href.toLowerCase().endsWith('.pdf'));
            });

            console.log(`   🔗 Found ${pdfLinks.length} PDF links.`);

            // DEBUG: If zero links, take a picture so we see WHY
            if (pdfLinks.length === 0) {
                console.log("   ⚠️ Zero links. Taking Screenshot...");
                await page.screenshot({ path: path.join(DOWNLOAD_DIR, `debug_${topic.substring(0,10)}.png`) });
            }

            // DOWNLOAD LOOP
            let count = 0;
            const uniqueLinks = [...new Set(pdfLinks)]; // Remove duplicates

            for (const link of uniqueLinks) {
                if (count >= MAX_FILES) break;
                
                const dest = path.join(topicDir, `doc_${count + 1}.pdf`);
                try {
                    await downloadFile(link, dest);
                    
                    // Verify file size (skip empty 0kb files)
                    if (fs.existsSync(dest) && fs.statSync(dest).size > 3000) {
                        console.log(`   ✅ Saved: ${link.substring(0, 40)}...`);
                        count++;
                    } else {
                        if (fs.existsSync(dest)) fs.unlinkSync(dest);
                    }
                } catch (e) {
                    // Ignore errors
                }
            }

        } catch (err) {
            console.error(`   ❌ Error: ${err.message}`);
        }
    }

    await browser.close();
})();

// Simple Downloader
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const req = https.get(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0' }, // Pretend to be a browser
            timeout: 10000 
        }, res => {
            if (res.statusCode === 200) {
                res.pipe(file);
                file.on('finish', () => file.close(resolve));
            } else {
                file.close(); fs.unlink(dest, () => {}); resolve(); 
            }
        });
        req.on('error', () => { file.close(); fs.unlink(dest, () => {}); resolve(); });
    });
}
