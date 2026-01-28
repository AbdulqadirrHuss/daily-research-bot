const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

// --- CONFIGURATION ---
const TASKS = (process.env.TASKS || "Renewable Energy").split(';').map(t => t.trim());
const MAX_FILES = parseInt(process.env.MAX_FILES) || 10;
const DOWNLOAD_DIR = path.resolve(__dirname, 'downloads');

// Ensure folder exists
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

(async () => {
    console.log("🤖 BUFFER-CAPTURE BOT ONLINE");
    console.log(`📂 Saving to: ${DOWNLOAD_DIR}`);
    
    // Test write again just to be safe
    fs.writeFileSync(path.join(DOWNLOAD_DIR, 'permission_check.txt'), 'OK');

    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-web-security' // Helps with CORS issues on downloads
        ]
    });

    const page = await browser.newPage();
    
    // Set a real User Agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    for (const topic of TASKS) {
        console.log(`\n🚀 HUNTING: "${topic}"`);
        const topicDir = path.join(DOWNLOAD_DIR, topic.replace(/[^a-z0-9]/gi, '_'));
        if (!fs.existsSync(topicDir)) fs.mkdirSync(topicDir, { recursive: true });

        try {
            // HTML DuckDuckGo
            const q = encodeURIComponent(`${topic} filetype:pdf`);
            const url = `https://html.duckduckgo.com/html/?q=${q}`;
            
            console.log(`   📡 Scanning...`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

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
                
                const filename = `doc_${count + 1}.pdf`;
                const savePath = path.join(topicDir, filename);

                try {
                    console.log(`   ⬇️ Grabbing: ${link.substring(0,40)}...`);
                    
                    // --- THE FIX: DIRECT MEMORY CAPTURE ---
                    // We open a new tab for the file so we don't lose our search results
                    const filePage = await browser.newPage();
                    
                    // Go to the file URL
                    const response = await filePage.goto(link, { 
                        waitUntil: 'networkidle2', 
                        timeout: 15000 
                    });

                    // Grab the raw data from Chrome's memory
                    const buffer = await response.buffer();
                    
                    // Write it to disk immediately
                    fs.writeFileSync(savePath, buffer);
                    
                    // Check if valid
                    if (fs.statSync(savePath).size > 3000) {
                        console.log(`      ✅ Captured (${Math.round(buffer.length/1024)} KB)`);
                        count++;
                    } else {
                        console.log(`      ⚠️ File too small (deleted)`);
                        fs.unlinkSync(savePath);
                    }
                    
                    await filePage.close();

                } catch (e) {
                    console.log(`      ❌ Failed: ${e.message}`);
                    // Close the tab if it crashed
                    const pages = await browser.pages();
                    if (pages.length > 2) await pages[pages.length - 1].close();
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

function printTree(dir) {
    try {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
             const fp = path.join(dir, file);
             if (fs.statSync(fp).isDirectory()) {
                 printTree(fp);
             } else {
                 console.log(`     - ${file} (${Math.round(fs.statSync(fp).size/1024)} KB)`);
             }
        });
    } catch(e) {}
}
