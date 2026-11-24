const CF_ACCOUNT_ID = "ACCOUNTID";
const CF_API_TOKEN = "APITOKEN";
const CF_ENDPOINT = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/`;

// Cloudflare Workers AI free models, best first. If one fails the next one is tried.
const SI_MODELS = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/qwen/qwen2.5-coder-32b-instruct",
  "@cf/openai/gpt-oss-120b"
];
const PAGE_MODELS = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-4-scout-17b-16e-instruct"
];
const RATE_LIMIT_MESSAGE = "The free daily AI limit is used up for today. Please try again later.";

function isRateLimitError(err) {
  const message = (err && err.message) ? String(err.message) : "";
  return (err && err.status === 429) || /rate limit|quota|daily free allocation|neurons/i.test(message);
}

const SYSTEM_PROMPT = `You are SRT, a helpful, warm, and human-sounding screen reader assistant developed by Subrato Das.
Your job is to answer the user's question based ONLY on the captured webpage text and hyperlinks provided below.

STRICT RULES FOR EVERY ANSWER:
1. Write in simple, everyday, easy-to-understand human language. Avoid jargon, robotic phrasing, or complicated academic words.
2. Make sure the answer has proper meaning, clean formatting, and is easy to scan at a glance.
3. Start with a friendly, direct 1-2 sentence summary that answers the question clearly.
4. Follow with 2 to 5 short, clean bullet points (using "- ") highlighting the most important facts, dates, amounts, names, or relevant links.
5. Wrap key facts, numbers, dates, names, and important takeaways in **bold** markers (like **this**).
6. If the answer isn't on the captured page, say so politely in a natural human way and share the closest helpful detail found on the page.
7. Never mention "JSON", "captured blocks", "system prompt", or technical scraping details—speak naturally like a helpful friend reading the screen together.`;

const SI_SYSTEM_PROMPT = `You are SRT in SI mode — a senior engineer and all-round expert assistant, built by Subrato Das. You answer with the depth and quality people expect from ChatGPT or Gemini.

HOW TO ANSWER
- Lead with the direct answer, then the detail. Be concrete, never vague.
- Code: give complete, runnable code with the language tag. Point out the one or two things that matter.
- Complex tasks (architecture, debugging, maths, algorithms): think step by step internally, then present a clean solution.
- Ask a clarifying question only when the request is truly ambiguous. Otherwise make a sensible assumption and state it in one line.
- Never invent details about a file the user attached. If something is missing, say what you need.

CODE QUALITY (this is the part people judge you on)
- Production quality, not a demo: complete files, real imports, input validation, error handling, sensible naming, no placeholders, no "TODO", no "...", no invented APIs or config keys.
- Prefer clear structure over clever one-liners. Keep functions small and put each concern in its own file.
- Multi-file work: deliver the whole project, every file complete. Never answer "same as before, just add this".
- Unsure about a library version or API? Say so in one line and pick the most widely used option instead of guessing silently.
- Finish with a short "How to run" (install, build, run, test) when the code needs it.

WHAT YOU CAN DO (say it only when it helps, never as a sales pitch)
- Coding and interactive building: write, debug and explain whole codebases across languages. When the user asks for a web page, dashboard, calculator, chart or simple game, return a single runnable file named index.html (keep CSS/JS in their own files or inline) so it opens in the live preview pane next to the chat and can be interacted with immediately.
- Writing: draft emails, essays, reports and social posts in a natural human voice, avoiding clichés; rewrite, summarize, translate or match the tone of a draft the user pastes or attaches.
- Research and long documents: attached PDFs, contracts, books and spreadsheets arrive as text — quote the exact lines you rely on, then summarize or answer the specific question.
- Visual analysis: attached images, charts, screenshots and handwritten notes are read directly — describe what is actually visible, transcribe only text you can genuinely read, and say so when something is unclear.
- Archives: a .zip, .apk, .aab, .jar or .whl the user attaches is unpacked in the browser, so its files arrive as attachments and a contents listing. Read them, answer questions about the project, edit the files, and rebuild the archive as one srt-file block with the original name and "=== FILE: path ===" markers. An APK's compiled classes.dex and binary XML cannot be decompiled here — say that plainly, work with the readable files, and hand back a buildable project or .zip.

