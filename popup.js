// Media Grabber v3.2 — Popup script
// Support for HLS/DASH segments and MediaSource buffers

let allMedia = { images: [], videos: [], streams: [] };
let currentTab = 'images';
let selectedItems = new Set();

// ─── Helpers ────────────────────────────────────────────────────────

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFilename(url) {
  try {
    if (url.startsWith('data:') || url.startsWith('blob:')) return `media_${Date.now()}.png`;
    const pathname = new URL(url).pathname;
    const name = pathname.split('/').pop();
    if (name && name.includes('.')) return name.split('?')[0];
    return `media_${Date.now()}.webp`;
  } catch {
    return `media_${Date.now()}.webp`;
  }
}

function isVideoFile(url) {
  if (!url) return false;
  return /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|3gp)(\?|$|#)/i.test(url);
}

function isVideoSegment(url) {
  if (!url) return false;
  return url.includes('.ts?') || url.includes('.ts&') || 
         url.includes('.m4s?') || url.includes('.m4s&') ||
         url.includes('segment') || url.includes('chunk');
}

function isVideoManifest(url) {
  if (!url) return false;
  return /\.m3u8(\?|$|#)/i.test(url) || /\.mpd(\?|$|#)/i.test(url);
}

function isImageUrl(url) {
  if (!url) return false;
  if (url.startsWith('data:image/')) return true;
  return /\.(webp|jpg|jpeg|png|gif|avif|bmp|tiff|ico)(\?|$|#)/i.test(url);
}

function isDownloadable(url) {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

// ─── Classify Media ─────────────────────────────────────────────────

function classifyAllMedia() {
  const images = [];
  const videos = [];
  const streams = [];  // HLS/DASH streams
  const seen = new Set();
  
  const allSources = [
    ...(allMedia.page || []),
    ...(allMedia.network || []),
    ...(allMedia.intercepted || [])
  ];
  
  for (const item of allSources) {
    const url = item.url || item.src || item.blobUrl || item.originalUrl || '';
    if (!url || seen.has(url)) continue;
    seen.add(url);
    
    // Skip non-HTTP URLs (except data: images)
    if (url.startsWith('data:')) {
      if (url.startsWith('data:image/')) {
        item._downloadable = false;
        item._type = 'image';
        images.push(item);
      }
      continue;
    }
    
    if (!url.startsWith('http://') && !url.startsWith('https://')) continue;
    
    // Classify based on URL patterns
    if (item.isManifest || isVideoManifest(url)) {
      // HLS/DASH manifest
      item._type = 'stream';
      item._downloadable = true;
      item._streamType = url.includes('.m3u8') ? 'HLS' : 'DASH';
      streams.push(item);
    } else if (item.isSegment || isVideoSegment(url)) {
      // Video segment
      item._type = 'segment';
      item._downloadable = true;
      videos.push(item);
    } else if (item.isVideo || isVideoFile(url)) {
      // Direct video file
      item._type = 'video';
      item._downloadable = true;
      videos.push(item);
    } else if (isImageUrl(url)) {
      // Image
      item._type = 'image';
      item._downloadable = true;
      images.push(item);
    }
  }
  
  allMedia.images = images;
  allMedia.videos = videos;
  allMedia.streams = streams;
}

// ─── Render Media List ──────────────────────────────────────────────

function renderMedia() {
  classifyAllMedia();
  
  const list = document.getElementById('media-list');
  const items = allMedia[currentTab] || [];
  
  // Update counts
  document.getElementById('images-count').textContent = allMedia.images.length;
  document.getElementById('videos-count').textContent = allMedia.videos.length + allMedia.streams.length;
  document.getElementById('total-count').textContent = 
    `${allMedia.images.length + allMedia.videos.length + allMedia.streams.length} items`;
  
  updateSelectedCount();
  
  if (items.length === 0) {
    const icon = currentTab === 'images' ? '🖼️' : '🎬';
    const label = currentTab === 'images' ? 'gambar' : 'video';
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${icon}</div>
        <div class="empty-title">Tidak Ada ${currentTab === 'images' ? 'Gambar' : 'Video'}</div>
        <div class="empty-text">Tidak ditemukan ${label} di halaman ini.<br>Untuk video streaming, coba putar video terlebih dahulu.</div>
      </div>
    `;
    return;
  }
  
  list.innerHTML = items.map((item, i) => {
    const url = item.url || item.src || item.blobUrl || item.originalUrl || '';
    const downloadable = isDownloadable(url);
    const type = item._type || 'video';
    const icon = type === 'stream' ? '📡' : type === 'segment' ? '🧩' : type === 'video' ? '🎬' : '🖼️';
    const size = formatSize(item.size);
    const width = item.width || item.naturalWidth || item.videoWidth;
    const height = item.height || item.naturalHeight || item.videoHeight;
    const dimensions = width && height ? `${width}×${height}` : '';
    const shortUrl = url.length > 45 ? url.substring(0, 45) + '...' : url;
    const isSelected = selectedItems.has(i);
    const poster = item.poster || '';
    const streamType = item._streamType || '';
    
    // Badge label
    let badgeLabel = type === 'stream' ? `Stream ${streamType}` : 
                     type === 'segment' ? 'Segment' :
                     type === 'video' ? 'Video' : 'Image';
    
    // Thumbnail
    let thumbHtml;
    if (type === 'stream' || type === 'segment') {
      thumbHtml = `<div class="media-thumb-placeholder">${icon}</div>`;
    } else if (type === 'video') {
      if (poster && poster.startsWith('http')) {
        thumbHtml = `<img class="media-thumb" src="${poster}" onerror="this.outerHTML='<div class=media-thumb-placeholder>🎬</div>'" loading="lazy">`;
      } else {
        thumbHtml = `<div class="media-thumb-placeholder">🎬</div>`;
      }
    } else {
      if (url.startsWith('data:image/') || url.startsWith('http')) {
        thumbHtml = `<img class="media-thumb" src="${url}" onerror="this.outerHTML='<div class=media-thumb-placeholder>🖼️</div>'" loading="lazy">`;
      } else {
        thumbHtml = `<div class="media-thumb-placeholder">🖼️</div>`;
      }
    }
    
    // Badge color
    let badgeClass = 'image';
    if (type === 'video' || type === 'segment') badgeClass = 'video';
    if (type === 'stream') badgeClass = 'stream';
    
    return `
      <div class="media-card ${isSelected ? 'selected' : ''}" data-index="${i}">
        <input type="checkbox" class="media-checkbox" data-index="${i}" ${isSelected ? 'checked' : ''} ${!downloadable ? 'disabled' : ''}>
        ${thumbHtml}
        <div class="media-info">
          <div class="media-type-badge ${badgeClass}">${badgeLabel}</div>
          <div class="media-url" title="${url}">${shortUrl}</div>
          <div class="media-meta">
            ${size ? `<span class="media-size">📦 ${size}</span>` : ''}
            ${dimensions ? `<span class="media-dimensions">📐 ${dimensions}</span>` : ''}
          </div>
        </div>
        ${downloadable ? `
          <button class="media-download-btn" data-index="${i}" title="Download">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
        ` : ''}
      </div>
    `;
  }).join('');
  
  // Event handlers
  list.querySelectorAll('.media-checkbox:not([disabled])').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.index);
      if (e.target.checked) {
        selectedItems.add(idx);
      } else {
        selectedItems.delete(idx);
      }
      e.target.closest('.media-card').classList.toggle('selected', e.target.checked);
      updateSelectedCount();
    });
  });
  
  list.querySelectorAll('.media-download-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      const item = allMedia[currentTab][idx];
      const url = item.url || item.src || item.blobUrl || item.originalUrl || '';
      const folder = document.getElementById('folder-input').value || 'MediaGrabber';
      const type = item._type || '';
      
      if (type === 'stream' || item.isManifest || item.isStream || isVideoManifest(url)) {
        // HLS/DASH stream — use HLSDownloader via content script
        const filename = getFilename(url).replace(/\.[^.]+$/, '') + '.ts';
        downloadHLSStream(url, filename);
      } else {
        chrome.runtime.sendMessage({
          type: 'DOWNLOAD_ONE',
          url: url,
          filename: getFilename(url),
          folder: folder
        });
      }
    });
  });
  
  const selectAll = document.getElementById('select-all');
  selectAll.checked = items.length > 0 && items.every((_, i) => selectedItems.has(i));
}

function updateSelectedCount() {
  const items = allMedia[currentTab] || [];
  const selectedCount = [...selectedItems].filter(i => i < items.length).length;
  document.getElementById('selected-count').textContent = `(${selectedCount})`;
}

// ─── Tab Switching ──────────────────────────────────────────────────

document.querySelectorAll('.segment').forEach(segment => {
  segment.addEventListener('click', () => {
    document.querySelectorAll('.segment').forEach(s => s.classList.remove('active'));
    segment.classList.add('active');
    currentTab = segment.dataset.tab;
    selectedItems.clear();
    renderMedia();
  });
});

// ─── Select All ─────────────────────────────────────────────────────

document.getElementById('select-all').addEventListener('change', (e) => {
  const items = allMedia[currentTab] || [];
  if (e.target.checked) {
    items.forEach((item, i) => {
      const url = item.url || item.src || item.blobUrl || item.originalUrl || '';
      if (isDownloadable(url)) {
        selectedItems.add(i);
      }
    });
  } else {
    selectedItems.clear();
  }
  renderMedia();
});

// ─── Scan Page ──────────────────────────────────────────────────────

async function scanPage() {
  const tab = await getCurrentTab();
  
  document.getElementById('header-status').textContent = 'Scanning...';
  document.getElementById('media-list').innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <span>Memindai halaman...</span>
    </div>
  `;
  
  // Get network intercepted media
  chrome.runtime.sendMessage({ type: 'GET_MEDIA', tabId: tab.id }, (response) => {
    if (response?.media) {
      allMedia.network = response.media;
      renderMedia();
    }
  });
  
  // Get content script intercepted data
  chrome.runtime.sendMessage({ type: 'GET_INTERCEPTED', tabId: tab.id }, (response) => {
    if (response?.media) {
      allMedia.intercepted = response.media;
      renderMedia();
    }
  });
  
  // Inject scan into page
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const media = [];
      
      // Scan images
      document.querySelectorAll('img').forEach(img => {
        const src = img.src;
        if (src && img.width > 50 && !src.startsWith('data:')) {
          media.push({ 
            type: 'image', 
            source: 'img', 
            url: src, 
            width: img.naturalWidth || img.width, 
            height: img.naturalHeight || img.height 
          });
        }
      });
      
      // Scan videos - capture ALL video elements
      document.querySelectorAll('video').forEach(vid => {
        const src = vid.src || vid.currentSrc;
        if (src) {
          media.push({ 
            type: 'video', 
            source: 'video', 
            url: src,
            width: vid.videoWidth || vid.width,
            height: vid.videoHeight || vid.height,
            poster: vid.poster || '',
            isVideo: true
          });
        }
        
        // Check source elements
        vid.querySelectorAll('source').forEach(s => {
          if (s.src) {
            media.push({ 
              type: 'video', 
              source: 'video-src', 
              url: s.src,
              width: vid.videoWidth || vid.width,
              height: vid.videoHeight || vid.height,
              poster: vid.poster || '',
              isVideo: true
            });
          }
        });
      });
      
      // Scan links to video files
      document.querySelectorAll('a[href]').forEach(a => {
        if (/\.(mp4|webm|mov|avi|mkv|flv|m4v)(\?|$|#)/i.test(a.href)) {
          media.push({ url: a.href, source: 'link', type: 'video', isVideo: true });
        }
        // HLS/DASH manifests
        if (/\.m3u8(\?|$|#)/i.test(a.href) || /\.mpd(\?|$|#)/i.test(a.href)) {
          media.push({ url: a.href, source: 'link-manifest', type: 'stream', isManifest: true });
        }
      });
      
      // Scan CSS background images
      document.querySelectorAll('*').forEach(el => {
        try {
          const bg = getComputedStyle(el).backgroundImage;
          if (bg && bg !== 'none' && !bg.includes('gradient')) {
            const match = bg.match(/url\("?([^"]+)"?\)/);
            if (match && match[1] && !match[1].startsWith('data:') && !match[1].includes('svg')) {
              media.push({ type: 'bg-image', source: 'css-bg', url: match[1] });
            }
          }
        } catch (e) {}
      });
      
      // Deduplicate
      const seen = new Set();
      return media.filter(m => {
        if (seen.has(m.url)) return false;
        seen.add(m.url);
        return true;
      });
    }
  }, (results) => {
    if (results?.[0]?.result) {
      allMedia.page = results[0].result;
      renderMedia();
      
      const totalVideos = allMedia.videos.length + allMedia.streams.length;
      document.getElementById('header-status').textContent = 
        `Ditemukan ${allMedia.images.length} gambar & ${totalVideos} video`;
    }
  });
}

// ─── Download Handlers ──────────────────────────────────────────────

document.getElementById('btn-download-selected').addEventListener('click', () => {
  const items = allMedia[currentTab] || [];
  const folder = document.getElementById('folder-input').value || 'MediaGrabber';
  const downloadItems = [];
  
  selectedItems.forEach(idx => {
    const item = items[idx];
    if (!item) return;
    const url = item.url || item.src || item.blobUrl || item.originalUrl || '';
    if (isDownloadable(url)) {
      downloadItems.push({ url, filename: getFilename(url) });
    }
  });
  
  if (downloadItems.length === 0) {
    document.getElementById('header-status').textContent = 'Tidak ada item yang dipilih';
    return;
  }
  
  startDownload(downloadItems, folder);
});

document.getElementById('btn-download-all').addEventListener('click', () => {
  const folder = document.getElementById('folder-input').value || 'MediaGrabber';
  const downloadItems = [];
  const seen = new Set();
  
  const items = allMedia[currentTab] || [];
  for (const item of items) {
    const url = item.url || item.src || item.blobUrl || item.originalUrl || '';
    if (isDownloadable(url) && !seen.has(url)) {
      seen.add(url);
      downloadItems.push({ url, filename: getFilename(url) });
    }
  }
  
  if (downloadItems.length === 0) {
    document.getElementById('header-status').textContent = 'Tidak ada media untuk diunduh';
    return;
  }
  
  startDownload(downloadItems, folder);
});

function startDownload(items, folder) {
  const progress = document.getElementById('progress');
  progress.classList.add('active');
  document.getElementById('progress-text').textContent = 'Mengunduh...';
  document.getElementById('progress-count').textContent = `0 / ${items.length}`;
  document.getElementById('progress-fill').style.width = '0%';
  document.getElementById('header-status').textContent = `Mengunduh ${items.length} file...`;
  
  chrome.runtime.sendMessage({
    type: 'DOWNLOAD_BATCH',
    items: items,
    folder: folder
  }, (response) => {
    if (response?.error) {
      document.getElementById('header-status').textContent = `Error: ${response.error}`;
      progress.classList.remove('active');
    }
  });
}

// ─── Platform Scan (YouTube, TikTok, Instagram, etc) ──────────────

let platformResults = [];

async function scanPlatform() {
  const tab = await getCurrentTab();
  const statusEl = document.getElementById('header-status');
  const btn = document.getElementById('platform-scan-btn');
  
  statusEl.textContent = '🔍 Scanning platform...';
  btn.disabled = true;
  btn.style.opacity = '0.6';
  
  chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_PLATFORM' }, (response) => {
    btn.disabled = false;
    btn.style.opacity = '1';
    
    if (chrome.runtime.lastError) {
      statusEl.textContent = '❌ Refresh halaman dulu, lalu coba lagi';
      return;
    }
    
    if (!response?.success) {
      statusEl.textContent = `❌ ${response?.error || 'Extraction failed'}`;
      return;
    }
    
    const { platform, results } = response;
    platformResults = results;
    
    if (results.length === 0) {
      statusEl.textContent = `ℹ️ ${platform}: Tidak ditemukan video`;
      return;
    }
    
    // Separate by type
    const videos = results.filter(r => r.isVideo || r.type === 'video');
    const audio = results.filter(r => r.isAudio || r.type === 'audio');
    const streams = results.filter(r => r.isStream || r.type === 'stream');
    
    statusEl.textContent = `✅ ${platform}: ${videos.length} video, ${audio.length} audio`;
    
    // Add platform results to the media list
    const platformItems = results.map(r => ({
      url: r.url,
      source: r.source,
      isVideo: r.isVideo !== false,
      isManifest: r.isManifest || false,
      isStream: r.isStream || false,
      width: r.width || 0,
      height: r.height || 0,
      size: r.size || 0,
      poster: r.thumbnail || '',
      _platform: platform,
      _quality: r.quality || '',
      _format: r.format || '',
      _hasAudio: r.hasAudio,
      _hasVideo: r.hasVideo,
      _bitrate: r.bitrate || 0
    }));
    
    // Merge with existing intercepted data
    if (!allMedia.intercepted) allMedia.intercepted = [];
    for (const item of platformItems) {
      if (!allMedia.intercepted.find(x => x.url === item.url)) {
        allMedia.intercepted.push(item);
      }
    }
    
    renderMedia();
    
    // If there are multiple qualities, show quality picker
    if (videos.length > 1) {
      showQualityPicker(platform, videos);
    }
  });
}

function showQualityPicker(platform, videos) {
  const modal = document.getElementById('quality-modal');
  const title = document.getElementById('modal-title');
  const body = document.getElementById('modal-body');
  
  title.textContent = `${getPlatformIcon(platform)} Pilih Kualitas Video`;
  
  // Sort by quality (height) descending
  const sorted = [...videos].sort((a, b) => (b.height || 0) - (a.height || 0));
  
  body.innerHTML = `
    <div class="platform-badge">${getPlatformIcon(platform)} ${platform}</div>
    ${sorted.map((v, i) => `
      <div class="quality-item" data-index="${i}" data-url="${escapeHtml(v.url)}">
        <div class="quality-icon ${v.isAudio ? 'audio-icon' : 'video-icon'}">
          ${v.isAudio ? '🎵' : '🎬'}
        </div>
        <div class="quality-info">
          <div class="quality-label">${v.quality || 'Unknown'} ${v.format ? `(${v.format})` : ''}</div>
          <div class="quality-detail">
            ${v.width && v.height ? `${v.width}×${v.height}` : ''}
            ${v.size ? ` • ${formatSize(v.size)}` : ''}
            ${v.bitrate ? ` • ${v.bitrate}kbps` : ''}
            ${v.hasAudio === false ? ' • Video only' : ''}
            ${v.hasAudio === true && !v.isVideo ? ' • Audio only' : ''}
          </div>
        </div>
        <div class="quality-badge">${v.quality || '?'}</div>
      </div>
    `).join('')}
  `;
  
  // Click handlers
  body.querySelectorAll('.quality-item').forEach(item => {
    item.addEventListener('click', () => {
      const url = item.dataset.url;
      const idx = parseInt(item.dataset.index);
      const video = sorted[idx];
      
      // Highlight selected
      body.querySelectorAll('.quality-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      
      // Download
      const filename = `${platform}_video_${video.quality || 'download'}.${video.format || 'mp4'}`;
      
      if (video.isStream || video.isManifest) {
        downloadHLSStream(url, filename);
      } else {
        chrome.runtime.sendMessage({
          type: 'DOWNLOAD_ONE',
          url: url,
          filename: filename,
          folder: document.getElementById('folder-input').value || 'MediaGrabber'
        });
      }
      
      // Close modal after short delay
      setTimeout(() => { modal.style.display = 'none'; }, 500);
    });
  });
  
  modal.style.display = 'flex';
}

function getPlatformIcon(platform) {
  const icons = {
    youtube: '🔴', tiktok: '🎵', instagram: '📸',
    twitter: '🐦', facebook: '📘', vimeo: '🎬',
    dailymotion: '📺', reddit: '🟠'
  };
  return icons[platform] || '🌐';
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Platform scan button
document.getElementById('platform-scan-btn').addEventListener('click', scanPlatform);

// Modal close
document.getElementById('modal-close').addEventListener('click', () => {
  document.getElementById('quality-modal').style.display = 'none';
});
document.getElementById('quality-modal').addEventListener('click', (e) => {
  if (e.target.id === 'quality-modal') {
    document.getElementById('quality-modal').style.display = 'none';
  }
});

// ─── Refresh Button ─────────────────────────────────────────────────

document.getElementById('refresh-btn').addEventListener('click', scanPage);

// ─── Progress Updates ───────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'DOWNLOAD_PROGRESS') {
    const pct = Math.round((msg.completed / msg.total) * 100);
    document.getElementById('progress-text').textContent = 'Mengunduh...';
    document.getElementById('progress-count').textContent = `${msg.completed} / ${msg.total}`;
    document.getElementById('progress-fill').style.width = pct + '%';
    document.getElementById('header-status').textContent = 
      `Mengunduh... ${msg.completed}/${msg.total}`;
  }
  if (msg.type === 'DOWNLOAD_COMPLETE') {
    document.getElementById('progress-text').textContent = 'Selesai!';
    document.getElementById('progress-count').textContent = 
      `${msg.completed} berhasil${msg.failed > 0 ? `, ${msg.failed} gagal` : ''}`;
    document.getElementById('progress-fill').style.width = '100%';
    document.getElementById('header-status').textContent = 
      `✅ ${msg.completed} file tersimpan ke ${document.getElementById('folder-input').value || 'MediaGrabber'}/`;
  }
});

