const STORAGE_KEY = "bookReader.paginationState.v2";
const PAGE_WORD_TARGET = 650;
const PAGE_WORD_MIN = 500;
const FADE_DURATION = 180;
const OLLAMA_URL = "http://localhost:11434/api/chat";
const audioFiles = {
    preface: {
        label: "Preface",
        src: "audiobook/01-preface.mp3"
    },
    "prologue-1": {
        label: "Prologue Part 1",
        src: "audiobook/02-prologue-part-1.mp3"
    },
    "prologue-2": {
        label: "Prologue Part 2",
        src: "audiobook/02-prologue-part-2.mp3"
    },
    "prologue-3": {
        label: "Prologue Part 3",
        src: "audiobook/02-prologue-part-3.mp3"
    }
};

const state = {
    currentPage: 0,
    activeAudioKey: "preface",
    audioPositions: {},
    wasPlaying: false,
    pages: [],
    chapterNav: [],
    resumeAvailable: false
};

const elements = {};

function countWords(text) {
    const clean = text.replace(/\s+/g, " ").trim();
    return clean ? clean.split(" ").length : 0;
}

function clampPage(pageNumber) {
    return Math.max(0, Math.min(pageNumber, state.pages.length - 1));
}

function normalizeChapterTitle(text) {
    return text.replace(/\s+/g, " ").trim();
}

function chapterDisplayLabel(page) {
    if (page.audioDerived) {
        return `${page.audioLabel} for ${page.chapterTitle}`;
    }
    return page.audioLabel;
}

function showReaderError(message) {
    if (elements.currentSection) {
        elements.currentSection.textContent = "Reader failed to load";
    }
    if (elements.audioChapterLabel) {
        elements.audioChapterLabel.textContent = message;
    }
    if (elements.bookContent) {
        elements.bookContent.innerHTML = `<p>${message}</p>`;
    }
}

function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return;
        }
        const saved = JSON.parse(raw);
        if (Number.isInteger(saved.currentPage)) {
            state.currentPage = saved.currentPage;
        }
        if (saved.activeAudioKey && audioFiles[saved.activeAudioKey]) {
            state.activeAudioKey = saved.activeAudioKey;
        }
        if (saved.audioPositions && typeof saved.audioPositions === "object") {
            state.audioPositions = saved.audioPositions;
        }
        state.wasPlaying = Boolean(saved.wasPlaying);
        state.resumeAvailable = Number.isInteger(saved.currentPage) && saved.currentPage > 0;
    } catch (error) {
        console.warn("Could not restore reader state", error);
    }
}

function saveState() {
    if (!elements.audioPlayer) {
        return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        currentPage: state.currentPage,
        activeAudioKey: state.activeAudioKey,
        audioPositions: state.audioPositions,
        wasPlaying: !elements.audioPlayer.paused
    }));
}

