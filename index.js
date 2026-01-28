const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

puppeteer.use(StealthPlugin());

// --- CONFIGURATION ---
const TASKS = (process.env.TASKS || "Renewable Energy").split(';').map(t => t.trim());
const MAX_FILES = parseInt(process.env.MAX_FILES) || 10;
const DOWNLOAD_DIR = path.resolve(__dirname, 'downloads');

// Ensure folder exists
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

// LOGGING SETUP
const LOG_FILE = path.join(DOWNLOAD_DIR, 'mission_report.txt');
function log(msg) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${msg}`;
    console.log(entry);
    fs.appendFileSync(LOG_FILE, entry + '\n');
}

(async () => {
    log("🤖 NUCLEAR BOT ONLINE (Puppeteer + cURL)");
    log(`📂 Saving to: ${DOWNLOAD_DIR}`);

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    for (const topic of TASKS) {
        log(`\n🚀 HUNTING: "${topic}"`);
        const topicDir = path.join(DOWNLOAD_DIR, topic.replace(/[^a-z0-9]/gi, '_'));
        if (!fs.existsSync(topicDir)) fs.mkdirSync(topicDir, { recursive: true });

        try {
            // HTML DuckDuckGo
            const q = encodeURIComponent(`${topic} filetype:pdf`);
            const url = `https://html.duckduckgo.com/html/?q=${q}`;
            
            log(`   📡 Scanning: ${url}`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // 1. EXTRACT LINKS
            const pdfLinks = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('a'))
                    .map(a => a.href)
                    .filter(href => href.toLowerCase().endsWith('.pdf'));
            });

            log(`   🔗 Found ${pdfLinks.length} candidates.`);

            // Save list of links for debugging
            fs.writeFileSync(path.join(topicDir, 'urls_found.txt'), pdfLinks.join('\n'));

            if (pdfLinks.length === 0) {
                log("   ⚠️ Zero links found. Taking screenshot...");
                await page.screenshot({ path: path.join(topicDir, 'debug_empty.png') });
            }

            // 2. NUCLEAR DOWNLOAD (cURL)
            let count = 0;
            const uniqueLinks = [...new Set(pdfLinks)];

            for (const link of uniqueLinks) {
                if (count >= MAX_FILES) break;
                
                const filename = `doc_${count + 1}.pdf`;
                const savePath = path.join(topicDir, filename);

                try {
                    log(`   ⬇️ cURLing: ${filename}...`);
                    
                    // The Command Line Magic
                    // -L follows redirects
                    // -A sets User Agent (Crucial!)
                    // --max-time 15 prevents hanging
                    const cmd = `curl -L -A "Mozilla/5.0" --max-time 20 -o "${savePath}" "${link}"`;
                    
                    execSync(cmd, { stdio: 'ignore' }); // Run it silently
                    
                    // Verify File
                    if (fs.existsSync(savePath) && fs.statSync(savePath).size > 3000) {
                        log(`      ✅ Captured (${Math.round(fs.statSync(savePath).size/1024)} KB)`);
                        count++;
                    } else {
                        log(`      ⚠️ Failed/Empty (Deleted)`);
                        if (fs.existsSync(savePath)) fs.unlinkSync(savePath);
                    }
                    
                    // Sleep 1s to be polite
                    await new Promise(r => setTimeout(r, 1000));

                } catch (e) {
                    log(`      ❌ Error: ${e.message}`);
                }
            }

        } catch (err) {
            log(`   ❌ Task Error: ${err.message}`);
        }
    }

    await browser.close();
    log("\n🏁 MISSION COMPLETE");
})();
