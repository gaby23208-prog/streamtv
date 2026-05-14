/**
 * StreamTV - IPTV PWA
 * Architecture: Module pattern, no framework, vanilla JS ES6+
 */

'use strict';

// ============================================================
// STATE
// ============================================================
const State = {
  channels: [],           // All parsed channels
  filtered: [],           // Currently displayed channels
  favorites: new Set(),   // Channel URLs marked as favorites
  epgData: new Map(),     // tvg-id → [{start, end, title, desc}]
  currentChannel: null,   // Currently playing channel object
  currentCategory: 'ALL',
  searchQuery: '',
  hlsInstance: null,      // HLS.js instance
  overlayTimer: null,     // Auto-hide overlay timeout
  focusedIndex: 0,        // Keyboard navigation index
  loadSource: 'url',      // 'url' | 'file' | 'demo'
};

// ============================================================
// DEMO PLAYLIST (used when no M3U provided)
// ============================================================
const DEMO_M3U = `#EXTM3U
#EXTINF:-1 tvg-id="tf1.fr" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/TF1_logo_2021.svg/120px-TF1_logo_2021.svg.png" group-title="NEWS",TF1
https://raw.githubusercontent.com/Free-TV/IPTV/master/streams/fr.m3u8
#EXTINF:-1 tvg-id="france2.fr" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/France_2_-_logo_2008.svg/120px-France_2_-_logo_2008.svg.png" group-title="NEWS",France 2
https://raw.githubusercontent.com/Free-TV/IPTV/master/streams/fr.m3u8
#EXTINF:-1 tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/BFM_TV_logo_%28depuis_octobre_2021%29.svg/200px-BFM_TV_logo_%28depuis_octobre_2021%29.svg.png" group-title="NEWS",BFM TV
https://raw.githubusercontent.com/Free-TV/IPTV/master/streams/fr.m3u8
#EXTINF:-1 tvg-logo="" group-title="SPORT",Sport Demo 1
https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8
#EXTINF:-1 tvg-logo="" group-title="SPORT",Sport Demo 2
https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8
#EXTINF:-1 tvg-logo="" group-title="MOVIES",Cinéma Demo
https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8
#EXTINF:-1 tvg-logo="" group-title="KIDS",Kids Demo
https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8
`;

// ============================================================
// M3U PARSER
// ============================================================
function parseM3U(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const channels = [];

  if (!lines[0]?.startsWith('#EXTM3U')) {
    console.warn('[M3U] Not a valid M3U file');
  }

  let meta = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('#EXTINF:')) {
      // Parse attributes
      const nameMatch = line.match(/,(.+)$/);
      const name = nameMatch ? nameMatch[1].trim() : 'Unknown';
      const logo = extractAttr(line, 'tvg-logo');
      const tvgId = extractAttr(line, 'tvg-id');
      const groupRaw = extractAttr(line, 'group-title');
      const category = classifyChannel(name, groupRaw);

      meta = { name, logo, tvgId, category, groupRaw };

    } else if (!line.startsWith('#') && line.includes('://')) {
      if (meta) {
        channels.push({
          name: meta.name,
          url: line,
          logo: meta.logo,
          tvgId: meta.tvgId,
          category: meta.category,
          groupRaw: meta.groupRaw,
          id: channels.length,
        });
        meta = null;
      }
    }
  }

  return channels;
}

function extractAttr(line, attr) {
  const re = new RegExp(`${attr}="([^"]*)"`, 'i');
  const match = line.match(re);
  return match ? match[1].trim() : '';
}

// ============================================================
// CATEGORY CLASSIFIER
// ============================================================
const CATEGORY_RULES = [
  { cat: 'SPORT',  kw: ['sport','foot','football','soccer','tennis','nba','nfl','equipe','l1','ligue 1','motorsport','f1','rugby','basket','handball','cycling','golf','boxe','ufc','mma','olympic','euro'] },
  { cat: 'NEWS',   kw: ['news','info','actualit','bfm','cnews','lci','itele','france info','euronews','cnn','bbc','al jazeera','rfi','tv5','france24','rtl','rmc'] },
  { cat: 'MOVIES', kw: ['film','cine','cinema','movie','action','horreur','comedie','canal+','ocs','polar','serie','drama','max','prime','netflix','disney'] },
  { cat: 'KIDS',   kw: ['kids','enfant','child','junior','cartoon','anime','boomerang','nickelodeon','disney jr','tiji','gulli','piwi','tfou','boing'] },
  { cat: 'MUSIC',  kw: ['music','musique','hits','mtv','clubbing','radio','concert','jazz','classical','club'] },
];

