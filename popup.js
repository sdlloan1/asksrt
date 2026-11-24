let currentPageData = null;
let currentChatId = null;
let currentMessages = [];
let prefs = {
  theme: 'light',
  autoSpeak: false,
  includeLinks: true
};

const answersContainer = document.getElementById('answersContainer');
const emptyState = document.getElementById('emptyState');
const questionInput = document.getElementById('questionInput');
const askBtn = document.getElementById('askBtn');
const captureStatus = document.getElementById('captureStatus');
const pageTitleEl = document.getElementById('pageTitle');
const pageStatsEl = document.getElementById('pageStats');
const themeBtn = document.getElementById('themeBtn');
const newChatBtn = document.getElementById('newChatBtn');
const historyBtn = document.getElementById('historyBtn');
const settingsBtn = document.getElementById('settingsBtn');
const historyView = document.getElementById('historyView');
const settingsView = document.getElementById('settingsView');
const historyList = document.getElementById('historyList');
const autoSpeakToggle = document.getElementById('autoSpeakToggle');
const includeLinksToggle = document.getElementById('includeLinksToggle');
const settingsFeedback = document.getElementById('settingsFeedback');

function applyTheme(theme) {
  prefs.theme = theme === 'dark' ? 'dark' : 'light';
  document.body.classList.remove('light', 'dark');
  document.body.classList.add(prefs.theme);
  themeBtn.textContent = prefs.theme === 'dark' ? '☀️' : '🌙';
}

// The toolbar icon opens this page as a standalone window, so it must fill that window.
if (new URLSearchParams(location.search).get('panel') === '1') {
  document.body.classList.add('panel-mode');
}

/* ---------------- Unsent text survives closing the panel or reloading ---------------- */
const DRAFT_KEY = 'srtDraft';
let draftTimer = null;

function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(flushDraft, 200);
}

function flushDraft() {
  clearTimeout(draftTimer);
  chrome.storage.local.set({
    [DRAFT_KEY]: {
      text: questionInput.value,
      si: !!(window.srtSi && window.srtSi.active())
    }
  }).catch(() => {});
}

function clearDraft() {
  clearTimeout(draftTimer);
  chrome.storage.local.remove([DRAFT_KEY]).catch(() => {});
}

window.srtClearDraft = clearDraft;
window.addEventListener('pagehide', () => {
  if (questionInput.value.trim()) flushDraft();
});

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatAnswerHtml(rawText) {
  const safe = escapeHtml(rawText || '');
  const lines = safe.split(/\n/);
  let html = '';
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
      continue;
    }
    const formatted = trimmed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    if (/^[-*•]\s+/.test(formatted)) {
      if (!inList) {
        html += '<ul>';
        inList = true;
      }
      html += `<li>${formatted.replace(/^[-*•]\s+/, '')}</li>`;
    } else {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
      html += `<p>${formatted}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html;
}

function speakText(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const clean = text.replace(/\*\*/g, '').replace(/[#*_`>-]/g, ' ');
  const utter = new SpeechSynthesisUtterance(clean);
  utter.rate = 1.0;
  utter.pitch = 1.03;
  const voices = window.speechSynthesis.getVoices();
  const natural = voices.find(v => /Natural|Neural|Google US English|Microsoft Aria|Samantha/i.test(v.name) && v.lang.startsWith('en'));
  if (natural) utter.voice = natural;
  window.speechSynthesis.speak(utter);
}

function renderMessages() {
  answersContainer.innerHTML = '';
  if (!currentMessages.length) {
    answersContainer.appendChild(emptyState);
    return;
  }

  // Render newest answer at the TOP
  const reversed = [...currentMessages].reverse();
  reversed.forEach((msg, index) => {
    const card = document.createElement('div');
    card.className = 'qa-card' + (index === 0 ? ' latest' : '');
    card.innerHTML = `
      <div class="qa-question-row">
        <span class="qa-question">Q: ${escapeHtml(msg.question)}</span>
        ${index === 0 ? '<span class="latest-badge">Latest</span>' : ''}
      </div>
      <div class="qa-answer">${formatAnswerHtml(msg.answer)}</div>
      <div class="qa-actions">
        <button class="mini-btn listen-btn">🔊 Listen</button>
        <button class="mini-btn copy-btn">📋 Copy</button>
      </div>
    `;
    card.querySelector('.listen-btn').addEventListener('click', () => speakText(msg.answer));
    card.querySelector('.copy-btn').addEventListener('click', (e) => {
      navigator.clipboard.writeText(msg.answer.replace(/\*\*/g, ''));
      e.target.textContent = '✓ Copied';
      setTimeout(() => { e.target.textContent = '📋 Copy'; }, 1400);
    });
    answersContainer.appendChild(card);
  });

  // Keep scroll at the very top so latest answer is immediately visible
  answersContainer.scrollTop = 0;
}

