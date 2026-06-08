// Content script — Media Grabber v2
// Runs on ALL pages at document_start

// ========== 1. OVERRIDE RIGHT-CLICK DISABLE ==========
document.addEventListener('contextmenu', (e) => {
  e.stopPropagation();
  return true;
}, true);

// Remove contextmenu blockers
const origAddEventListener = EventTarget.prototype.addEventListener;
EventTarget.prototype.addEventListener = function(type, listener, options) {
  if (type === 'contextmenu') return;
  return origAddEventListener.call(this, type, listener, options);
};

// ========== 2. INTERCEPT FETCH ==========
const origFetch = window.fetch;
window.fetch = async function(...args) {
  const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
  const response = await origFetch.apply(this, args);
  
  if (url) {
    const contentType = response.headers?.get('content-type') || '';
    const mediaExts = /\.(webp|jpg|jpeg|png|gif|avif|bmp|tiff|mp4|webm|mov)(\?|$|#)/i;
    
    if (contentType.includes('image') || contentType.includes('video') || 
        contentType.includes('octet-stream') || mediaExts.test(url)) {
      const clone = response.clone();
      clone.blob().then(blob => {
        if (blob.size > 1024) { // Skip tiny tracking pixels
          const blobUrl = URL.createObjectURL(blob);
          chrome.runtime.sendMessage({
            type: 'ADD_MEDIA',
            data: {
              source: 'fetch',
              url: url,
              blobUrl: blobUrl,
              contentType: contentType || blob.type,
              size: blob.size,
              timestamp: Date.now()
            }
          });
        }
      }).catch(() => {});
    }
    
    // Scan JSON responses for media URLs
    if (contentType.includes('json')) {
      const clone = response.clone();
      clone.json().then(data => findMediaUrlsInJson(data, url)).catch(() => {});
    }
  }
  
  return response;
};

// ========== 3. INTERCEPT XMLHttpRequest ==========
const origXHROpen = XMLHttpRequest.prototype.open;
const origXHRSend = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open = function(method, url, ...args) {
  this._mgUrl = url;
  return origXHROpen.call(this, method, url, ...args);
};

XMLHttpRequest.prototype.send = function(...args) {
  this.addEventListener('load', function() {
    const url = this._mgUrl;
    if (!url) return;
    
    const contentType = this.getResponseHeader('content-type') || '';
    
    if (contentType.includes('image') || contentType.includes('video') || 
        contentType.includes('octet-stream')) {
      chrome.runtime.sendMessage({
        type: 'ADD_MEDIA',
        data: {
          source: 'xhr',
          url: url,
          contentType: contentType,
          timestamp: Date.now()
        }
      });
    }
    
    if (contentType.includes('json')) {
      try {
        const data = JSON.parse(this.responseText);
        findMediaUrlsInJson(data, url);
      } catch (e) {}
    }
  });
  return origXHRSend.apply(this, args);
};

// ========== 4. INTERCEPT CANVAS TODataURL ==========
const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
  const result = origToDataURL.call(this, type, quality);
  
  if (this.width > 200 && this.height > 200) {
    chrome.runtime.sendMessage({
      type: 'ADD_MEDIA',
      data: {
        source: 'canvas',
        width: this.width,
        height: this.height,
        dataUrl: result.substring(0, 200) + '...',
        timestamp: Date.now()
      }
    });
  }
  
  return result;
};

// ========== 5. INTERCEPT BLOB URL CREATION ==========
const origCreateObjectURL = URL.createObjectURL;
URL.createObjectURL = function(blob) {
  const url = origCreateObjectURL.call(this, blob);
  
  if (blob.type && (blob.type.includes('image') || blob.type.includes('video')) && blob.size > 1024) {
    chrome.runtime.sendMessage({
      type: 'ADD_MEDIA',
      data: {
        source: 'blob',
        blobUrl: url,
        url: url,
        contentType: blob.type,
        size: blob.size,
        timestamp: Date.now()
      }
    });
  }
  
  return url;
};