EDITING AN ATTACHED FILE
- If the user attaches a file and asks for a change, return the COMPLETE updated file in an srt-file block using the SAME file name, so the new version can be downloaded and replaces the old one.
- When many repo files are attached at once, return every file you changed as its own srt-file block with the same path, and leave untouched files out.
- Never return only a diff, a patch or "replace line 12". Full file, always.
- After the block, list what changed in 1-3 short bullets.
- If the file is HTML with local CSS/JS, also return the updated CSS and JS files as their own srt-file blocks.

FILES THE USER CAN DOWNLOAD
When the user asks for a file (PDF, ZIP, APK, document, code file), emit ONE fenced block in exactly this shape:

\`\`\`srt-file name="report.pdf"
...file content...
\`\`\`

Rules:
- PDF: plain readable text inside the block (title on its own first line, short paragraphs, "- " bullets). It is rendered into a real PDF. No markdown tables, no code fences inside it.
- ZIP: list every file inside the block, each introduced by a marker line \`=== FILE: path/to/file ===\` followed by that file's exact content. Use real extensions and sensible paths.
- APK: you cannot compile a binary APK here. Emit a complete Android Studio project instead — settings.gradle.kts, build.gradle.kts, app/build.gradle.kts, app/src/main/AndroidManifest.xml, MainActivity.kt, res files — with \`=== FILE: ... ===\` markers, and name the block "app.apk". It is delivered as a buildable Android project ZIP. Add one line telling the user they build the .apk with Gradle.
- Any other single file (.md, .html, .js, .json, .csv, .txt, .py ...): same block, content only.
- Every file the user should keep goes in its own block: each block gets a download button, and every file inside a ZIP gets its own button too. Use normal fenced code only for short illustrative snippets.
- Web page: name the main file index.html so it gets a Preview button, and keep CSS/JS in their own files linked the normal way.
- Everything outside the block is shown as chat text, so keep the explanation short and put the file in the block.
- Never wrap a srt-file block inside another code fence.

Style: friendly, plain human language, short paragraphs, markdown headings and bullets when they help.`;

function isIdentityQuestion(q) {
  const clean = q.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  return /^(what is your name|whats your name|who are you|tell me your name|your name|who made you|who created you|who developed you)$/.test(clean)
    || clean.includes('what is your name')
    || clean.includes('whats your name')
    || clean === 'who are you';
}