// ─── HLS Stream Download ──────────────────────────────────────────

async function downloadHLSStream(url, filename) {
  const tab = await getCurrentTab();
  const progress = document.getElementById('progress');
  progress.classList.add('active');
  document.getElementById('progress-text').textContent = 'Parsing M3U8...';
  document.getElementById('progress-count').textContent = '';
  document.getElementById('progress-fill').style.width = '0%';
  document.getElementById('header-status').textContent = '📡 Downloading HLS stream...';
  
  // Send download request to content script
  chrome.tabs.sendMessage(tab.id, {
    type: 'DOWNLOAD_HLS',
    url: url,
    filename: filename
  }, (response) => {
    if (chrome.runtime.lastError) {
      document.getElementById('header-status').textContent = 
        '❌ Content script not loaded. Refresh the page and try again.';
      progress.classList.remove('active');
      return;
    }
    
    if (response?.success) {
      document.getElementById('progress-text').textContent = 'Selesai!';
      document.getElementById('progress-fill').style.width = '100%';
      document.getElementById('header-status').textContent = 
        `✅ Stream downloaded (${formatSize(response.size)})`;
    } else {
      document.getElementById('header-status').textContent = 
        `❌ Error: ${response?.error || 'Unknown error'}`;
    }
    setTimeout(() => progress.classList.remove('active'), 3000);
  });
}