function buildPagesFromHtml(html) {
    const parser = document.createElement("div");
    parser.innerHTML = html;
    const blocks = [];
    let currentChapterTitle = "Opening";

    Array.from(parser.children).forEach((node) => {
        const tag = node.tagName.toLowerCase();
        const text = node.textContent || "";
        const normalizedText = normalizeChapterTitle(text);
        if (!normalizedText && tag !== "img") {
            return;
        }
        if (tag === "h2" && normalizedText !== "Contents") {
            currentChapterTitle = normalizedText;
        }
        blocks.push({
            tag,
            html: node.outerHTML,
            words: countWords(text),
            chapterTitle: currentChapterTitle
        });
    });

    const pages = [];
    let pageBlocks = [];
    let pageWords = 0;
    let pageChapter = blocks[0] ? blocks[0].chapterTitle : "Opening";

    function flushPage() {
        if (!pageBlocks.length) {
            return;
        }
        pages.push({
            html: pageBlocks.map((block) => block.html).join(""),
            wordCount: pageWords,
            chapterTitle: pageChapter
        });
        pageBlocks = [];
        pageWords = 0;
    }

    blocks.forEach((block, index) => {
        const nextBlock = blocks[index + 1];
        const startsNewChapter = block.tag === "h2" && pageBlocks.length > 0;

        if (startsNewChapter) {
            flushPage();
            pageChapter = block.chapterTitle;
        }

        if (!pageBlocks.length) {
            pageChapter = block.chapterTitle;
        }

        pageBlocks.push(block);
        pageWords += block.words;

        const nextStartsChapter = nextBlock && nextBlock.tag === "h2";
        const isSafeBreakpoint = pageWords >= PAGE_WORD_TARGET || (pageWords >= PAGE_WORD_MIN && nextStartsChapter);

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
        let audioDerived = false;

        if (index === 0 || /Preface/i.test(page.chapterTitle)) {
            audioKey = "preface";
        } else if (/Prologue/i.test(page.chapterTitle) && prologueChunk) {
            const position = prologuePages.findIndex((entry) => entry.index === index);
            if (position < prologueChunk) {
                audioKey = "prologue-1";
            } else if (position < prologueChunk * 2) {
                audioKey = "prologue-2";
            } else {
                audioKey = "prologue-3";
            }
        } else {
            audioDerived = true;
        }

        page.audioKey = audioKey;
        page.audioLabel = audioFiles[audioKey].label;
        page.audioDerived = audioDerived;
        page.number = index + 1;
    });

    return pages;
}

function buildChapterNavigation() {
    const seen = new Set();
    state.chapterNav = state.pages.reduce((items, page, index) => {
        if (seen.has(page.chapterTitle)) {
            return items;
        }
        seen.add(page.chapterTitle);
        items.push({
            title: page.chapterTitle,
            pageIndex: index
        });
        return items;
    }, []);
}

function populatePageJump() {
    elements.pageJumpSelect.innerHTML = state.pages.map((page, index) => {
        return `<option value="${index}">Page ${index + 1}: ${page.chapterTitle}</option>`;
    }).join("");
}

function renderChapterNav() {
    const currentPage = state.pages[state.currentPage];
    elements.chapterNav.innerHTML = state.chapterNav.map((chapter) => {
        const active = currentPage.chapterTitle === chapter.title ? "active" : "";
        return `
            <button class="chapter-link ${active}" type="button" data-page-index="${chapter.pageIndex}">
                ${chapter.title}
                <small>Starts on page ${chapter.pageIndex + 1}</small>
            </button>
        `;
    }).join("");
}

function updateAudioButtons(activeKey) {
    document.querySelectorAll(".chapter-btn").forEach((button) => {
        button.classList.toggle("active", button.dataset.audioKey === activeKey);
    });
}

function restoreAudioPosition(audioKey, shouldAutoplay) {
    const targetTime = state.audioPositions[audioKey] || 0;
    const player = elements.audioPlayer;

    function applyPosition() {
        if (targetTime > 0 && Number.isFinite(targetTime)) {
            player.currentTime = targetTime;
        }
        if (shouldAutoplay) {
            player.play().catch(() => {});
        }
    }

    if (player.readyState >= 1) {
        applyPosition();
        return;
    }

    player.addEventListener("loadedmetadata", applyPosition, { once: true });
}

function resolveAssetUrl(relativePath) {
    return new URL(relativePath, document.baseURI).href;
}

function syncAudioForPage(page, forceReload = false) {
    const player = elements.audioPlayer;
    const nextAudioKey = page.audioKey;
    const currentSrc = player.currentSrc || player.getAttribute("src") || "";
    const nextSrc = resolveAssetUrl(audioFiles[nextAudioKey].src);
    const sameAudio = currentSrc === nextSrc;
    const wasPlaying = !player.paused;

    if (state.activeAudioKey) {
        state.audioPositions[state.activeAudioKey] = player.currentTime || state.audioPositions[state.activeAudioKey] || 0;
    }

    state.activeAudioKey = nextAudioKey;
    updateAudioButtons(nextAudioKey);

    if (!sameAudio || forceReload) {
        player.src = nextSrc;
        player.load();
        restoreAudioPosition(nextAudioKey, wasPlaying || state.wasPlaying);
    }

    elements.audioMeta.textContent = page.audioDerived
        ? `Current page uses ${audioFiles[nextAudioKey].label}. Additional audiobook chapters have not been mapped yet.`
        : `Current page is synced to ${audioFiles[nextAudioKey].label}.`;
}