function classifyChannel(name, group) {
  const haystack = `${name} ${group}`.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.kw.some(kw => haystack.includes(kw))) return rule.cat;
  }
  return 'OTHER';
}

// ============================================================
// EPG / XMLTV PARSER
// ============================================================
async function loadEPG(url) {
  if (!url) return;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    parseXMLTV(text);
    console.log('[EPG] Loaded, channels:', State.epgData.size);
    refreshChannelEPGPreviews();
  } catch (e) {
    console.warn('[EPG] Failed:', e.message);
  }
}

function parseXMLTV(xml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  const progs = doc.querySelectorAll('programme');

  progs.forEach(p => {
    const channel = p.getAttribute('channel');
    const start = parseXMLTVDate(p.getAttribute('start'));
    const end   = parseXMLTVDate(p.getAttribute('stop'));
    const title = p.querySelector('title')?.textContent?.trim() || '';
    const desc  = p.querySelector('desc')?.textContent?.trim() || '';

    if (!channel || !start || !title) return;

    if (!State.epgData.has(channel)) State.epgData.set(channel, []);
    State.epgData.get(channel).push({ start, end, title, desc });
  });
}

function parseXMLTVDate(str) {
  if (!str) return null;
  // Format: 20231015123000 +0200
  const clean = str.replace(/\s+[+-]\d{4}$/, '').trim();
  const y = clean.slice(0,4), mo = clean.slice(4,6), d = clean.slice(6,8);
  const h = clean.slice(8,10), mi = clean.slice(10,12), s = clean.slice(12,14);
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`);
}

function getEPGNow(channel) {
  if (!channel?.tvgId) return null;
  const progs = State.epgData.get(channel.tvgId);
  if (!progs?.length) return null;
  const now = new Date();
  return progs.find(p => p.start <= now && (!p.end || p.end > now)) || null;
}

function getEPGNext(channel) {
  if (!channel?.tvgId) return null;
  const progs = State.epgData.get(channel.tvgId);
  if (!progs?.length) return null;
  const now = new Date();
  const current = progs.find(p => p.start <= now && (!p.end || p.end > now));
  if (!current) return null;
  const idx = progs.indexOf(current);
  return progs[idx + 1] || null;
}

function getEPGList(channel) {
  if (!channel?.tvgId) return [];
  const progs = State.epgData.get(channel.tvgId) || [];
  const now = new Date();
  const start = new Date(now.getTime() - 2 * 3600 * 1000);
  const end   = new Date(now.getTime() + 6 * 3600 * 1000);
  return progs.filter(p => p.start >= start && p.start <= end);
}

function formatTime(date) {
  if (!date) return '';
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// ============================================================
// FAVORITES
// ============================================================
function loadFavorites() {
  try {
    const raw = localStorage.getItem('streamtv_favorites');
    if (raw) {
      const arr = JSON.parse(raw);
      State.favorites = new Set(arr);
    }
  } catch { State.favorites = new Set(); }
}

function saveFavorites() {
  try {
    localStorage.setItem('streamtv_favorites', JSON.stringify([...State.favorites]));
  } catch {}
}

function toggleFavorite(channelUrl) {
  if (State.favorites.has(channelUrl)) {
    State.favorites.delete(channelUrl);
    showToast('Retiré des favoris');
  } else {
    State.favorites.add(channelUrl);
    showToast('⭐ Ajouté aux favoris');
  }
  saveFavorites();
  updateFavButtons(channelUrl);
  if (State.currentCategory === 'FAV') applyFilters();
}

function isFav(url) { return State.favorites.has(url); }

// ============================================================
// LAST CHANNEL PERSISTENCE
// ============================================================
function saveLastChannel(channel) {
  try { localStorage.setItem('streamtv_last', JSON.stringify({ url: channel.url, id: channel.id })); }
  catch {}
}

function getLastChannel() {
  try { return JSON.parse(localStorage.getItem('streamtv_last') || 'null'); }
  catch { return null; }
}

// ============================================================
// FILTERING
// ============================================================
function applyFilters() {
  const q = State.searchQuery.toLowerCase().trim();
  let list = State.channels;

  if (State.currentCategory === 'FAV') {
    list = list.filter(c => State.favorites.has(c.url));
  } else if (State.currentCategory !== 'ALL') {
    list = list.filter(c => c.category === State.currentCategory);
  }

  if (q) {
    list = list.filter(c => c.name.toLowerCase().includes(q));
  }

  State.filtered = list;
  DOM.channelCount.textContent = `${list.length} chaîne${list.length !== 1 ? 's' : ''}`;
  renderChannels();
}

// ============================================================
// DOM CACHE
// ============================================================
const DOM = {};

function cacheDOM() {
  const ids = [
    'splash','setup-modal','app',
    'load-btn','m3u-url','epg-url','m3u-file','m3u-drop',
    'setup-error',
    'sidebar','channels-list','channel-count',
    'search-input','search-clear',
    'categories',
    'video-player','player-placeholder','player-overlay',
    'player-loading','player-loading-text','player-error','player-error-text',
    'retry-btn',
    'overlay-logo','overlay-channel-name','overlay-program','overlay-fav-btn',
    'epg-bar','epg-time-now','epg-title-now','epg-time-next','epg-title-next',
    'info-logo','info-name','info-cat',
    'fav-toggle-btn','fav-icon',
    'epg-panel','epg-list',
    'bottom-nav',
  ];
  ids.forEach(id => { DOM[camelize(id)] = document.getElementById(id); });
}

function camelize(str) {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// ============================================================
// RENDER CHANNELS
// ============================================================
function renderChannels() {
  const list = DOM.channelsList;
  list.innerHTML = '';

  if (!State.filtered.length) {
    list.innerHTML = `<div class="loading-channels"><span style="font-size:32px">📭</span><span>Aucune chaîne trouvée</span></div>`;
    return;
  }

  const frag = document.createDocumentFragment();

  State.filtered.forEach((ch, idx) => {
    const item = document.createElement('div');
    item.className = 'channel-item';
    item.dataset.idx = idx;
    if (State.currentChannel?.url === ch.url) item.classList.add('active');
    if (idx === State.focusedIndex) item.classList.add('focused');

    const epgNow = getEPGNow(ch);
    const epgText = epgNow ? epgNow.title : '';

    item.innerHTML = `
      <span class="channel-num">${ch.id + 1}</span>
      <div class="channel-logo-wrap">
        ${ch.logo
          ? `<img class="channel-logo" src="${escHtml(ch.logo)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><span class="channel-logo-placeholder" style="display:none">📺</span>`
          : `<span class="channel-logo-placeholder">📺</span>`}
      </div>
      <div class="channel-info">
        <div class="channel-name">${escHtml(ch.name)}</div>
        ${epgText ? `<div class="channel-epg-preview">${escHtml(epgText)}</div>` : ''}
      </div>
      <button class="channel-fav-btn ${isFav(ch.url) ? 'active' : ''}" data-url="${escHtml(ch.url)}" title="Favori">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="${isFav(ch.url) ? '#f59e0b' : 'none'}" stroke="${isFav(ch.url) ? '#f59e0b' : 'currentColor'}" stroke-width="2">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
        </svg>
      </button>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.channel-fav-btn')) {
        e.stopPropagation();
        toggleFavorite(ch.url);
        return;
      }
      State.focusedIndex = idx;
      playChannel(ch);
    });

    frag.appendChild(item);
  });

  list.appendChild(frag);
}

