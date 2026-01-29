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
const CONTENT_TYPE = process.env.INPUT_CONTENT_TYPE || "both"; // pdfs (only PDFs) or both (PDFs + web pages)

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

// --- WIKIPEDIA API SEARCH (Works from any IP) ---
async function searchWikipedia(query, maxLinks) {
    const links = [];
    console.log(`\n🔍 Searching Wikipedia API for: "${query}"...`);

    try {
        // Wikipedia API is public and doesn't block IPs
        const response = await axios.get('https://en.wikipedia.org/w/api.php', {
            params: {
                action: 'query',
                list: 'search',
                srsearch: query,
                srlimit: Math.min(maxLinks, 50),
                format: 'json',
                origin: '*'
            },
            headers: {
                'User-Agent': 'ResearchBot/1.0 (Educational; contact@example.com)'
            },
            timeout: 15000
        });

        const results = response.data?.query?.search || [];
        console.log(`   Found ${results.length} Wikipedia articles`);

        for (const result of results) {
            const title = result.title.replace(/ /g, '_');
            links.push(`https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`);
        }

        console.log(`   ✅ Extracted ${links.length} Wikipedia links`);
    } catch (e) {
        console.log(`   ❌ Wikipedia API failed: ${e.message}`);
    }

    return links;
}

// --- RSS/ATOM FEED SEARCH (News aggregators) ---
async function searchRSSFeeds(query, maxLinks) {
    const links = [];
    console.log(`\n🔍 Searching News RSS Feeds for: "${query}"...`);

    const rssFeeds = [
        // Google News RSS (works without auth)
        `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
        // Bing News RSS
        `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`,
    ];

    for (const feedUrl of rssFeeds) {
        if (links.length >= maxLinks) break;

        try {
            console.log(`   Trying: ${feedUrl.substring(0, 60)}...`);
            const response = await axios.get(feedUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; ResearchBot/1.0)',
                    'Accept': 'application/rss+xml, application/xml, text/xml'
                },
                timeout: 15000
            });

            // Parse RSS XML
            const dom = new JSDOM(response.data, { contentType: 'text/xml' });
            const items = dom.window.document.querySelectorAll('item link, entry link');

            let count = 0;
            for (const item of items) {
                const link = item.textContent || item.getAttribute('href');
                if (link && link.startsWith('http') && !links.includes(link) && links.length < maxLinks) {
                    links.push(link);
                    count++;
                }
            }
            console.log(`   Found ${count} links from feed`);

        } catch (e) {
            console.log(`   Feed failed: ${e.message}`);
        }
    }

    console.log(`   ✅ Total RSS links: ${links.length}`);
    return links;
}

// --- BROWSER-BASED SEARCH (Using Playwright for search engines) ---
async function searchWithBrowser(query, maxLinks, browser) {
    const links = [];
    console.log(`\n🔍 Browser-based search for: "${query}"...`);

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 }
    });
    const page = await context.newPage();

    // Try DuckDuckGo with browser
    try {
        console.log(`   Trying DuckDuckGo...`);
        await page.goto(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`, {
            waitUntil: 'networkidle',
            timeout: 30000
        });

        // Wait for results
        await page.waitForSelector('[data-testid="result"]', { timeout: 10000 }).catch(() => null);
        await page.waitForTimeout(2000);

        const ddgLinks = await page.evaluate(() => {
            const results = document.querySelectorAll('[data-testid="result"] a, .result__a');
            return Array.from(results)
                .map(a => a.href)
                .filter(h => h && h.startsWith('http') && !h.includes('duckduckgo.com'));
        });

        ddgLinks.slice(0, maxLinks).forEach(l => { if (!links.includes(l)) links.push(l); });
        console.log(`   DuckDuckGo found ${ddgLinks.length} results`);

    } catch (e) {
        console.log(`   DuckDuckGo failed: ${e.message}`);
    }

    // Try Bing with browser
    if (links.length < maxLinks) {
        try {
            console.log(`   Trying Bing...`);
            await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });

            await page.waitForSelector('#b_results', { timeout: 10000 }).catch(() => null);
            await page.waitForTimeout(2000);

            const bingLinks = await page.evaluate(() => {
                const results = document.querySelectorAll('#b_results h2 a, .b_algo h2 a');
                return Array.from(results)
                    .map(a => a.href)
                    .filter(h => h && h.startsWith('http') && !h.includes('bing.com'));
            });

            bingLinks.slice(0, maxLinks - links.length).forEach(l => { if (!links.includes(l)) links.push(l); });
            console.log(`   Bing found ${bingLinks.length} results`);

        } catch (e) {
            console.log(`   Bing failed: ${e.message}`);
        }
    }

    await context.close();
    console.log(`   ✅ Total browser search links: ${links.length}`);
    return links;
}

