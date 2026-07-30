/* =====================================================
   YT Downloader Pro — app.js  (v4 — Album View)
   ===================================================== */

const API = '/api';


// ══════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════
const state = {
  // URL tab
  type: null, videoUrl: null,
  playlistVideos: [], selectedVideos: new Set(),
  format: 'mp4', videoQuality: 'best', audioQuality: '192',

  // Search tab
  searchType: 'music',
  searchResults: [], selectedResults: new Set(),
  bulkFormat: 'mp3', bulkAudioQuality: '192', bulkVideoQuality: 'best',

  // Album view
  albumResults: [],
  currentAlbum: null,
  selectedTracks: new Set(),
  albumView: false,

  // Preview player
  previewAudio: null,
  previewBtn: null,

  // Modal
  modalUrl: null, modalTitle: '', modalThumb: '', modalArtist: '',
  modalFormat: 'mp3', modalAudioKbps: '192', modalVideoQ: 'best',
};

// ══════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════
const $ = id => document.getElementById(id);

function fmtDur(s) {
  if (!s) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}
function fmtViews(n) {
  if (!n) return '';
  if (n >= 1e9) return `${(n/1e9).toFixed(1)}B vistas`;
  if (n >= 1e6) return `${(n/1e6).toFixed(1)}M vistas`;
  if (n >= 1e3) return `${(n/1e3).toFixed(0)}K vistas`;
  return `${n} vistas`;
}
function showError(id, msg) {
  const el = $(id); if (!el) return;
  el.querySelector('span').textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 6000);
}

// ══════════════════════════════════════════════════════
//  BROWSER-DOWNLOAD TOAST SYSTEM
// ══════════════════════════════════════════════════════
function createDownloadToast(label) {
  const toast = document.createElement('div');
  toast.className = 'dl-toast';
  toast.innerHTML = `
    <div class="toast-header">
      <div class="toast-icon-wrap"><div class="toast-spinner"></div></div>
      <div class="toast-info">
        <div class="toast-title">Preparando descarga...</div>
        <div class="toast-sub">${label}</div>
      </div>
      <button class="toast-close" onclick="this.closest('.dl-toast').remove()">✕</button>
    </div>
    <div class="toast-bar-track"><div class="toast-bar-fill" style="width:0%"></div></div>
    <div class="toast-footer">
      <span class="toast-pct">0%</span>
      <span class="toast-speed"></span>
      <span class="toast-eta"></span>
    </div>`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  return toast;
}

function updateToast(toast, data) {
  if (!toast?.isConnected) return;
  const pct = Math.round(data.progress || 0);
  toast.querySelector('.toast-bar-fill').style.width = `${pct}%`;
  toast.querySelector('.toast-pct').textContent = `${pct}%`;
  if (data.current_title) toast.querySelector('.toast-sub').textContent = data.current_title;
  if (data.speed) toast.querySelector('.toast-speed').textContent = data.speed;
  if (data.eta)   toast.querySelector('.toast-eta').textContent   = `ETA ${data.eta}`;
  if (pct >= 50 && pct < 100 && !data.speed) {
    toast.querySelector('.toast-speed').textContent = 'Convirtiendo audio...';
  }
  if (data.total > 1)
    toast.querySelector('.toast-title').textContent = `Preparando ${data.completed}/${data.total} archivos...`;
}

function toastDone(toast, filename, downloadUrl) {
  if (!toast?.isConnected) return;
  toast.querySelector('.toast-icon-wrap').innerHTML = '<div class="toast-check">✓</div>';
  Object.assign(toast.querySelector('.toast-icon-wrap').style,
    { background:'rgba(46,204,113,0.15)', borderColor:'#2ecc71' });
  toast.querySelector('.toast-title').textContent = '¡Archivo Listo!';
  toast.querySelector('.toast-sub').textContent = filename || 'Tu canción ya está lista';
  toast.querySelector('.toast-bar-fill').style.width = '100%';
  toast.querySelector('.toast-pct').textContent = '100%';
  
  if (downloadUrl) {
    toast.querySelector('.toast-footer').innerHTML = `
      <a href="${downloadUrl}" download="${filename || 'musica.mp3'}" style="background:#2ecc71;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:0.9rem;display:inline-block;margin-top:8px;box-shadow:0 2px 8px rgba(46,204,113,0.4);">📥 GUARDAR EN EL CELULAR</a>
    `;
  }
  setTimeout(() => {
    if (toast?.isConnected) {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 400);
    }
  }, 12000);
}

