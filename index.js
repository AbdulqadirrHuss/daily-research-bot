const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const pdf = require('pdf-parse');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// --- CONFIGURATION ---
puppeteer.use(StealthPlugin());

// Inputs (Defaults provided for testing)
const QUERY = process.env.INPUT_QUERY || "Artificial Intelligence Safety";
const TARGET_DOCS = parseInt(process.env.INPUT_TARGET || "100"); // Try for 100-400
const DOCS_PER_FILE = 40; // Compress 40 docs into 1 text file

const OUTPUT_DIR = path.resolve(__dirname, 'research_text');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

(async () => {
    console.log(`\n🚜 TEXT MINER BOT ONLINE`);
    console.log(`🎯 Goal: ${TARGET_DOCS} articles about "${QUERY}"`);
    console.log(`Bx Compression: ${DOCS_PER_FILE} articles per text file`);

    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    });

    // --- STEP 1: HARVEST LINKS (Deep Search) ---
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    let collectedLinks = new Set();
    let pageNum = 0;
    
    // Loop until we have enough links or hit a limit (20 pages)
    while (collectedLinks.size < TARGET_DOCS && pageNum < 20) {
        console.log(`   📡 Scanning Page ${pageNum + 1}... (Pool: ${collectedLinks.size})`);
        
        try {
            // Bing is easier to deep-paginate than DDG for raw volume
            const offset = pageNum * 10 + 1;
            const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(QUERY)}&first=${offset}`;
            
            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await new Promise(r => setTimeout(r, 2000)); // Be polite

            const newLinks = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('li.b_algo h2 a, .b_algo a'))
                    .map(a => a.href)
                    .filter(href => href.startsWith('http'));
            });

            if (newLinks.length === 0) {
                console.log("      ⚠️ No more results found.");
                break;
            }

            newLinks.forEach(l => collectedLinks.add(l));
            pageNum++;

        } catch (e) {
            console.log(`      ❌ Search Error: ${e.message}`);
            break;
        }
    }
    
    await page.close();
    console.log(`\n✅ Harvest Complete. Found ${collectedLinks.size} links.`);
    
    // --- STEP 2: PROCESS & COMPRESS ---
    const linksArray = Array.from(collectedLinks);
    let processedCount = 0;
    let currentVolume = 1;
    let currentBuffer = ""; // Holds text before writing to file

    // Limit concurrency to 5 tabs to save memory
    const CONCURRENCY = 5;
    
    for (let i = 0; i < linksArray.length; i += CONCURRENCY) {
        const chunk = linksArray.slice(i, i + CONCURRENCY);
        const promises = chunk.map(link => processLink(link, browser));
        const results = awaitZhPromise.all(promises);

        // Append valid results to buffer
        for (const res of results) {
            if (res) {
                currentBuffer += res + "\n\n" + "=".repeat(50) + "\n\n";
                processedCount++;
            }
        }

        process.stdout.write(`\r⚙️  Processed: ${processedCount}/${linksArray.length}`);

        // Check if we need to dump the buffer to a file
        if (processedCount > 0 && processedCount % DOCS_PER_FILE === 0) {
            saveVolume(currentVolume, currentBuffer);
            currentVolume++;
            currentBuffer = ""; // Reset buffer
        }
    }

    // Save any leftovers
    if (currentBuffer.length > 0) {
        saveVolume(currentVolume, currentBuffer);
    }

    await browser.close();
    console.log(`\n\n🏁 JOB DONE. Output saved to /research_text/`);

})();

// --- HELPER: Save Text File ---
function saveVolume(volNum, content) {
    const filename = `Volume_${volNum}_(${QUERY.replace(/[^a-z0-9]/gi, '_')}).txt`;
    const filePath = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(filePath, content);
    console.log(`\n    mw 💾 Saved ${filename} (${Math.round(content.length/1024)} KB)`);
}

// --- HELPER: Process Single Link ---
async function processLink(link, browser) {
    let page = null;
    try {
        // A. Is it a PDF?
        if (link.toLowerCase().endsWith('.pdf')) {
            return await processPDF(link);
        }

        // B. Is it a Webpage?
        page = await browser.newPage();
        await page.setRequestInterception(true);
        page.on('request', req => {
            if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) req.abort();
            else req.continue();
        });

        await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 15000 });
        
        // Check content type just in case it's a hidden PDF
        const contentType = await page.evaluate(() => document.contentType);
        if (contentType === 'application/pdf') {
            await page.close();
            return await processPDF(link);
        }

        // Extract Text (Readability)
        const html = await page.content();
        const dom = new JSDOM(html, { url: link });
        const reader = new Readability(dom.window.document);
        const article = reader.parse();

        if (article && article.textContent.length > 200) {
            return formatOutput("WEB", article.title, link, article.textContent);
        }

    } catch (e) {
        // Ignore errors
    } finally {
        if (page) await page.close();
    }
    return null;
}

// --- HELPER: Download & Parse PDF (RAM only) ---
async function processPDF(url) {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0' },
            maxRedirects: 5
        });
        
        const data = await pdf(response.data);
        if (data.text.length > 200) {
            return formatOutput("PDF", `PDF Document`, url, data.text);
        }
    } catch (e) {
        return null;
    }
    return null;
}

function formatOutput(type, title, url, content) {
    const cleanText = content.replace(/\s\s+/g, ' ').trim();
    return `TYPE: ${type}\nTITLE: ${title}\nURL: ${url}\nDATE: ${new Date().toISOString()}\n\n${cleanText}`;
}

// Hack for Promise.all typo above
const awaitZhPromise = Promise;