// --- PDF PROCESSING ---
async function processPDF(url) {
    try {
        console.log(`      📄 Attempting PDF: ${url.substring(0, 60)}...`);

        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/pdf,*/*'
            },
            maxRedirects: 10,
            validateStatus: (status) => status >= 200 && status < 400
        });

        const contentType = response.headers['content-type'] || '';
        if (!contentType.includes('pdf') && response.data.length < 50000) {
            console.log(`      ⚠️ Not a valid PDF (${contentType})`);
            return null;
        }

        if (response.data.length < 10000) {
            console.log(`      ⚠️ PDF too small (${response.data.length} bytes)`);
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

        if (!response) return null;

        const responseContentType = response.headers()['content-type'] || '';
        if (responseContentType.includes('pdf')) {
            await page.unroute('**/*');
            return await processPDF(url);
        }

        const html = await page.content();
        const dom = new JSDOM(html, { url });

        let title, textContent;

        if (contentType === 'websites') {
            title = await page.title();
            textContent = dom.window.document.body?.textContent || '';
        } else {
            const reader = new Readability(dom.window.document);
            const article = reader.parse();

            if (article && article.textContent) {
                title = article.title;
                textContent = article.textContent;
            } else if (contentType === 'both') {
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

async function processLink(link, browser, contentType) {
    const isPdfLink = link.toLowerCase().endsWith('.pdf') || link.toLowerCase().includes('.pdf?');

    // If PDFs only mode, skip non-PDF links
    if (contentType === 'pdfs' && !isPdfLink) {
        console.log(`      ⏭️ Skipping non-PDF: ${link.substring(0, 50)}...`);
        return null;
    }

    // Process PDF links directly
    if (isPdfLink) {
        return await processPDF(link);
    }

    // Process web pages (only if contentType is 'both')
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
    console.log(`\n🚜 TEXT MINER BOT ONLINE`);
    console.log(`🎯 Goal: ${TARGET_DOCS} items about "${QUERY}"`);
    console.log(`📦 Compression: ${DOCS_PER_FILE} items per text file`);
    console.log(`📝 Min Words: ${MIN_WORDS}`);
    console.log(`📑 Content Type: ${CONTENT_TYPE}${CONTENT_TYPE === 'pdfs' ? ' (PDFs only)' : ' (PDFs + web pages)'}`);

    // Launch browser early for search if needed
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    // --- STEP 1: HARVEST LINKS (Multiple strategies) ---
    let collectedLinks = [];

    // Modify query for PDF-only mode
    const searchQuery = CONTENT_TYPE === 'pdfs' ? `${QUERY} filetype:pdf` : QUERY;
    console.log(`\n🔎 Search Query: "${searchQuery}"`);

    // Strategy 1: Wikipedia API (skip for PDFs mode - Wikipedia doesn't have PDFs)
    if (CONTENT_TYPE !== 'pdfs') {
        const wikiLinks = await searchWikipedia(QUERY, Math.ceil(TARGET_DOCS / 2));
        collectedLinks.push(...wikiLinks);
    } else {
        console.log(`\n⏭️ Skipping Wikipedia (no PDFs)`);
    }

    // Strategy 2: RSS Feeds (works for both modes)
    if (collectedLinks.length < TARGET_DOCS) {
        const rssLinks = await searchRSSFeeds(searchQuery, TARGET_DOCS - collectedLinks.length);
        rssLinks.forEach(l => { if (!collectedLinks.includes(l)) collectedLinks.push(l); });
    }

    // Strategy 3: Browser-based search (uses filetype:pdf for pdfs mode)
    if (collectedLinks.length < TARGET_DOCS) {
        const browserLinks = await searchWithBrowser(searchQuery, TARGET_DOCS - collectedLinks.length, browser);
        browserLinks.forEach(l => { if (!collectedLinks.includes(l)) collectedLinks.push(l); });
    }

    console.log(`\n✅ Harvest Complete. Found ${collectedLinks.length} unique links.`);

    if (collectedLinks.length === 0) {
        console.log("❌ No links found. Exiting.");
        await browser.close();
        process.exit(1);
    }

    // --- STEP 2: PROCESS & COMPRESS ---
    const linksArray = collectedLinks.slice(0, TARGET_DOCS);
    let processedCount = 0;
    let successCount = 0;
    let currentVolume = 1;
    let currentBuffer = "";

    const CONCURRENCY = 3;

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

        if (successCount > 0 && successCount % DOCS_PER_FILE === 0 && currentBuffer.length > 0) {
            saveVolume(currentVolume, currentBuffer, QUERY);
            currentVolume++;
            currentBuffer = "";
        }
    }

    if (currentBuffer.length > 0) {
        saveVolume(currentVolume, currentBuffer, QUERY);
    }

    await browser.close();

    console.log(`\n\n🏁 JOB COMPLETE!`);
    console.log(`   📊 Total Processed: ${processedCount}`);
    console.log(`   ✅ Successfully Extracted: ${successCount}`);
    console.log(`   📁 Output saved to: ${OUTPUT_DIR}`);

})();
