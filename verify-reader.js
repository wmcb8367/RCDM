const fs = require("fs");
const path = require("path");
const vm = require("vm");

const INDEX_PATH = "index.html";
const READER_PATH = "reader.js";
const BOOK_PATH = "book-content.js";

function countWords(text) {
    const clean = text.replace(/\s+/g, " ").trim();
    return clean ? clean.split(" ").length : 0;
}

function normalizeChapterTitle(text) {
    return text.replace(/\s+/g, " ").trim();
}

function buildBlocks(html) {
    const regex = /<(h1|h2|h3|p)[^>]*>([\s\S]*?)<\/\1>/gi;
    const blocks = [];
    let currentChapterTitle = "Opening";
    let match;

    while ((match = regex.exec(html))) {
        const tag = match[1].toLowerCase();
        const text = match[2].replace(/<[^>]+>/g, " ");
        const normalizedText = normalizeChapterTitle(text);
        if (!normalizedText) {
            continue;
        }
        if (tag === "h2" && normalizedText !== "Contents" && normalizedText !== "2025 Edition") {
            currentChapterTitle = normalizedText;
        }
        blocks.push({
            tag,
            words: countWords(text),
            chapterTitle: currentChapterTitle
        });
    }

    return blocks;
}

function buildPages(blocks) {
    const pages = [];
    let pageBlocks = [];
    let pageWords = 0;
    let pageChapter = blocks[0] ? blocks[0].chapterTitle : "Opening";

    function flushPage() {
        if (!pageBlocks.length) {
            return;
        }
        pages.push({
            chapterTitle: pageChapter,
            wordCount: pageWords
        });
        pageBlocks = [];
        pageWords = 0;
    }

    blocks.forEach((block, index) => {
        const nextBlock = blocks[index + 1];
        const startsNewChapter =
            block.tag === "h2" &&
            pageBlocks.length > 0 &&
            pageChapter !== "Opening" &&
            block.chapterTitle !== pageChapter;

        if (startsNewChapter) {
            flushPage();
            pageChapter = block.chapterTitle;
        }

        if (!pageBlocks.length) {
            pageChapter = block.chapterTitle;
        }
        if (pageChapter === "Opening" && block.chapterTitle !== "Opening") {
            pageChapter = block.chapterTitle;
        }

        pageBlocks.push(block);
        pageWords += block.words;

        const nextStartsChapter =
            nextBlock &&
            nextBlock.tag === "h2" &&
            nextBlock.chapterTitle !== pageChapter;

        const isSafeBreakpoint = pageWords >= 650 || (pageWords >= 500 && nextStartsChapter);
        if (isSafeBreakpoint) {
            flushPage();
        }
    });

    flushPage();
    return pages;
}

function assignAudioToPages(pages) {
    const prologuePages = pages
        .map((page, index) => ({ page, index }))
        .filter(({ page }) => /Prologue/i.test(page.chapterTitle));

    const prologueChunk = prologuePages.length ? Math.ceil(prologuePages.length / 3) : 0;

    pages.forEach((page, index) => {
        let audioKey = "prologue-3";
        if (index === 0 || /Preface/i.test(page.chapterTitle)) {
            audioKey = "preface";
        } else if (/Prologue/i.test(page.chapterTitle) && prologueChunk) {
            const position = prologuePages.findIndex((entry) => entry.index === index);
            if (position < prologueChunk) {
                audioKey = "prologue-1";
            } else if (position < prologueChunk * 2) {
                audioKey = "prologue-2";
            }
        }
        page.audioKey = audioKey;
    });

    return pages;
}

function main() {
    const indexHtml = fs.readFileSync(INDEX_PATH, "utf8");
    const readerJs = fs.readFileSync(READER_PATH, "utf8");
    const bookContentJs = fs.readFileSync(BOOK_PATH, "utf8");
    const sandbox = { window: {} };
    vm.runInNewContext(bookContentJs, sandbox);
    const bookHtml = sandbox.window.BOOK_HTML;
    if (typeof bookHtml !== "string" || !bookHtml.length) {
        throw new Error("BOOK_HTML was not loaded from book-content.js");
    }

    const pages = assignAudioToPages(buildPages(buildBlocks(bookHtml)));
    const audioFiles = [
        "audiobook/01-preface.mp3",
        "audiobook/02-prologue-full.mp3"
    ];

    const summary = {
        pageCount: pages.length,
        chapterCount: [...new Set(pages.map((page) => page.chapterTitle))].length,
        firstPageChapter: pages[0] ? pages[0].chapterTitle : null,
        audioKeysUsed: [...new Set(pages.map((page) => page.audioKey))],
        audioFiles: audioFiles.map((relativePath) => {
            const absolutePath = path.join(process.cwd(), relativePath);
            const exists = fs.existsSync(absolutePath);
            return {
                path: relativePath,
                exists,
                bytes: exists ? fs.statSync(absolutePath).size : 0
            };
        }),
        checks: {
            bookContentScriptIncluded: indexHtml.includes('src="book-content.js"'),
            readerScriptIncluded: indexHtml.includes('src="reader.js"'),
            initOnDOMContentLoaded: readerJs.includes('document.addEventListener("DOMContentLoaded"'),
            hasPrevButton: indexHtml.includes('id="prevPageBtn"'),
            hasNextButton: indexHtml.includes('id="nextPageBtn"'),
            hasPageJump: indexHtml.includes('id="pageJumpSelect"'),
            hasChapterNav: indexHtml.includes('id="chapterNav"'),
            hasProgressBar: indexHtml.includes('id="progressFill"'),
            hasAudioPlayer: indexHtml.includes('id="audioPlayer"'),
            hasChatUi: indexHtml.includes('id="chatInput"') && indexHtml.includes('id="sendBtn"'),
            hasKeyboardNavigation: readerJs.includes('ArrowRight') && readerJs.includes('ArrowLeft'),
            hasPersistence: readerJs.includes("localStorage.getItem") && readerJs.includes("localStorage.setItem")
        }
    };

    console.log(JSON.stringify(summary, null, 2));
}

main();