function showThinkingAnimation() {
  if (emptyState.parentNode === answersContainer) {
    emptyState.remove();
  }
  const existing = document.getElementById('thinkingCard');
  if (existing) existing.remove();

  const card = document.createElement('div');
  card.id = 'thinkingCard';
  card.className = 'thinking-card';
  card.innerHTML = `
    <div class="orb-wrap">
      <div class="orb-ring"></div>
      <div class="orb-core"></div>
    </div>
    <div class="thinking-text">
      <strong>SRT is thinking...</strong>
      <span id="thinkingStep">Reading captured screen text &amp; links...</span>
    </div>
  `;
  answersContainer.prepend(card);
  answersContainer.scrollTop = 0;

  setTimeout(() => {
    const step = document.getElementById('thinkingStep');
    if (step) step.textContent = 'Writing a simple, human answer...';
  }, 1100);
}

function removeThinkingAnimation() {
  const existing = document.getElementById('thinkingCard');
  if (existing) existing.remove();
}

async function saveChatToHistory() {
  if (!currentMessages.length) return;
  const store = await chrome.storage.local.get(['chatHistory']);
  let history = store.chatHistory || [];
  const chatTitle = currentMessages[0].question.slice(0, 60);
  const pageTitle = (currentPageData && currentPageData.title) || 'Webpage';

  const existingIdx = history.findIndex(c => c.id === currentChatId);
  const entry = {
    id: currentChatId,
    title: chatTitle,
    pageTitle,
    updatedAt: new Date().toISOString(),
    messages: currentMessages
  };

  if (existingIdx >= 0) {
    history[existingIdx] = entry;
  } else {
    history.unshift(entry);
  }
  history = history.slice(0, 50);
  await chrome.storage.local.set({ chatHistory: history });
}

async function handleAsk(customPrompt) {
  if (window.srtSi && window.srtSi.active()) {
    return window.srtSi.send(customPrompt);
  }
  const q = (typeof customPrompt === 'string' ? customPrompt : questionInput.value).trim();
  if (!q) return;

  questionInput.value = '';
  questionInput.style.height = 'auto';
  clearDraft();
  askBtn.disabled = true;
  showThinkingAnimation();

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'ASK_SRT',
      question: q,
      pageData: currentPageData,
      includeLinks: prefs.includeLinks
    });

    removeThinkingAnimation();
    const answerText = (response && response.answer) || "Sorry, I couldn't read an answer right now. Please try asking again!";
    currentMessages.push({
      question: q,
      answer: answerText,
      timestamp: new Date().toISOString()
    });
    renderMessages();
    await saveChatToHistory();

    if (prefs.autoSpeak) {
      speakText(answerText);
    }
  } catch (err) {
    removeThinkingAnimation();
    currentMessages.push({
      question: q,
      answer: "Something interrupted the scan. Please try asking your question once more!",
      timestamp: new Date().toISOString()
    });
    renderMessages();
  } finally {
    askBtn.disabled = false;
    questionInput.focus();
  }
}

async function resolveActiveTab() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'ACTIVE_TAB' });
    if (res && res.ok && res.tab && res.tab.id) return res.tab;
  } catch {}
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch {
    return null;
  }
}

