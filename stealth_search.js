/**
 * Stealth Browser Search Module
 * Implements anti-detection techniques and multiple search engine fallbacks
 * for bypassing bot detection on DuckDuckGo, Google, and Bing
 */
const { chromium } = require('playwright');

// Stealth configuration to evade bot detection
const STEALTH_CONFIG = {
    // Realistic browser fingerprints
    userAgents: [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
    ],

    // Viewport variations
    viewports: [
        { width: 1920, height: 1080 },
        { width: 1366, height: 768 },
        { width: 1536, height: 864 },
        { width: 1440, height: 900 },
    ],

    // Timezone variations
    timezones: ['America/New_York', 'America/Chicago', 'America/Los_Angeles', 'America/Denver'],

    // Locale variations
    locales: ['en-US', 'en-GB', 'en-CA'],
};

function getRandomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Create a stealth browser context with anti-detection measures
 */
async function createStealthContext(browser) {
    const userAgent = getRandomItem(STEALTH_CONFIG.userAgents);
    const viewport = getRandomItem(STEALTH_CONFIG.viewports);
    const timezone = getRandomItem(STEALTH_CONFIG.timezones);
    const locale = getRandomItem(STEALTH_CONFIG.locales);

    const context = await browser.newContext({
        userAgent,
        viewport,
        locale,
        timezoneId: timezone,
        // Permissions that real browsers have
        permissions: ['geolocation'],
        // Enable JavaScript (some bot detectors check this)
        javaScriptEnabled: true,
        // Bypass CSP for some edge cases
        bypassCSP: true,
        // Extra HTTP headers to look more legitimate
        extraHTTPHeaders: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Sec-Ch-Ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
        }
    });

    // Inject anti-detection scripts
    await context.addInitScript(() => {
        // Override navigator properties that reveal automation
        Object.defineProperty(navigator, 'webdriver', { get: () => false });

        // Add chrome object that Playwright doesn't have by default
        if (!window.chrome) {
            window.chrome = {
                runtime: {},
                loadTimes: function () { },
                csi: function () { },
                app: {}
            };
        }

        // Fix permissions API
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
                Promise.resolve({ state: Notification.permission }) :
                originalQuery(parameters)
        );

        // Add plugins array (empty in headless)
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5]
        });

        // Add languages
        Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en']
        });

        // Hide automation indicators
        Object.defineProperty(navigator, 'platform', {
            get: () => 'Win32'
        });

        // Override connection property
        Object.defineProperty(navigator, 'connection', {
            get: () => ({
                effectiveType: '4g',
                rtt: 50,
                downlink: 10,
                saveData: false
            })
        });
    });

    return context;
}

/**
 * Perform human-like actions before searching
 */
async function humanize(page) {
    // Random delay before actions
    await page.waitForTimeout(500 + Math.random() * 1000);

    // Slight mouse movement
    await page.mouse.move(
        100 + Math.random() * 200,
        100 + Math.random() * 200
    );
}

/**
 * Scroll down the page to load more results
 * Many search engines use infinite scroll or lazy loading
 * @param {Page} page - Playwright page object
 * @param {number} scrollCount - Number of times to scroll (default 3)
 * @param {number} scrollDelay - Delay between scrolls in ms (default 1000)
 */
async function scrollForMoreResults(page, scrollCount = 3, scrollDelay = 1000) {
    console.log(`   📜 Scrolling to load more results (${scrollCount} scrolls)...`);

    for (let i = 0; i < scrollCount; i++) {
        // Get current scroll height
        const previousHeight = await page.evaluate(() => document.body.scrollHeight);

        // Scroll to bottom with human-like behavior
        await page.evaluate(() => {
            window.scrollTo({
                top: document.body.scrollHeight,
                behavior: 'smooth'
            });
        });

        // Wait for potential new content to load
        await page.waitForTimeout(scrollDelay + Math.random() * 500);

        // Check if we've loaded new content
        const newHeight = await page.evaluate(() => document.body.scrollHeight);

        // Add slight random mouse movement to seem more human
        await page.mouse.move(
            200 + Math.random() * 300,
            300 + Math.random() * 200
        );

        // If no new content loaded after 2 scrolls, break early
        if (newHeight === previousHeight && i >= 1) {
            console.log(`   📜 No more content to load after ${i + 1} scrolls`);
            break;
        }
    }
}

/**
 * Search DuckDuckGo with stealth mode
 * Uses the lite version which has less bot detection
 */
