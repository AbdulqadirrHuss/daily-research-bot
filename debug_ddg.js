/**
 * Debug script for DuckDuckGo search
 * Tests if DDG is blocking our requests or if selectors are wrong
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const QUERY = process.argv[2] || "a2ad complex filetype:pdf";
const DEBUG_DIR = path.resolve(__dirname, 'debug_output');

if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });

async function debugDuckDuckGo() {
    console.log(`\n🔍 DEBUG: Testing DuckDuckGo search for "${QUERY}"\n`);

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US'
    });

    const page = await context.newPage();

    try {
        console.log('1️⃣ Navigating to DuckDuckGo...');
        const url = `https://duckduckgo.com/?q=${encodeURIComponent(QUERY)}`;
        console.log(`   URL: ${url}`);

        const response = await page.goto(url, {
            waitUntil: 'networkidle',
            timeout: 30000
        });

        console.log(`\n2️⃣ Response Status: ${response.status()}`);
        console.log(`   Final URL: ${page.url()}`);

        // Check for Cloudflare
        const title = await page.title();
        console.log(`   Page Title: ${title}`);

        if (title.includes('Cloudflare') || title.includes('Just a moment')) {
            console.log('\n⚠️ CLOUDFLARE DETECTED! Page is being blocked.');
        }

        // Wait for page to fully load
        console.log('\n3️⃣ Waiting for content...');
        await page.waitForTimeout(5000);

        // Take screenshot
        const screenshotPath = path.join(DEBUG_DIR, 'ddg_screenshot.png');
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`   📸 Screenshot saved to: ${screenshotPath}`);

        // Save HTML
        const html = await page.content();
        const htmlPath = path.join(DEBUG_DIR, 'ddg_page.html');
        fs.writeFileSync(htmlPath, html);
        console.log(`   📄 HTML saved to: ${htmlPath}`);

        // Check what selectors exist
        console.log('\n4️⃣ Checking for result selectors...');

        const selectors = [
            '[data-testid="result"]',
            '.result__a',
            '[data-nir="true"]',
            'article[data-testid="result"]',
            '.react-results--main a',
            '.nrn-react-div a',
            'a[data-testid="result-title-a"]',
            'a[data-testid="result-extras-url-link"]',
            '.result',
            '.web-result',
            '#links .result',
            '.results--main .result',
            '[data-layout="organic"]'
        ];

        for (const sel of selectors) {
            const count = await page.locator(sel).count();
            if (count > 0) {
                console.log(`   ✅ ${sel}: ${count} matches`);
            } else {
                console.log(`   ❌ ${sel}: 0 matches`);
            }
        }

        // Try to find ANY links
        console.log('\n5️⃣ Looking for any external links...');
        const allLinks = await page.evaluate(() => {
            const links = document.querySelectorAll('a[href^="http"]');
            return Array.from(links)
                .map(a => ({ href: a.href, text: a.textContent?.substring(0, 50) }))
                .filter(l => !l.href.includes('duckduckgo.com'))
                .slice(0, 20);
        });

        console.log(`   Found ${allLinks.length} external links:`);
        allLinks.forEach((l, i) => {
            console.log(`   ${i + 1}. ${l.href.substring(0, 60)}...`);
        });

        // Check for JavaScript-heavy content indicators
        console.log('\n6️⃣ Checking page structure...');
        const bodyContent = await page.evaluate(() => document.body?.innerText?.substring(0, 500));
        console.log(`   Body text preview:\n   "${bodyContent?.replace(/\n/g, ' ').substring(0, 200)}..."`);

        // Check for specific elements that indicate JS hasn't loaded
        const hasReactRoot = await page.locator('#react-layout, #react-root, [data-react-root]').count();
        console.log(`   React root elements: ${hasReactRoot}`);

    } catch (e) {
        console.log(`\n❌ ERROR: ${e.message}`);

        // Try to save whatever we got
        try {
            const html = await page.content();
            fs.writeFileSync(path.join(DEBUG_DIR, 'ddg_error.html'), html);
            await page.screenshot({ path: path.join(DEBUG_DIR, 'ddg_error.png') });
        } catch (e2) {
            console.log(`   Could not save error state: ${e2.message}`);
        }
    }

    await browser.close();
    console.log('\n✅ Debug complete. Check debug_output/ folder for files.');
}

debugDuckDuckGo();
