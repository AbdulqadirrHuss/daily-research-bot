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

// --- HTTP-BASED SEARCH (No browser needed) ---
async function searchDDGHtml(query, maxLinks) {
    const links = [];
    console.log(`\n🔍 Searching DuckDuckGo Lite for: "${query}"...`);

    try {
        // DuckDuckGo HTML light version - works without JavaScript
        const response = await axios.get('https://lite.duckduckgo.com/lite/', {
            params: { q: query },
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'en-US,en;q=0.9'
            },
            timeout: 30000
        });

        console.log(`   HTTP Status: ${response.status}`);
        console.log(`   Response size: ${response.data.length} bytes`);
        console.log(`   Has result-link: ${response.data.includes('result-link')}`);

        const dom = new JSDOM(response.data);
        const document = dom.window.document;

        // DDG Lite returns redirect links - extract actual URL from uddg parameter
        const resultLinks = document.querySelectorAll('a.result-link');
        console.log(`   Found ${resultLinks.length} result-link elements`);

        if (resultLinks.length === 0) {
            // Try alternative selectors
            const allLinks = document.querySelectorAll('a');
            console.log(`   All <a> tags: ${allLinks.length}`);

            // Log first few link classes for debugging
            for (let i = 0; i < Math.min(5, allLinks.length); i++) {
                console.log(`   Link ${i}: class="${allLinks[i].className}" href="${(allLinks[i].href || '').substring(0, 30)}"`);
            }
        }

        // Convert NodeList to Array for safer iteration
        const linksArray = Array.from(resultLinks);

        for (let i = 0; i < linksArray.length && links.length < maxLinks; i++) {
            const a = linksArray[i];
            try {
                const rawHref = a.getAttribute('href');
                if (!rawHref) continue;

                // DDG Lite links are like //duckduckgo.com/l/?uddg=<encoded_url>
                const fullUrl = rawHref.startsWith('//') ? 'https:' + rawHref : rawHref;
                const url = new URL(fullUrl);
                const uddg = url.searchParams.get('uddg');

                if (uddg) {
                    const decodedUrl = decodeURIComponent(uddg);
                    if (decodedUrl.startsWith('http') &&
                        !decodedUrl.includes('duckduckgo.com') &&
                        !links.includes(decodedUrl)) {
                        links.push(decodedUrl);
                    }
                }
            } catch (e) {
                // Skip malformed URLs
            }
        }

        console.log(`   ✅ Extracted ${links.length} links from DDG Lite`);
    } catch (e) {
        console.log(`   ❌ DDG Lite failed: ${e.message}`);
        console.log(`   Stack: ${e.stack}`);
    }

    return links;
}

async function searchBingHtml(query, maxLinks) {
    const links = [];
    console.log(`\n🔍 Searching Bing...`);

    for (let page = 0; page < 5 && links.length < maxLinks; page++) {
        try {
            const first = page * 10 + 1;
            const response = await axios.get('https://www.bing.com/search', {
                params: { q: query, first: first },
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml',
                    'Accept-Language': 'en-US,en;q=0.9'
                },
                timeout: 15000
            });

            const dom = new JSDOM(response.data);
            const document = dom.window.document;

            // Bing search result selectors
            const resultLinks = document.querySelectorAll('li.b_algo h2 a, .b_algo a[href^="http"]');

            let newCount = 0;
            for (const a of resultLinks) {
                const href = a.href;
                if (href && href.startsWith('http') &&
                    !href.includes('bing.com') &&
                    !href.includes('microsoft.com') &&
                    !links.includes(href) &&
                    links.length < maxLinks) {
                    links.push(href);
                    newCount++;
                }
            }

            console.log(`   Page ${page + 1}: Found ${newCount} new links (total: ${links.length})`);

            if (newCount === 0) break;

            // Be polite between requests
            await new Promise(r => setTimeout(r, 1000));

        } catch (e) {
            console.log(`   ❌ Bing page ${page + 1} failed: ${e.message}`);
            break;
        }
    }

    return links;
}

async function searchGoogle(query, maxLinks) {
    const links = [];
    console.log(`\n🔍 Searching Google...`);

    for (let page = 0; page < 5 && links.length < maxLinks; page++) {
        try {
            const start = page * 10;
            const response = await axios.get('https://www.google.com/search', {
                params: { q: query, start: start },
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml',
                    'Accept-Language': 'en-US,en;q=0.9'
                },
                timeout: 15000
            });

            const dom = new JSDOM(response.data);
            const document = dom.window.document;

            // Google search result selectors
            const resultLinks = document.querySelectorAll('div.g a[href^="http"], a[data-ved][href^="http"]');

            let newCount = 0;
            for (const a of resultLinks) {
                const href = a.href;
                if (href && href.startsWith('http') &&
                    !href.includes('google.com') &&
                    !href.includes('webcache') &&
                    !href.includes('translate.google') &&
                    !links.includes(href) &&
                    links.length < maxLinks) {
                    links.push(href);
                    newCount++;
                }
            }

            console.log(`   Page ${page + 1}: Found ${newCount} new links (total: ${links.length})`);

            if (newCount === 0) break;

            await new Promise(r => setTimeout(r, 1500));

        } catch (e) {
            console.log(`   ❌ Google page ${page + 1} failed: ${e.message}`);
            break;
        }
    }

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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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

// --- WEBPAGE PROCESSING (Using Playwright) ---
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
    if (link.toLowerCase().endsWith('.pdf') || link.toLowerCase().includes('.pdf?')) {
        return await processPDF(link);
    }

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
    console.log(`📑 Content Type: ${CONTENT_TYPE}`);

    // --- STEP 1: HARVEST LINKS (HTTP-based, no browser) ---
    let collectedLinks = [];

    // Try multiple search engines until we have enough links
    collectedLinks = await searchDDGHtml(QUERY, TARGET_DOCS);

    if (collectedLinks.length < TARGET_DOCS) {
        const bingLinks = await searchBingHtml(QUERY, TARGET_DOCS - collectedLinks.length);
        collectedLinks = [...new Set([...collectedLinks, ...bingLinks])];
    }

    if (collectedLinks.length < TARGET_DOCS) {
        const googleLinks = await searchGoogle(QUERY, TARGET_DOCS - collectedLinks.length);
        collectedLinks = [...new Set([...collectedLinks, ...googleLinks])];
    }

    console.log(`\n✅ Harvest Complete. Found ${collectedLinks.length} unique links.`);

    if (collectedLinks.length === 0) {
        console.log("❌ No links found. Exiting.");
        process.exit(1);
    }

    // --- STEP 2: PROCESS & COMPRESS (Using Playwright for content) ---
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

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