function refreshChannelEPGPreviews() {
  document.querySelectorAll('.channel-item').forEach(item => {
    const idx = parseInt(item.dataset.idx);
    const ch = State.filtered[idx];
    if (!ch) return;
    const epgNow = getEPGNow(ch);
    let preview = item.querySelector('.channel-epg-preview');
    if (epgNow?.title) {
      if (!preview) {
        preview = document.createElement('div');
        preview.className = 'channel-epg-preview';
        item.querySelector('.channel-info').appendChild(preview);
      }
      preview.textContent = epgNow.title;
    }
  });
}

function updateFavButtons(url) {
  const fav = isFav(url);
  document.querySelectorAll(`.channel-fav-btn[data-url="${CSS.escape(url)}"]`).forEach(btn => {
    btn.classList.toggle('active', fav);
    const svg = btn.querySelector('svg');
    if (svg) {
      svg.setAttribute('fill', fav ? '#f59e0b' : 'none');
      svg.setAttribute('stroke', fav ? '#f59e0b' : 'currentColor');
    }
  });
  // Update main fav button
  if (State.currentChannel?.url === url) updateFavUI();
}

function updateFavUI() {
  const fav = isFav(State.currentChannel?.url);
  DOM.favToggleBtn.classList.toggle('active', fav);
  DOM.overlayFavBtn.classList.toggle('active', fav);
}

