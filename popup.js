// Media Grabber v3 — Apple-style UI
// Popup script with Image/Video tabs, size display, and modern design

let allMedia = { images: [], videos: [] };
let currentTab = 'images';
let selectedItems = new Set();

// ─── Helpers ────────────────────────────────────────────────────────

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function formatSize(bytes) {
  if (!bytes || bytes === 0) return 'N/A';
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

function isVideoUrl(url, contentType = '') {
  const videoExts = /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v)(\?|$|#)/i;
  const videoTypes = /video\//i;
  return videoExts.test(url) || videoTypes.test(contentType) || 
         url.includes('video') || url.includes('.m3u8');
}

function isImageUrl(url, contentType = '') {
  const imageExts = /\.(webp|jpg|jpeg|png|gif|avif|bmp|tiff|svg|ico)(\?|$|#)/i;
  const imageTypes = /image\//i;
  return imageExts.test(url) || imageTypes.test(contentType);
}

function classifyMedia(item) {
  const url = item.url || item.src || item.blobUrl || item.originalUrl || '';
  const contentType = item.contentType || '';
  
  if (item.type === 'video' || isVideoUrl(url, contentType)) return 'video';
  if (item.type === 'image' || isImageUrl(url, contentType)) return 'image';
  if (item.type === 'canvas' || item.type === 'bg-image') return 'image';
  return 'image'; // default to image
}

function getMediaIcon(type) {
  return type === 'video' ? '🎬' : '🖼️';
}

// ─── Classify All Media ─────────────────────────────────────────────

function classifyAllMedia() {
  const images = [];
  const videos = [];
  const seen = new Set();
  
  // Combine all sources
  const allSources = [
    ...allMedia.page || [],
    ...allMedia.network || [],
    ...allMedia.intercepted || []
  ];
  
  for (const item of allSources) {
    const url = item.url || item.src || item.blobUrl || item.originalUrl || '';
    if (!url || seen.has(url)) continue;
    seen.add(url);
    
    // Skip data/blob URLs for counting
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('canvas:')) {
      // Still add to list for preview, but mark as non-downloadable
      item._downloadable = false;
    } else {
      item._downloadable = true;
    }
    
    const type = classifyMedia(item);
    if (type === 'video') {
      videos.push(item);
    } else {
      images.push(item);
    }
  }
  
  allMedia.images = images;
  allMedia.videos = videos;
}

// ─── Render Media List ──────────────────────────────────────────────

function renderMedia() {
  classifyAllMedia();
  
  const list = document.getElementById('media-list');
  const items = allMedia[currentTab] || [];
  
  // Update counts
  document.getElementById('images-count').textContent = allMedia.images.length;
  document.getElementById('videos-count').textContent = allMedia.videos.length;
  document.getElementById('total-count').textContent = 
    `${allMedia.images.length + allMedia.videos.length} items`;
  
  // Update selected count
  updateSelectedCount();
  
  if (items.length === 0) {
    const icon = currentTab === 'images' ? '🖼️' : '🎬';
    const label = currentTab === 'images' ? 'gambar' : 'video';
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${icon}</div>
        <div class="empty-title">Tidak Ada ${currentTab === 'images' ? 'Gambar' : 'Video'}</div>
        <div class="empty-text">Tidak ditemukan ${label} di halaman ini</div>
      </div>
    `;
    return;
  }
  
  list.innerHTML = items.map((item, i) => {
    const url = item.url || item.src || item.blobUrl || item.originalUrl || '';
    const isData = url.startsWith('data:');
    const isBlob = url.startsWith('blob:');
    const downloadable = !isData && !isBlob && !url.startsWith('canvas:');
    const type = currentTab === 'images' ? 'image' : 'video';
    const icon = getMediaIcon(type);
    const size = formatSize(item.size);
    const width = item.width || item.naturalWidth || item.videoWidth;
    const height = item.height || item.naturalHeight || item.videoHeight;
    const dimensions = width && height ? `${width}×${height}` : '';
    const source = item.source || 'page';
    const shortUrl = url.length > 60 ? url.substring(0, 60) + '...' : url;
    const isSelected = selectedItems.has(i);
    
    return `
      <div class="media-card ${isSelected ? 'selected' : ''}" data-index="${i}">
        <input type="checkbox" class="media-checkbox" data-index="${i}" ${isSelected ? 'checked' : ''} ${!downloadable ? 'disabled' : ''}>
        ${(!isData && !isBlob)
          ? `<img class="media-thumb" src="${url}" onerror="this.outerHTML='<div class=media-thumb-placeholder>${icon}</div>'" loading="lazy">`
          : `<div class="media-thumb-placeholder">${icon}</div>`
        }
        <div class="media-info">
          <div class="media-type-badge ${type}">${type === 'video' ? 'Video' : 'Image'}</div>
          <div class="media-url" title="${url}">${shortUrl}</div>
          <div class="media-meta">
            ${size !== 'N/A' ? `<span class="media-size">📦 ${size}</span>` : ''}
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
  
  // Checkbox handlers
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
  
  // Download button handlers
  list.querySelectorAll('.media-download-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      const item = allMedia[currentTab][idx];
      const url = item.url || item.src || item.blobUrl || item.originalUrl || '';
      const folder = document.getElementById('folder-input').value || 'MediaGrabber';
      
      chrome.runtime.sendMessage({
        type: 'DOWNLOAD_ONE',
        url: url,
        filename: getFilename(url),
        folder: folder
      });
    });
  });
  
  // Select all checkbox
  const selectAll = document.getElementById('select-all');
  selectAll.checked = items.every((_, i) => selectedItems.has(i));
}

