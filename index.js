const { chromium } = require('playwright');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const pdf = require('pdf-parse');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// --- CONFIGURATION ---
const QUERY = process.env.INPUT_QUERY || "Artificial Intelligence Safety";
const TARGET_DOCS = parseInt(process.env.INPUT_TARGET || "100");
const DOCS_PER_FILE = parseInt(process.env.INPUT_DOCS_PER_FILE || "40");
const MIN_WORDS = parseInt(process.env.INPUT_MIN_WORDS || "200");
const CONTENT_TYPE = process.env.INPUT_CONTENT_TYPE || "both"; // articles, websites, both

const OUTPUT_DIR = path.resolve(__dirname, 'research_text');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// --- UTILITY FUNCTIONS ---
function countWords(text) {
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

function formatOutput(type, title, url, content) {
    const cleanText = content.replace(/\s\s+/g, ' ').trim();
    return `TYPE: ${type}\nTITLE: ${title}\nURL: ${url}\nDATE: ${new Date().toISOString()}\nWORDS: ${countWords(cleanText)}\n\n${cleanText}`;
}

function saveVolume(volNum, content, query) {
    const filename = `Volume_${volNum}_(${query.replace(/[^a-z0-9]/gi, '_')}).txt`;
    const filePath = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(filePath, content);
    console.log(`\n    💾 Saved ${filename} (${Math.round(content.length / 1024)} KB)`);
}

// --- PDF PROCESSING ---
async function processPDF(url) {
    try {
        console.log(`      📄 Attempting PDF: ${url.substring(0, 60)}...`);

        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/pdf,*/*'
            },
            maxRedirects: 10,
            validateStatus: (status) => status >= 200 && status < 400
        });

        // Check if we actually got a PDF
        const contentType = response.headers['content-type'] || '';
        if (!contentType.includes('pdf') && response.data.length < 50000) {
            // Small file that's not a PDF - likely an error page
            console.log(`      ⚠️ Not a valid PDF (${contentType})`);
            return null;
        }

        // Check minimum size (real PDFs are usually larger than 50KB)
        if (response.data.length < 10000) {
            console.log(`      ⚠️ PDF too small (${response.data.length} bytes), likely corrupted`);
            return null;
        }

        const data = await pdf(response.data);
        const wordCount = countWords(data.text);

        if (wordCount >= MIN_WORDS) {
            console.log(`      ✅ PDF extracted: ${wordCount} words`);
            return formatOutput("PDF", data.info?.Title || "PDF Document", url, data.text);
        } else {
            console.log(`      ⚠️ PDF too short: ${wordCount} words (min: ${MIN_WORDS})`);
        }
    } catch (e) {
        console.log(`      ❌ PDF failed: ${e.message}`);
    }
    return null;
}

// --- WEBPAGE PROCESSING ---
async function processWebpage(url, page, contentType) {
    try {
        // Set up request interception to block unnecessary resources
        await page.route('**/*', (route) => {
            const resourceType = route.request().resourceType();
            if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                route.abort();
            } else {
                route.continue();
            }
        });

        const response = await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 20000
        });

        if (!response) {
            return null;
        }

        // Check if it's actually a PDF
        const responseContentType = response.headers()['content-type'] || '';
        if (responseContentType.includes('pdf')) {
            await page.unroute('**/*');
            return await processPDF(url);
        }

        const html = await page.content();
        const dom = new JSDOM(html, { url });

        let title, textContent;

        if (contentType === 'websites') {
            // Full website mode - get all text
            title = await page.title();
            textContent = dom.window.document.body?.textContent || '';
        } else {
            // Articles mode or Both mode - try Readability first
            const reader = new Readability(dom.window.document);
            const article = reader.parse();

            if (article && article.textContent) {
                title = article.title;
                textContent = article.textContent;
            } else if (contentType === 'both') {
                // Fallback to full content in 'both' mode
                title = await page.title();
                textContent = dom.window.document.body?.textContent || '';
            } else {
                return null;
            }
        }

        await page.unroute('**/*');

        const wordCount = countWords(textContent);
        if (wordCount >= MIN_WORDS) {
            console.log(`      ✅ Web extracted: ${wordCount} words`);
            return formatOutput("WEB", title || "Untitled", url, textContent);
        } else {
            console.log(`      ⚠️ Content too short: ${wordCount} words (min: ${MIN_WORDS})`);
        }
    } catch (e) {
        console.log(`      ❌ Web failed: ${e.message}`);
    }
    return null;
}

// --- LINK PROCESSING ---
async function processLink(link, browser, contentType) {
    // Check if it's a PDF link
    if (link.toLowerCase().endsWith('.pdf') || link.toLowerCase().includes('.pdf?')) {
        return await processPDF(link);
    }

    // Process as webpage
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        return await processWebpage(link, page, contentType);
    } finally {
        await context.close();
    }
}