async function captureActiveScreen() {
  captureStatus.textContent = 'Scanning screen...';
  try {
    const tab = await resolveActiveTab();
    if (!tab || !tab.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
      captureStatus.textContent = 'Protected page';
      pageTitleEl.textContent = (tab && tab.title) || 'Browser system page';
      pageStatsEl.textContent = '0 words • 0 links';
      currentPageData = { title: pageTitleEl.textContent, url: (tab && tab.url) || '', blocks: [], hyperlinks: [], fullText: '' };
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    const data = results && results[0] && results[0].result;
    if (data) {
      currentPageData = data;
      const wordCount = data.fullText ? data.fullText.split(/\s+/).filter(Boolean).length : 0;
      const linkCount = data.hyperlinks ? data.hyperlinks.length : 0;
      captureStatus.textContent = 'Captured';
      pageTitleEl.textContent = data.title || data.url;
      pageTitleEl.title = data.title || data.url;
      pageStatsEl.textContent = `${wordCount} words • ${linkCount} links`;

      const store = await chrome.storage.local.get(['capturedPages']);
      const capturedPages = store.capturedPages || {};
      capturedPages[data.url] = data;
      await chrome.storage.local.set({ capturedPages });
    }
  } catch (e) {
    captureStatus.textContent = 'Ready';
    pageTitleEl.textContent = 'Current screen';
  }
}

function startNewChat() {
  if (window.srtSi && window.srtSi.active()) {
    return window.srtSi.newChat();
  }
  window.speechSynthesis && window.speechSynthesis.cancel();
  currentChatId = 'chat_' + Date.now();
  currentMessages = [];
  historyView.classList.add('hidden');
  settingsView.classList.add('hidden');
  renderMessages();
  questionInput.focus();
}

async function openHistoryDrawer() {
  settingsView.classList.add('hidden');
  historyView.classList.remove('hidden');
  const store = await chrome.storage.local.get(['chatHistory']);
  const history = store.chatHistory || [];
  historyList.innerHTML = '';

  if (!history.length) {
    historyList.innerHTML = '<p style="text-align:center;color:var(--text-muted);font-size:13px;margin-top:24px;">No saved chats yet. Ask a question to start!</p>';
    return;
  }

  history.forEach(item => {
    const row = document.createElement('div');
    row.className = 'history-item';
    const count = (item.messages && item.messages.length) || 0;
    const isSi = item.mode === 'si';
    row.innerHTML = `
      <div class="history-info">
        <strong>${escapeHtml(item.title)}</strong>
        <small>${isSi ? 'SI chat' : escapeHtml(item.pageTitle)} • ${count} ${isSi ? 'messages' : 'Q&amp;A'}</small>
      </div>
      <button class="del-chat-btn" title="Delete Chat">🗑️</button>
    `;
    row.querySelector('.history-info').addEventListener('click', () => {
      if (isSi && window.srtSi) {
        window.srtSi.loadChat(item);
        return;
      }
      currentChatId = item.id;
      currentMessages = [...(item.messages || [])];
      historyView.classList.add('hidden');
      renderMessages();
    });
    row.querySelector('.del-chat-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const updated = history.filter(c => c.id !== item.id);
      await chrome.storage.local.set({ chatHistory: updated });
      if (currentChatId === item.id) {
        startNewChat();
      }
      openHistoryDrawer();
    });
    historyList.appendChild(row);
  });
}

// Event Listeners
themeBtn.addEventListener('click', async () => {
  const next = prefs.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
  await chrome.storage.local.set({ srtPrefs: prefs });
});

newChatBtn.addEventListener('click', startNewChat);
historyBtn.addEventListener('click', openHistoryDrawer);
document.getElementById('closeHistoryBtn').addEventListener('click', () => historyView.classList.add('hidden'));

document.getElementById('clearAllHistoryBtn').addEventListener('click', async () => {
  await chrome.storage.local.set({ chatHistory: [] });
  startNewChat();
  openHistoryDrawer();
});

settingsBtn.addEventListener('click', () => {
  historyView.classList.add('hidden');
  settingsView.classList.remove('hidden');
  settingsFeedback.textContent = '';
});
document.getElementById('closeSettingsBtn').addEventListener('click', () => settingsView.classList.add('hidden'));

autoSpeakToggle.addEventListener('change', async () => {
  prefs.autoSpeak = autoSpeakToggle.checked;
  await chrome.storage.local.set({ srtPrefs: prefs });
});

includeLinksToggle.addEventListener('change', async () => {
  prefs.includeLinks = includeLinksToggle.checked;
  await chrome.storage.local.set({ srtPrefs: prefs });
});

document.getElementById('rescanBtn').addEventListener('click', async () => {
  settingsView.classList.add('hidden');
  await captureActiveScreen();
});

document.getElementById('clearCacheBtn').addEventListener('click', async () => {
  await chrome.storage.local.remove(['capturedPages']);
  settingsFeedback.textContent = 'Stored page cache cleared!';
});

askBtn.addEventListener('click', () => handleAsk());

questionInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleAsk();
  }
});

questionInput.addEventListener('input', () => {
  questionInput.style.height = 'auto';
  questionInput.style.height = Math.min(questionInput.scrollHeight, 84) + 'px';
  saveDraft();
});

document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => handleAsk(chip.getAttribute('data-q')));
});

// Init on popup open: load prefs, capture screen silently, DO NOT auto-answer
(async function init() {
  const store = await chrome.storage.local.get(['srtPrefs', 'srtDraft']);
  if (store.srtPrefs) {
    prefs = { ...prefs, ...store.srtPrefs };
  }
  applyTheme(prefs.theme);
  autoSpeakToggle.checked = !!prefs.autoSpeak;
  includeLinksToggle.checked = prefs.includeLinks !== false;
  currentChatId = 'chat_' + Date.now();
  if (store.srtDraft && store.srtDraft.text) {
    questionInput.value = store.srtDraft.text;
    questionInput.style.height = 'auto';
    questionInput.style.height = Math.min(questionInput.scrollHeight, 84) + 'px';
  }
  await captureActiveScreen();
})();