function updateSelectedCount() {
  const items = allMedia[currentTab] || [];
  const downloadable = items.filter((item) => {
    const url = item.url || item.src || item.blobUrl || item.originalUrl || '';
    return !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('canvas:');
  });
  
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
      if (!url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('canvas:')) {
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
      
      // Images
      document.querySelectorAll('img').forEach(img => {
        if (img.src && !img.src.startsWith('data:') && img.width > 50) {
          media.push({ 
            type: 'image', 
            source: 'img', 
            url: img.src, 
            width: img.naturalWidth || img.width, 
            height: img.naturalHeight || img.height 
          });
        }
      });
      
      // Videos
      document.querySelectorAll('video').forEach(vid => {
        const src = vid.src || vid.currentSrc;
        if (src) media.push({ 
          type: 'video', 
          source: 'video', 
          url: src,
          width: vid.videoWidth,
          height: vid.videoHeight
        });
        vid.querySelectorAll('source').forEach(s => {
          if (s.src) media.push({ 
            type: 'video', 
            source: 'video-src', 
            url: s.src,
            width: vid.videoWidth,
            height: vid.videoHeight
          });
        });
      });
      
      // Canvas
      document.querySelectorAll('canvas').forEach((c, i) => {
        if (c.width > 200 && c.height > 200) {
          try {
            media.push({ 
              type: 'canvas', 
              source: 'canvas', 
              url: c.toDataURL('image/png'), 
              width: c.width, 
              height: c.height 
            });
          } catch (e) {
            media.push({ 
              type: 'canvas-tainted', 
              source: 'canvas', 
              url: `canvas:${i}`, 
              width: c.width, 
              height: c.height 
            });
          }
        }
      });
      
      // Background images
      document.querySelectorAll('*').forEach(el => {
        try {
          const bg = getComputedStyle(el).backgroundImage;
          if (bg && bg !== 'none' && !bg.includes('gradient')) {
            const match = bg.match(/url\("?([^"]+)"?\)/);
            if (match && !match[1].startsWith('data:') && !match[1].includes('svg')) {
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
      
      const total = allMedia.images.length + allMedia.videos.length;
      document.getElementById('header-status').textContent = 
        `Ditemukan ${allMedia.images.length} gambar & ${allMedia.videos.length} video`;
    }
  });
}

// ─── Download Handlers ──────────────────────────────────────────────

// Download Selected
document.getElementById('btn-download-selected').addEventListener('click', () => {
  const items = allMedia[currentTab] || [];
  const folder = document.getElementById('folder-input').value || 'MediaGrabber';
  const downloadItems = [];
  
  selectedItems.forEach(idx => {
    const item = items[idx];
    if (!item) return;
    const url = item.url || item.src || item.blobUrl || item.originalUrl || '';
    if (url && !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('canvas:')) {
      downloadItems.push({ url, filename: getFilename(url) });
    }
  });
  
  if (downloadItems.length === 0) {
    document.getElementById('header-status').textContent = 'Tidak ada item yang dipilih';
    return;
  }
  
  startDownload(downloadItems, folder);
});

// Download All
document.getElementById('btn-download-all').addEventListener('click', () => {
  const folder = document.getElementById('folder-input').value || 'MediaGrabber';
  const downloadItems = [];
  const seen = new Set();
  
  // Download all from current tab
  const items = allMedia[currentTab] || [];
  for (const item of items) {
    const url = item.url || item.src || item.blobUrl || item.originalUrl || '';
    if (url && !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('canvas:') && !seen.has(url)) {
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
