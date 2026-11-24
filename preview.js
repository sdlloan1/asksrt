/* Ask SRT — live artifact preview pane: renders a generated web page next to the chat */
(function () {
  const el = {};
  let current = null;

  function $(id) { return document.getElementById(id); }

  function show(entries) {
    const list = entries || [];
    const html = window.SRTFiles.buildPreviewHtml(list);
    if (!html) return false;
    const page = list.find((f) => /\.html?$/i.test(f.path)) || list[0];
    current = { entries: list, html, name: (page && page.path) || 'preview.html' };
    el.title.textContent = current.name;
    el.frame.srcdoc = html;
    el.pane.classList.remove('hidden');
    if (el.shell) el.shell.classList.add('preview-open');
    return true;
  }

  function close() {
    if (!el.pane) return;
    el.pane.classList.add('hidden');
    if (el.shell) el.shell.classList.remove('preview-open');
    el.frame.srcdoc = '';
    current = null;
  }

  function openTab() {
    if (current) window.SRTFiles.openPreview(current.entries);
  }

  function download() {
    if (!current) return;
    window.SRTFiles.downloadText(current.name.split('/').pop(), current.html);
  }

  function reload() {
    if (current) el.frame.srcdoc = current.html;
  }

  function init() {
    el.pane = $('previewPane');
    if (!el.pane) return;
    el.frame = $('previewFrame');
    el.title = $('previewTitle');
    el.shell = document.querySelector('.app-shell');

    $('previewClose').addEventListener('click', close);
    $('previewReload').addEventListener('click', reload);
    $('previewOpenTab').addEventListener('click', openTab);
    $('previewDownload').addEventListener('click', download);
  }

  window.srtPreview = { show, close };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
