const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');

// --- 1. CONFIGURATION ---
const RAW_TASKS = process.env.TASKS || "Renewable Energy";
const TARGET_PER_TOPIC = parseInt(process.env.MAX_FILES) || 10;
const BASE_DIR = path.join(__dirname, 'downloads');

// Create the download folder immediately
if (!fs.existsSync(BASE_DIR)) fs.mkdirSync(BASE_DIR, { recursive: true });

(async () => {
    const tasks = RAW_TASKS.split(';').map(t => t.trim()).filter(t => t.length > 0);
    console.log(`\n🤖 BULLDOZER BOT ONLINE`);
    console.log(`🎯 Targets: [ ${tasks.join(' | ')} ]`);
    console.log(`🔒 Enforcement: Must download ${TARGET_PER_TOPIC} files per topic.`);

    const browser = await chromium.launch({ headless: true });
    
    // Pretend to be a real PC (User Agent is Critical)
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    for (const topic of tasks) {
        console.log(`\n\n🚀 STARTING TASK: "${topic}"`);
        const safeName = topic.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
        const taskDir = path.join(BASE_DIR, safeName);
        if (!fs.existsSync(taskDir)) fs.mkdirSync(taskDir, { recursive: true });

        const page = await context.newPage();
        let downloadedCount = 0;
        let pageNum = 1;
        let consecutiveFailures = 0;

        // --- ENFORCEMENT LOOP ---
        // Keep running until we hit the target OR fail 5 pages in a row
        while (downloadedCount < TARGET_PER_TOPIC && consecutiveFailures < 5) {
            
            // 1. Search Bing (It provides cleaner links than DDG)
            // We verify the query includes "filetype:pdf"
            const q = encodeURIComponent(`${topic} filetype:pdf`);
            const url = `https://www.bing.com/search?q=${q}&first=${(pageNum - 1) * 10 + 1}`;
            
            console.log(`   🔎 Checking Page ${pageNum}...`);
            
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
                
                // 2. Extract Links (Broad Selection)
                // We grab ALL links in search results, not just .pdf ones, 
                // because some valid PDF links don't end in .pdf (like dynamic gen)
                const candidates = await page.evaluate(() => {
                    const results = Array.from(document.querySelectorAll('li.b_algo h2 a'));
                    return results.map(a => a.href);
                });

                if (candidates.length === 0) {
                    console.log("   ⚠️ No results found on this page.");
                    consecutiveFailures++;
                    pageNum++;
                    continue;
                }

                // 3. Filter & Download
                let filesFoundOnPage = 0;
                
                for (const link of candidates) {
                    if (downloadedCount >= TARGET_PER_TOPIC) break;

                    // Skip junk links
                    if (!link.startsWith('http')) continue;

                    // Try to download
                    const filename = `doc_${downloadedCount + 1}.pdf`;
                    const savePath = path.join(taskDir, filename);
                    
                    try {
                        // We do a HEAD request first to check if it's actually a PDF
                        const isPdf = await verifyAndDownload(link, savePath);
                        if (isPdf) {
                            console.log(`   [${downloadedCount + 1}/${TARGET_PER_TOPIC}] ✅ Verified & Saved: ${link.substring(0, 35)}...`);
                            downloadedCount++;
                            filesFoundOnPage++;
                        }
                    } catch (e) {
                        // Silent fail for individual bad links
                    }
                }

                if (filesFoundOnPage === 0) {
                    consecutiveFailures++;
                    console.log("   ⚠️ Found links, but none were valid PDFs.");
                } else {
                    consecutiveFailures = 0; // Reset failure count if we got at least one
                }

                pageNum++;
                await page.waitForTimeout(2000); // Be polite

            } catch (err) {
                console.log(`   ❌ Page Error: ${err.message}`);
                consecutiveFailures++;
            }
        }

        if (downloadedCount < TARGET_PER_TOPIC) {
            console.log(`   ⚠️ WARNING: Could not find enough files. Stopped at ${downloadedCount}.`);
        } else {
            console.log(`   🎉 SUCCESS: Target met for "${topic}"`);
        }
        
        await page.close();
    }

    await browser.close();
    
    // --- VERIFICATION: List files to logs ---
    console.log("\n📂 FINAL INVENTORY:");
    const files = fs.readdirSync(BASE_DIR, { recursive: true });
    console.log(files);
})();

// --- HELPER: The "Enforcer" Downloader ---
// This checks the Content-Type header before saving
function verifyAndDownload(url, dest) {
    return new Promise((resolve) => {
        const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 }, (res) => {
            // ENFORCEMENT: Check if the internet says this is a PDF
            const isPdf = (res.headers['content-type'] || '').includes('pdf') || url.toLowerCase().endsWith('.pdf');
            
            if (res.statusCode === 200 && isPdf) {
                const file = fs.createWriteStream(dest);
                res.pipe(file);
                file.on('finish', () => {
                    file.close();
                    // Double Check: Did we save > 0 bytes?
                    const stats = fs.statSync(dest);
                    if (stats.size > 1000) {
                        resolve(true);
                    } else {
                        fs.unlinkSync(dest); // Delete empty junk
                        resolve(false);
                    }
                });
            } else {
                res.resume(); // Drain
                resolve(false);
            }
        });

        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
    });
}
