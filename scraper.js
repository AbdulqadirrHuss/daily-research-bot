const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');

// --- CONFIGURATION ---
const RAW_TASKS = process.env.TASKS || "Renewable Energy";
const TARGET_PER_TOPIC = parseInt(process.env.MAX_FILES) || 10;
const BASE_DIR = path.join(__dirname, 'downloads');

// Create the download folder immediately
if (!fs.existsSync(BASE_DIR)) fs.mkdirSync(BASE_DIR, { recursive: true });

(async () => {
    const tasks = RAW_TASKS.split(';').map(t => t.trim()).filter(t => t.length > 0);
    console.log(`\n🤖 LITE-MODE BOT ONLINE`);
    console.log(`🌍 Environment: GitHub Cloud (Datacenter IP)`);
    
    // Launch standard headless browser
    const browser = await chromium.launch({ headless: true });
    
    // Use a very standard, "boring" Windows User Agent
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36'
    });

    for (const topic of tasks) {
        console.log(`\n🚀 TASK: "${topic}"`);
        const safeName = topic.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
        const taskDir = path.join(BASE_DIR, safeName);
        if (!fs.existsSync(taskDir)) fs.mkdirSync(taskDir, { recursive: true });

        const page = await context.newPage();

        try {
            // --- THE FIX: HTML-ONLY MODE ---
            // This URL has NO javascript bot checks. It just works.
            const q = encodeURIComponent(`${topic} filetype:pdf`);
            const url = `https://html.duckduckgo.com/html/?q=${q}`;
            
            console.log(`   📡 Connecting to Lite Interface...`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            
            // Wait for 2 seconds to be polite
            await page.waitForTimeout(2000);

            // "Vacuum" Strategy: Grab ALL links ending in .pdf
            const pdfLinks = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('a'))
                    .map(a => a.href)
                    .filter(href => href.toLowerCase().endsWith('.pdf'));
            });

            console.log(`   🔗 Found ${pdfLinks.length} PDF links.`);

            if (pdfLinks.length === 0) {
                console.log("   ⚠️ Zero links found. The query might be too specific.");
            }

            // --- DOWNLOADER ---
            let count = 0;
            const uniqueLinks = [...new Set(pdfLinks)]; // Remove duplicates

            for (const link of uniqueLinks) {
                if (count >= TARGET_PER_TOPIC) break;
                
                const filename = `doc_${count + 1}.pdf`;
                const savePath = path.join(taskDir, filename);
                
                try {
                    await downloadFile(link, savePath);
                    
                    // Verify the file isn't empty (redirects often fail to 0kb)
                    const stats = fs.statSync(savePath);
                    if (stats.size > 3000) { // Must be larger than 3KB
                        console.log(`   [${count+1}] ✅ Saved: ${link.substring(0, 40)}...`);
                        count++;
                    } else {
                        fs.unlinkSync(savePath); // Delete junk file
                    }
                } catch (e) {
                    // Ignore download errors, just keep moving
                }
            }

        } catch (err) {
            console.error(`   ❌ Error: ${err.message}`);
        } finally {
            await page.close();
        }
    }

    await browser.close();
    
    // Final Audit for logs
    console.log("\n📂 FILE AUDIT:");
    try {
        const folders = fs.readdirSync(BASE_DIR);
        for (const f of folders) {
             const count = fs.readdirSync(path.join(BASE_DIR, f)).length;
             console.log(`   - ${f}: ${count} files`);
        }
    } catch (e) {}
})();

// Helper: Simple Node.js Downloader
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const req = https.get(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 15000 
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
