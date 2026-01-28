const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');

// --- 1. SETUP & CONFIGURATION ---
// "process.env" grabs the text you type into the GitHub form
const RAW_TASKS = process.env.TASKS || "Default Topic";
const MAX_FILES = parseInt(process.env.MAX_FILES) || 10;
const BASE_DIR = path.join(__dirname, 'downloads');

if (!fs.existsSync(BASE_DIR)) fs.mkdirSync(BASE_DIR);

(async () => {
    // Split the input string "Topic A; Topic B" into a real list
    const tasks = RAW_TASKS.split(';').map(t => t.trim()).filter(t => t.length > 0);
    
    console.log(`\n🤖 BOT ONLINE. Targets: [ ${tasks.join(' | ')} ]`);
    console.log(`📂 Limit: ${MAX_FILES} files per topic`);

    const browser = await chromium.launch({ headless: true });
    // We pretend to be a real Windows PC to avoid basic blocking
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    // --- 2. MAIN LOOP (Per Topic) ---
    for (const topic of tasks) {
        console.log(`\n🚀 STARTING TASK: "${topic}"`);
        
        // Create a specific folder for this topic (e.g. downloads/Chinese_EV)
        const safeFolderName = topic.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
        const taskDir = path.join(BASE_DIR, safeFolderName);
        if (!fs.existsSync(taskDir)) fs.mkdirSync(taskDir);

        const page = await context.newPage();

        try {
            // Search DuckDuckGo specifically for PDFs
            // We append "filetype:pdf" automatically
            const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(topic + " filetype:pdf")}&t=h_&ia=web`;
            await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
            
            let pdfLinks = new Set();
            let attempts = 0;

            // Scroll and gather links until we have enough candidates
            while (pdfLinks.size < MAX_FILES * 2 && attempts < 4) {
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await page.waitForTimeout(1500);

                const found = await page.evaluate(() => 
                    Array.from(document.querySelectorAll('a'))
                        .map(a => a.href)
                        .filter(href => href.toLowerCase().endsWith('.pdf') || href.includes('libgen'))
                );
                
                found.forEach(l => pdfLinks.add(l));
                
                // Try to click "More Results"
                const moreBtn = await page.$('text="More Results"');
                if (moreBtn) await moreBtn.click();
                else break;
                
                attempts++;
            }

            console.log(`   🔗 Found ${pdfLinks.size} potential links.`);

            // --- 3. DOWNLOADER ---
            let downloaded = 0;
            for (const link of pdfLinks) {
                if (downloaded >= MAX_FILES) break;

                const filename = `doc_${downloaded + 1}.pdf`;
                const savePath = path.join(taskDir, filename);

                try {
                    // Standard Download
                    await new Promise((resolve, reject) => {
                        const file = fs.createWriteStream(savePath);
                        https.get(link, (response) => {
                            if (response.statusCode === 200) {
                                response.pipe(file);
                                file.on('finish', () => {
                                    file.close();
                                    console.log(`   [${downloaded+1}] 💾 Saved: ${link.substring(0,40)}...`);
                                    downloaded++;
                                    resolve();
                                });
                            } else {
                                fs.unlink(savePath, () => {}); // Delete empty file
                                resolve(); // Skip, don't crash
                            }
                        }).on('error', (e) => {
                            fs.unlink(savePath, () => {});
                            resolve();
                        });
                    });
                } catch (e) {
                    // Ignore errors and keep going
                }
            }

        } catch (err) {
            console.log(`   ❌ Error on topic ${topic}: ${err.message}`);
        } finally {
            await page.close();
        }
    }

    await browser.close();
    console.log(`\n🏁 MISSION COMPLETE.`);
})();