function toastError(toast, msg) {
  if (!toast?.isConnected) return;
  toast.querySelector('.toast-icon-wrap').innerHTML = '✕';
  Object.assign(toast.querySelector('.toast-icon-wrap').style,
    { background:'rgba(255,71,87,0.15)', borderColor:'#ff4757', color:'#ff4757', fontSize:'1.1rem' });
  toast.querySelector('.toast-title').textContent = 'Error en descarga';
  toast.querySelector('.toast-sub').textContent = msg || 'Inténtalo de nuevo';
  setTimeout(() => { toast.classList.remove('visible'); setTimeout(() => toast.remove(), 400); }, 5000);
}

// ══════════════════════════════════════════════════════
//  BROWSER DOWNLOAD CORE
// ══════════════════════════════════════════════════════
async function browserDownload(urls, fmt, quality, audioQuality, label) {
  if (!urls?.length) return;

  // If multiple URLs selected, download each song individually (no ZIP archive)
  if (urls.length > 1) {
    for (let i = 0; i < urls.length; i++) {
      const singleUrl = urls[i];
      const singleLabel = `Canción ${i + 1}/${urls.length}`;
      browserDownload([singleUrl], fmt, quality, audioQuality, singleLabel);
      await new Promise(r => setTimeout(r, 600));
    }
    return;
  }

  const toast = createDownloadToast(label || `${urls.length} archivo(s)`);
  let token;
  try {
    const res  = await fetch(`${API}/prepare-download`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({urls, format:fmt, quality, audio_quality:audioQuality}),
    });
    const data = await res.json();
    if (data.error) { toastError(toast, data.error); return; }
    token = data.token;
  } catch (e) { toastError(toast, 'Error de conexión'); return; }

  await new Promise(resolve => {
    const iv = setInterval(async () => {
      try {
        const res  = await fetch(`${API}/prepare-status/${token}`);
        const data = await res.json();
        updateToast(toast, data);
        if (data.status === 'ready') {
          clearInterval(iv);
          const dlUrl = `${API}/get-file/${token}`;
          
          // Trigger browser download via direct window location
          try {
            window.location.href = dlUrl;
          } catch(e) {}

          toastDone(toast, data.filename, dlUrl);
          resolve();
        } else if (data.status === 'error') {
          clearInterval(iv);
          toastError(toast, data.error || 'Error desconocido');
          resolve();
        }
      } catch { /* ignore */ }
    }, 900);
  });
}

// ══════════════════════════════════════════════════════
//  PREVIEW PLAYER
// ══════════════════════════════════════════════════════
function playPreview(url, btn) {
  // Stop current preview
  if (state.previewAudio) {
    state.previewAudio.pause();
    state.previewAudio = null;
    if (state.previewBtn) {
      state.previewBtn.innerHTML = previewPlayIcon();
      state.previewBtn.classList.remove('preview-playing');
    }
  }
  // Toggle off if same button
  if (state.previewBtn === btn) {
    state.previewBtn = null;
    return;
  }
  if (!url) return;

  const audio = new Audio(url);
  state.previewAudio = audio;
  state.previewBtn   = btn;
  btn.innerHTML = previewPauseIcon();
  btn.classList.add('preview-playing');

  audio.play().catch(() => {});

  audio.addEventListener('ended', () => {
    btn.innerHTML = previewPlayIcon();
    btn.classList.remove('preview-playing');
    state.previewAudio = null;
    state.previewBtn   = null;
  });

  // Auto-stop after 30s
  setTimeout(() => {
    if (state.previewAudio === audio) {
      audio.pause();
      btn.innerHTML = previewPlayIcon();
      btn.classList.remove('preview-playing');
      state.previewAudio = null;
      state.previewBtn   = null;
    }
  }, 30500);
}

function previewPlayIcon() {
  return `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
}
function previewPauseIcon() {
  return `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
}


