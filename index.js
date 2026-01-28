const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

// --- CONFIGURATION ---
const TASKS = (process.env.TASKS || "Renewable Energy").split(';').map(t => t.trim());
const MAX_FILES = parseInt(process.env.MAX_FILES) || 10;
// MUST use absolute path for CDP to work
const DOWNLOAD_DIR = path.resolve(__dirname, 'downloads');

// Ensure folder exists
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

(async () => {
    console.log("🤖 CDP-ENFORCED BOT ONLINE");
    console.log(`📂 Writing files to: ${DOWNLOAD_DIR}`);

    // TEST WRITE: Prove we can save files
    fs.writeFileSync(path.join(DOWNLOAD_DIR, 'test_permission.txt'), 'If you see this, write permissions are GOOD.');

    const browser = await puppeteer.launch({
        headless: true, // v23+ standard
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    });

    const page = await browser.newPage();
    
    // --- THE MAGIC FIX: FORCE DOWNLOAD PERMISSION ---
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: DOWNLOAD_DIR,
    });
    console.log("   ✅ Download Behavior SET to: 'allow'");

    for (const topic of TASKS) {
        console.log(`\n🚀 HUNTING: "${topic}"`);
        const topicDir = path.join(DOWNLOAD_DIR, topic.replace(/[^a-z0-9]/gi, '_'));
        if (!fs.existsSync(topicDir)) fs.mkdirSync(topicDir, { recursive: true });

        // Update download path for this specific topic
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: topicDir,
        });

        try {
            // HTML DuckDuckGo (Easiest to scrape)
            const q = encodeURIComponent(`${topic} filetype:pdf`);
            const url = `https://html.duckduckgo.com/html/?q=${q}`;
            
            console.log(`   📡 Connecting...`);
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

            // Gather Links
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
                    console.log(`   ⬇️ Triggering: ${link.substring(0,40)}...`);
                    
                    // Trigger download by navigating to the file URL
                    // We catch errors because Chrome might abort the "navigation" when the download starts
                    try {
                        await page.goto(link, { timeout: 10000, waitUntil: 'networkidle2' });
                    } catch (e) {
                        // This is expected! Chrome cancels "navigation" when it starts a download.
                    }
                    
                    // WAIT for file to appear
                    const gotFile = await waitForFile(topicDir, 10000); 
                    
                    if (gotFile) {
                        console.log(`      ✅ Saved: ${gotFile}`);
                        count++;
                    } else {
                        console.log(`      ⚠️ Timeout (No file appeared)`);
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
    
    // FINAL AUDIT
    console.log("\n📦 FINAL STORAGE CHECK:");
    printTree(DOWNLOAD_DIR);

})();

// Helper: Wait for a new file to appear in the folder
async function waitForFile(dir, timeout) {
    const start = Date.now();
    const initialFiles = fs.readdirSync(dir);
    
    while (Date.now() - start < timeout) {
        const currentFiles = fs.readdirSync(dir);
        // Find the new file
        const newFile = currentFiles.find(f => !initialFiles.includes(f) && !f.endsWith('.crdownload'));
        if (newFile) return newFile;
        await new Promise(r => setTimeout(r, 1000));
    }
    return null;
}

function printTree(dir) {
    try {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
             const fp = path.join(dir, file);
             if (fs.statSync(fp).isDirectory()) {
                 console.log(`   DIR: ${file}`);
                 printTree(fp);
             } else {
                 console.log(`     - ${file} (${Math.round(fs.statSync(fp).size/1024)} KB)`);
             }
        });
    } catch(e) {}
}
