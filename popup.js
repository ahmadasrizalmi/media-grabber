// Media Grabber v2 — Popup script
let allMedia = { page: [], network: [], intercepted: [] };
let currentTab = 'page';

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFilename(url) {
  try {
    if (url.startsWith('data:') || url.startsWith('blob:')) return `media_${Date.now()}.png`;
    const pathname = new URL(url).pathname;
    const name = pathname.split('/').pop();
    if (name && name.includes('.')) return name;
    return `media_${Date.now()}.webp`;
  } catch {
    return `media_${Date.now()}.webp`;
  }
}

function renderMedia() {
  const list = document.getElementById('media-list');
  const items = allMedia[currentTab] || [];
  
  document.getElementById('page-count').textContent = allMedia.page.length;
  document.getElementById('network-count').textContent = allMedia.network.length;
  document.getElementById('intercepted-count').textContent = allMedia.intercepted.length;
  
  const totalDl = [...allMedia.page, ...allMedia.network, ...allMedia.intercepted]
    .filter(m => {
      const url = m.url || m.src || m.blobUrl || '';
      return !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('canvas:');
    }).length;
  document.getElementById('dl-count').textContent = totalDl;
  
  if (items.length === 0) {
    list.innerHTML = `
      <div class="empty">
        <p>No media found in "${currentTab}" tab</p>
        <p style="margin-top:8px;font-size:11px;color:#475569">Click "Scan Page" to search</p>
      </div>
    `;
    return;
  }
  
  list.innerHTML = items.map((item, i) => {
    const url = item.url || item.src || item.blobUrl || item.originalUrl || item.mediaUrl || '';
    const isVideo = url.includes('.mp4') || url.includes('.webm') || url.includes('video') || item.type === 'video';
    const isData = url.startsWith('data:');
    const isBlob = url.startsWith('blob:');
    const source = item.source || currentTab;
    const icon = isVideo ? '🎬' : '🖼️';
    const shortUrl = url.length > 100 ? url.substring(0, 100) + '...' : url;
    const dlDisabled = isData || isBlob || url.startsWith('canvas:');
    
    return `
      <div class="media-item">
        ${(!isData && !isBlob)
          ? `<img class="media-preview" src="${url}" onerror="this.outerHTML='<div class=media-preview-placeholder>${icon}</div>'" loading="lazy">`
          : `<div class="media-preview-placeholder">${icon}</div>`
        }
        <div class="media-info">
          <div class="media-type">${source} • ${item.type || 'image'} ${item.size ? '• ' + formatSize(item.size) : ''} ${item.width ? '• ' + item.width + '×' + item.height : ''}</div>
          <div class="media-url" title="${url}">${shortUrl}</div>
        </div>
        <button class="btn-sm download-btn" data-index="${i}" data-tab="${currentTab}" ${dlDisabled ? 'disabled style="opacity:0.3"' : ''} title="Download">⬇️</button>
      </div>
    `;
  }).join('');
  
  // Download button handlers
  list.querySelectorAll('.download-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      const tab = btn.dataset.tab;
      const item = allMedia[tab][idx];
      const url = item.url || item.src || item.blobUrl || item.originalUrl || '';
      const folder = document.getElementById('folder').value || 'MediaGrabber';
      
      if (url.startsWith('data:') || url.startsWith('blob:')) {
        const a = document.createElement('a');
        a.href = url;
        a.download = getFilename(url);
        a.click();
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
}

// Scan page
async function scanPage() {
  const tab = await getCurrentTab();
  
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
      
      document.querySelectorAll('img').forEach(img => {
        if (img.src && !img.src.startsWith('data:') && img.width > 50) {
          media.push({ type: 'image', source: 'img', url: img.src, width: img.width, height: img.height });
        }
      });
      
      document.querySelectorAll('video').forEach(vid => {
        const src = vid.src || vid.currentSrc;
        if (src) media.push({ type: 'video', source: 'video', url: src });
        vid.querySelectorAll('source').forEach(s => {
          if (s.src) media.push({ type: 'video', source: 'video-src', url: s.src });
        });
      });
      
      document.querySelectorAll('canvas').forEach((c, i) => {
        if (c.width > 200 && c.height > 200) {
          try {
            media.push({ type: 'canvas', source: 'canvas', url: c.toDataURL('image/png'), width: c.width, height: c.height });
          } catch (e) {
            media.push({ type: 'canvas-tainted', source: 'canvas', url: `canvas:${i}`, width: c.width, height: c.height });
          }
        }
      });
      
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
      
      document.querySelectorAll('iframe').forEach(iframe => {
        if (iframe.src && !iframe.src.includes('about:blank')) {
          media.push({ type: 'iframe', source: 'iframe', url: iframe.src });
        }
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
      document.getElementById('header-status').textContent = 
        `${allMedia.page.length} found on page`;
    }
  });
}

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    renderMedia();
  });
});

// Scan button
document.getElementById('scan-btn').addEventListener('click', scanPage);

// Download All
document.getElementById('dl-all-btn').addEventListener('click', () => {
  const folder = document.getElementById('folder').value || 'MediaGrabber';
  
  // Collect ALL downloadable URLs from all tabs
  const allItems = [];
  const seen = new Set();
  
  for (const tab of ['page', 'network', 'intercepted']) {
    for (const item of (allMedia[tab] || [])) {
      const url = item.url || item.src || item.blobUrl || item.originalUrl || '';
      if (url && !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('canvas:') && !seen.has(url)) {
        seen.add(url);
        allItems.push({ url, filename: getFilename(url) });
      }
    }
  }
  
  if (allItems.length === 0) {
    document.getElementById('header-status').textContent = 'No downloadable URLs found';
    return;
  }
  
  // Show progress
  const progress = document.getElementById('progress');
  progress.classList.add('active');
  document.getElementById('progress-text').textContent = `Starting ${allItems.length} downloads...`;
  document.getElementById('progress-fill').style.width = '0%';
  document.getElementById('header-status').textContent = `Downloading ${allItems.length} files...`;
  
  chrome.runtime.sendMessage({
    type: 'DOWNLOAD_BATCH',
    items: allItems,
    folder: folder
  }, (response) => {
    if (response?.error) {
      document.getElementById('header-status').textContent = `Error: ${response.error}`;
      progress.classList.remove('active');
    }
  });
});

// Listen for progress updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'DOWNLOAD_PROGRESS') {
    const pct = Math.round((msg.completed / msg.total) * 100);
    document.getElementById('progress-text').textContent = 
      `${msg.completed} / ${msg.total} downloaded${msg.failed > 0 ? ` (${msg.failed} failed)` : ''}`;
    document.getElementById('progress-fill').style.width = pct + '%';
    document.getElementById('header-status').textContent = 
      `Downloading... ${msg.completed}/${msg.total}`;
  }
  if (msg.type === 'DOWNLOAD_COMPLETE') {
    document.getElementById('progress-text').textContent = 
      `✅ Done! ${msg.completed} downloaded${msg.failed > 0 ? `, ${msg.failed} failed` : ''}`;
    document.getElementById('progress-fill').style.width = '100%';
    document.getElementById('header-status').textContent = 
      `Complete! ${msg.completed} files saved to ${document.getElementById('folder').value || 'MediaGrabber'}/`;
  }
});

// Initial load
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
