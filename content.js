// Content script — Media Grabber v3.1
// Enhanced video detection with proper filtering

// ========== 1. OVERRIDE RIGHT-CLICK DISABLE ==========
document.addEventListener('contextmenu', (e) => {
  e.stopPropagation();
  return true;
}, true);

const origAddEventListener = EventTarget.prototype.addEventListener;
EventTarget.prototype.addEventListener = function(type, listener, options) {
  if (type === 'contextmenu') return;
  return origAddEventListener.call(this, type, listener, options);
};

// ========== VIDEO URL VALIDATION ==========
function isRealVideoUrl(url) {
  if (!url || typeof url !== 'string') return false;
  
  // Must be http/https
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
  
  // Skip common tracking/analytics/player URLs
  const skipPatterns = [
    /google-analytics/i,
    /facebook\.net/i,
    /doubleclick/i,
    /pixel/i,
    /beacon/i,
    /tracking/i,
    /analytics/i,
    /stats\./i,
    /\.gif\?/i,  // tracking GIFs
    /\/player\//i,  // player API endpoints
    /\/api\//i,
    /\/v1\//i,
    /\/v2\//i,
    /manifest\.m3u8$/i,  // HLS manifest (not actual video)
    /\.m3u8\?/i,
    /\.mpd$/i,  // DASH manifest
    /\.mpd\?/i,
  ];
  
  for (const pattern of skipPatterns) {
    if (pattern.test(url)) return false;
  }
  
  // Must have video extension or be from known video CDN
  const videoExtensions = /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|3gp)(\?|$|#)/i;
  const videoPaths = /\/(video|videos|media|uploads|files|download)\/.*\.(mp4|webm|mov)/i;
  const videoCdn = /(cdn|static|media|assets|uploads)\..*\.(mp4|webm)/i;
  
  return videoExtensions.test(url) || videoPaths.test(url) || videoCdn.test(url);
}

function isRealImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('data:')) return false;
  
  // Skip tracking pixels
  const skipPatterns = [
    /google-analytics/i,
    /facebook\.net/i,
    /doubleclick/i,
    /pixel/i,
    /beacon/i,
    /1x1/i,
    /spacer/i,
    /transparent/i,
  ];
  
  for (const pattern of skipPatterns) {
    if (pattern.test(url)) return false;
  }
  
  const imageExtensions = /\.(webp|jpg|jpeg|png|gif|avif|bmp|tiff|svg|ico)(\?|$|#)/i;
  return imageExtensions.test(url) || url.startsWith('data:image/');
}

// ========== 2. INTERCEPT FETCH ==========
const origFetch = window.fetch;
window.fetch = async function(...args) {
  const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
  const response = await origFetch.apply(this, args);
  
  if (url) {
    const contentType = response.headers?.get('content-type') || '';
    
    // Only capture actual video files
    if (contentType.includes('video/mp4') || contentType.includes('video/webm') || 
        contentType.includes('video/quicktime')) {
      const clone = response.clone();
      clone.blob().then(blob => {
        if (blob.size > 10240) { // Min 10KB for video
          const blobUrl = URL.createObjectURL(blob);
          chrome.runtime.sendMessage({
            type: 'ADD_MEDIA',
            data: {
              source: 'fetch-video',
              url: url,
              blobUrl: blobUrl,
              contentType: contentType || blob.type,
              size: blob.size,
              isVideo: true,
              timestamp: Date.now()
            }
          });
        }
      }).catch(() => {});
    }
    
    // Capture actual images
    if (contentType.includes('image/') && !contentType.includes('svg')) {
      const clone = response.clone();
      clone.blob().then(blob => {
        if (blob.size > 1024) { // Skip tiny tracking pixels
          chrome.runtime.sendMessage({
            type: 'ADD_MEDIA',
            data: {
              source: 'fetch-image',
              url: url,
              contentType: contentType || blob.type,
              size: blob.size,
              isVideo: false,
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
    
    // Only capture actual video responses
    if (contentType.includes('video/mp4') || contentType.includes('video/webm')) {
      chrome.runtime.sendMessage({
        type: 'ADD_MEDIA',
        data: {
          source: 'xhr-video',
          url: url,
          contentType: contentType,
          isVideo: true,
          timestamp: Date.now()
        }
      });
    }
    
    // Capture images
    if (contentType.includes('image/') && !contentType.includes('svg')) {
      chrome.runtime.sendMessage({
        type: 'ADD_MEDIA',
        data: {
          source: 'xhr-image',
          url: url,
          contentType: contentType,
          isVideo: false,
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

// ========== 4. SCAN JSON FOR MEDIA URLS ==========
function findMediaUrlsInJson(data, sourceUrl, depth = 0) {
  if (depth > 5 || !data) return;
  
  if (typeof data === 'string') {
    if (isRealVideoUrl(data)) {
      chrome.runtime.sendMessage({
        type: 'ADD_MEDIA',
        data: {
          source: 'json-video',
          url: data.startsWith('http') ? data : new URL(data, sourceUrl).href,
          originalApiUrl: sourceUrl,
          isVideo: true,
          timestamp: Date.now()
        }
      });
    } else if (isRealImageUrl(data)) {
      chrome.runtime.sendMessage({
        type: 'ADD_MEDIA',
        data: {
          source: 'json-image',
          url: data.startsWith('http') ? data : new URL(data, sourceUrl).href,
          originalApiUrl: sourceUrl,
          isVideo: false,
          timestamp: Date.now()
        }
      });
    }
  } else if (Array.isArray(data)) {
    data.forEach(item => findMediaUrlsInJson(item, sourceUrl, depth + 1));
  } else if (typeof data === 'object') {
    Object.entries(data).forEach(([key, value]) => {
      if (['url', 'src', 'video', 'video_url', 'video_src', 'mp4', 'webm',
           'image', 'thumbnail', 'poster', 'preview', 'file', 'media'].includes(key.toLowerCase())) {
        findMediaUrlsInJson(value, sourceUrl, depth + 1);
      }
      findMediaUrlsInJson(value, sourceUrl, depth + 1);
    });
  }
}

// ========== 5. MONITOR DOM ==========
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== 1) continue;
      
      // Video elements
      if (node.tagName === 'VIDEO') {
        const src = node.src || node.currentSrc;
        if (src && isRealVideoUrl(src)) {
          chrome.runtime.sendMessage({
            type: 'ADD_MEDIA',
            data: {
              source: 'dom-video',
              url: src,
              width: node.videoWidth,
              height: node.videoHeight,
              poster: node.poster || '',
              isVideo: true,
              timestamp: Date.now()
            }
          });
        }
      }
      
      // Image elements
      if (node.tagName === 'IMG') {
        const src = node.src;
        if (src && isRealImageUrl(src) && node.width > 50) {
          chrome.runtime.sendMessage({
            type: 'ADD_MEDIA',
            data: {
              source: 'dom-image',
              url: src,
              width: node.naturalWidth || node.width,
              height: node.naturalHeight || node.height,
              isVideo: false,
              timestamp: Date.now()
            }
          });
        }
      }
    }
  }
});

document.addEventListener('DOMContentLoaded', () => {
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'poster']
  });
});

console.log('[Media Grabber] Content script v3.1 loaded');