// ============================================================
// PLAYER
// ============================================================
function playChannel(channel) {
  if (State.currentChannel?.url === channel.url) return;

  State.currentChannel = channel;
  saveLastChannel(channel);

  // Update active in list
  document.querySelectorAll('.channel-item').forEach(el => {
    el.classList.toggle('active', el.dataset.idx == State.filtered.indexOf(channel));
  });

  // Update info panel
  DOM.infoLogo.src = channel.logo || '';
  DOM.infoLogo.style.display = channel.logo ? '' : 'none';
  DOM.infoName.textContent = channel.name;
  DOM.infoCat.textContent = catLabel(channel.category);

  updateFavUI();
  updateEPGDisplay();
  loadStream(channel.url);

  // On mobile, close sidebar
  if (window.innerWidth < 768) {
    DOM.sidebar.classList.remove('open');
  }
}

function loadStream(url) {
  DOM.playerPlaceholder.classList.add('hidden');
  DOM.videoPlayer.classList.remove('hidden');
  DOM.playerError.classList.add('hidden');
  DOM.playerLoading.classList.remove('hidden');
  DOM.playerLoadingText.textContent = 'Connexion au flux...';

  // Cleanup previous HLS instance
  if (State.hlsInstance) {
    State.hlsInstance.destroy();
    State.hlsInstance = null;
  }

  const video = DOM.videoPlayer;
  video.src = '';

  const isHLS = url.includes('.m3u8') || url.includes('/hls/');

  if (isHLS && typeof Hls !== 'undefined' && Hls.isSupported()) {
    // Use HLS.js (Android Chrome, desktop)
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 30,
      maxBufferLength: 30,
    });
    State.hlsInstance = hls;
    hls.loadSource(url);
    hls.attachMedia(video);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      DOM.playerLoading.classList.add('hidden');
      video.play().catch(() => {});
      showPlayerOverlay();
    });
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) {
        showPlayerError(`Erreur HLS : ${data.type}`);
      }
    });

  } else if (video.canPlayType('application/vnd.apple.mpegurl') || !isHLS) {
    // Native HLS (Safari/iOS) or direct stream
    video.src = url;
    video.load();

    const onCanPlay = () => {
      DOM.playerLoading.classList.add('hidden');
      showPlayerOverlay();
      video.removeEventListener('canplay', onCanPlay);
    };
    const onError = () => {
      showPlayerError('Format non supporté ou flux indisponible');
      video.removeEventListener('error', onError);
    };
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('error', onError);
    video.play().catch(() => {});

  } else {
    showPlayerError('HLS.js non disponible — rechargez la page');
  }
}

function showPlayerError(msg) {
  DOM.playerLoading.classList.add('hidden');
  DOM.playerError.classList.remove('hidden');
  DOM.playerErrorText.textContent = msg;
}

function showPlayerOverlay() {
  const overlay = DOM.playerOverlay;
  const ch = State.currentChannel;
  if (!ch) return;

  DOM.overlayLogo.src = ch.logo || '';
  DOM.overlayLogo.style.display = ch.logo ? '' : 'none';
  DOM.overlayChannelName.textContent = ch.name;

  const epgNow = getEPGNow(ch);
  DOM.overlayProgram.textContent = epgNow?.title || '';

  overlay.classList.add('visible');
  resetOverlayTimer();
}