// ========== 6. SCAN JSON FOR MEDIA URLS ==========
function findMediaUrlsInJson(data, sourceUrl, depth = 0) {
  if (depth > 5 || !data) return;
  
  const mediaPatterns = [
    /\.(webp|jpg|jpeg|png|avif|mp4|webm|mov|gif)(\?|$|#)/i,
    /\/media\//i, /\/image\//i, /\/upload\//i,
    /\/render\//i, /\/output\//i, /\/result\//i,
    /\.(hk|fke|fte)(\?|$)/i
  ];
  
  if (typeof data === 'string') {
    if (mediaPatterns.some(p => p.test(data)) && data.length < 2000) {
      chrome.runtime.sendMessage({
        type: 'ADD_MEDIA',
        data: {
          source: 'json',
          url: data.startsWith('http') ? data : new URL(data, sourceUrl).href,
          originalApiUrl: sourceUrl,
          timestamp: Date.now()
        }
      });
    }
  } else if (Array.isArray(data)) {
    data.forEach(item => findMediaUrlsInJson(item, sourceUrl, depth + 1));
  } else if (typeof data === 'object') {
    Object.entries(data).forEach(([key, value]) => {
      if (['url', 'src', 'image', 'media', 'file', 'path', 'output', 'result',
           'download', 'href', 'link', 'preview', 'thumbnail', 'original', 'hd', 'full']
           .includes(key.toLowerCase())) {
        findMediaUrlsInJson(value, sourceUrl, depth + 1);
      }
      findMediaUrlsInJson(value, sourceUrl, depth + 1);
    });
  }
}

// ========== 7. MONITOR DOM ==========
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== 1) continue;
      
      if (node.tagName === 'IMG' || node.tagName === 'VIDEO') {
        const src = node.src || node.currentSrc;
        if (src && !src.startsWith('data:')) {
          chrome.runtime.sendMessage({
            type: 'ADD_MEDIA',
            data: {
              source: 'dom',
              tagName: node.tagName,
              url: src,
              width: node.naturalWidth || node.videoWidth,
              height: node.naturalHeight || node.videoHeight,
              timestamp: Date.now()
            }
          });
        }
      }
      
      // Background images
      try {
        const bg = getComputedStyle(node).backgroundImage;
        if (bg && bg !== 'none' && !bg.includes('gradient')) {
          const match = bg.match(/url\("?([^"]+)"?\)/);
          if (match && !match[1].startsWith('data:') && !match[1].includes('svg')) {
            chrome.runtime.sendMessage({
              type: 'ADD_MEDIA',
              data: {
                source: 'css-bg',
                url: match[1],
                timestamp: Date.now()
              }
            });
          }
        }
      } catch (e) {}
    }
  }
});

document.addEventListener('DOMContentLoaded', () => {
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'style']
  });
});