function renderPage(pageIndex, options = {}) {
    const index = clampPage(pageIndex);
    const page = state.pages[index];
    state.currentPage = index;

    const applyRender = () => {
        elements.bookContent.innerHTML = page.html;
        elements.currentSection.textContent = page.chapterTitle;
        elements.audioChapterLabel.textContent = `Audio chapter: ${chapterDisplayLabel(page)}`;
        elements.pageIndicator.textContent = `Page ${page.number} of ${state.pages.length}`;
        elements.progressDetail.textContent = `Page ${page.number} of ${state.pages.length}`;
        const progress = Math.round((page.number / state.pages.length) * 100);
        elements.progressPercent.textContent = `${progress}% complete`;
        elements.progressFill.style.width = `${progress}%`;
        elements.pageJumpSelect.value = String(index);
        elements.prevPageBtn.disabled = index === 0;
        elements.nextPageBtn.disabled = index === state.pages.length - 1;
        renderChapterNav();
        syncAudioForPage(page, options.forceAudioReload);
        saveState();
        elements.readerMain.scrollTop = 0;
        elements.bookContent.classList.remove("is-fading");
    };

    if (options.skipFade) {
        applyRender();
        return;
    }

    elements.bookContent.classList.add("is-fading");
    window.setTimeout(applyRender, FADE_DURATION);
}

function goToPage(pageIndex, options = {}) {
    const clamped = clampPage(pageIndex);
    if (clamped === state.currentPage && !options.forceAudioReload) {
        return;
    }
    renderPage(clamped, options);
}

function jumpToAudioChapter(audioKey) {
    const matchingPageIndex = state.pages.findIndex((page) => page.audioKey === audioKey);
    if (matchingPageIndex === -1) {
        return;
    }
    state.audioPositions[audioKey] = state.audioPositions[audioKey] || 0;
    state.wasPlaying = true;
    goToPage(matchingPageIndex, { forceAudioReload: true });
}

function handleKeyNavigation(event) {
    const activeTag = document.activeElement && document.activeElement.tagName;
    if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT") {
        return;
    }

    if (event.key === "ArrowRight") {
        event.preventDefault();
        goToPage(state.currentPage + 1);
    } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToPage(state.currentPage - 1);
    }
}

function appendChatMessage(role, html, id = "") {
    const wrapper = document.createElement("div");
    wrapper.className = `message ${role}`;
    if (id) {
        wrapper.id = id;
    }
    wrapper.innerHTML = html;
    elements.chatMessages.appendChild(wrapper);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    return wrapper;
}

function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