function initParticles() {
  const c = $('particles'); if (!c) return;
  const colors = ['#6c63ff','#8b85ff','#ff4757','#2ecc71','#ffd32a'];
  for (let i = 0; i < 28; i++) {
    const p = document.createElement('div'); p.className = 'particle';
    const size = Math.random() * 4 + 2;
    p.style.cssText = `width:${size}px;height:${size}px;left:${Math.random()*100}%;` +
      `background:${colors[Math.floor(Math.random()*colors.length)]};` +
      `animation-duration:${Math.random()*15+10}s;animation-delay:${Math.random()*10}s;`;
    c.appendChild(p);
  }
}

// ══════════════════════════════════════════════════════
//  TABS
// ══════════════════════════════════════════════════════
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const panel = $('panel' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1));
    if (panel) { panel.classList.remove('hidden'); panel.classList.add('active'); }
  });
});

// ══════════════════════════════════════════════════════
//  TAB 1 — URL DOWNLOAD
// ══════════════════════════════════════════════════════
$('analyzeBtn').addEventListener('click', analyzeUrl);
$('urlInput').addEventListener('keydown', e => { if (e.key === 'Enter') analyzeUrl(); });
$('pasteBtn').addEventListener('click', async () => {
  try { $('urlInput').value = await navigator.clipboard.readText(); } catch {}
  $('urlInput').focus();
});

async function analyzeUrl() {
  const url = $('urlInput').value.trim();
  if (!url) { showError('errorAlert', 'Ingresa un link de YouTube.'); return; }
  $('errorAlert').classList.add('hidden');
  $('analyzeBtn').disabled = true;
  $('analyzeBtn').querySelector('.btn-text').textContent = 'Analizando...';
  $('videoInfoSection').classList.add('hidden');
  try {
    const res  = await fetch(`${API}/info`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url})});
    const data = await res.json();
    if (!res.ok || data.error) { showError('errorAlert', data.error || 'No se pudo analizar.'); return; }
    data.type === 'video' ? renderSingleVideo(data, url) : renderPlaylist(data);
    $('videoInfoSection').classList.remove('hidden');
    updateSelectedInfo();
  } catch { showError('errorAlert', 'Error de conexión. ¿Está corriendo el servidor?'); }
  finally { $('analyzeBtn').disabled = false; $('analyzeBtn').querySelector('.btn-text').textContent = 'Analizar'; }
}

function renderSingleVideo(data, url) {
  state.type = 'video'; state.videoUrl = url; state.selectedVideos = new Set(['single']);
  $('singleVideoCard').classList.remove('hidden'); $('playlistCard').classList.add('hidden');
  $('videoThumbnail').src = data.thumbnail || '';
  $('videoTitle').textContent = data.title || 'Sin título';
  $('videoUploader').innerHTML = svgUser() + (data.uploader || 'Canal desconocido');
  $('videoViews').innerHTML = svgEye() + fmtViews(data.view_count);
  $('videoDuration').textContent = fmtDur(data.duration);
  if (data.qualities?.length) {
    const sel = $('videoQuality');
    sel.innerHTML = '<option value="best">Mejor calidad</option>';
    data.qualities.forEach(q => { const o = document.createElement('option'); o.value = q.value; o.textContent = q.label; sel.appendChild(o); });
  }
}

function renderPlaylist(data) {
  state.type = 'playlist'; state.videoUrl = null;
  state.playlistVideos = data.videos || [];
  state.selectedVideos = new Set(state.playlistVideos.map((_,i) => i));
  $('singleVideoCard').classList.add('hidden'); $('playlistCard').classList.remove('hidden');
  $('playlistTitle').textContent = data.title || 'Playlist';
  $('playlistMeta').textContent = `${data.count} videos · ${data.uploader || ''}`;
  const grid = $('playlistGrid'); grid.innerHTML = '';
  state.playlistVideos.forEach((v, i) => {
    const item = document.createElement('div');
    item.className = 'playlist-item selected'; item.dataset.index = i;
    item.innerHTML = `<div class="item-thumb-wrapper">
        ${v.thumbnail ? `<img class="item-thumb" src="${v.thumbnail}" loading="lazy" />` : `<div class="item-thumb-placeholder">${svgVideo()}</div>`}
        <span class="item-number">${i+1}</span>
        ${v.duration ? `<span class="item-duration">${fmtDur(v.duration)}</span>` : ''}
      </div><div class="item-title">${v.title || 'Sin título'}</div>`;
    item.addEventListener('click', () => togglePL(i, item));
    grid.appendChild(item);
  });
}

