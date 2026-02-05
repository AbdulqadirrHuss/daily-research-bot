const { chromium } = require('playwright');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const pdf = require('pdf-parse');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const { stealthSearch } = require('./stealth_search');
const { generateResearchPDF } = require('./pdf_generator');

// --- CONFIGURATION ---
const QUERY = process.env.INPUT_QUERY || "Artificial Intelligence Safety";
const TARGET_DOCS = parseInt(process.env.INPUT_TARGET || "100");
const DOCS_PER_FILE = parseInt(process.env.INPUT_DOCS_PER_FILE || "40");
const MIN_WORDS = parseInt(process.env.INPUT_MIN_WORDS || "200");
const CONTENT_TYPE = process.env.INPUT_CONTENT_TYPE || "both"; // pdfs (only PDFs) or both (PDFs + web pages)

const OUTPUT_DIR = path.resolve(__dirname, 'research_text');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// --- UTILITY FUNCTIONS ---

/**
 * Sanitize extracted content to remove:
 * - Garbled encoding (corrupted Cyrillic/Asian text bytes)
 * - Wikipedia reference noise
 * - Citation patterns
 * - Non-printable characters
 */
function sanitizeContent(text) {
    if (!text) return '';

    let clean = text;

    // Remove common corrupted byte sequences (Cyrillic UTF-8 misread as Windows-1252)
    // These patterns appear as: C´, Cä, CÔ, Dð, D$, etc.
    clean = clean.replace(/[ABCD][´äÔðô¤€„][0-9A-Za-z]*/g, ' ');
    clean = clean.replace(/[CD][A-Za-z][0-9A-Za-z´äÔðô¤€„]+/g, ' ');

    // Remove strings with too many special/corrupted characters
    clean = clean.replace(/\S*[´äÔðô¤€„¢£¥©®™•†‡§¶]\S*/g, ' ');

    // Remove Wikipedia-style reference patterns
    clean = clean.replace(/\^\s*(Jump up to:?\s*)?[a-z\s]+$/gim, '');
    clean = clean.replace(/\[\d+\]/g, '');  // [1], [2], etc.
    clean = clean.replace(/\[citation needed\]/gi, '');
    clean = clean.replace(/\[edit\]/gi, '');
    clean = clean.replace(/\[show\]/gi, '');
    clean = clean.replace(/\[hide\]/gi, '');

    // Remove "Archived from the original" citation patterns
    clean = clean.replace(/Archived from the original[^.]*\./gi, '');
    clean = clean.replace(/Retrieved \d+\s+\w+\s+\d+\.?/gi, '');
    clean = clean.replace(/Retrieved \w+\s+\d+,?\s+\d+\.?/gi, '');

    // Remove external link patterns common in Wikipedia
    clean = clean.replace(/\^ [a-z] "[^"]*"\./gi, '');
    clean = clean.replace(/\(JPG\)/gi, '');
    clean = clean.replace(/\(PDF\)/gi, '');

    // Remove lines that are mostly reference noise
    const lines = clean.split('\n');
    const filteredLines = lines.filter(line => {
        const trimmed = line.trim();

        // Skip very short lines
        if (trimmed.length < 20) return false;

        // Skip lines that look like pure references
        if (/^(\^|\[|\d+\.)\s/.test(trimmed)) return false;

        // Skip lines with too many special chars relative to length
        const specialChars = (trimmed.match(/[^a-zA-Z0-9\s.,!?;:'"()-]/g) || []).length;
        if (specialChars / trimmed.length > 0.15) return false;

        // Skip lines that are mostly URLs
        if (/https?:\/\/\S+/.test(trimmed) && trimmed.length < 100) return false;

        return true;
    });

    clean = filteredLines.join('\n');

    // Remove non-printable characters (except newlines and tabs)
    clean = clean.replace(/[^\x20-\x7E\n\t]/g, ' ');

    // Collapse multiple spaces
    clean = clean.replace(/[ \t]+/g, ' ');
    clean = clean.replace(/\n\s*\n\s*\n/g, '\n\n');

    return clean.trim();
}

function countWords(text) {
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

function formatOutput(type, title, url, content) {
    // Sanitize content to remove garbled text and citations
    const sanitized = sanitizeContent(content);
    const cleanText = sanitized.replace(/\s\s+/g, ' ').trim();

    // Return structured data for PDF generation
    return {
        type: type,
        title: (title || 'Untitled Document').replace(/[^\x20-\x7E]/g, ''),
        url: url,
        date: new Date().toISOString(),
        wordCount: countWords(cleanText),
        content: cleanText
    };
}

function savePDFVolume(volNum, sources, query) {
    const filename = `Volume_${volNum}_(${query.replace(/[^a-z0-9]/gi, '_')}).pdf`;
    const filePath = path.join(OUTPUT_DIR, filename);

    // Create a new PDF document with outline support
    const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        bufferPages: true,
        pdfVersion: '1.5',
        autoFirstPage: false
    });

    // Pipe to file
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Track page destinations for outline
    const pageDestinations = [];

    // --- TITLE PAGE ---
    doc.addPage();
    const titlePageRef = doc.page;

    doc.fontSize(28).font('Helvetica-Bold');
    doc.text('RESEARCH COMPILATION', { align: 'center' });
    doc.moveDown(0.5);

    doc.fontSize(18).font('Helvetica');
    doc.text(`Volume ${volNum}`, { align: 'center' });
    doc.moveDown(0.3);

    doc.fontSize(14).font('Helvetica-Oblique');
    doc.text(`Topic: "${query}"`, { align: 'center' });
    doc.moveDown(0.5);

    doc.fontSize(12).font('Helvetica');
    doc.text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.text(`Total Sources: ${sources.length}`, { align: 'center' });

    // Divider line
    doc.moveDown(1);
    doc.strokeColor('#333333').lineWidth(2);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();

    // --- TABLE OF CONTENTS PAGE ---
    doc.addPage();
    const tocPageNum = doc._pageBuffer.length;

    doc.fontSize(20).font('Helvetica-Bold');
    doc.text('TABLE OF CONTENTS', { align: 'center' });
    doc.moveDown(1);

    // We'll store TOC y-positions to add links later
    const tocEntries = [];
    doc.fontSize(11).font('Helvetica');
    sources.forEach((source, idx) => {
        const truncTitle = source.title.length > 55
            ? source.title.substring(0, 52) + '...'
            : source.title;
        const yPos = doc.y;
        tocEntries.push({ y: yPos, idx });
        doc.text(`${idx + 1}. [${source.type}] ${truncTitle}`, {
            continued: false,
            underline: true,
            link: `#source_${idx}`
        });
        doc.moveDown(0.3);
    });

    // --- INDIVIDUAL SOURCES ---
    // Store page references for outline
    const sourcePages = [];

    sources.forEach((source, idx) => {
        // Start new page for each source
        doc.addPage();

        // Store page reference for this source (for outline)
        sourcePages.push({
            pageIndex: doc._pageBuffer.length - 1,
            title: source.title.length > 50 ? source.title.substring(0, 47) + '...' : source.title,
            type: source.type
        });

        // ═══════════════════════════════════════════════════════════
        // SOURCE HEADER
        // ═══════════════════════════════════════════════════════════
        doc.strokeColor('#2563eb').lineWidth(3);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(0.5);

        // Source number badge
        doc.fontSize(14).font('Helvetica-Bold').fillColor('#2563eb');
        doc.text(`📄 SOURCE ${idx + 1} OF ${sources.length}`, { align: 'left' });
        doc.moveDown(0.3);

        // Title
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#000000');
        doc.text(source.title, { align: 'left' });
        doc.moveDown(0.5);

        // ───────────────────────────────────────────────────────────
        // METADATA BLOCK
        // ───────────────────────────────────────────────────────────
        doc.strokeColor('#cccccc').lineWidth(1);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(0.4);

        doc.fontSize(10).font('Helvetica').fillColor('#555555');
        doc.text(`Type: ${source.type === 'PDF' ? '📑 PDF Document' : '🌐 Web Page'}`);
        doc.text(`URL: ${source.url}`, { link: source.url, underline: true });
        doc.text(`Date Extracted: ${source.date}`);
        doc.text(`Word Count: ${source.wordCount.toLocaleString()} words`);
        doc.moveDown(0.4);

        doc.strokeColor('#cccccc').lineWidth(1);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(0.8);

        // ───────────────────────────────────────────────────────────
        // CONTENT BODY
        // ───────────────────────────────────────────────────────────
        doc.fontSize(11).font('Times-Roman').fillColor('#000000');

        // Split content into paragraphs and add them
        const paragraphs = source.content.split(/\n+/).filter(p => p.trim().length > 0);
        paragraphs.forEach(para => {
            // Check if we need a new page
            if (doc.y > 700) {
                doc.addPage();
                // Add continuation header
                doc.fontSize(9).font('Helvetica-Oblique').fillColor('#888888');
                doc.text(`[Continued - Source ${idx + 1}: ${source.title.substring(0, 40)}...]`, { align: 'right' });
                doc.moveDown(0.5);
                doc.fontSize(11).font('Times-Roman').fillColor('#000000');
            }
            doc.text(para.trim(), { align: 'justify', lineGap: 2 });
            doc.moveDown(0.5);
        });

        // ═══════════════════════════════════════════════════════════
        // SOURCE FOOTER
        // ═══════════════════════════════════════════════════════════
        doc.moveDown(1);
        doc.strokeColor('#2563eb').lineWidth(2);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(0.3);
        doc.fontSize(9).font('Helvetica-Oblique').fillColor('#666666');
        doc.text(`▼ END OF SOURCE ${idx + 1}`, { align: 'center' });
    });

    // --- ADD PDF OUTLINE (Sidebar Navigation) ---
    // PDFKit doesn't have native outline support, so we add it manually
    // Create outline dictionary
    const outlineItems = [];

    // Title page entry
    outlineItems.push({
        title: 'Title Page',
        page: 0
    });

    // Table of Contents entry
    outlineItems.push({
        title: 'Table of Contents',
        page: 1
    });

    // Add each source to outline
    sourcePages.forEach((sp, idx) => {
        outlineItems.push({
            title: `${idx + 1}. [${sp.type}] ${sp.title}`,
            page: sp.pageIndex
        });
    });

    // Add outline entries as named destinations (for internal linking)
    // Note: Full outline support requires low-level PDF manipulation
    // The TOC links above provide in-document navigation
    // For proper sidebar bookmarks, we use the addNamedDestination approach if available

    try {
        // Try to add named destinations for each source
        sourcePages.forEach((sp, idx) => {
            const destName = `source_${idx}`;
            if (doc.addNamedDestination) {
                doc.addNamedDestination(destName, 'XYZ', sp.pageIndex * 842, 842, null);
            }
        });
    } catch (e) {
        // Named destinations not supported in this PDFKit version
        console.log(`   Note: Named destinations not available`);
    }

    // Finalize PDF
    doc.end();

    // Wait for stream to finish
    return new Promise((resolve) => {
        stream.on('finish', () => {
            const stats = fs.statSync(filePath);
            console.log(`\n    💾 Saved ${filename} (${Math.round(stats.size / 1024)} KB)`);
            console.log(`    📑 Contains ${sources.length} sources with clickable Table of Contents`);
            resolve();
        });
    });
}

// --- SEMANTIC SCHOLAR API (Free, no auth required) ---
async function searchSemanticScholar(query, maxLinks) {
    const links = [];
    console.log(`\n🔍 Searching Semantic Scholar for: "${query}"...`);

    try {
        const response = await axios.get('https://api.semanticscholar.org/graph/v1/paper/search', {
            params: {
                query: query,
                limit: Math.min(maxLinks, 100),
                fields: 'title,openAccessPdf,url,externalIds'
            },
            headers: {
                'User-Agent': 'ResearchBot/1.0 (Educational)'
            },
            timeout: 20000
        });

        const papers = response.data?.data || [];
        console.log(`   Found ${papers.length} papers`);

        let pdfCount = 0;
        for (const paper of papers) {
            // Prefer open access PDF links
            if (paper.openAccessPdf?.url) {
                links.push(paper.openAccessPdf.url);
                pdfCount++;
            } else if (paper.externalIds?.ArXiv) {
                // Construct arXiv PDF link
                links.push(`https://arxiv.org/pdf/${paper.externalIds.ArXiv}.pdf`);
                pdfCount++;
            }
        }

        console.log(`   ✅ Extracted ${pdfCount} PDF links from Semantic Scholar`);
    } catch (e) {
        console.log(`   ❌ Semantic Scholar failed: ${e.message}`);
    }

    return links;
}

// --- ARXIV API SEARCH (Free, academic preprints) ---
async function searchArXiv(query, maxLinks) {
    const links = [];
    console.log(`\n🔍 Searching arXiv for: "${query}"...`);

    try {
        const searchQuery = query.replace(/\s+/g, '+AND+');
        const response = await axios.get('http://export.arxiv.org/api/query', {
            params: {
                search_query: `all:${searchQuery}`,
                start: 0,
                max_results: Math.min(maxLinks, 100),
                sortBy: 'relevance'
            },
            headers: {
                'User-Agent': 'ResearchBot/1.0 (Educational)'
            },
            timeout: 20000
        });

        // Parse Atom XML
        const dom = new JSDOM(response.data, { contentType: 'text/xml' });
        const entries = dom.window.document.querySelectorAll('entry');

        for (const entry of entries) {
            const id = entry.querySelector('id')?.textContent;
            if (id) {
                // Convert arXiv ID to PDF URL
                const arxivId = id.replace('http://arxiv.org/abs/', '');
                links.push(`https://arxiv.org/pdf/${arxivId}.pdf`);
            }
        }

        console.log(`   ✅ Extracted ${links.length} arXiv PDF links`);
    } catch (e) {
        console.log(`   ❌ arXiv failed: ${e.message}`);
    }

    return links;
}

// --- GOOGLE SCHOLAR SEARCH (Browser-based) ---
async function searchGoogleScholar(query, maxLinks, browser) {
    const links = [];
    console.log(`\n🔍 Searching Google Scholar for: "${query}"...`);

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 }
    });
    const page = await context.newPage();

    try {
        await page.goto(`https://scholar.google.com/scholar?q=${encodeURIComponent(query)}&hl=en`, {
            waitUntil: 'networkidle',
            timeout: 30000
        });

        // Wait for results
        await page.waitForSelector('.gs_r', { timeout: 10000 }).catch(() => null);
        await page.waitForTimeout(2000);

        // Extract PDF links from Google Scholar
        const scholarLinks = await page.evaluate(() => {
            const results = [];
            // Look for [PDF] links on the right side
            const pdfLinks = document.querySelectorAll('.gs_or_ggsm a, .gs_ggsd a, a[href*=".pdf"]');
            pdfLinks.forEach(a => {
                const href = a.href;
                if (href && (href.endsWith('.pdf') || href.includes('.pdf?') || href.includes('/pdf/'))) {
                    results.push(href);
                }
            });

            // Also get links from result titles that might lead to PDFs
            const titleLinks = document.querySelectorAll('.gs_rt a');
            titleLinks.forEach(a => {
                const href = a.href;
                if (href && href.startsWith('http') && !href.includes('scholar.google')) {
                    results.push(href);
                }
            });

            return results;
        });

        scholarLinks.slice(0, maxLinks).forEach(l => {
            if (!links.includes(l)) links.push(l);
        });

        console.log(`   ✅ Google Scholar found ${links.length} links`);
    } catch (e) {
        console.log(`   ❌ Google Scholar failed: ${e.message}`);
    }

    await context.close();
    return links;
}

