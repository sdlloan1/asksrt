/* Ask SRT — local file generation (no servers, everything in the browser) */
(function () {
  const encoder = new TextEncoder();

  /* ---------------- CRC32 (for ZIP) ---------------- */
  let crcTable = null;
  function makeCrcTable() {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    return table;
  }
  function crc32(bytes) {
    if (!crcTable) crcTable = makeCrcTable();
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(d) {
    const date = d || new Date();
    return {
      time: ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31),
      date: (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31)
    };
  }

  function safePath(p) {
    return String(p || 'file.txt')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\.\.\//g, '')
      .replace(/[<>:"|?*]/g, '_')
      .slice(0, 180) || 'file.txt';
  }

  /* ---------------- ZIP (store, UTF-8 names) ---------------- */
  function createZip(files) {
    const parts = [];
    const central = [];
    const stamp = dosDateTime();
    let offset = 0;

    (files || []).forEach((file) => {
      const nameBytes = encoder.encode(safePath(file.path));
      const data = typeof file.content === 'string' ? encoder.encode(file.content) : new Uint8Array(file.content);
      const crc = crc32(data);

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, stamp.time, true);
      lv.setUint16(12, stamp.date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      const cd = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, stamp.time, true);
      cv.setUint16(14, stamp.date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);
      cd.set(nameBytes, 46);

      parts.push(local, data);
      central.push(cd);
      offset += local.length + data.length;
    });

    const centralSize = central.reduce((sum, c) => sum + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }

  /* ---------------- PDF writer ---------------- */
  function escapePdfText(str) {
    return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  function wrapText(line, maxChars) {
    if (line.length <= maxChars) return [line];
    const words = line.split(' ');
    const out = [];
    let current = '';
    for (const word of words) {
      if (word.length > maxChars) {
        if (current) { out.push(current); current = ''; }
        for (let i = 0; i < word.length; i += maxChars) out.push(word.slice(i, i + maxChars));
        continue;
      }
      const next = current ? current + ' ' + word : word;
      if (next.length <= maxChars) current = next;
      else { out.push(current); current = word; }
    }
    if (current) out.push(current);
    return out;
  }

  function buildPageContent(lines, pageNo, totalPages, titleLines, layout) {
    const { margin, leading, fontSize } = layout;
    const parts = ['BT'];
    let y = layout.pageHeight - margin;

    if (pageNo === 1 && titleLines.length) {
      titleLines.forEach((titleLine) => {
        parts.push('/F2 17 Tf', `1 0 0 1 ${margin} ${y} Tm`, `(${escapePdfText(titleLine)}) Tj`);
        y -= 22;
      });
      y -= 8;
    }

    parts.push(`/F1 ${fontSize} Tf`);
    lines.forEach((line) => {
      if (line) parts.push(`1 0 0 1 ${margin} ${y} Tm`, `(${escapePdfText(line)}) Tj`);
      y -= leading;
    });

    parts.push('/F1 8 Tf', `1 0 0 1 ${margin} ${margin - 18} Tm`, `(${escapePdfText(`Page ${pageNo} of ${totalPages}`)}) Tj`);
    parts.push('ET');
    return parts.join('\n') + '\n';
  }

  function createPdf(rawText, title) {
    const layout = { pageWidth: 595.28, pageHeight: 841.89, margin: 50, fontSize: 11, leading: 15, maxChars: 88 };
    const usable = layout.pageHeight - layout.margin * 2;

    const clean = String(rawText || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\t/g, '    ')
      .replace(/[^\x20-\xFF\n]/g, '?');

    const lines = [];
    clean.split('\n').forEach((line) => {
      if (!line.trim()) { lines.push(''); return; }
      lines.push(...wrapText(line, layout.maxChars));
    });
    if (!lines.length) lines.push('');

    const titleLines = title
      ? wrapText(String(title).replace(/[^\x20-\xFF]/g, '?'), 58)
      : [];
    const headerSpace = titleLines.length ? titleLines.length * 22 + 8 : 0;
    const firstCapacity = Math.max(1, Math.floor((usable - headerSpace) / layout.leading));
    const capacity = Math.max(1, Math.floor(usable / layout.leading));

    const pages = [];
    let cursor = 0;
    pages.push(lines.slice(cursor, cursor + firstCapacity));
    cursor += firstCapacity;
    while (cursor < lines.length) {
      pages.push(lines.slice(cursor, cursor + capacity));
      cursor += capacity;
    }

    const pageObjNums = [];
    const contentObjNums = [];
    let nextNum = 5;
    pages.forEach(() => {
      pageObjNums.push(nextNum++);
      contentObjNums.push(nextNum++);
    });

    const objects = [];
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[2] = `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`;
    objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

    pages.forEach((pageLines, i) => {
      const content = buildPageContent(pageLines, i + 1, pages.length, i === 0 ? titleLines : [], layout);
      objects[pageObjNums[i]] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${layout.pageWidth} ${layout.pageHeight}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjNums[i]} 0 R >>`;
      objects[contentObjNums[i]] = `<< /Length ${content.length} >>\nstream\n${content}endstream`;
    });

    let out = '%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n';
    const offsets = [];
    for (let n = 1; n < objects.length; n++) {
      offsets[n] = out.length;
      out += `${n} 0 obj\n${objects[n]}\nendobj\n`;
    }
    const xrefStart = out.length;
    const size = objects.length;
    out += `xref\n0 ${size}\n0000000000 65535 f \n`;
    for (let n = 1; n < size; n++) out += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return new Blob([bytes], { type: 'application/pdf' });
  }

  /* ---------------- Parsing helpers ---------------- */
  function parseFileSections(body) {
    const text = String(body || '').replace(/\r\n?/g, '\n');
    const marker = /^===\s*FILE:\s*(.+?)\s*===\s*$/gm;
    const matches = [...text.matchAll(marker)];
    if (!matches.length) {
      return [{ path: 'content.txt', content: text.trim() + '\n' }];
    }
    return matches.map((match, i) => {
      const start = match.index + match[0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
      return {
        path: match[1].trim(),
        content: text.slice(start, end).replace(/^\n/, '').replace(/\n+$/, '\n')
      };
    });
  }

  /* ---------------- PDF text extraction (best effort) ---------------- */
  function bytesToLatin1(bytes) {
    let out = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return out;
  }

  async function inflate(bytes, format) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function decodeTextBytes(latin1) {
    const bytes = new Uint8Array(latin1.length);
    for (let i = 0; i < latin1.length; i++) bytes[i] = latin1.charCodeAt(i) & 0xff;
    try {
      return new TextDecoder('windows-1252').decode(bytes);
    } catch {
      return latin1;
    }
  }

  function unescapePdfString(str) {
    return str.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (full, code) => {
      switch (code) {
        case 'n': return '\n';
        case 'r': return '\r';
        case 't': return '\t';
        case 'b': return '\b';
        case 'f': return '\f';
        case '(': return '(';
        case ')': return ')';
        case '\\': return '\\';
        default: return String.fromCharCode(parseInt(code, 8));
      }
    });
  }

  function textFromContent(content) {
    let text = '';
    const blocks = content.match(/BT[\s\S]*?ET/g) || [];
    blocks.forEach((block) => {
      const strings = block.match(/\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>/g) || [];
      strings.forEach((token) => {
        if (token.startsWith('(')) {
          text += unescapePdfString(token.slice(1, -1));
        } else {
          const hex = token.slice(1, -1).replace(/\s+/g, '');
          for (let i = 0; i + 1 < hex.length; i += 2) text += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
        }
      });
      text += '\n';
    });
    return text;
  }

  async function extractPdfText(arrayBuffer) {
    try {
      const bytes = new Uint8Array(arrayBuffer);
      const raw = bytesToLatin1(bytes);
      const streamRe = /stream\r?\n/g;
      let match;
      let collected = '';

      while ((match = streamRe.exec(raw))) {
        const start = match.index + match[0].length;
        const end = raw.indexOf('endstream', start);
        if (end === -1) break;
        const headerStart = Math.max(0, match.index - 400);
        const dict = raw.slice(headerStart, match.index);
        let chunk = bytes.subarray(start, end);

        if (/\/FlateDecode/.test(dict)) {
          try {
            chunk = await inflate(chunk, 'deflate');
          } catch {
            try {
              chunk = await inflate(chunk, 'deflate-raw');
            } catch {
              continue;
            }
          }
        } else if (/\/Filter/.test(dict) && !/\/FlateDecode/.test(dict)) {
          continue;
        }

        const content = bytesToLatin1(chunk);
        if (/\bBT\b/.test(content)) collected += textFromContent(content);
        streamRe.lastIndex = end;
      }

      const text = decodeTextBytes(collected)
        .replace(/\u0000/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      return text.length >= 20 ? text.slice(0, 40000) : '';
    } catch {
      return '';
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'srt-file';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /* ---------------- Code blocks → downloadable files ---------------- */
  const LANG_EXT = {
    js: 'js', javascript: 'js', jsx: 'jsx', ts: 'ts', typescript: 'ts', tsx: 'tsx',
    py: 'py', python: 'py', java: 'java', kt: 'kt', kotlin: 'kt', go: 'go', rs: 'rs', rust: 'rs',
    rb: 'rb', ruby: 'rb', php: 'php', c: 'c', h: 'h', cpp: 'cpp', cs: 'cs', swift: 'swift',
    dart: 'dart', html: 'html', htm: 'html', css: 'css', scss: 'scss', json: 'json',
    md: 'md', markdown: 'md', sh: 'sh', bash: 'sh', zsh: 'sh', sql: 'sql',
    yml: 'yml', yaml: 'yaml', xml: 'xml', txt: 'txt', text: 'txt'
  };

  function codeFilename(lang, index) {
    const ext = LANG_EXT[String(lang || '').toLowerCase()] || 'txt';
    const base = ext === 'html' ? 'preview' : 'snippet';
    return `${base}-${(index || 0) + 1}.${ext}`;
  }

  function downloadText(name, text) {
    downloadBlob(new Blob([String(text)], { type: 'text/plain;charset=utf-8' }), name || 'file.txt');
  }

  /* ---------------- Preview (HTML with local CSS/JS inlined) ---------------- */
  function buildPreviewHtml(entries) {
    const list = (entries || []).filter((f) => f && typeof f.content === 'string');
    const page = list.find((f) => /\.html?$/i.test(f.path)) || list[0];
    if (!page) return '';
    const byName = (name) => {
      const clean = String(name).replace(/^\.?\//, '');
      return list.find((f) => f.path === clean || f.path.endsWith('/' + clean));
    };
    return String(page.content)
      .replace(/<link[^>]+href=["']([^"']+\.css)["'][^>]*>/gi, (full, href) => {
        const file = byName(href);
        return file ? `<style>\n${file.content}\n</style>` : full;
      })
      .replace(/<script[^>]+src=["']([^"']+\.m?js)["'][^>]*>\s*<\/script>/gi, (full, src) => {
        const file = byName(src);
        return file ? `<script>\n${file.content}\n</script>` : full;
      });
  }

  function openPreview(entries) {
    const html = buildPreviewHtml(entries);
    if (!html) return false;
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  }

  /* ---------------- ZIP reader (for uploading a project) ---------------- */
  async function readZip(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(bytes.buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 66000; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a valid ZIP file');

    const count = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const entries = [];

    for (let i = 0; i < count; i++) {
      if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) break;
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const nameLen = view.getUint16(offset + 28, true);
      const extraLen = view.getUint16(offset + 30, true);
      const commentLen = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
      offset += 46 + nameLen + extraLen + commentLen;
      if (name.endsWith('/')) continue;

      const localNameLen = view.getUint16(localOffset + 26, true);
      const localExtraLen = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localNameLen + localExtraLen;
      const raw = bytes.subarray(start, start + compressedSize);
      let content;
      if (method === 0) content = raw;
      else if (method === 8) {
        try { content = await inflate(raw, 'deflate-raw'); } catch { continue; }
      } else continue;

      entries.push({ path: name.replace(/^\/+/, ''), bytes: content });
    }
    return entries;
  }

  window.SRTFiles = {
    createPdf,
    createZip,
    parseFileSections,
    extractPdfText,
    downloadBlob,
    downloadText,
    codeFilename,
    buildPreviewHtml,
    openPreview,
    readZip
  };
})();