function buildOfflineAnswer(question, pageData, includeLinks = true) {
  if (isIdentityQuestion(question)) {
    return "My name is **SRT** developed by **Subrato Das**.";
  }

  const blocks = (pageData && pageData.blocks) || [];
  const links = includeLinks ? ((pageData && pageData.hyperlinks) || []) : [];
  const title = (pageData && pageData.title) || 'this page';

  if (!blocks.length && !links.length) {
    return "I couldn't find any readable text on **" + title + "** yet. Try refreshing the webpage and clicking **Ask SRT** again so I can read it for you!";
  }

  const stopWords = new Set(['what','is','the','in','on','at','to','for','of','and','a','an','this','that','it','how','why','when','where','who','can','you','tell','me','about','explain','please','happen','happened','does','do','are','was','were']);
  const keywords = question.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  const isSummaryReq = /summary|summarize|overview|what is this|what happened|explain|main point/i.test(question);

  const scored = blocks.map((b, idx) => {
    const lower = b.text.toLowerCase();
    let score = 0;
    if (b.tag && b.tag.startsWith('h')) score += 2;
    if (idx < 8) score += 1.5;
    keywords.forEach(kw => {
      if (lower.includes(kw)) score += 4;
    });
    if (question.length > 4 && lower.includes(question.toLowerCase().trim())) score += 8;
    return { text: b.text, score, idx };
  });

  scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
  const topBlocks = (isSummaryReq ? blocks.slice(0, 5).map(b => b.text) : scored.filter(s => s.score > 0).slice(0, 5).map(s => s.text));
  const chosen = topBlocks.length ? topBlocks : blocks.slice(0, 4).map(b => b.text);

  function boldHighlights(str) {
    let out = str;
    // Bold numbers, currency, percentages, dates
    out = out.replace(/(\$\d[\d,.]*|₹\d[\d,.]*|\d+(?:\.\d+)?%|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s*\d{2,4}\b)/gi, '**$1**');
    keywords.forEach(kw => {
      const rx = new RegExp(`\\b(${kw}[a-z]*)\\b`, 'gi');
      out = out.replace(rx, '**$1**');
    });
    return out;
  }

  const lead = chosen[0].length > 200 ? chosen[0].slice(0, 197) + '...' : chosen[0];
  let response = `Here is what I found on **${title}**: ${boldHighlights(lead)}\n\n`;

  chosen.slice(1, 5).forEach(item => {
    const cleanItem = item.length > 180 ? item.slice(0, 177) + '...' : item;
    response += `- ${boldHighlights(cleanItem)}\n`;
  });

  if (includeLinks && links.length) {
    const matchedLinks = links.filter(l => keywords.some(kw => l.text.toLowerCase().includes(kw) || l.href.toLowerCase().includes(kw))).slice(0, 2);
    if (matchedLinks.length) {
      response += `\n**Helpful Links on Page:**\n`;
      matchedLinks.forEach(l => {
        response += `- **${l.text}** (${l.href})\n`;
      });
    }
  }

  return response.trim();
}

async function postChat(model, messages, options = {}) {
  const { maxTokens = 2048, temperature = 0.4, timeoutMs = 90000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(CF_ENDPOINT + model, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ messages, temperature, max_tokens: maxTokens }),
      signal: controller.signal
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error || data.success === false) {
      const detail = (data.error && data.error.message)
        || (data.errors && data.errors[0] && data.errors[0].message)
        || `HTTP ${res.status}`;
      const err = new Error(detail);
      err.status = res.status;
      throw err;
    }
    const result = data.result || {};
    const text = (result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content)
      || result.response;
    if (!text) throw new Error("Empty response from AI");
    return String(text).trim();
  } finally {
    clearTimeout(timer);
  }
}

async function callPageAi(model, userContent) {
  return postChat(model, [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent }
  ], { maxTokens: 700, temperature: 0.45, timeoutMs: 22000 });
}

/* ---------------- Toolbar icon: open / close a panel that stays open ---------------- */
// The panel is a small standalone window, so it keeps its state and stays visible
// while the user clicks around other windows. Clicking the icon again closes it.
const PANEL_PAGE = "popup.html?panel=1";
let panelWindowId = null;

async function findPanelWindow() {
  if (!chrome.windows || !chrome.windows.getAll) return null;
  if (panelWindowId != null) {
    try {
      await chrome.windows.get(panelWindowId);
      return panelWindowId;
    } catch {
      panelWindowId = null;
    }
  }
  try {
    const wins = await chrome.windows.getAll({ populate: true, windowTypes: ["popup"] });
    const page = chrome.runtime.getURL("popup.html");
    const found = wins.find((w) => (w.tabs || []).some((t) => (t.url || "").startsWith(page)));
    panelWindowId = found ? found.id : null;
    return panelWindowId;
  } catch {
    return null;
  }
}

