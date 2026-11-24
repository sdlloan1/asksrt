/* Ask SRT — GitHub connect: load a repo file into SI mode, push generated files or an uploaded ZIP back */
(function () {
  const API = 'https://api.github.com';
  const el = {};
  let token = '';
  let login = '';
  let repo = '';
  let branch = 'main';

  function $(id) { return document.getElementById(id); }

  function setStatus(text, ok) {
    if (!el.status) return;
    el.status.textContent = text;
    el.status.className = 'gh-status' + (ok ? ' ok' : '');
  }

  function feedback(text) {
    if (el.feedback) el.feedback.textContent = text || '';
  }

  async function api(path, options) {
    const opts = options || {};
    const res = await fetch(API + path, {
      method: opts.method || 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        ...(opts.body ? { 'Content-Type': 'application/json' } : {})
      },
      body: opts.body
    });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
      const err = new Error((data && data.message) || ('HTTP ' + res.status));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function base64FromBytes(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  function base64FromText(text) {
    return base64FromBytes(new TextEncoder().encode(String(text)));
  }

  function base64ToText(b64) {
    const binary = atob(String(b64 || '').replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  async function connect() {
    token = ((el.token && el.token.value) || token || '').trim();
    if (!token) { setStatus('Paste a personal access token first.'); return; }
    setStatus('Connecting…');
    try {
      const user = await api('/user');
      login = (user && user.login) || '';
      await chrome.storage.local.set({ githubToken: token, githubLogin: login });
      setStatus('Connected as ' + login, true);
      feedback('');
      await checkRepo();
    } catch (e) {
      token = '';
      setStatus('Could not connect: ' + e.message);
    }
  }

  // Tells the user straight away whether this token can actually reach the repository.
  async function checkRepo() {
    if (!token) return false;
    if (!((el.repo && el.repo.value) || repo || '').trim()) return false;
    try {
      const info = await repoInfo();
      const data = await resolveBranch(info);
      if (!canWrite(info)) {
        setStatus(`Connected as ${login} · ${repo} (${data.name}) · read only`, false);
        feedback(`Repo OK for reading, but this token has no write access — deleting and pushing will fail until it gets it (${WRITE_HELP}).`);
        return false;
      }
      setStatus(`Connected as ${login} · ${repo} (${data.name})`, true);
      feedback(`Repo OK — default branch "${info.default_branch}", writing to "${data.name}".`);
      return true;
    } catch (e) {
      setStatus(`Connected as ${login} · repo not usable`, false);
      feedback(e.message);
      return false;
    }
  }

  async function saveSettings() {
    repo = (el.repo.value || '')
      .trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/i, '')
      .replace(/\/+$/, '');
    branch = (el.branch.value || '').trim() || 'main';
    await chrome.storage.local.set({ githubRepo: repo, githubBranch: branch });
  }

  async function getSha(path) {
    try {
      const data = await api(`/repos/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`);
      return (data && data.sha) || null;
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async function putFile(path, base64, message) {
    const body = { message, content: base64, branch };
    const sha = await getSha(path);
    if (sha) body.sha = sha;
    await api(`/repos/${repo}/contents/${encodeURI(path)}`, { method: 'PUT', body: JSON.stringify(body) });
  }

  function joinPath(folder, path) {
    const dir = String(folder || '').replace(/^\/+|\/+$/g, '');
    const clean = String(path || '').replace(/^\/+/, '');
    return dir ? dir + '/' + clean : clean;
  }

  async function pushEntries(entries, label) {
    open();
    if (!entries || !entries.length) {
      feedback('Nothing to push yet — ask SI for files first.');
      return;
    }
    if (!token) { setStatus('Connect GitHub first, then push again.'); return; }
    await saveSettings();
    if (!/^[^/]+\/[^/]+$/.test(repo)) { setStatus('Set the repository as owner/name.'); return; }
    try { await resolveBranch(await repoInfo()); } catch (e) { feedback(e.message); return; }

    feedback(`Pushing ${entries.length} file(s) from ${label || 'the reply'} to ${repo} (${branch})…`);
    const failed = [];
    let done = 0;
    for (const entry of entries) {
      const path = joinPath(el.folder ? el.folder.value : '', entry.path);
      try {
        const base64 = entry.bytes ? base64FromBytes(entry.bytes) : base64FromText(entry.content || '');
        await putFile(path, base64, `Update ${path} from Ask SRT`);
        done++;
      } catch (e) {
        failed.push(`${path} (${e.message})`);
      }
    }
    feedback(`Pushed ${done} file(s) to ${repo}.` + (failed.length ? ` Failed: ${failed.join('; ')}` : ''));
  }

  async function loadRepoFile() {
    if (!token) { setStatus('Connect GitHub first.'); return; }
    await saveSettings();
    const path = (el.path.value || '').trim().replace(/^\/+/, '');
    if (!/^[^/]+\/[^/]+$/.test(repo) || !path) {
      feedback('Set the repository and the file path you want to edit.');
      return;
    }
    feedback('Loading ' + path + '…');
    try {
      await resolveBranch(await repoInfo());
      const data = await api(`/repos/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`);
      if (!data || Array.isArray(data)) throw new Error('that path is a folder');
      const text = base64ToText(data.content);
      if (window.srtSi) window.srtSi.addFile(path.split('/').pop(), text);
      feedback('Added ' + path + ' to the chat — describe the change, then push the result.');
    } catch (e) {
      feedback('Could not load ' + path + ': ' + e.message);
    }
  }

  async function pushZip(file) {
    if (!file) return;
    if (!token) { setStatus('Connect GitHub first.'); return; }
    feedback('Reading ' + file.name + '…');
    try {
      const entries = await window.SRTFiles.readZip(await file.arrayBuffer());
      if (!entries.length) { feedback('No files found inside ' + file.name + '.'); return; }
      feedback(`${entries.length} file(s) found in ${file.name}.`);
      await pushEntries(entries, file.name);
    } catch (e) {
      feedback('Could not read the ZIP: ' + e.message);
    }
  }

  /* ---------------- Whole repository ---------------- */
  const REPO_TEXT_FILE = /\.(txt|md|markdown|json|csv|tsv|log|xml|ya?ml|html?|css|scss|less|jsx?|tsx?|mjs|cjs|py|java|kt|kts|gradle|groovy|c|h|cpp|hpp|cs|go|rs|rb|php|sh|bash|zsh|sql|swift|dart|toml|ini|conf|env|properties|vue|svelte)$/i;
  const MAX_REPO_FILES = 40;
  const MAX_REPO_FILE_BYTES = 60 * 1024;

  function repoNotFound() {
    return new Error(
      `repository "${repo}" was not found for this token. Check the owner/name spelling, ` +
      'and that the token can see it: a classic token needs the "repo" scope, a fine-grained ' +
      'token needs this repository selected with Contents: Read and write.'
    );
  }

  async function repoInfo() {
    await saveSettings();
    if (!/^[^/]+\/[^/]+$/.test(repo)) throw new Error('set the repository as owner/name');
    try {
      return await api(`/repos/${repo}`);
    } catch (e) {
      if (e.status === 404) throw repoNotFound();
      throw e;
    }
  }

  // The branch field may be empty, misspelled or left at "main" on a "master" repo.
  async function resolveBranch(info) {
    try {
      return await api(`/repos/${repo}/branches/${encodeURIComponent(branch)}`);
    } catch (e) {
      if (e.status !== 404) throw e;
      const list = await api(`/repos/${repo}/branches?per_page=100`);
      const names = (list || []).map((b) => b.name);
      if (!names.length) throw new Error('this repository has no commits yet');
      const fallback = names.includes(info.default_branch) ? info.default_branch : names[0];
      feedback(`Branch "${branch}" not found — using "${fallback}".`);
      branch = fallback;
      if (el.branch) el.branch.value = branch;
      await chrome.storage.local.set({ githubBranch: branch });
      return api(`/repos/${repo}/branches/${encodeURIComponent(fallback)}`);
    }
  }

  async function branchTree() {
    const info = await repoInfo();
    const data = await resolveBranch(info);
    const head = data.commit.sha;
    const tree = data.commit.commit.tree.sha;
    const listing = await api(`/repos/${repo}/git/trees/${tree}?recursive=1`);
    const blobs = (listing.tree || []).filter((node) => node.type === 'blob');
    return { info, head, tree, blobs };
  }

  function canWrite(info) {
    return !(info && info.permissions && info.permissions.push === false);
  }

  const WRITE_HELP = 'classic token: "repo" scope; fine-grained token: Contents = Read and write';

  // Labels the failing GitHub call so an error says which step was refused.
  async function step(name, fn) {
    try {
      return await fn();
    } catch (e) {
      e.step = name;
      throw e;
    }
  }

  // Fallback when the git-data API refuses: delete each file through the Contents API.
  async function deleteFileByFile(blobs) {
    let done = 0;
    for (const blob of blobs) {
      await api(`/repos/${repo}/contents/${encodeURI(blob.path)}`, {
        method: 'DELETE',
        body: JSON.stringify({ message: 'Delete all files from Ask SRT', sha: blob.sha, branch })
      });
      done += 1;
    }
    return done;
  }

  function refPath() {
    return branch.split('/').map(encodeURIComponent).join('/');
  }

  async function loadAllFiles() {
    if (!token) { setStatus('Connect GitHub first.'); return; }
    try {
      const { blobs } = await branchTree();
      const wanted = blobs.filter((b) => REPO_TEXT_FILE.test(b.path) && (b.size || 0) < MAX_REPO_FILE_BYTES);
      if (!wanted.length) { feedback(`No editable text files found on ${branch}.`); return; }
      const picked = wanted.slice(0, MAX_REPO_FILES);
      feedback(`Loading ${picked.length} file(s) from ${repo} (${branch})…`);
      const files = [];
      for (const blob of picked) {
        try {
          const data = await api(`/repos/${repo}/git/blobs/${blob.sha}`);
          files.push({ name: blob.path, text: base64ToText(data.content) });
        } catch {}
      }
      if (!files.length) { feedback(`Could not read the files on ${branch}.`); return; }
      window.srtSi.addFiles(files);
      const more = wanted.length > picked.length ? ` (first ${picked.length} of ${wanted.length})` : '';
      feedback(`Added ${files.length} file(s)${more} — describe the change, then push the result.`);
    } catch (e) {
      feedback(`Could not load ${repo}: ${e.message}`);
    }
  }

  async function deleteAllFiles() {
    if (!token) { setStatus('Connect GitHub first.'); return; }
    try {
      const { info, head, tree, blobs } = await branchTree();
      if (!canWrite(info)) {
        feedback(`This token can read ${repo} but not write to it — recreate it with write access (${WRITE_HELP}).`);
        return;
      }
      // Deleting each top-level entry removes the whole file or folder below it,
      // which also works on repositories too large for a recursive listing.
      const root = await step('reading the root tree', () => api(`/repos/${repo}/git/trees/${tree}`));
      const tops = (root.tree || []).filter((n) => n.type === 'blob' || n.type === 'tree');
      if (!tops.length) { feedback(`Nothing to delete — ${branch} is already empty.`); return; }

      const ok = confirm(
        `Delete everything in ${repo} (${branch})?\n\n` +
        `${blobs.length} file(s) in ${tops.length} top-level item(s) will be removed in one commit. ` +
        'Git history keeps the old commit, so it can be restored, but the branch will be empty.'
      );
      if (!ok) return;

      feedback(`Deleting ${blobs.length} file(s) in one commit…`);
      try {
        const newTree = await step('creating the empty tree', () => api(`/repos/${repo}/git/trees`, {
          method: 'POST',
          body: JSON.stringify({
            base_tree: tree,
            tree: tops.map((n) => ({ path: n.path, mode: n.mode, type: n.type, sha: null }))
          })
        }));
        const commit = await step('creating the commit', () => api(`/repos/${repo}/git/commits`, {
          method: 'POST',
          body: JSON.stringify({
            message: 'Delete all files from Ask SRT',
            tree: newTree.sha,
            parents: [head]
          })
        }));
        await step('updating the branch', () => api(`/repos/${repo}/git/refs/heads/${refPath()}`, {
          method: 'PATCH',
          body: JSON.stringify({ sha: commit.sha, force: false })
        }));
        feedback(`Deleted ${blobs.length} file(s) in one commit on ${repo} (${branch}).`);
        return;
      } catch (e) {
        if (!blobs.length || blobs.length > 200) throw e;
        feedback(`One-commit delete was refused (${e.message} at ${e.step || 'GitHub'}) — deleting file by file…`);
        try {
          const done = await deleteFileByFile(blobs);
          feedback(`Deleted ${done} file(s) one by one on ${repo} (${branch}) — ${done} commits.`);
          return;
        } catch (inner) {
          if (inner.status === 422) {
            throw new Error(`"${branch}" is protected, so GitHub refused the delete — allow pushes to it or use another branch`);
          }
          if (inner.status === 403 || inner.status === 404) {
            throw new Error(`GitHub refused the delete (${inner.message}) — this token has no write access (${WRITE_HELP})`);
          }
          throw inner;
        }
      }
    } catch (e) {
      feedback(`Delete failed: ${e.message}`);
    }
  }

  function open() {
    if (!el.view) return;
    el.view.classList.remove('hidden');
    const history = $('historyView');
    const settings = $('settingsView');
    if (history) history.classList.add('hidden');
    if (settings) settings.classList.add('hidden');
    if (el.token && token && !el.token.value) el.token.value = token;
  }

  function close() {
    if (el.view) el.view.classList.add('hidden');
  }

  async function init() {
    el.view = $('githubView');
    if (!el.view) return;
    el.status = $('ghStatus');
    el.token = $('ghToken');
    el.repo = $('ghRepo');
    el.branch = $('ghBranch');
    el.path = $('ghPath');
    el.folder = $('ghFolder');
    el.feedback = $('ghFeedback');
    el.zip = $('ghZip');

    const store = await chrome.storage.local.get(['githubToken', 'githubLogin', 'githubRepo', 'githubBranch']);
    token = store.githubToken || '';
    login = store.githubLogin || '';
    repo = store.githubRepo || '';
    branch = store.githubBranch || 'main';
    if (el.repo) el.repo.value = repo;
    if (el.branch) el.branch.value = branch;
    setStatus(token && login ? 'Connected as ' + login : 'Not connected', !!(token && login));

    const openBtn = $('githubBtn');
    if (openBtn) {
      openBtn.addEventListener('click', () => {
        if (el.view.classList.contains('hidden')) open();
        else close();
      });
    }
    const closeBtn = $('closeGithubBtn');
    if (closeBtn) closeBtn.addEventListener('click', close);
    $('ghConnectBtn').addEventListener('click', connect);
    $('ghForgetBtn').addEventListener('click', async () => {
      token = '';
      login = '';
      await chrome.storage.local.remove(['githubToken', 'githubLogin']);
      if (el.token) el.token.value = '';
      setStatus('Token forgotten');
    });
    if (el.repo) el.repo.addEventListener('change', checkRepo);
    $('ghLoadFileBtn').addEventListener('click', loadRepoFile);
    $('ghLoadAllBtn').addEventListener('click', loadAllFiles);
    $('ghDeleteAllBtn').addEventListener('click', deleteAllFiles);
    $('ghPushFilesBtn').addEventListener('click', () => {
      pushEntries(window.srtSi ? window.srtSi.latestFiles() : [], 'the latest reply');
    });
    el.zip.addEventListener('change', async (event) => {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      await pushZip(file);
    });
  }

  window.srtGithub = {
    open,
    close,
    pushEntries,
    isConnected: () => !!token
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