async function askOllama(question) {
    const response = await fetch(OLLAMA_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: "llama3.1:8b",
            messages: [
                {
                    role: "system",
                    content: "You are an expert sailing coach assistant helping readers understand Willie McBride's book Race Course Decision Making. Answer questions based on sailing strategy, tactics, and race course philosophy."
                },
                {
                    role: "user",
                    content: question
                }
            ],
            stream: false
        })
    });

    if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}`);
    }

    const data = await response.json();
    const content = data && data.message && data.message.content;
    if (!content) {
        throw new Error("Ollama response was missing message content");
    }
    return content;
}

function placeholderAnswer(question) {
    return [
        "AI placeholder mode is active.",
        "Local Ollama was not reachable, so this fallback confirms the chat UI is working.",
        `Question received: "${question}"`,
        "Start Ollama to get live answers from the local model."
    ].join(" ");
}

async function sendMessage() {
    const question = elements.chatInput.value.trim();
    if (!question) {
        return;
    }

    appendChatMessage("user", `<strong>You:</strong><br>${escapeHtml(question)}`);
    elements.chatInput.value = "";

    const thinking = appendChatMessage("assistant", "<strong>AI Assistant:</strong><br>Thinking...", "thinking");

    try {
        const answer = await askOllama(question);
        thinking.innerHTML = `<strong>AI Assistant:</strong><br>${escapeHtml(answer).replaceAll("\n", "<br>")}`;
    } catch (error) {
        console.warn("Falling back to placeholder AI response", error);
        thinking.innerHTML = `<strong>AI Assistant:</strong><br>${escapeHtml(placeholderAnswer(question))}`;
    }

    thinking.id = "";
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function bindEvents() {
    elements.prevPageBtn.addEventListener("click", () => goToPage(state.currentPage - 1));
    elements.nextPageBtn.addEventListener("click", () => goToPage(state.currentPage + 1));
    elements.pageJumpSelect.addEventListener("change", (event) => goToPage(Number(event.target.value)));

    elements.chapterNav.addEventListener("click", (event) => {
        const target = event.target.closest("[data-page-index]");
        if (!target) {
            return;
        }
        goToPage(Number(target.dataset.pageIndex));
    });

    document.querySelectorAll(".chapter-btn").forEach((button) => {
        button.addEventListener("click", () => jumpToAudioChapter(button.dataset.audioKey));
    });

    elements.chatInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            sendMessage();
        }
    });
    elements.sendBtn.addEventListener("click", sendMessage);

    elements.audioPlayer.addEventListener("timeupdate", () => {
        state.audioPositions[state.activeAudioKey] = elements.audioPlayer.currentTime;
        saveState();
    });

    elements.audioPlayer.addEventListener("play", () => {
        state.wasPlaying = true;
        saveState();
    });

    elements.audioPlayer.addEventListener("pause", () => {
        state.wasPlaying = false;
        saveState();
    });

    window.addEventListener("keydown", handleKeyNavigation);
    window.addEventListener("beforeunload", saveState);
}

function cacheElements() {
    elements.bookContent = document.getElementById("bookContent");
    elements.chapterNav = document.getElementById("chapterNav");
    elements.currentSection = document.getElementById("currentSection");
    elements.audioChapterLabel = document.getElementById("audioChapterLabel");
    elements.resumeIndicator = document.getElementById("resumeIndicator");
    elements.progressPercent = document.getElementById("progressPercent");
    elements.progressDetail = document.getElementById("progressDetail");
    elements.progressFill = document.getElementById("progressFill");
    elements.prevPageBtn = document.getElementById("prevPageBtn");
    elements.nextPageBtn = document.getElementById("nextPageBtn");
    elements.pageJumpSelect = document.getElementById("pageJumpSelect");
    elements.pageIndicator = document.getElementById("pageIndicator");
    elements.audioPlayer = document.getElementById("audioPlayer");
    elements.audioMeta = document.getElementById("audioMeta");
    elements.readerMain = document.getElementById("readerMain");
    elements.chatMessages = document.getElementById("chatMessages");
    elements.chatInput = document.getElementById("chatInput");
    elements.sendBtn = document.getElementById("sendBtn");
}

async function initReader() {
    cacheElements();
    loadState();

    const bookHtml = typeof window.BOOK_HTML === "string" ? window.BOOK_HTML : "";
    if (!bookHtml) {
        throw new Error("BOOK_HTML was not available on window");
    }
    state.pages = assignAudioToPages(buildPagesFromHtml(bookHtml));

    if (!state.pages.length) {
        throw new Error("No pages were generated from book content");
    }

    buildChapterNavigation();
    state.currentPage = clampPage(state.currentPage);
    populatePageJump();

    if (state.resumeAvailable) {
        elements.resumeIndicator.hidden = false;
        elements.resumeIndicator.textContent = `Resume Reading: Page ${state.currentPage + 1}`;
    }

    bindEvents();
    renderPage(state.currentPage, { skipFade: true, forceAudioReload: true });
}

document.addEventListener("DOMContentLoaded", () => {
    initReader().catch((error) => {
        console.error("Reader initialization failed", error);
        cacheElements();
        showReaderError("The reader could not initialize. Check book-content.js and reader.js.");
    });
});

window.sendMessage = sendMessage;