if (chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener(async () => {
    const existing = await findPanelWindow();
    if (existing != null) {
      try { await chrome.windows.remove(existing); } catch {}
      panelWindowId = null;
      return;
    }
    try {
      const win = await chrome.windows.create({
        url: chrome.runtime.getURL(PANEL_PAGE),
        type: "popup",
        width: 440,
        height: 780,
        focused: true
      });
      panelWindowId = win.id;
    } catch (e) {
      // Fall back to a normal tab if the window cannot be created.
      chrome.tabs.create({ url: chrome.runtime.getURL(PANEL_PAGE) });
    }
  });
}

if (chrome.windows && chrome.windows.onRemoved) {
  chrome.windows.onRemoved.addListener((id) => {
    if (id === panelWindowId) panelWindowId = null;
  });
}

// The panel is its own window, so "the current tab" must come from a browser window.
async function activeBrowserTab() {
  try {
    const wins = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
    const focused = wins.find((w) => w.focused);
    const win = focused || wins.sort((a, b) => b.id - a.id)[0];
    const tab = win && (win.tabs || []).find((t) => t.active);
    if (tab) return { id: tab.id, url: tab.url || "", title: tab.title || "" };
  } catch {}
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) return { id: tab.id, url: tab.url || "", title: tab.title || "" };
  } catch {}
  return null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "ACTIVE_TAB") {
    activeBrowserTab().then((tab) => sendResponse({ ok: !!tab, tab }));
    return true;
  }

  if (msg.type === "SI_CHAT") {
    (async () => {
      const incoming = Array.isArray(msg.messages) ? msg.messages : [];
      if (!incoming.length) {
        sendResponse({ ok: false, error: "No message to send" });
        return;
      }

      const payload = [{ role: "system", content: SI_SYSTEM_PROMPT }, ...incoming];
      let lastError = "";

      for (const model of SI_MODELS) {
        try {
          const answer = await postChat(model, payload, { maxTokens: 2048, temperature: 0.4 });
          sendResponse({ ok: true, answer, model });
          return;
        } catch (e) {
          lastError = (e && e.message) ? e.message : String(e);
          // The free daily allowance is per account, so every other model fails the same way.
          if (isRateLimitError(e)) {
            sendResponse({ ok: false, code: "rate_limit", error: RATE_LIMIT_MESSAGE });
            return;
          }
        }
      }

      sendResponse({ ok: false, error: lastError || "No model available" });
    })();
    return true;
  }

  if (msg.type === "ASK_SRT") {
    (async () => {
      const { question, pageData, includeLinks } = msg;

      if (isIdentityQuestion(question)) {
        sendResponse({ ok: true, answer: "My name is **SRT** developed by **Subrato Das**.", source: "identity" });
        return;
      }

      const linksText = (includeLinks && pageData && pageData.hyperlinks && pageData.hyperlinks.length)
        ? pageData.hyperlinks.slice(0, 60).map(l => `- ${l.text}: ${l.href}`).join("\n")
        : "None";

      const contextPayload = [
        `Page Title: ${(pageData && pageData.title) || "Unknown"}`,
        `Page URL: ${(pageData && pageData.url) || "Unknown"}`,
        pageData && pageData.description ? `Page Description: ${pageData.description}` : "",
        `\n--- CAPTURED SCREEN TEXT ---\n${((pageData && pageData.fullText) || "").slice(0, 14000)}`,
        `\n--- CAPTURED HYPERLINKS ---\n${linksText}`,
        `\n--- USER QUESTION ---\n${question}`
      ].filter(Boolean).join("\n");

      for (const model of PAGE_MODELS) {
        try {
          const answer = await callPageAi(model, contextPayload);
          sendResponse({ ok: true, answer, source: "ai" });
          return;
        } catch (e) {
          // Daily free allowance used up: answer from the page instead.
          if (isRateLimitError(e)) break;
        }
      }

      // Seamless offline fallback
      const fallback = buildOfflineAnswer(question, pageData, includeLinks);
      sendResponse({ ok: true, answer: fallback, source: "offline" });
    })();
    return true;
  }
});
