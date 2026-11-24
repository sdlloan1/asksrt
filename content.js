(() => {
  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function extractPageData() {
    const title = document.title || '';
    const url = window.location.href || '';
    const metaDescEl = document.querySelector('meta[name="description"]');
    const description = metaDescEl ? (metaDescEl.getAttribute('content') || '').trim() : '';

    const seenTexts = new Set();
    const blocks = [];

    const selectors = 'h1, h2, h3, h4, h5, h6, p, li, td, th, blockquote, pre, article, section, label, span, div';
    const elements = document.querySelectorAll(selectors);

    elements.forEach((el) => {
      if (!isVisible(el)) return;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IFRAME'].includes(el.tagName)) return;

      // Prefer leaf-ish text containers to avoid huge duplicate parent dumps
      const childBlocks = el.querySelectorAll('p, li, td, th, h1, h2, h3, h4, h5, h6, div, section, article');
      if (childBlocks.length > 2 && !['P', 'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4'].includes(el.tagName)) {
        return;
      }

      const raw = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (!raw || raw.length < 3 || raw.length > 1200) return;
      if (seenTexts.has(raw)) return;
      seenTexts.add(raw);

      const tag = el.tagName.toLowerCase();
      blocks.push({ tag, text: raw });
    });

    // Fallback to body innerText lines if structured extraction was sparse
    if (blocks.length < 5 && document.body) {
      const lines = (document.body.innerText || '').split(/\n+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
      lines.forEach(line => {
        if (line.length >= 3 && !seenTexts.has(line)) {
          seenTexts.add(line);
          blocks.push({ tag: 'p', text: line });
        }
      });
    }

    const linkMap = new Map();
    document.querySelectorAll('a[href]').forEach((a) => {
      if (!isVisible(a)) return;
      const href = a.href;
      if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      const text = (a.innerText || a.getAttribute('aria-label') || a.title || '').replace(/\s+/g, ' ').trim();
      const key = `${text}|${href}`;
      if (!linkMap.has(key)) {
        linkMap.set(key, { text: text || href, href });
      }
    });

    const hyperlinks = Array.from(linkMap.values()).slice(0, 200);
    const fullText = blocks.map(b => b.text).join('\n').slice(0, 24000);

    return {
      title,
      url,
      description,
      blocks: blocks.slice(0, 300),
      hyperlinks,
      fullText,
      capturedAt: new Date().toISOString()
    };
  }

  return extractPageData();
})();
