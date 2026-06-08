// Background service worker — Media Grabber v3.1
// Fixed video detection with proper filtering

const mediaRequests = new Map();
const interceptedData = [];

// ========== VIDEO URL VALIDATION ==========
function isRealVideoUrl(url) {
  if (!url || typeof url !== 'string') return false;
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
    /\.gif\?/i,
    /\/player\//i,
    /\/api\//i,
    /manifest\.m3u8$/i,
    /\.m3u8\?/i,
    /\.mpd$/i,
    /\.mpd\?/i,
    /segment/i,
    /chunk/i,
  ];
  
  for (const pattern of skipPatterns) {
    if (pattern.test(url)) return false;
  }
  
  // Must have video extension
  return /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|3gp)(\?|$|#)/i.test(url);
}

function isRealImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
  
  const skipPatterns = [
    /google-analytics/i,
    /facebook\.net/i,
    /doubleclick/i,
    /pixel/i,
    /beacon/i,
    /tracking/i,
    /1x1/i,
  ];
  
  for (const pattern of skipPatterns) {
    if (pattern.test(url)) return false;
  }
  
  return /\.(webp|jpg|jpeg|png|gif|avif|bmp|tiff|ico)(\?|$|#)/i.test(url);
}

// ========== INTERCEPT NETWORK REQUESTS ==========
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url;
    
    // Skip non-media domains
    if (url.includes('google-analytics') || url.includes('facebook.net') || 
        url.includes('doubleclick') || url.includes('pixel')) return;
    
    // Only capture actual media files
    const isVideo = isRealVideoUrl(url);
    const isImage = isRealImageUrl(url);
    
    if (isVideo || isImage) {
      mediaRequests.set(details.requestId, {
        url: url,
        type: details.type,
        isVideo: isVideo,
        isImage: isImage,
        time: Date.now(),
        tabId: details.tabId,
        initiator: details.initiator || ''
      });
    }
  },
  { urls: ["<all_urls>"] }
);

// Capture response headers for content-type and size
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (mediaRequests.has(details.requestId)) {
      const media = mediaRequests.get(details.requestId);
      
      const contentType = details.responseHeaders?.find(
        h => h.name.toLowerCase() === 'content-type'
      );
      if (contentType) {
        media.contentType = contentType.value;
        
        // Verify it's actually media
        if (contentType.value.includes('video/')) {
          media.verified = true;
          media.isVideo = true;
        } else if (contentType.value.includes('image/')) {
          media.verified = true;
          media.isImage = true;
        }
      }
      
      const contentLength = details.responseHeaders?.find(
        h => h.name.toLowerCase() === 'content-length'
      );
      if (contentLength) {
        media.size = parseInt(contentLength.value);
      }
      
      media.status = details.statusCode;
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// Cleanup old entries (keep last 10 minutes)
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, media] of mediaRequests) {
    if (media.time < cutoff) mediaRequests.delete(id);
  }
}, 60000);

// ========== DOWNLOAD STATE ==========
let downloadState = {
  isDownloading: false,
  total: 0,
  completed: 0,
  failed: 0,
  queue: []
};