function resetOverlayTimer() {
  clearTimeout(State.overlayTimer);
  State.overlayTimer = setTimeout(() => {
    DOM.playerOverlay.classList.remove('visible');
  }, 4000);
}

function updateEPGDisplay() {
  const ch = State.currentChannel;
  const epgNow  = getEPGNow(ch);
  const epgNext = getEPGNext(ch);

  // Overlay bar
  DOM.epgTimNow.textContent  = epgNow  ? formatTime(epgNow.start)  : '';
  DOM.epgTitleNow.textContent = epgNow  ? epgNow.title  : 'Aucune donnée EPG';
  DOM.epgTimeNext.textContent = epgNext ? formatTime(epgNext.start) : '';
  DOM.epgTitleNext.textContent = epgNext ? epgNext.title : '';

  // EPG panel list
  const list = getEPGList(ch);
  if (!list.length) {
    DOM.epgList.innerHTML = '<span class="epg-empty">Aucune donnée EPG disponible</span>';
    return;
  }
  const now = new Date();
  DOM.epgList.innerHTML = list.map(p => {
    const isCurrent = p.start <= now && (!p.end || p.end > now);
    return `
      <div class="epg-item ${isCurrent ? 'current' : ''}">
        <div class="epg-item-time">${formatTime(p.start)}</div>
        <div class="epg-item-content">
          <div class="epg-item-title">${escHtml(p.title)}</div>
          ${p.desc ? `<div class="epg-item-desc">${escHtml(p.desc)}</div>` : ''}
        </div>
        ${isCurrent ? '<div class="epg-live-badge">EN DIRECT</div>' : ''}
      </div>`;
  }).join('');
}

// ============================================================
// KEYBOARD NAVIGATION
// ============================================================
function initKeyboardNav() {
  document.addEventListener('keydown', (e) => {
    const list = State.filtered;
    if (!list.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      State.focusedIndex = Math.min(State.focusedIndex + 1, list.length - 1);
      updateFocusUI();
      scrollToFocused();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      State.focusedIndex = Math.max(State.focusedIndex - 1, 0);
      updateFocusUI();
      scrollToFocused();
    } else if (e.key === 'Enter') {
      playChannel(list[State.focusedIndex]);
    } else if (e.key === 'f' || e.key === 'F') {
      const ch = list[State.focusedIndex];
      if (ch) toggleFavorite(ch.url);
    }
  });
}

function updateFocusUI() {
  document.querySelectorAll('.channel-item').forEach(el => {
    el.classList.toggle('focused', parseInt(el.dataset.idx) === State.focusedIndex);
  });
}

function scrollToFocused() {
  const el = document.querySelector(`.channel-item[data-idx="${State.focusedIndex}"]`);
  el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ============================================================
// SWIPE (iPhone)
// ============================================================
function initSwipe() {
  let touchStartY = 0;
  let touchStartTime = 0;

  const playerArea = document.getElementById('player-area');

  playerArea.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
    touchStartTime = Date.now();
    showPlayerOverlay();
    resetOverlayTimer();
  }, { passive: true });

  playerArea.addEventListener('touchend', (e) => {
    const dy = touchStartY - e.changedTouches[0].clientY;
    const dt = Date.now() - touchStartTime;
    if (Math.abs(dy) > 50 && dt < 500) {
      const dir = dy > 0 ? 1 : -1; // swipe up = next, swipe down = prev
      navigateChannel(dir);
    }
  }, { passive: true });

  // Left/Right swipe: open/close sidebar on mobile
  let touchStartX = 0;
  document.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 80 && window.innerWidth < 768) {
      if (dx > 0 && touchStartX < 30) {
        DOM.sidebar.classList.add('open');
      } else if (dx < 0) {
        DOM.sidebar.classList.remove('open');
      }
    }
  }, { passive: true });
}