function togglePL(i, el) {
  state.selectedVideos.has(i) ? (state.selectedVideos.delete(i), el.classList.remove('selected'))
                               : (state.selectedVideos.add(i), el.classList.add('selected'));
  updateSelectedInfo();
}

$('selectAllBtn').addEventListener('click', () => {
  state.selectedVideos = new Set(state.playlistVideos.map((_,i) => i));
  document.querySelectorAll('.playlist-item').forEach(el => el.classList.add('selected'));
  updateSelectedInfo();
});
$('deselectAllBtn').addEventListener('click', () => {
  state.selectedVideos.clear();
  document.querySelectorAll('.playlist-item').forEach(el => el.classList.remove('selected'));
  updateSelectedInfo();
});

function updateSelectedInfo() {
  const n = state.type === 'video' ? 1 : state.selectedVideos.size;
  $('selectedInfo').textContent = `${n} video${n!==1?'s':''} seleccionado${n!==1?'s':''}`;
  $('downloadBtn').disabled = n === 0;
}

document.querySelectorAll('.format-tab').forEach(t =>
  t.addEventListener('click', () => {
    state.format = t.dataset.format;
    document.querySelectorAll('.format-tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    $('videoQualityGroup').classList.toggle('hidden', state.format !== 'mp4');
    $('audioQualityGroup').classList.toggle('hidden', state.format !== 'mp3');
  }));

$('videoQuality').addEventListener('change', e => { state.videoQuality = e.target.value; });
$('audioQualityChips').addEventListener('click', e => {
  const chip = e.target.closest('.quality-chip'); if (!chip) return;
  state.audioQuality = chip.dataset.kbps;
  document.querySelectorAll('#audioQualityChips .quality-chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
});

$('downloadBtn').addEventListener('click', () => {
  const urls = state.type === 'video'
    ? [state.videoUrl]
    : [...state.selectedVideos].sort((a,b)=>a-b).map(i => state.playlistVideos[i].url);
  if (!urls.length) return;
  browserDownload(urls, state.format, state.videoQuality, state.audioQuality,
    urls.length === 1 ? (state.videoUrl || 'Video') : `${urls.length} videos`);
});

$('newDownloadBtn')?.addEventListener('click', () => {
  $('progressSection').classList.add('hidden');
  $('videoInfoSection').classList.add('hidden');
  $('urlInput').value = ''; $('urlInput').focus();
});
$('openFolderBtn')?.addEventListener('click', () => fetch(`${API}/open-folder`, {method:'POST'}));

// ══════════════════════════════════════════════════════
//  TAB 2 — SEARCH
// ══════════════════════════════════════════════════════
document.querySelectorAll('.type-chip').forEach(chip =>
  chip.addEventListener('click', () => {
    document.querySelectorAll('.type-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active'); state.searchType = chip.dataset.type;
  }));

document.querySelectorAll('.qs-chip').forEach(chip =>
  chip.addEventListener('click', () => { $('searchInput').value = chip.dataset.q; doSearch(); }));

$('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
$('searchInput').addEventListener('input', () => {
  $('clearSearchBtn').classList.toggle('hidden', !$('searchInput').value);
});
$('clearSearchBtn').addEventListener('click', () => {
  $('searchInput').value = ''; $('clearSearchBtn').classList.add('hidden'); $('searchInput').focus();
});
$('searchBtn').addEventListener('click', doSearch);

async function doSearch() {
  const query = $('searchInput').value.trim(); if (!query) return;
  $('searchErrorAlert').classList.add('hidden');
  $('clearSearchBtn').classList.remove('hidden');
  $('searchBtnText').textContent = 'Buscando...';
  $('searchSpinner').classList.remove('hidden');
  $('searchBtn').disabled = true;
  $('searchResultsSection').classList.remove('hidden');
  $('resultsGrid').className = 'results-grid';
  $('resultsGrid').innerHTML = '';
  $('resultsSkeleton').classList.remove('hidden');
  $('searchProgressSection').classList.add('hidden');
  state.selectedResults.clear(); state.albumView = false;
  updateBulkBar();

  try {
    if (state.searchType === 'album') {
      await doAlbumSearch(query);
    } else {
      await doRegularSearch(query);
    }
  } finally {
    $('resultsSkeleton').classList.add('hidden');
    $('searchBtnText').textContent = 'Buscar';
    $('searchSpinner').classList.add('hidden');
    $('searchBtn').disabled = false;
  }
}

// ── Regular song/video search ──────────────────────────
async function doRegularSearch(query) {
  try {
    const res  = await fetch(`${API}/search`, {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({query, type:state.searchType, limit:20})});
    const data = await res.json();
    if (!res.ok || data.error) {
      showError('searchErrorAlert', data.error || 'Error'); $('searchResultsSection').classList.add('hidden'); return;
    }
    state.searchResults = data.results || [];
    renderSongResults(state.searchResults, query);
  } catch { showError('searchErrorAlert', 'Error de conexión.'); $('searchResultsSection').classList.add('hidden'); }
}

function renderSongResults(results, query) {
  $('resultsCount').textContent = `${results.length} resultado${results.length!==1?'s':''}`;
  $('resultsQuery').textContent = `para "${query}"`;
  $('bulkBar').classList.remove('hidden');
  const grid = $('resultsGrid');
  grid.className = 'results-grid';
  grid.innerHTML = '';

  if (!results.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:40px">
      <div style="font-size:2.5rem;margin-bottom:10px">🔍</div>
      <p>No se encontraron resultados para "<strong>${query}</strong>"</p></div>`;
    return;
  }

  results.forEach((r, i) => {
    const card = document.createElement('div');
    card.className = 'result-card'; card.dataset.index = i;
    const thumb = r.thumbnail
      ? `<img class="card-thumb" src="${r.thumbnail}" loading="lazy" />`
      : `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--text-muted)">${svgVideo()}</div>`;
    card.innerHTML = `
      <div class="card-thumb-wrap">${thumb}
        ${r.duration ? `<span class="card-duration">${fmtDur(r.duration)}</span>` : ''}
        <div class="card-check">✓</div>
      </div>
      <div class="card-body">
        <div class="card-title">${r.title||'Sin título'}</div>
        <div class="card-artist">${r.uploader||''}</div>
        <div class="card-actions">
          <button class="card-btn card-btn-mp3" data-idx="${i}" data-fmt="mp3">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> MP3
          </button>
          <button class="card-btn card-btn-mp4" data-idx="${i}" data-fmt="mp4">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg> MP4
          </button>
        </div>
      </div>`;
    card.querySelector('.card-thumb-wrap').addEventListener('click', () => toggleResult(i, card));
    card.querySelector('.card-title').addEventListener('click',  () => toggleResult(i, card));
    card.querySelector('.card-artist').addEventListener('click', () => toggleResult(i, card));
    card.querySelectorAll('.card-btn').forEach(btn =>
      btn.addEventListener('click', e => { e.stopPropagation(); quickDownload(r, btn.dataset.fmt); }));
    grid.appendChild(card);
  });
}

function quickDownload(result, fmt) {
  browserDownload([result.url], fmt, 'best', '192', result.title || 'Canción');
}

function toggleResult(i, card) {
  state.selectedResults.has(i) ? (state.selectedResults.delete(i), card.classList.remove('selected'))
                                : (state.selectedResults.add(i), card.classList.add('selected'));
  updateBulkBar();
}

function updateBulkBar() {
  const n = state.selectedResults.size;
  $('bulkCount').textContent = `${n} seleccionado${n!==1?'s':''}`;
  $('downloadSelectedBtn').disabled = n === 0;
}

document.querySelectorAll('.bulk-fmt-btn').forEach(btn =>
  btn.addEventListener('click', () => {
    state.bulkFormat = btn.dataset.fmt;
    document.querySelectorAll('.bulk-fmt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $('bulkQualityAudio').classList.toggle('hidden', btn.dataset.fmt !== 'mp3');
    $('bulkQualityVideo').classList.toggle('hidden', btn.dataset.fmt !== 'mp4');
  }));

$('bulkAudioQuality').addEventListener('change', e => { state.bulkAudioQuality = e.target.value; });
$('bulkVideoQuality').addEventListener('change', e => { state.bulkVideoQuality = e.target.value; });

$('downloadSelectedBtn').addEventListener('click', () => {
  const selected = [...state.selectedResults].sort((a,b)=>a-b);
  if (!selected.length) return;
  const urls  = selected.map(i => state.searchResults[i].url);
  const q     = state.bulkFormat === 'mp4' ? state.bulkVideoQuality : 'best';
  const label = selected.length === 1
    ? (state.searchResults[selected[0]].title || 'Canción')
    : `${selected.length} canciones por separado`;
  browserDownload(urls, state.bulkFormat, q, state.bulkAudioQuality, label);
});

// ── ALBUM SEARCH ───────────────────────────────────────
async function doAlbumSearch(query) {
  $('bulkBar').classList.add('hidden');
  try {
    const res  = await fetch(`${API}/search-albums`, {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({query})});
    const data = await res.json();
    if (!res.ok || data.error) {
      showError('searchErrorAlert', data.error || 'Error'); $('searchResultsSection').classList.add('hidden'); return;
    }
    state.albumResults = data.results || [];
    renderAlbumGrid(state.albumResults, query);
  } catch { showError('searchErrorAlert', 'Error de conexión.'); $('searchResultsSection').classList.add('hidden'); }
}

function renderAlbumGrid(albums, query) {
  state.albumView = false;
  $('resultsCount').textContent = `${albums.length} álbum${albums.length!==1?'es':''}`;
  $('resultsQuery').textContent = `para "${query}"`;
  const grid = $('resultsGrid');
  grid.className = 'albums-grid';
  grid.innerHTML = '';

  if (!albums.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:40px">
      <div style="font-size:2.5rem;margin-bottom:10px">💿</div>
      <p>No se encontraron álbumes para "<strong>${query}</strong>"</p></div>`;
    return;
  }

  albums.forEach(album => {
    const card = document.createElement('div');
    card.className = 'album-card';
    card.innerHTML = `
      <div class="album-card-cover">
        ${album.thumbnail
          ? `<img src="${album.thumbnail}" loading="lazy" onerror="this.style.opacity=0" />`
          : `<div class="album-cover-placeholder">💿</div>`}
        <div class="album-card-hover">
          <button class="album-open-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </button>
        </div>
      </div>
      <div class="album-card-info">
        <div class="album-card-title">${album.title||'Sin título'}</div>
        <div class="album-card-artist">${album.artist||''}</div>
        ${album.year ? `<div class="album-card-year">${album.year}</div>` : ''}
        ${album.track_count > 0 ? `<div class="album-card-year">${album.track_count} canciones</div>` : ''}
      </div>`;
    card.addEventListener('click', () => openAlbumDetail(album));
    grid.appendChild(card);
  });
}

// ── ALBUM DETAIL VIEW ──────────────────────────────────
async function openAlbumDetail(album) {
  state.albumView = true;
  state.selectedTracks = new Set();
  const grid = $('resultsGrid');
  grid.className = 'results-grid';
  grid.innerHTML = `
    <div class="album-loading" style="grid-column:1/-1">
      <div class="album-loading-spinner"></div>
      <span>Cargando canciones del álbum...</span>
    </div>`;

  try {
    const res  = await fetch(`${API}/album-tracks`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        itunes_id: album.itunes_id,
        title:     album.title,
        artist:    album.artist,
        thumbnail: album.thumbnail,
        year:      album.year || '',
      }),
    });
    const data = await res.json();
    if (data.error) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted)">Error: ${data.error}</div>`;
      return;
    }
    state.currentAlbum = data;
    renderAlbumDetail(data);
  } catch (e) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted)">Error de conexión</div>`;
  }
}