async function searchDuckDuckGoLite(query, maxLinks, context) {
    const links = [];
    const page = await context.newPage();

    try {
        console.log('   🦆 Trying DuckDuckGo Lite (less detection)...');

        // Use the lite/HTML version which has less JavaScript-based detection
        await page.goto(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        await humanize(page);

        // Helper function to extract links from current page
        const extractLinks = async () => {
            return await page.evaluate(() => {
                const results = [];
                // Lite version uses simple table structure
                const rows = document.querySelectorAll('table tr');
                rows.forEach(row => {
                    const link = row.querySelector('a.result-link');
                    if (link && link.href && link.href.startsWith('http')) {
                        results.push(link.href);
                    }
                });

                // Also try standard link selectors
                document.querySelectorAll('a[href^="http"]').forEach(a => {
                    const href = a.href;
                    if (href && !href.includes('duckduckgo.com') && !results.includes(href)) {
                        results.push(href);
                    }
                });

                return results;
            });
        };

        // Get initial results
        let ddgLinks = await extractLinks();
        ddgLinks.forEach(l => {
            if (!links.includes(l)) links.push(l);
        });

        // DDG Lite uses form submission for pagination - try to get more pages
        let pageNum = 1;
        const maxPages = 3;

        while (links.length < maxLinks && pageNum < maxPages) {
            // Look for the "Next" button (form submit)
            const nextButton = await page.$('input[type="submit"][value="Next"], input.nav-link[value*="Next"]');
            if (!nextButton) {
                console.log(`   📜 No more pages available after page ${pageNum}`);
                break;
            }

            await humanize(page);
            await nextButton.click();
            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(1000 + Math.random() * 500);

            const newLinks = await extractLinks();
            newLinks.forEach(l => {
                if (!links.includes(l)) links.push(l);
            });

            pageNum++;
            console.log(`   📜 Page ${pageNum}: Total ${links.length} links`);
        }

        console.log(`   ✅ DDG Lite found ${links.length} results`);
    } catch (e) {
        console.log(`   ❌ DDG Lite failed: ${e.message}`);
    }

    await page.close();
    return links;
}

/**
 * Search DuckDuckGo via HTML version (no JavaScript)
 */
async function searchDuckDuckGoHTML(query, maxLinks, context) {
    const links = [];
    const page = await context.newPage();

    try {
        console.log('   🦆 Trying DuckDuckGo HTML version...');

        // HTML-only version doesn't require JavaScript
        await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        await humanize(page);

        // Helper function to extract links
        const extractLinks = async () => {
            return await page.evaluate(() => {
                const results = [];
                // HTML version uses different selectors
                document.querySelectorAll('.result__a, .result__url, a.result-link').forEach(a => {
                    const href = a.href;
                    if (href && href.startsWith('http') && !href.includes('duckduckgo.com')) {
                        results.push(href);
                    }
                });

                // Fallback: any link that's not DDG
                if (results.length === 0) {
                    document.querySelectorAll('a[href^="http"]').forEach(a => {
                        const href = a.href;
                        if (href && !href.includes('duckduckgo.com') && !results.includes(href)) {
                            results.push(href);
                        }
                    });
                }

                return results;
            });
        };

        // Get initial results
        let ddgLinks = await extractLinks();
        ddgLinks.forEach(l => {
            if (!links.includes(l)) links.push(l);
        });

        // DDG HTML version uses form-based pagination with "Next" button
        let pageNum = 1;
        const maxPages = 3;

        while (links.length < maxLinks && pageNum < maxPages) {
            // Look for the "Next" navigation link or button
            const nextButton = await page.$('input.btn.btn--alt[value="Next"], .nav-link form input[type="submit"], input[value="Next"]');
            if (!nextButton) {
                console.log(`   📜 No more pages available after page ${pageNum}`);
                break;
            }

            await humanize(page);
            await nextButton.click();
            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(1000 + Math.random() * 500);

            const newLinks = await extractLinks();
            newLinks.forEach(l => {
                if (!links.includes(l)) links.push(l);
            });

            pageNum++;
            console.log(`   📜 Page ${pageNum}: Total ${links.length} links`);
        }

        console.log(`   ✅ DDG HTML found ${links.length} results`);
    } catch (e) {
        console.log(`   ❌ DDG HTML failed: ${e.message}`);
    }

    await page.close();
    return links;
}

/**
 * Search Startpage (privacy-focused, proxies Google results)
 */
async function searchStartpage(query, maxLinks, context) {
    const links = [];
    const page = await context.newPage();

    try {
        console.log('   🔒 Trying Startpage (proxy for Google)...');

        await page.goto(`https://www.startpage.com/sp/search?query=${encodeURIComponent(query)}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        await page.waitForSelector('.w-gl__result', { timeout: 10000 }).catch(() => null);
        await humanize(page);

        // Helper function to extract links
        const extractLinks = async () => {
            return await page.evaluate(() => {
                const results = [];
                document.querySelectorAll('.w-gl__result a.w-gl__result-title, .result a').forEach(a => {
                    const href = a.href;
                    if (href && href.startsWith('http') && !href.includes('startpage.com')) {
                        results.push(href);
                    }
                });
                return results;
            });
        };

        // Get initial results
        let spLinks = await extractLinks();
        spLinks.forEach(l => {
            if (!links.includes(l)) links.push(l);
        });

        // Scroll to load more results and try pagination
        await scrollForMoreResults(page, 3, 1500);

        // Extract links after scrolling
        spLinks = await extractLinks();
        spLinks.forEach(l => {
            if (!links.includes(l)) links.push(l);
        });

        // Try to click "Next" page if available
        let pageNum = 1;
        const maxPages = 3;

        while (links.length < maxLinks && pageNum < maxPages) {
            const nextButton = await page.$('button.next, a.next, .pagination a[rel="next"], nav button:has-text("Next")');
            if (!nextButton) break;

            await humanize(page);
            await nextButton.click();
            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(1500 + Math.random() * 500);
            await page.waitForSelector('.w-gl__result', { timeout: 10000 }).catch(() => null);

            const newLinks = await extractLinks();
            newLinks.forEach(l => {
                if (!links.includes(l)) links.push(l);
            });

            pageNum++;
            console.log(`   📜 Page ${pageNum}: Total ${links.length} links`);
        }

        console.log(`   ✅ Startpage found ${links.length} results`);
    } catch (e) {
        console.log(`   ❌ Startpage failed: ${e.message}`);
    }

    await page.close();
    return links;
}

/**
 * Search Brave Search
 */
async function searchBrave(query, maxLinks, context) {
    const links = [];
    const page = await context.newPage();

    try {
        console.log('   🦁 Trying Brave Search...');

        await page.goto(`https://search.brave.com/search?q=${encodeURIComponent(query)}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        await page.waitForSelector('.snippet', { timeout: 10000 }).catch(() => null);
        await humanize(page);

        // Helper function to extract links
        const extractLinks = async () => {
            return await page.evaluate(() => {
                const results = [];
                document.querySelectorAll('.snippet a, .result a, a[href^="http"]').forEach(a => {
                    const href = a.href;
                    if (href && href.startsWith('http') &&
                        !href.includes('brave.com') &&
                        !href.includes('search.brave')) {
                        results.push(href);
                    }
                });
                return [...new Set(results)];
            });
        };

        // Get initial results
        let braveLinks = await extractLinks();
        braveLinks.forEach(l => {
            if (!links.includes(l)) links.push(l);
        });

        // Brave uses infinite scroll - scroll to load more
        await scrollForMoreResults(page, 5, 1500);

        // Extract links after scrolling
        braveLinks = await extractLinks();
        braveLinks.forEach(l => {
            if (!links.includes(l)) links.push(l);
        });

        // Also try pagination buttons if they exist
        let pageNum = 1;
        const maxPages = 3;

        while (links.length < maxLinks && pageNum < maxPages) {
            const nextButton = await page.$('a[aria-label="Next page"], .pagination-next, button:has-text("Next")');
            if (!nextButton) break;

            await humanize(page);
            await nextButton.click();
            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(1500 + Math.random() * 500);

            const newLinks = await extractLinks();
            newLinks.forEach(l => {
                if (!links.includes(l)) links.push(l);
            });

            pageNum++;
            console.log(`   📜 Page ${pageNum}: Total ${links.length} links`);
        }

        console.log(`   ✅ Brave found ${links.length} results`);
    } catch (e) {
        console.log(`   ❌ Brave failed: ${e.message}`);
    }

    await page.close();
    return links;
}

/**
 * Search Yandex (Russian search engine, less aggressive bot detection)
 */
async function searchYandex(query, maxLinks, context) {
    const links = [];
    const page = await context.newPage();

    try {
        console.log('   🔴 Trying Yandex...');

        await page.goto(`https://yandex.com/search/?text=${encodeURIComponent(query)}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        await page.waitForSelector('.serp-item', { timeout: 10000 }).catch(() => null);
        await humanize(page);

        // Helper function to extract links
        const extractLinks = async () => {
            return await page.evaluate(() => {
                const results = [];
                document.querySelectorAll('.serp-item a, .organic__url, .link').forEach(a => {
                    const href = a.href;
                    if (href && href.startsWith('http') && !href.includes('yandex')) {
                        results.push(href);
                    }
                });
                return [...new Set(results)];
            });
        };

        // Get initial results
        let yandexLinks = await extractLinks();
        yandexLinks.forEach(l => {
            if (!links.includes(l)) links.push(l);
        });

        // Yandex uses "Load more" or pagination - scroll and try both
        await scrollForMoreResults(page, 4, 1500);

        // Extract links after scrolling
        yandexLinks = await extractLinks();
        yandexLinks.forEach(l => {
            if (!links.includes(l)) links.push(l);
        });

        // Try pagination
        let pageNum = 1;
        const maxPages = 3;

        while (links.length < maxLinks && pageNum < maxPages) {
            const nextButton = await page.$('.pager__item_kind_next a, a.pager__item_kind_next, .more-button');
            if (!nextButton) break;

            await humanize(page);
            await nextButton.click();
            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(1500 + Math.random() * 500);
            await page.waitForSelector('.serp-item', { timeout: 10000 }).catch(() => null);

            const newLinks = await extractLinks();
            newLinks.forEach(l => {
                if (!links.includes(l)) links.push(l);
            });

            pageNum++;
            console.log(`   📜 Page ${pageNum}: Total ${links.length} links`);
        }

        console.log(`   ✅ Yandex found ${links.length} results`);
    } catch (e) {
        console.log(`   ❌ Yandex failed: ${e.message}`);
    }

    await page.close();
    return links;
}

/**
 * Search Mojeek (UK-based, independent index)
 */
async function searchMojeek(query, maxLinks, context) {
    const links = [];
    const page = await context.newPage();

    try {
        console.log('   🟢 Trying Mojeek...');

        await page.goto(`https://www.mojeek.com/search?q=${encodeURIComponent(query)}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        await page.waitForSelector('.results-standard', { timeout: 10000 }).catch(() => null);
        await humanize(page);

        // Helper function to extract links
        const extractLinks = async () => {
            return await page.evaluate(() => {
                const results = [];
                document.querySelectorAll('.results-standard a, li.result a, a[href^="http"]').forEach(a => {
                    const href = a.href;
                    if (href && href.startsWith('http') && !href.includes('mojeek.com')) {
                        results.push(href);
                    }
                });
                return [...new Set(results)];
            });
        };

        // Get initial results
        let mojeekLinks = await extractLinks();
        mojeekLinks.forEach(l => {
            if (!links.includes(l)) links.push(l);
        });

        // Scroll to load more results
        await scrollForMoreResults(page, 3, 1000);

        // Extract links after scrolling
        mojeekLinks = await extractLinks();
        mojeekLinks.forEach(l => {
            if (!links.includes(l)) links.push(l);
        });

        // Mojeek uses traditional pagination
        let pageNum = 1;
        const maxPages = 3;

        while (links.length < maxLinks && pageNum < maxPages) {
            const nextButton = await page.$('a.next-page, a[rel="next"], .pagination a:has-text("Next"), .pagination a:has-text("»")');
            if (!nextButton) break;

            await humanize(page);
            await nextButton.click();
            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(1500 + Math.random() * 500);
            await page.waitForSelector('.results-standard', { timeout: 10000 }).catch(() => null);

            const newLinks = await extractLinks();
            newLinks.forEach(l => {
                if (!links.includes(l)) links.push(l);
            });

            pageNum++;
            console.log(`   📜 Page ${pageNum}: Total ${links.length} links`);
        }

        console.log(`   ✅ Mojeek found ${links.length} results`);
    } catch (e) {
        console.log(`   ❌ Mojeek failed: ${e.message}`);
    }

    await page.close();
    return links;
}

/**
 * Main stealth search function - tries multiple search engines
 */
async function stealthSearch(query, maxLinks, browser) {
    const links = [];
    console.log(`\n🥷 Starting stealth search for: "${query}"...`);

    // Create stealth context
    const context = await createStealthContext(browser);

    // Try search engines in order of reliability
    const searchFunctions = [
        { name: 'DDG HTML', fn: searchDuckDuckGoHTML },
        { name: 'DDG Lite', fn: searchDuckDuckGoLite },
        { name: 'Startpage', fn: searchStartpage },
        { name: 'Brave', fn: searchBrave },
        { name: 'Mojeek', fn: searchMojeek },
        { name: 'Yandex', fn: searchYandex },
    ];

    for (const { name, fn } of searchFunctions) {
        if (links.length >= maxLinks) break;

        try {
            const results = await fn(query, maxLinks - links.length, context);
            results.forEach(l => {
                if (!links.includes(l)) links.push(l);
            });
        } catch (e) {
            console.log(`   ⚠️ ${name} error: ${e.message}`);
        }

        // Small delay between search engines
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
    }

    await context.close();

    console.log(`\n🎯 Stealth search complete: ${links.length} total links found`);
    return links;
}

module.exports = {
    createStealthContext,
    stealthSearch,
    searchDuckDuckGoHTML,
    searchDuckDuckGoLite,
    searchStartpage,
    searchBrave,
    searchYandex,
    searchMojeek,
    humanize,
    scrollForMoreResults
};