function navigateChannel(dir) {
  const list = State.filtered;
  if (!list.length) return;
  const curIdx = State.currentChannel ? list.findIndex(c => c.url === State.currentChannel.url) : -1;
  let next = curIdx + dir;
  if (next < 0) next = list.length - 1;
  if (next >= list.length) next = 0;
  State.focusedIndex = next;
  playChannel(list[next]);
}

// ============================================================
// SETUP MODAL
// ============================================================
function initSetupModal() {
  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      State.loadSource = btn.dataset.tab;
    });
  });

  // File drag & drop
  const drop = DOM.m3uDrop;
  ['dragenter','dragover'].forEach(ev => {
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag-over'); });
  });
  ['dragleave','drop'].forEach(ev => {
    drop.addEventListener(ev, () => drop.classList.remove('drag-over'));
  });
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileLoad(file);
  });
  DOM.m3uFile.addEventListener('change', (e) => {
    if (e.target.files[0]) handleFileLoad(e.target.files[0]);
  });

  // Load button
  DOM.loadBtn.addEventListener('click', handleLoad);
}

async function handleLoad() {
  hideSetupError();
  DOM.loadBtn.disabled = true;
  DOM.loadBtn.querySelector('span').textContent = 'Chargement...';

  try {
    let m3uText = '';
    let epgUrl = DOM.epgUrl.value.trim();

    if (State.loadSource === 'demo') {
      m3uText = DEMO_M3U;
    } else if (State.loadSource === 'url') {
      const url = DOM.m3uUrl.value.trim();
      if (!url) throw new Error('Entrez une URL M3U valide');
      m3uText = await fetchM3U(url);
    } else {
      throw new Error('Sélectionnez un fichier M3U');
    }

    const channels = parseM3U(m3uText);
    if (!channels.length) throw new Error('Aucune chaîne trouvée dans la playlist');

    // Save config
    try {
      localStorage.setItem('streamtv_m3u_url', DOM.m3uUrl.value.trim());
      localStorage.setItem('streamtv_epg_url', epgUrl);
    } catch {}

    State.channels = channels;
    State.filtered = channels;
    State.currentCategory = 'ALL';

    hideModal();
    initApp(epgUrl);

  } catch (e) {
    showSetupError(e.message);
  } finally {
    DOM.loadBtn.disabled = false;
    DOM.loadBtn.querySelector('span').textContent = 'Charger les chaînes';
  }
}

async function fetchM3U(url) {
  let fetchUrl = url;
  // Try direct fetch first (works if CORS is open)
  try {
    const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    // If CORS error, try a public proxy
    const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxy, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error('Impossible de charger la playlist (CORS bloqué)');
    const data = await res.json();
    return data.contents;
  }
}

function handleFileLoad(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const channels = parseM3U(e.target.result);
    if (!channels.length) {
      showSetupError('Aucune chaîne dans ce fichier M3U');
      return;
    }
    State.channels = channels;
    State.filtered = channels;
    State.currentCategory = 'ALL';
    hideModal();
    initApp('');
  };
  reader.readAsText(file);
}

function showSetupError(msg) {
  DOM.setupError.textContent = msg;
  DOM.setupError.classList.remove('hidden');
}
function hideSetupError() { DOM.setupError.classList.add('hidden'); }

function hideModal() {
  DOM.setupModal.classList.add('hidden');
}

// ============================================================
// MAIN APP INIT
// ============================================================
function initApp(epgUrl) {
  DOM.app.classList.remove('hidden');
  applyFilters();
  renderChannels();
  initEPGRefresh();

  if (epgUrl) loadEPG(epgUrl);

  // Resume last channel
  const last = getLastChannel();
  if (last) {
    const ch = State.channels.find(c => c.url === last.url);
    if (ch) playChannel(ch);
  }
}

// ============================================================
// CATEGORIES
// ============================================================
function initCategories() {
  DOM.categories.addEventListener('click', (e) => {
    const btn = e.target.closest('.cat-btn');
    if (!btn) return;
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    State.currentCategory = btn.dataset.cat;
    State.focusedIndex = 0;
    applyFilters();
  });
}