// --- MAIN EXECUTION ---
(async () => {
    console.log(`\n🚜 TEXT MINER BOT ONLINE (Playwright Edition)`);
    console.log(`🎯 Goal: ${TARGET_DOCS} items about "${QUERY}"`);
    console.log(`📦 Compression: ${DOCS_PER_FILE} items per text file`);
    console.log(`📝 Min Words: ${MIN_WORDS}`);
    console.log(`📑 Content Type: ${CONTENT_TYPE}`);

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    // --- STEP 1: HARVEST LINKS ---
    const searchContext = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 }
    });
    const searchPage = await searchContext.newPage();

    let collectedLinks = new Set();
    let pageNum = 0;
    const maxPages = Math.ceil(TARGET_DOCS / 10) + 5;

    // Use DuckDuckGo (with JS) and Bing as fallback
    const searchEngines = [
        {
            name: 'DuckDuckGo',
            getUrl: (query, page) => `https://duckduckgo.com/?q=${encodeURIComponent(query)}&t=h_&ia=web`,
            waitSelector: 'article[data-testid="result"]',
            selectors: [
                'article[data-testid="result"] a[href^="http"]',
                '[data-testid="result-title-a"]',
                'a.result__a',
                '.nrn-react-div a[href^="http"]'
            ],
            filter: (href) => href && href.startsWith('http') && !href.includes('duckduckgo.com') && !href.includes('duck.co'),
            singlePage: true
        },
        {
            name: 'Bing',
            getUrl: (query, page) => `https://www.bing.com/search?q=${encodeURIComponent(query)}&first=${page * 10 + 1}`,
            waitSelector: '#b_results',
            selectors: [
                '#b_results h2 a',
                'li.b_algo h2 a',
                '.b_algo h2 a',
                'cite + a',
                '#b_results a[href^="http"]'
            ],
            filter: (href) => href && href.startsWith('http') && !href.includes('bing.com') && !href.includes('microsoft.com') && !href.includes('go.microsoft'),
            singlePage: false
        }
    ];

    for (const engine of searchEngines) {
        if (collectedLinks.size >= TARGET_DOCS) break;

        console.log(`\n🔍 Using ${engine.name} Search...`);
        pageNum = 0;

        while (collectedLinks.size < TARGET_DOCS && pageNum < Math.min(maxPages, 20)) {
            console.log(`   📡 Scanning Page ${pageNum + 1}... (Pool: ${collectedLinks.size})`);

            try {
                const searchUrl = engine.getUrl(QUERY, pageNum);
                console.log(`      URL: ${searchUrl}`);
                await searchPage.goto(searchUrl, { waitUntil: 'networkidle', timeout: 45000 });

                // Wait for search results to appear
                if (engine.waitSelector) {
                    try {
                        await searchPage.waitForSelector(engine.waitSelector, { timeout: 10000 });
                        console.log(`      ✅ Found results container`);
                    } catch (e) {
                        console.log(`      ⚠️ Results container not found, trying anyway...`);
                    }
                }
                await searchPage.waitForTimeout(2000);

                // Debug: Log page title
                const pageTitle = await searchPage.title();
                console.log(`      Page title: ${pageTitle}`);

                // Try multiple selectors
                let newLinks = [];
                for (const selector of engine.selectors) {
                    const links = await searchPage.evaluate((sel) => {
                        return Array.from(document.querySelectorAll(sel)).map(a => a.href);
                    }, selector);
                    if (links.length > 0) {
                        console.log(`      Selector "${selector}" found ${links.length} links`);
                    }
                    newLinks.push(...links);
                }

                // Filter and dedupe
                newLinks = [...new Set(newLinks)].filter(engine.filter);

                console.log(`      Total filtered: ${newLinks.length} new links`);

                if (newLinks.length === 0) {
                    console.log("      ⚠️ No results on this page, trying next...");
                    pageNum++;
                    if (pageNum >= 3 && collectedLinks.size === 0) {
                        console.log("      ⚠️ No results after 3 pages, switching search engine...");
                        break;
                    }
                    continue;
                }

                newLinks.forEach(l => collectedLinks.add(l));
                pageNum++;

                // If this is a single-page search engine, break after first successful page
                if (engine.singlePage) {
                    console.log(`      ✅ ${engine.name} single-page search complete`);
                    break;
                }

            } catch (e) {
                console.log(`      ❌ Search Error: ${e.message}`);
                if (pageNum === 0) break; // Switch engines if first page fails
                pageNum++;
            }
        }
    }

    await searchContext.close();
    console.log(`\n✅ Harvest Complete. Found ${collectedLinks.size} links.`);

    if (collectedLinks.size === 0) {
        console.log("❌ No links found. Exiting.");
        await browser.close();
        process.exit(1);
    }

    // --- STEP 2: PROCESS & COMPRESS ---
    const linksArray = Array.from(collectedLinks).slice(0, TARGET_DOCS);
    let processedCount = 0;
    let successCount = 0;
    let currentVolume = 1;
    let currentBuffer = "";

    const CONCURRENCY = 3; // Lower concurrency for stability

    for (let i = 0; i < linksArray.length; i += CONCURRENCY) {
        const chunk = linksArray.slice(i, i + CONCURRENCY);
        const promises = chunk.map(link => processLink(link, browser, CONTENT_TYPE));
        const results = await Promise.all(promises);

        for (const res of results) {
            processedCount++;
            if (res) {
                currentBuffer += res + "\n\n" + "=".repeat(60) + "\n\n";
                successCount++;
            }
        }

        process.stdout.write(`\r⚙️  Processed: ${processedCount}/${linksArray.length} (Success: ${successCount})`);

        // Check if we need to dump the buffer to a file
        if (successCount > 0 && successCount % DOCS_PER_FILE === 0 && currentBuffer.length > 0) {
            saveVolume(currentVolume, currentBuffer, QUERY);
            currentVolume++;
            currentBuffer = "";
        }
    }

    // Save any leftovers
    if (currentBuffer.length > 0) {
        saveVolume(currentVolume, currentBuffer, QUERY);
    }

    await browser.close();

    console.log(`\n\n🏁 JOB COMPLETE!`);
    console.log(`   📊 Total Processed: ${processedCount}`);
    console.log(`   ✅ Successfully Extracted: ${successCount}`);
    console.log(`   📁 Output saved to: ${OUTPUT_DIR}`);

})();
