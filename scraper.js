// Use the 'extra' version of chromium to enable plugins
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const fs = require('fs');
const path = require('path');
const https = require('https');

const RAW_TASKS = process.env.TASKS || "Renewable Energy";
const TARGET_PER_TOPIC = parseInt(process.env.MAX_FILES) || 10;
const BASE_DIR = path.join(__dirname, 'downloads');

if (!fs.existsSync(BASE_DIR)) fs.mkdirSync(BASE_DIR, { recursive: true });

(async () => {
    const tasks = RAW_TASKS.split(';').map(t => t.trim()).filter(t => t.length > 0);
    console.log(`\n🤖 STEALTH BOT ONLINE. Targets: [ ${tasks.join(' | ')} ]`);

    const browser = await chromium.launch({ 
        headless: true, // Stealth plugin handles the masking
    });

    for (const topic of tasks) {
        console.log(`\n🚀 TASK: "${topic}"`);
        const safeName = topic.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
        const taskDir = path.join(BASE_DIR, safeName);
        if (!fs.existsSync(taskDir)) fs.mkdirSync(taskDir, { recursive: true });

        const page = await browser.newPage();
        
        // 1. USE BING (Better for files, less aggressive CAPTCHA than Google)
        // We append 'filetype:pdf' to force file results
        const q = encodeURIComponent(`${topic} filetype:pdf`);
        const url = `https://www.bing.com/search?q=${q}`;
        
        try {
            console.log(`   🔎 Searching Bing...`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(2000); // Wait for human-like pause

            // 2. THE VACUUM (Grab ALL links, ignore layout)
            // We do not look for "search results". We look for ANY link ending in .pdf
            let pdfLinks = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('a'))
                    .map(a => a.href)
                    .filter(href => href.toLowerCase().endsWith('.pdf') || href.toLowerCase().includes('.pdf?'));
            });

            console.log(`   🔗 Found ${pdfLinks.length} raw PDF links on page 1.`);

            // 3. DOWNLOAD
            let count = 0;
            // Remove duplicates
            pdfLinks = [...new Set(pdfLinks)];

            for (const link of pdfLinks) {
                if (count >= TARGET_PER_TOPIC) break;
                if (!link.startsWith('http')) continue;

                const filename = `doc_${count + 1}.pdf`;
                const savePath = path.join(taskDir, filename);
                
                try {
                    console.log(`   ⬇️ Downloading: ${link.substring(0, 40)}...`);
                    await downloadFile(link, savePath);
                    
                    // Verify size (ignore empty files)
                    const stats = fs.statSync(savePath);
                    if (stats.size > 2000) {
                        console.log(`      ✅ Saved (${Math.round(stats.size/1024)}KB)`);
                        count++;
                    } else {
                        fs.unlinkSync(savePath); // Delete empty junk
                        console.log(`      ⚠️ Too small (Junk/Redirect)`);
                    }
                } catch (e) {
                    // console.log("Failed: " + e.message);
                }
            }
            
            if (count === 0) {
                console.log("   ⚠️ No valid PDFs downloaded. The search engine might have given only redirects.");
                // Take a screenshot to debug ONLY if it fails
                await page.screenshot({ path: path.join(BASE_DIR, `debug_fail_${safeName}.png`) });
            }

        } catch (err) {
            console.error(`   ❌ Error: ${err.message}`);
        } finally {
            await page.close();
        }
    }

    await browser.close();
    
    // Final Audit
    console.log("\n📂 FILE AUDIT:");
    try {
        const files = fs.readdirSync(BASE_DIR, { recursive: true });
        console.log(files);
    } catch (e) { console.log("   No files found."); }
})();

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const req = https.get(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 10000 
        }, (res) => {
            if (res.statusCode === 200) {
                res.pipe(file);
                file.on('finish', () => file.close(resolve));
            } else {
                fs.unlink(dest, () => {});
                reject(new Error(res.statusCode));
            }
        });
        req.on('error', (e) => {
            fs.unlink(dest, () => {});
            reject(e);
        });
        req.end();
    });
}
