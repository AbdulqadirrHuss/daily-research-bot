/**
 * PDF Generator Module
 * Creates research compilation PDFs with proper sidebar bookmarks
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

/**
 * Generate a research compilation PDF with sidebar navigation
 * @param {number} volNum - Volume number
 * @param {Array} sources - Array of source objects with title, url, content, type, wordCount, date
 * @param {string} query - Search query/topic
 * @param {string} outputDir - Output directory path
 * @returns {Promise<string>} - Filename of created PDF
 */
function generateResearchPDF(volNum, sources, query, outputDir) {
    // New naming convention: (Topic)_Research_File_(number).pdf
    const safeTopic = query.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    const filename = `${safeTopic}_Research_File_${volNum}.pdf`;
    const filePath = path.join(outputDir, filename);

    // Create PDF with enhanced settings
    const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 72, bottom: 72, left: 72, right: 72 },
        bufferPages: true,
        pdfVersion: '1.5',
        autoFirstPage: false,
        info: {
            Title: `${query} - Research Compilation Volume ${volNum}`,
            Author: 'Research Bot',
            Subject: query,
            Keywords: query,
            CreationDate: new Date()
        }
    });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Track page numbers for bookmarks
    const pageNumbers = { title: 0, toc: 0, sources: [] };

    // ============================================
    // TITLE PAGE
    // ============================================
    doc.addPage();
    pageNumbers.title = 0;

    // Background
    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#fafafa');

    // Title
    doc.moveDown(6);
    doc.fontSize(28).font('Helvetica-Bold').fillColor('#1a1a1a');
    doc.text('RESEARCH COMPILATION', { align: 'center' });

    doc.moveDown(0.3);
    doc.fontSize(42).fillColor('#2563eb');
    doc.text(`Volume ${volNum}`, { align: 'center' });

    // Decorative line
    doc.moveDown(0.8);
    const lineY = doc.y;
    doc.strokeColor('#2563eb').lineWidth(3);
    doc.moveTo(150, lineY).lineTo(445, lineY).stroke();

    // Topic
    doc.moveDown(1.5);
    doc.fontSize(14).font('Helvetica').fillColor('#666666');
    doc.text('Research Topic:', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(20).font('Helvetica-Bold').fillColor('#1a1a1a');
    doc.text(`"${query}"`, { align: 'center' });

    // Metadata
    doc.moveDown(4);
    doc.fontSize(11).font('Helvetica').fillColor('#888888');
    doc.text(`Generated: ${new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    })}`, { align: 'center' });
    doc.moveDown(0.3);
    doc.text(`Total Sources: ${sources.length}`, { align: 'center' });

    // ============================================
    // TABLE OF CONTENTS
    // ============================================
    doc.addPage();
    pageNumbers.toc = 1;

    doc.fontSize(22).font('Helvetica-Bold').fillColor('#1a1a1a');
    doc.text('TABLE OF CONTENTS', { align: 'center' });

    doc.moveDown(0.4);
    doc.strokeColor('#e5e5e5').lineWidth(1);
    doc.moveTo(72, doc.y).lineTo(523, doc.y).stroke();
    doc.moveDown(1);

    // List sources in TOC
    sources.forEach((source, idx) => {
        if (doc.y > 720) {
            doc.addPage();
        }

        const truncTitle = source.title.length > 55
            ? source.title.substring(0, 52) + '...'
            : source.title;

        const typeColor = source.type === 'PDF' ? '#dc2626' : '#2563eb';
        const typeLabel = source.type === 'PDF' ? 'PDF' : 'WEB';

        doc.fontSize(10).font('Helvetica-Bold').fillColor(typeColor);
        doc.text(`${idx + 1}. [${typeLabel}] `, 72, doc.y, { continued: true });

        doc.font('Helvetica').fillColor('#333333');
        doc.text(truncTitle);

        doc.moveDown(0.5);
    });

    // ============================================
    // INDIVIDUAL SOURCES
    // ============================================
    sources.forEach((source, idx) => {
        doc.addPage();
        pageNumbers.sources.push(doc._pageBuffer.length - 1);

        // ---- HEADER BAR ----
        doc.rect(0, 0, doc.page.width, 70).fill('#1e3a5f');

        doc.fontSize(11).font('Helvetica-Bold').fillColor('#ffffff');
        doc.text(`SOURCE ${idx + 1} of ${sources.length}`, 72, 22);

        const typeLabel = source.type === 'PDF' ? 'PDF DOCUMENT' : 'WEB ARTICLE';
        doc.fontSize(9).font('Helvetica').fillColor('#93c5fd');
        doc.text(typeLabel, 72, 40);

        // ---- TITLE ----
        doc.y = 90;
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#1a1a1a');
        doc.text(source.title, 72, doc.y, { width: 451 });

        doc.moveDown(0.6);

        // ---- METADATA BOX ----
        const metaY = doc.y;
        doc.rect(72, metaY, 451, 50).fill('#f5f5f5');

        doc.fontSize(9).font('Helvetica').fillColor('#666666');
        doc.text(`URL: ${source.url.substring(0, 70)}${source.url.length > 70 ? '...' : ''}`,
            82, metaY + 8, { link: source.url });
        doc.text(`Date: ${new Date(source.date).toLocaleDateString()}  |  Words: ${source.wordCount.toLocaleString()}`,
            82, metaY + 28);

        doc.y = metaY + 65;

        // ---- CONTENT ----
        doc.fontSize(10.5).font('Times-Roman').fillColor('#333333');

        // Clean content
        let content = source.content || '';
        content = content
            .replace(/\r\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]+/g, ' ')
            .trim();

        // Split into paragraphs
        const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 15);

        for (const para of paragraphs) {
            const cleanPara = para.trim();
            if (!cleanPara) continue;

            const paraHeight = doc.heightOfString(cleanPara, {
                width: 451,
                lineGap: 2
            });

            // Check for page break
            if (doc.y + paraHeight > 750) {
                doc.addPage();

                // Running header
                doc.fontSize(8).font('Helvetica-Oblique').fillColor('#999999');
                doc.text(`Source ${idx + 1} (continued)`, 72, 40, { align: 'right', width: 451 });
                doc.y = 60;
                doc.fontSize(10.5).font('Times-Roman').fillColor('#333333');
            }

            doc.text(cleanPara, 72, doc.y, {
                width: 451,
                align: 'justify',
                lineGap: 2
            });
            doc.moveDown(0.5);
        }

        // ---- FOOTER ----
        if (doc.y < 730) {
            doc.moveDown(1);
            doc.strokeColor('#e5e5e5').lineWidth(1);
            doc.moveTo(72, doc.y).lineTo(523, doc.y).stroke();
            doc.moveDown(0.3);
            doc.fontSize(8).font('Helvetica-Oblique').fillColor('#aaaaaa');
            doc.text(`— End of Source ${idx + 1} —`, { align: 'center' });
        }
    });

    // ============================================
    // ADD PDF BOOKMARKS (Sidebar Navigation)
    // ============================================
    // PDFKit supports outlines/bookmarks
    try {
        if (doc.outline) {
            // Root level bookmarks
            doc.outline.addItem('Title Page');
            doc.outline.addItem('Table of Contents');

            // Sources section with children
            const sourcesBookmark = doc.outline.addItem('Sources');
            sources.forEach((source, idx) => {
                const shortTitle = source.title.length > 35
                    ? source.title.substring(0, 32) + '...'
                    : source.title;
                sourcesBookmark.addItem(`${idx + 1}. ${shortTitle}`);
            });
        }
    } catch (e) {
        console.log(`   Note: Bookmarks not fully supported: ${e.message}`);
    }

    // Finalize
    doc.end();

    return new Promise((resolve) => {
        stream.on('finish', () => {
            const stats = fs.statSync(filePath);
            console.log(`\n    💾 Saved: ${filename}`);
            console.log(`    📊 Size: ${Math.round(stats.size / 1024)} KB`);
            console.log(`    📑 Contains ${sources.length} sources`);
            resolve(filename);
        });
    });
}

module.exports = { generateResearchPDF };