// ========== 8. FLOATING PANEL ==========
document.addEventListener('DOMContentLoaded', () => {
  // Inject styles
  const style = document.createElement('style');
  style.textContent = `
    #mg-panel {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    #mg-toggle {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      color: white;
      box-shadow: 0 4px 16px rgba(99,102,241,0.4);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #mg-toggle:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 20px rgba(99,102,241,0.5);
    }
    #mg-toggle.has-media::after {
      content: attr(data-count);
      position: absolute;
      top: -4px;
      right: -4px;
      background: #ef4444;
      color: white;
      font-size: 10px;
      font-weight: 700;
      min-width: 18px;
      height: 18px;
      border-radius: 9px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 4px;
    }
    #mg-dropdown {
      display: none;
      position: absolute;
      bottom: 56px;
      right: 0;
      width: 360px;
      max-height: 480px;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      overflow: hidden;
    }
    #mg-dropdown.open { display: flex; flex-direction: column; }
    .mg-header {
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      padding: 14px 16px;
      color: white;
    }
    .mg-header h3 { font-size: 14px; margin: 0; font-weight: 700; }
    .mg-header p { font-size: 11px; margin: 4px 0 0; opacity: 0.7; }
    .mg-body {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
      max-height: 320px;
    }
    .mg-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px;
      border-radius: 10px;
      cursor: default;
      transition: background 0.15s;
    }
    .mg-item:hover { background: #1e293b; }
    .mg-thumb {
      width: 44px;
      height: 44px;
      border-radius: 8px;
      object-fit: cover;
      background: #1e293b;
      flex-shrink: 0;
    }
    .mg-thumb-placeholder {
      width: 44px;
      height: 44px;
      border-radius: 8px;
      background: #1e293b;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      flex-shrink: 0;
    }
    .mg-info { flex: 1; min-width: 0; }
    .mg-source { font-size: 10px; color: #8b5cf6; font-weight: 600; text-transform: uppercase; }
    .mg-url { font-size: 11px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mg-dl-btn {
      background: none;
      border: 1px solid #334155;
      color: #e2e8f0;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      transition: all 0.15s;
      flex-shrink: 0;
    }
    .mg-dl-btn:hover { background: #6366f1; border-color: #6366f1; }
    .mg-footer {
      padding: 10px 12px;
      border-top: 1px solid #334155;
      display: flex;
      gap: 6px;
    }
    .mg-btn {
      flex: 1;
      padding: 10px;
      border: none;
      border-radius: 10px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .mg-btn:hover { opacity: 0.85; }
    .mg-btn-primary {
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: white;
    }
    .mg-btn-secondary {
      background: #1e293b;
      color: #e2e8f0;
      border: 1px solid #334155;
    }
    .mg-empty {
      text-align: center;
      padding: 30px 16px;
      color: #64748b;
      font-size: 13px;
    }
    .mg-progress {
      padding: 10px 12px;
      background: #1e293b;
      border-top: 1px solid #334155;
      display: none;
    }
    .mg-progress.active { display: block; }
    .mg-progress-text { font-size: 11px; color: #94a3b8; margin-bottom: 6px; }
    .mg-progress-bar {
      height: 4px;
      background: #334155;
      border-radius: 2px;
      overflow: hidden;
    }
    .mg-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #6366f1, #8b5cf6);
      border-radius: 2px;
      transition: width 0.3s;
    }
    .mg-folder-input {
      width: 100%;
      padding: 6px 10px;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 6px;
      color: #e2e8f0;
      font-size: 11px;
      margin-bottom: 8px;
    }
    .mg-folder-input:focus { outline: none; border-color: #6366f1; }
    .mg-folder-label { font-size: 10px; color: #64748b; margin-bottom: 4px; display: block; }
  `;
  document.head.appendChild(style);
  
  // Create panel
  const panel = document.createElement('div');
  panel.id = 'mg-panel';
  panel.innerHTML = `
    <div id="mg-dropdown">
      <div class="mg-header">
        <h3>⚡ Media Grabber</h3>
        <p id="mg-status">Scanning...</p>
      </div>
      <div class="mg-body" id="mg-list">
        <div class="empty">Loading...</div>
      </div>
      <div class="mg-progress" id="mg-progress">
        <div class="mg-progress-text" id="mg-progress-text">0 / 0</div>
        <div class="mg-progress-bar">
          <div class="mg-progress-fill" id="mg-progress-fill" style="width:0%"></div>
        </div>
      </div>
      <div class="mg-footer">
        <button class="mg-btn mg-btn-secondary" id="mg-scan">🔄 Scan</button>
        <button class="mg-btn mg-btn-primary" id="mg-dl-all">⬇️ Download All</button>
      </div>
    </div>
    <button id="mg-toggle">🧲</button>
  `;
  document.body.appendChild(panel);
  
  let mediaList = [];
  let isOpen = false;
  
  // Toggle dropdown
  document.getElementById('mg-toggle').addEventListener('click', () => {
    isOpen = !isOpen;
    document.getElementById('mg-dropdown').classList.toggle('open', isOpen);
    if (isOpen) scanPage();
  });
  
  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && isOpen) {
      isOpen = false;
      document.getElementById('mg-dropdown').classList.remove('open');
    }
  });
  
  // Scan page
  function scanPage() {
    mediaList = [];
    
    // Images
    document.querySelectorAll('img').forEach(img => {
      if (img.src && !img.src.startsWith('data:') && img.width > 50) {
        mediaList.push({ url: img.src, source: 'img', type: 'image', width: img.width, height: img.height });
      }
    });
    
    // Videos
    document.querySelectorAll('video').forEach(vid => {
      const src = vid.src || vid.currentSrc;
      if (src) mediaList.push({ url: src, source: 'video', type: 'video' });
      vid.querySelectorAll('source').forEach(s => {
        if (s.src) mediaList.push({ url: s.src, source: 'video-src', type: 'video' });
      });
    });
    
    // Canvas
    document.querySelectorAll('canvas').forEach((c, i) => {
      if (c.width > 200 && c.height > 200) {
        try {
          mediaList.push({ url: c.toDataURL('image/png'), source: 'canvas', type: 'canvas', width: c.width, height: c.height });
        } catch (e) {
          mediaList.push({ url: `canvas:${i}`, source: 'canvas-tainted', type: 'canvas', width: c.width, height: c.height });
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
            mediaList.push({ url: match[1], source: 'css-bg', type: 'image' });
          }
        }
      } catch (e) {}
    });
    
    // iframes
    document.querySelectorAll('iframe').forEach(iframe => {
      if (iframe.src && !iframe.src.includes('about:blank')) {
        mediaList.push({ url: iframe.src, source: 'iframe', type: 'iframe' });
      }
    });
    
    // Deduplicate
    const seen = new Set();
    mediaList = mediaList.filter(m => {
      const key = m.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    
    // Update toggle badge
    const toggle = document.getElementById('mg-toggle');
    if (mediaList.length > 0) {
      toggle.classList.add('has-media');
      toggle.dataset.count = mediaList.length;
    } else {
      toggle.classList.remove('has-media');
    }
    
    renderList();
  }
  
  function renderList() {
    const list = document.getElementById('mg-list');
    const status = document.getElementById('mg-status');
    
    status.textContent = `${mediaList.length} media found`;
    
    if (mediaList.length === 0) {
      list.innerHTML = '<div class="mg-empty">No media found on this page<br><small>Try navigating to a page with images/videos</small></div>';
      return;
    }
    
    list.innerHTML = mediaList.map((item, i) => {
      const isData = item.url.startsWith('data:');
      const isBlob = item.url.startsWith('blob:');
      const isVideo = item.type === 'video';
      const icon = isVideo ? '🎬' : '🖼️';
      const shortUrl = item.url.length > 80 ? item.url.substring(0, 80) + '...' : item.url;
      
      return `
        <div class="mg-item">
          ${(!isData && !isBlob)
            ? `<img class="mg-thumb" src="${item.url}" onerror="this.outerHTML='<div class=mg-thumb-placeholder>${icon}</div>'" loading="lazy">`
            : `<div class="mg-thumb-placeholder">${icon}</div>`
          }
          <div class="mg-info">
            <div class="mg-source">${item.source}${item.width ? ' • ' + item.width + '×' + item.height : ''}</div>
            <div class="mg-url" title="${item.url}">${shortUrl}</div>
          </div>
          <button class="mg-dl-btn" data-index="${i}" title="Download">⬇️</button>
        </div>
      `;
    }).join('');
    
    // Single download buttons
    list.querySelectorAll('.mg-dl-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index);
        downloadSingle(mediaList[idx]);
      });
    });
  }
  
  function downloadSingle(item) {
    const url = item.url;
    
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      // Data URLs: create temporary link
      const a = document.createElement('a');
      a.href = url;
      a.download = `media_${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      chrome.runtime.sendMessage({
        type: 'DOWNLOAD_ONE',
        url: url,
        filename: getFilename(url),
        folder: document.getElementById('mg-folder')?.value || 'MediaGrabber'
      });
    }
  }
  
  // Download All
  document.getElementById('mg-dl-all').addEventListener('click', () => {
    const dlItems = mediaList.filter(m => !m.url.startsWith('data:') && !m.url.startsWith('blob:') && !m.url.startsWith('canvas:'));
    const folder = document.getElementById('mg-folder')?.value || 'MediaGrabber';
    
    if (dlItems.length === 0) {
      alert('No downloadable URLs found (data/blob URLs need manual save)');
      return;
    }
    
    // Show progress
    const progress = document.getElementById('mg-progress');
    progress.classList.add('active');
    document.getElementById('mg-progress-text').textContent = `Starting download of ${dlItems.length} files...`;
    document.getElementById('mg-progress-fill').style.width = '0%';
    
    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_BATCH',
      items: dlItems.map(m => ({ url: m.url, filename: getFilename(m.url) })),
      folder: folder
    });
  });
  
  // Scan button
  document.getElementById('mg-scan').addEventListener('click', scanPage);
  
  // Listen for download progress
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'DOWNLOAD_PROGRESS') {
      const pct = Math.round((msg.completed / msg.total) * 100);
      document.getElementById('mg-progress-text').textContent = 
        `${msg.completed} / ${msg.total} downloaded${msg.failed > 0 ? ` (${msg.failed} failed)` : ''}`;
      document.getElementById('mg-progress-fill').style.width = pct + '%';
    }
    if (msg.type === 'DOWNLOAD_COMPLETE') {
      document.getElementById('mg-progress-text').textContent = 
        `✅ Done! ${msg.completed} downloaded${msg.failed > 0 ? `, ${msg.failed} failed` : ''}`;
      document.getElementById('mg-progress-fill').style.width = '100%';
      setTimeout(() => {
        document.getElementById('mg-progress').classList.remove('active');
      }, 5000);
    }
  });
  
  function getFilename(url) {
    try {
      const pathname = new URL(url).pathname;
      const name = pathname.split('/').pop();
      return name || `media_${Date.now()}`;
    } catch {
      return `media_${Date.now()}`;
    }
  }
  
  // Auto-scan after 2 seconds (let page load)
  setTimeout(scanPage, 2000);
});

console.log('[Media Grabber] Content script loaded');