function renderAlbumDetail(data) {
  const grid = $('resultsGrid');
  const cover = data.thumbnail || '';
  const q = $('searchInput').value.trim();

  const el = document.createElement('div');
  el.className = 'album-detail-view';
  el.style.gridColumn = '1 / -1';
  el.innerHTML = `
    <!-- Header -->
    <div class="album-detail-header">
      <div class="album-cover-wrap">
        ${cover
          ? `<img class="album-cover-large" src="${cover}" onerror="this.style.display='none'" />`
          : `<div class="album-cover-large" style="display:flex;align-items:center;justify-content:center;font-size:4rem;background:var(--bg-secondary)">💿</div>`}
      </div>
      <div class="album-meta">
        <div class="album-meta-type">ÁLBUM</div>
        <h2 class="album-meta-title">${data.title||'Sin título'}</h2>
        <div class="album-meta-artist">${data.artist||''}</div>
        <div class="album-meta-info">${data.year ? data.year+' · ' : ''}${data.track_count} canciones</div>
        <div class="album-meta-actions">
          <button class="dl-album-btn" id="dlAllBtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Descargar álbum completo
          </button>
          <button class="back-album-btn" id="backAlbumBtn">← Volver</button>
        </div>
      </div>
    </div>

    <!-- Tracks header -->
    <div class="track-list-header">
      <span># Canciones</span>
      <button class="select-all-tracks-btn" id="selectAllTracksBtn">Seleccionar todas</button>
    </div>

    <!-- Track list -->
    <div class="track-list" id="albumTrackList">
      ${data.tracks.map((t, i) => `
        <div class="track-item" data-idx="${i}">
          <div class="track-num">${t.number}</div>
          ${t.preview_url
            ? `<button class="track-preview-btn" data-preview="${t.preview_url}" data-idx="${i}" title="Vista previa 30s">${previewPlayIcon()}</button>`
            : `<div class="track-num-spacer"></div>`}
          <div class="track-thumb-wrap">
            <img src="${t.thumbnail||''}" loading="lazy" onerror="this.style.display='none'" />
          </div>
          <div class="track-details">
            <div class="track-name">${t.title||'Sin título'}</div>
            <div class="track-artist">${t.artist||data.artist||''}</div>
          </div>
          ${t.duration ? `<div class="track-dur">${fmtDur(t.duration)}</div>` : '<div class="track-dur"></div>'}
          <button class="track-quick-dl" data-idx="${i}" title="Descargar esta canción">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
        </div>`).join('')}
    </div>

    <!-- Footer -->
    <div class="track-list-footer">
      <button class="dl-selected-tracks-btn" id="dlSelectedBtn" disabled>
        Descargar seleccionadas (0)
      </button>
    </div>`;

  grid.innerHTML = '';
  grid.appendChild(el);

  // ── Event listeners ──
  $('backAlbumBtn').addEventListener('click', () => {
    renderAlbumGrid(state.albumResults, q);
  });

  $('dlAllBtn').addEventListener('click', () => {
    const urls  = data.tracks.map(t => t.url);
    browserDownload(urls, 'mp3', 'best', '320', data.title || 'Álbum');
  });

  $('selectAllTracksBtn').addEventListener('click', () => {
    if (state.selectedTracks.size === data.tracks.length) {
      // Deselect all
      state.selectedTracks.clear();
      document.querySelectorAll('.track-item').forEach(el => el.classList.remove('selected'));
      $('selectAllTracksBtn').textContent = 'Seleccionar todas';
    } else {
      // Select all
      state.selectedTracks = new Set(data.tracks.map((_, i) => i));
      document.querySelectorAll('.track-item').forEach(el => el.classList.add('selected'));
      $('selectAllTracksBtn').textContent = 'Deseleccionar todas';
    }
    updateTrackDownloadBtn(data.tracks.length);
  });

  // Preview buttons
  document.querySelectorAll('.track-preview-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      playPreview(btn.dataset.preview, btn);
    });
  });

  // Track row — click to select
  document.querySelectorAll('.track-item').forEach(item => {
    item.addEventListener('click', e => {
      if (e.target.closest('.track-quick-dl')) return;
      const idx = parseInt(item.dataset.idx);
      state.selectedTracks.has(idx)
        ? (state.selectedTracks.delete(idx), item.classList.remove('selected'))
        : (state.selectedTracks.add(idx), item.classList.add('selected'));
      updateTrackDownloadBtn(data.tracks.length);
    });
  });

  // Quick individual download
  document.querySelectorAll('.track-quick-dl').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const track = data.tracks[parseInt(btn.dataset.idx)];
      browserDownload([track.url], 'mp3', 'best', '320', track.title || 'Canción');
    });
  });

  $('dlSelectedBtn').addEventListener('click', () => {
    const sel  = [...state.selectedTracks].sort((a,b)=>a-b);
    const urls = sel.map(i => data.tracks[i].url);
    const lbl  = sel.length === data.tracks.length ? data.title : `${sel.length} canciones`;
    browserDownload(urls, 'mp3', 'best', '320', lbl);
  });
}