// ============================================================
// SEARCH
// ============================================================
function initSearch() {
  DOM.searchInput.addEventListener('input', (e) => {
    State.searchQuery = e.target.value;
    DOM.searchClear.classList.toggle('hidden', !State.searchQuery);
    State.focusedIndex = 0;
    applyFilters();
  });
  DOM.searchClear.addEventListener('click', () => {
    DOM.searchInput.value = '';
    State.searchQuery = '';
    DOM.searchClear.classList.add('hidden');
    applyFilters();
    DOM.searchInput.focus();
  });
}

// ============================================================
// BOTTOM NAV (mobile)
// ============================================================
function initBottomNav() {
  DOM.bottomNav.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-btn');
    if (!btn) return;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const view = btn.dataset.view;
    if (view === 'home' || view === 'search') {
      DOM.sidebar.classList.add('open');
      if (view === 'search') setTimeout(() => DOM.searchInput.focus(), 300);
    } else if (view === 'fav') {
      State.currentCategory = 'FAV';
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === 'FAV'));
      applyFilters();
      DOM.sidebar.classList.add('open');
    } else if (view === 'guide') {
      DOM.sidebar.classList.remove('open');
    }
  });
}

// ============================================================
// OVERLAY INTERACTION
// ============================================================
function initPlayerInteractions() {
  const playerArea = document.getElementById('player-area');

  playerArea.addEventListener('click', () => {
    if (DOM.playerOverlay.classList.contains('visible')) {
      DOM.playerOverlay.classList.remove('visible');
      clearTimeout(State.overlayTimer);
    } else {
      showPlayerOverlay();
    }
  });

  DOM.overlayFavBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (State.currentChannel) toggleFavorite(State.currentChannel.url);
  });

  DOM.favToggleBtn.addEventListener('click', () => {
    if (State.currentChannel) toggleFavorite(State.currentChannel.url);
  });

  DOM.retryBtn.addEventListener('click', () => {
    DOM.playerError.classList.add('hidden');
    if (State.currentChannel) loadStream(State.currentChannel.url);
  });
}

// ============================================================
// SETTINGS BUTTON → reset to setup
// ============================================================
function initSettings() {
  DOM.settingsBtn.addEventListener('click', () => {
    if (!confirm('Charger une nouvelle playlist ? La lecture en cours sera arrêtée.')) return;
    if (State.hlsInstance) { State.hlsInstance.destroy(); State.hlsInstance = null; }
    DOM.videoPlayer.src = '';
    DOM.videoPlayer.classList.add('hidden');
    DOM.playerPlaceholder.classList.remove('hidden');
    DOM.playerOverlay.classList.remove('visible');
    DOM.app.classList.add('hidden');
    DOM.setupModal.classList.remove('hidden');
  });
}

// ============================================================
// EPG AUTO-REFRESH
// ============================================================
function initEPGRefresh() {
  setInterval(() => {
    if (State.currentChannel) updateEPGDisplay();
  }, 60 * 1000);
}

// ============================================================
// TOAST
// ============================================================
let toastTimeout;
function showToast(msg) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ============================================================
// UTILS
// ============================================================
function escHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function catLabel(cat) {
  const labels = { SPORT: '⚽ Sport', NEWS: '📰 Infos', MOVIES: '🎬 Films', KIDS: '🧸 Kids', MUSIC: '🎵 Musique', OTHER: '📡 Autres' };
  return labels[cat] || cat;
}

// ============================================================
// BOOT
// ============================================================
function boot() {
  cacheDOM();
  loadFavorites();

  // Init UI
  initSetupModal();
  initCategories();
  initSearch();
  initKeyboardNav();
  initSwipe();
  initPlayerInteractions();
  initBottomNav();
  initSettings();

  // Restore saved config
  const savedM3U = localStorage.getItem('streamtv_m3u_url') || '';
  const savedEPG = localStorage.getItem('streamtv_epg_url') || '';
  if (savedM3U) DOM.m3uUrl.value = savedM3U;
  if (savedEPG) DOM.epgUrl.value = savedEPG;

  // Splash → setup modal
  setTimeout(() => {
    DOM.splash.classList.add('fade-out');
    setTimeout(() => {
      DOM.splash.classList.add('hidden');
      DOM.setupModal.classList.remove('hidden');
    }, 500);
  }, 1500);
}

document.addEventListener('DOMContentLoaded', boot);