// Listen for HLS progress updates from content script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'HLS_PROGRESS') {
    const progress = document.getElementById('progress');
    progress.classList.add('active');
    
    if (msg.stage === 'parsing') {
      document.getElementById('progress-text').textContent = '📋 Parsing M3U8...';
      document.getElementById('progress-fill').style.width = '10%';
    } else if (msg.stage === 'downloading') {
      const pct = msg.percent || Math.round((msg.completed / msg.total) * 100);
      document.getElementById('progress-text').textContent = 
        `⬇️ Downloading segments... ${msg.completed || 0}/${msg.total || '?'}`;
      document.getElementById('progress-count').textContent = `${pct}%`;
      document.getElementById('progress-fill').style.width = pct + '%';
      document.getElementById('header-status').textContent = 
        `📡 HLS: ${pct}% (${msg.completed || 0}/${msg.total || '?'} segments)`;
    } else if (msg.stage === 'merging') {
      document.getElementById('progress-text').textContent = '🔗 Merging segments...';
      document.getElementById('progress-fill').style.width = '90%';
    } else if (msg.stage === 'saving') {
      document.getElementById('progress-text').textContent = '💾 Saving file...';
      document.getElementById('progress-fill').style.width = '95%';
    }
  }
  
  if (msg.type === 'HLS_ERROR') {
    document.getElementById('header-status').textContent = `❌ HLS Error: ${msg.error}`;
    document.getElementById('progress').classList.remove('active');
  }
});

// ─── Initial Load ───────────────────────────────────────────────────

getCurrentTab().then(tab => {
  chrome.runtime.sendMessage({ type: 'GET_MEDIA', tabId: tab.id }, (response) => {
    if (response?.media) {
      allMedia.network = response.media;
      renderMedia();
    }
  });
  
  chrome.runtime.sendMessage({ type: 'GET_INTERCEPTED', tabId: tab.id }, (response) => {
    if (response?.media) {
      allMedia.intercepted = response.media;
      renderMedia();
    }
  });
});

// Auto-scan on open
scanPage();