// ========== MESSAGE HANDLER ==========
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  
  if (msg.type === 'GET_MEDIA') {
    const mediaList = [...mediaRequests.values()]
      .filter(m => m.tabId === msg.tabId)
      .reduce((acc, m) => {
        if (!acc.find(x => x.url === m.url)) acc.push(m);
        return acc;
      }, []);
    sendResponse({ media: mediaList });
  }
  
  if (msg.type === 'ADD_MEDIA') {
    // From content script — store in intercepted list
    const exists = interceptedData.find(m => m.url === msg.data.url || m.blobUrl === msg.data.blobUrl);
    if (!exists) {
      interceptedData.push({ ...msg.data, tabId: sender.tab?.id, time: Date.now() });
    }
    sendResponse({ ok: true });
  }
  
  if (msg.type === 'GET_INTERCEPTED') {
    const tabMedia = interceptedData.filter(m => m.tabId === msg.tabId);
    sendResponse({ media: tabMedia });
  }
  
  if (msg.type === 'DOWNLOAD_ONE') {
    const folder = msg.folder || 'MediaGrabber';
    const filename = `${folder}/${msg.filename || 'media.webp'}`;
    
    chrome.downloads.download({
      url: msg.url,
      filename: filename,
      saveAs: false,
      conflictAction: 'uniquify'
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        chrome.downloads.download({
          url: msg.url,
          filename: msg.filename || 'media.webp',
          saveAs: false,
          conflictAction: 'uniquify'
        });
      }
    });
    sendResponse({ ok: true });
  }
  
  if (msg.type === 'DOWNLOAD_BATCH') {
    if (downloadState.isDownloading) {
      sendResponse({ ok: false, error: 'Already downloading' });
      return true;
    }
    
    const items = msg.items || [];
    const folder = msg.folder || 'MediaGrabber';
    
    downloadState = {
      isDownloading: true,
      total: items.length,
      completed: 0,
      failed: 0,
      queue: [...items],
      folder: folder
    };
    
    processDownloadQueue();
    sendResponse({ ok: true, total: items.length });
  }
  
  if (msg.type === 'GET_DOWNLOAD_STATUS') {
    sendResponse({ ...downloadState });
  }
  
  if (msg.type === 'CANCEL_DOWNLOADS') {
    downloadState.isDownloading = false;
    downloadState.queue = [];
    sendResponse({ ok: true });
  }
  
  return true;
});

// ========== BATCH DOWNLOAD QUEUE ==========
function processDownloadQueue() {
  if (!downloadState.isDownloading || downloadState.queue.length === 0) {
    downloadState.isDownloading = false;
    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_COMPLETE',
      completed: downloadState.completed,
      failed: downloadState.failed,
      total: downloadState.total
    }).catch(() => {});
    return;
  }
  
  const item = downloadState.queue.shift();
  const ext = getExtension(item.url);
  const baseName = sanitizeFilename(item.filename || `media_${Date.now()}`);
  const filename = `${downloadState.folder}/${baseName}${ext}`;
  
  chrome.downloads.download({
    url: item.url,
    filename: filename,
    saveAs: false,
    conflictAction: 'uniquify'
  }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.warn('[Media Grabber] Download failed:', chrome.runtime.lastError.message);
      downloadState.failed++;
      
      // Try without folder as fallback
      chrome.downloads.download({
        url: item.url,
        filename: `${baseName}${ext}`,
        saveAs: false,
        conflictAction: 'uniquify'
      }, () => {
        if (!chrome.runtime.lastError) {
          downloadState.failed--;
          downloadState.completed++;
        }
        
        chrome.runtime.sendMessage({
          type: 'DOWNLOAD_PROGRESS',
          completed: downloadState.completed,
          failed: downloadState.failed,
          total: downloadState.total
        }).catch(() => {});
        
        setTimeout(() => processDownloadQueue(), 300);
      });
      return;
    }
    
    downloadState.completed++;
    
    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_PROGRESS',
      completed: downloadState.completed,
      failed: downloadState.failed,
      total: downloadState.total
    }).catch(() => {});
    
    setTimeout(() => processDownloadQueue(), 300);
  });
}

// Track download completion
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state) {
    if (delta.state.current === 'complete') {
      // Download succeeded
    } else if (delta.state.current === 'interrupted') {
      downloadState.failed++;
    }
  }
});

// ========== HELPERS ==========
function getExtension(url) {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.(webp|jpg|jpeg|png|gif|avif|bmp|tiff|mp4|webm|mov|avi|mkv|mp3|wav|ogg)(\?|$)/i);
    if (match) return '.' + match[1].toLowerCase();
    return '.webp';
  } catch {
    return '.webp';
  }
}

function sanitizeFilename(name) {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 100);
}

console.log('[Media Grabber] Background service worker v3.1 loaded');
