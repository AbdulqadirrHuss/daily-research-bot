const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');

const RAW_TASKS = process.env.TASKS || "Default";
const MAX_FILES = parseInt(process.env.MAX_FILES) || 10;
const BASE_DIR = path.join(__dirname, 'downloads');

// Force creation of the folder immediately
if (!fs.existsSync(BASE_DIR)) fs.mkdirSync(BASE_DIR, { recursive: true });

(async () => {
    const tasks = RAW_TASKS.split(';').map(t => t.trim()).filter(t => t.length > 0);
    console.log(`\n🤖 BOT ONLINE. Targets: [ ${tasks.join(' | ')} ]`);

    const browser = await chromium.launch({ 
        headless: true,
        args: [
            '--disable-blink-features=AutomationControlled', // Hides "Robot" flag
            '--no-sandbox', 
            '--disable-setuid-sandbox'
        ]
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
        locale: 'en-US',
        timezoneId: 'America/New_York'
    });

    for (const topic of tasks) {
        console.log(`\n🚀 STARTING TASK: "${topic}"`);
        const safeName = topic.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
        const taskDir = path.join(BASE_DIR, safeName);
        if (!fs.existsSync(taskDir)) fs.mkdirSync(taskDir, { recursive: true });

        const page = await context.newPage();

        try {
            // Add 'filetype:pdf' to ensuring we get files
            const q = encodeURIComponent(`${topic} filetype:pdf`);
            await page.goto(`https://duckduckgo.com/?q=${q}&t=h_&ia=web`, { waitUntil: 'networkidle' });
            
            // Wait specifically for results to load
            try {
                await page.waitForSelector('a[href$=".pdf"], a[href*="libgen"]', { timeout: 10000 });
            } catch (e) {
                console.log("   ⚠️ No PDF links found immediately. Taking debug screenshot...");
                await page.screenshot({ path: path.join(BASE_DIR, `debug_${safeName}.png`) });
            }

            // Harvest Links
            let pdfLinks = new Set();
            for (let i = 0; i < 5; i++) { // Scroll 5 times
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await page.waitForTimeout(2000);
                
                const found = await page.evaluate(() => 
                    Array.from(document.querySelectorAll('a'))
                        .map(a => a.href)
                        .filter(href => href.toLowerCase().endsWith('.pdf'))
                );
                found.forEach(l => pdfLinks.add(l));
                
                // Click "More Results" if it exists
                const moreBtn = await page.$('#more-results');
                if (moreBtn) await moreBtn.click();
            }

            console.log(`   🔗 Found ${pdfLinks.size} potential PDFs.`);

            // Download
            let count = 0;
            for (const link of pdfLinks) {
                if (count >= MAX_FILES) break;
                
                // Simple fetch download
                const dest = path.join(taskDir, `doc_${count + 1}.pdf`);
                try {
                    await downloadFile(link, dest);
                    console.log(`   [${count+1}] Saved: ${link.substring(0,30)}...`);
                    count++;
                } catch (err) {
                    // Skip failed
                }
            }

        } catch (err) {
            console.error(`   ❌ Critical Error on ${topic}:`, err);
        } finally {
            await page.close();
        }
    }

    await browser.close();
    
    // DEBUG: List all files at the end to prove they exist
    console.log("\n📂 FINAL FILE CHECK:");
    const finalFiles = getAllFiles(BASE_DIR);
    console.log(finalFiles.join('\n'));
})();

// Helper: Download
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            if (res.statusCode === 200) {
                res.pipe(file);
                file.on('finish', () => file.close(resolve));
            } else {
                fs.unlink(dest, () => {});
                reject();
            }
        }).on('error', () => {
            fs.unlink(dest, () => {});
            reject();
        });
    });
}

// Helper: List files for debug
function getAllFiles(dirPath, arrayOfFiles) {
    files = fs.readdirSync(dirPath);
    arrayOfFiles = arrayOfFiles || [];
    files.forEach(function(file) {
        if (fs.statSync(dirPath + "/" + file).isDirectory()) {
            arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
        } else {
            arrayOfFiles.push(path.join(dirPath, "/", file));
        }
    });
    return arrayOfFiles;
}
