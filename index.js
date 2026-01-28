const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

puppeteer.use(StealthPlugin());

// --- CONFIGURATION ---
const TASKS = (process.env.TASKS || "Renewable Energy").split(';').map(t => t.trim());
const MAX_FILES = parseInt(process.env.MAX_FILES) || 10;
const DOWNLOAD_DIR = path.resolve(__dirname, 'downloads');

// Ensure folder exists
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

(async () => {
    console.log("🤖 SESSION-HIJACK BOT ONLINE");
    
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    
    // 1. Establish a Human Identity
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    for (const topic of TASKS) {
        console.log(`\n🚀 HUNTING: "${topic}"`);
        const topicDir = path.join(DOWNLOAD_DIR, topic.replace(/[^a-z0-9]/gi, '_'));
        if (!fs.existsSync(topicDir)) fs.mkdirSync(topicDir, { recursive: true });

        try {
            // Use HTML DuckDuckGo (Least resistance)
            const q = encodeURIComponent(`${topic} filetype:pdf`);
            await page.goto(`https://html.duckduckgo.com/html/?q=${q}`, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // Gather Links
            const pdfLinks = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('a'))
                    .map(a => a.href)
                    .filter(href => href.toLowerCase().endsWith('.pdf'));
            });

            console.log(`   🔗 Found ${pdfLinks.length} candidates.`);

            // 2. THE HIJACK: Get the "Passport" (Cookies + UA)
            const cookies = await page.cookies();
            const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
            const userAgent = await page.evaluate(() => navigator.userAgent);

            // 3. DOWNLOAD WITH PASSPORT
            let count = 0;
            const uniqueLinks = [...new Set(pdfLinks)];

            for (const link of uniqueLinks) {
                if (count >= MAX_FILES) break;
                
                const filename = `doc_${count + 1}.pdf`;
                const savePath = path.join(topicDir, filename);
                
                try {
                    console.log(`   ⬇️ Downloading: ${filename}...`);
                    
                    // Pass the browser's credentials to Axios
                    await downloadWithCookies(link, savePath, cookieString, userAgent);
                    
                    // 4. VERIFY IT IS A REAL PDF
                    if (isValidPDF(savePath)) {
                        console.log(`      ✅ Verified PDF`);
                        count++;
                    } else {
                        console.log(`      ⚠️ Invalid File (Deleted)`);
                        fs.unlinkSync(savePath);
                    }
                } catch (e) {
                    console.log(`      ❌ Error: ${e.message}`);
                }
                
                await new Promise(r => setTimeout(r, 1000)); // Be polite
            }

        } catch (err) {
            console.error(`   ❌ Task Error: ${err.message}`);
        }
    }

    await browser.close();
    
    // DEBUG: Print file tree
    console.log("\n📦 STORAGE CHECK:");
    printTree(DOWNLOAD_DIR);

})();

async function downloadWithCookies(url, dest, cookieString, userAgent) {
    const writer = fs.createWriteStream(dest);
    
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        headers: {
            'User-Agent': userAgent,
            'Cookie': cookieString, // <--- THE KEY FIX
            'Referer': 'https://html.duckduckgo.com/'
        },
        timeout: 20000
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

// Check first 4 bytes for "%PDF" signature
function isValidPDF(filepath) {
    try {
        const buffer = Buffer.alloc(4);
        const fd = fs.openSync(filepath, 'r');
        fs.readSync(fd, buffer, 0, 4, 0);
        fs.closeSync(fd);
        return buffer.toString() === '%PDF';
    } catch (e) {
        return false;
    }
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
                 const size = Math.round(fs.statSync(fp).size / 1024);
                 console.log(`     - ${file} (${size} KB)`);
             }
        });
    } catch(e) {}
}