function updateTrackDownloadBtn(total) {
  const n   = state.selectedTracks.size;
  const btn = $('dlSelectedBtn');
  if (btn) { btn.disabled = n === 0; btn.textContent = `Descargar seleccionadas (${n})`; }
  const allBtn = $('selectAllTracksBtn');
  if (allBtn) allBtn.textContent = n === total ? 'Deseleccionar todas' : 'Seleccionar todas';
}

// ── Misc search buttons ───────────────────────────────
$('searchOpenFolderBtn')?.addEventListener('click', () => fetch(`${API}/open-folder`, {method:'POST'}));
$('searchBackBtn')?.addEventListener('click', () => {
  $('searchProgressSection').classList.add('hidden');
  $('searchResultsSection').classList.remove('hidden');
});

// ══════════════════════════════════════════════════════
//  MODAL
// ══════════════════════════════════════════════════════
function openModal(result, defaultFmt = 'mp3') {
  state.modalUrl = result.url; state.modalTitle = result.title || '';
  state.modalThumb = result.thumbnail || ''; state.modalArtist = result.uploader || '';
  state.modalFormat = defaultFmt;
  $('modalTitle').textContent = state.modalTitle;
  $('modalSub').textContent   = state.modalArtist;
  $('modalThumb').src         = state.modalThumb;
  document.querySelectorAll('.modal-fmt-btn').forEach(b => b.classList.toggle('active', b.dataset.fmt === defaultFmt));
  $('modalAudioOpts').classList.toggle('hidden', defaultFmt !== 'mp3');
  $('modalVideoOpts').classList.toggle('hidden', defaultFmt !== 'mp4');
  $('modalOverlay').classList.remove('hidden');
}
function closeModal() { $('modalOverlay').classList.add('hidden'); }
$('modalClose').addEventListener('click', closeModal);
$('modalCancel').addEventListener('click', closeModal);
$('modalOverlay').addEventListener('click', e => { if (e.target === $('modalOverlay')) closeModal(); });
document.querySelectorAll('.modal-fmt-btn').forEach(btn =>
  btn.addEventListener('click', () => {
    state.modalFormat = btn.dataset.fmt;
    document.querySelectorAll('.modal-fmt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $('modalAudioOpts').classList.toggle('hidden', state.modalFormat !== 'mp3');
    $('modalVideoOpts').classList.toggle('hidden', state.modalFormat !== 'mp4');
  }));
$('modalAudioOpts').addEventListener('click', e => {
  const chip = e.target.closest('.quality-chip'); if (!chip) return;
  state.modalAudioKbps = chip.dataset.kbps;
  $('modalAudioOpts').querySelectorAll('.quality-chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
});
$('modalVideoQuality').addEventListener('change', e => { state.modalVideoQ = e.target.value; });
$('modalDownload').addEventListener('click', () => {
  closeModal();
  browserDownload([state.modalUrl], state.modalFormat,
    state.modalFormat === 'mp4' ? state.modalVideoQ : 'best',
    state.modalAudioKbps, state.modalTitle);
});

// ══════════════════════════════════════════════════════
//  SVG HELPERS
// ══════════════════════════════════════════════════════
function svgUser() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
}
function svgEye() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
}
function svgVideo() {
  return `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`;
}

// ══════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════
initParticles();