// --- GOOGLE FILETYPE:PDF SEARCH (Browser-based) ---
async function searchGooglePDF(query, maxLinks, browser) {
    const links = [];
    console.log(`\n🔍 Searching Google for PDFs: "${query} filetype:pdf"...`);

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 }
    });
    const page = await context.newPage();

    try {
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query + ' filetype:pdf')}&num=50`;
        await page.goto(searchUrl, {
            waitUntil: 'networkidle',
            timeout: 30000
        });

        // Wait for results
        await page.waitForSelector('#search', { timeout: 10000 }).catch(() => null);
        await page.waitForTimeout(2000);

        // Extract PDF links
        const googleLinks = await page.evaluate(() => {
            const results = [];
            // Get all result links
            const allLinks = document.querySelectorAll('#search a[href]');
            allLinks.forEach(a => {
                const href = a.href;
                // Filter for PDF links or links that look like they lead to PDFs
                if (href && href.startsWith('http') &&
                    !href.includes('google.com') &&
                    !href.includes('webcache') &&
                    (href.endsWith('.pdf') || href.includes('.pdf?') || href.includes('/pdf/'))) {
                    results.push(href);
                }
            });

            // Also get result URLs that might be PDF sources
            const resultLinks = document.querySelectorAll('div[data-ved] a[href*="http"]');
            resultLinks.forEach(a => {
                const href = a.href;
                if (href && !href.includes('google.com') && !results.includes(href)) {
                    // Check if the link text or nearby text mentions PDF
                    const text = a.textContent || '';
                    if (text.includes('PDF') || href.includes('pdf')) {
                        results.push(href);
                    }
                }
            });

            return [...new Set(results)];
        });

        googleLinks.slice(0, maxLinks).forEach(l => {
            if (!links.includes(l)) links.push(l);
        });

        console.log(`   ✅ Google PDF search found ${links.length} links`);
    } catch (e) {
        console.log(`   ❌ Google PDF search failed: ${e.message}`);
    }

    await context.close();
    return links;
}

// --- WIKIPEDIA API SEARCH (Works from any IP) ---
async function searchWikipedia(query, maxLinks) {
    const links = [];
    console.log(`\n🔍 Searching Wikipedia API for: "${query}"...`);

    try {
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

// --- BROWSER-BASED SEARCH (Using Stealth Search Module) ---
async function searchWithBrowser(query, maxLinks, browser) {
    console.log(`\n🔍 Browser-based search for: "${query}"...`);

    // Use the stealth search module which has anti-detection and multiple search engines
    const links = await stealthSearch(query, maxLinks, browser);

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
        // Block heavy resources to speed up loading
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
            timeout: 25000
        });

        if (!response) {
            console.log(`      ❌ No response from ${url.substring(0, 40)}...`);
            return null;
        }

        // Check for PDF content-type (redirected PDFs)
        const responseContentType = response.headers()['content-type'] || '';
        if (responseContentType.includes('pdf')) {
            await page.unroute('**/*');
            return await processPDF(url);
        }

        // Wait for JavaScript content to render
        // Many sites load content dynamically
        try {
            await page.waitForLoadState('networkidle', { timeout: 8000 });
        } catch (e) {
            // Continue anyway - some sites never reach networkidle
        }

        // Additional wait for lazy-loaded content
        await page.waitForTimeout(2000);

        // Get HTML after JS has rendered
        const html = await page.content();
        const dom = new JSDOM(html, { url });
        const document = dom.window.document;

        let title = '';
        let textContent = '';

        // STRATEGY 1: Try Readability (best for articles)
        try {
            const reader = new Readability(document.cloneNode(true));
            const article = reader.parse();

            if (article && article.textContent && countWords(article.textContent) > 50) {
                title = article.title || '';
                textContent = article.textContent;
            }
        } catch (e) {
            // Readability failed, continue to fallbacks
        }

        // STRATEGY 2: Direct text extraction from main content areas
        if (!textContent || countWords(textContent) < 50) {
            const selectors = [
                'article', 'main', '[role="main"]', '.content', '#content',
                '.post-content', '.article-content', '.entry-content',
                '.post-body', '.article-body', '.story-body',
                '.page-content', '#main-content', '.main-content'
            ];

            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (el && el.textContent) {
                    const extracted = el.textContent.trim();
                    if (countWords(extracted) > countWords(textContent)) {
                        textContent = extracted;
                        title = title || document.querySelector('h1')?.textContent ||
                            document.querySelector('title')?.textContent || '';
                    }
                }
            }
        }

        // STRATEGY 3: Fall back to body text (last resort)
        if (!textContent || countWords(textContent) < 50) {
            // Remove scripts, styles, navs, headers, footers
            const nodesToRemove = document.querySelectorAll(
                'script, style, nav, header, footer, aside, .nav, .menu, .sidebar, .comments, .advertisement, .ad, [role="navigation"]'
            );
            nodesToRemove.forEach(n => n.remove());

            textContent = document.body?.textContent || '';
            title = title || document.querySelector('title')?.textContent || 'Untitled';
        }

        // Get title from page if still missing
        if (!title) {
            title = await page.title() || 'Untitled';
        }

        await page.unroute('**/*');

        // Clean up the extracted text
        textContent = textContent
            .replace(/\s+/g, ' ')
            .replace(/\n\s*\n/g, '\n\n')
            .trim();

        const wordCount = countWords(textContent);

        // Check for bot detection/challenge pages (they often have very short generic content)
        const lowerContent = textContent.toLowerCase();
        const isBotBlocked = (
            lowerContent.includes('verify you are human') ||
            lowerContent.includes('please enable javascript') ||
            lowerContent.includes('checking your browser') ||
            lowerContent.includes('cloudflare') ||
            lowerContent.includes('access denied') ||
            lowerContent.includes('403 forbidden') ||
            lowerContent.includes('captcha') ||
            (wordCount < 100 && lowerContent.includes('security'))
        );

        if (isBotBlocked) {
            console.log(`      🚫 Bot blocked: ${url.substring(0, 45)}...`);
            return null;
        }

        if (wordCount >= MIN_WORDS) {
            console.log(`      ✅ Web extracted: ${wordCount} words`);
            return formatOutput("WEB", title, url, textContent);
        } else {
            console.log(`      ⚠️ Content too short: ${wordCount} words (min: ${MIN_WORDS})`);
        }
    } catch (e) {
        console.log(`      ❌ Web failed: ${e.message.substring(0, 50)}`);
    }
    return null;
}

async function processLink(link, browser, contentType) {
    const lowerLink = link.toLowerCase();

    // Check if this is definitely a PDF link
    const isDefinitePdf = lowerLink.endsWith('.pdf') || lowerLink.includes('.pdf?');

    // Check if this might be a PDF (academic links that often resolve to PDFs)
    const mightBePdf = lowerLink.includes('/pdf/') ||
        lowerLink.includes('/pdf?') ||
        lowerLink.includes('downloadpdf') ||
        lowerLink.includes('/fulltext/') ||
        (lowerLink.includes('doi.org') && contentType === 'pdfs') ||
        lowerLink.includes('arxiv.org/pdf') ||
        lowerLink.includes('researchgate.net/publication') ||
        lowerLink.includes('academia.edu');

    // Process definite PDFs directly
    if (isDefinitePdf) {
        return await processPDF(link);
    }

    // For PDF mode, try potential PDF URLs by following redirects
    if (contentType === 'pdfs') {
        if (mightBePdf) {
            console.log(`      🔍 Checking potential PDF: ${link.substring(0, 50)}...`);

            // First try direct PDF download (in case it redirects)
            const pdfResult = await processPDF(link);
            if (pdfResult) return pdfResult;

            // If that fails, try browser-based processing to see if it resolves to PDF
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

        // Skip non-PDF links in PDF-only mode
        console.log(`      ⏭️ Skipping non-PDF: ${link.substring(0, 50)}...`);
        return null;
    }

    // Process web pages (for 'both' mode)
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

    console.log(`\n🔎 Search Query: "${QUERY}"`);

    // For PDF mode, use academic sources first
    if (CONTENT_TYPE === 'pdfs') {
        console.log(`\n📚 Using academic search sources for PDF discovery...`);

        // Strategy 1: Semantic Scholar API (best for academic topics, has open access PDFs)
        const semanticLinks = await searchSemanticScholar(QUERY, Math.ceil(TARGET_DOCS / 2));
        semanticLinks.forEach(l => { if (!collectedLinks.includes(l)) collectedLinks.push(l); });

        // Strategy 2: arXiv API (preprints and technical papers)
        if (collectedLinks.length < TARGET_DOCS) {
            const arxivLinks = await searchArXiv(QUERY, TARGET_DOCS - collectedLinks.length);
            arxivLinks.forEach(l => { if (!collectedLinks.includes(l)) collectedLinks.push(l); });
        }

        // Strategy 3: Google Scholar (comprehensive academic search)
        if (collectedLinks.length < TARGET_DOCS) {
            const scholarLinks = await searchGoogleScholar(QUERY, TARGET_DOCS - collectedLinks.length, browser);
            scholarLinks.forEach(l => { if (!collectedLinks.includes(l)) collectedLinks.push(l); });
        }

        // Strategy 4: Google filetype:pdf (general PDF search)
        if (collectedLinks.length < TARGET_DOCS) {
            const googlePdfLinks = await searchGooglePDF(QUERY, TARGET_DOCS - collectedLinks.length, browser);
            googlePdfLinks.forEach(l => { if (!collectedLinks.includes(l)) collectedLinks.push(l); });
        }

        // Strategy 5: DuckDuckGo/Bing as backup
        if (collectedLinks.length < TARGET_DOCS) {
            const browserLinks = await searchWithBrowser(`${QUERY} filetype:pdf`, TARGET_DOCS - collectedLinks.length, browser);
            browserLinks.forEach(l => { if (!collectedLinks.includes(l)) collectedLinks.push(l); });
        }
    } else {
        // For web + PDF mode, use the original strategy

        // Strategy 1: Wikipedia API
        const wikiLinks = await searchWikipedia(QUERY, Math.ceil(TARGET_DOCS / 2));
        collectedLinks.push(...wikiLinks);

        // Strategy 2: RSS Feeds
        if (collectedLinks.length < TARGET_DOCS) {
            const rssLinks = await searchRSSFeeds(QUERY, TARGET_DOCS - collectedLinks.length);
            rssLinks.forEach(l => { if (!collectedLinks.includes(l)) collectedLinks.push(l); });
        }

        // Strategy 3: Browser-based search
        if (collectedLinks.length < TARGET_DOCS) {
            const browserLinks = await searchWithBrowser(QUERY, TARGET_DOCS - collectedLinks.length, browser);
            browserLinks.forEach(l => { if (!collectedLinks.includes(l)) collectedLinks.push(l); });
        }
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
    let currentSources = [];

    const CONCURRENCY = 3;

    for (let i = 0; i < linksArray.length; i += CONCURRENCY) {
        const chunk = linksArray.slice(i, i + CONCURRENCY);
        const promises = chunk.map(link => processLink(link, browser, CONTENT_TYPE));
        const results = await Promise.all(promises);

        for (const res of results) {
            processedCount++;
            if (res) {
                currentSources.push(res);
                successCount++;
            }
        }

        process.stdout.write(`\r⚙️  Processed: ${processedCount}/${linksArray.length} (Success: ${successCount})`);

        if (successCount > 0 && successCount % DOCS_PER_FILE === 0 && currentSources.length > 0) {
            await generateResearchPDF(currentVolume, currentSources, QUERY, OUTPUT_DIR);
            currentVolume++;
            currentSources = [];
        }
    }

    if (currentSources.length > 0) {
        await generateResearchPDF(currentVolume, currentSources, QUERY, OUTPUT_DIR);
    }

    await browser.close();

    console.log(`\n\n🏁 JOB COMPLETE!`);
    console.log(`   📊 Total Processed: ${processedCount}`);
    console.log(`   ✅ Successfully Extracted: ${successCount}`);
    console.log(`   📁 Output saved to: ${OUTPUT_DIR}`);

})();
