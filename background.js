// Background service worker — Media Grabber v2
// Intercepts ALL network requests for media content

const mediaRequests = new Map();
const interceptedData = [];

// ========== INTERCEPT NETWORK REQUESTS ==========
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url;
    
    // Detect media by content-type patterns in URL
    const mediaExts = /\.(webp|jpg|jpeg|png|gif|avif|bmp|tiff|mp4|webm|mov|avi|mkv|mp3|wav|ogg|flac|aac)(\?|$|#)/i;
    const mediaPaths = /\/(media|image|upload|render|output|result|asset|file|download|blob)\//i;
    const customExts = /\.(hk|fke|fte|img|vid)(\?|$|#)/i;
    
    // Skip tiny tracking pixels and analytics
    if (url.includes('google-analytics') || url.includes('facebook.net') || 
        url.includes('doubleclick') || url.includes('pixel')) return;
    
    const isMedia = mediaExts.test(url) || mediaPaths.test(url) || customExts.test(url);
    
    if (isMedia) {
      mediaRequests.set(details.requestId, {
        url: url,
        type: details.type,
        time: Date.now(),
        tabId: details.tabId,
        initiator: details.initiator || ''
      });
    }
  },
  { urls: ["<all_urls>"] }
);

// Capture response headers for content-type
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (mediaRequests.has(details.requestId)) {
      const media = mediaRequests.get(details.requestId);
      const contentType = details.responseHeaders?.find(
        h => h.name.toLowerCase() === 'content-type'
      );
      if (contentType) {
        media.contentType = contentType.value;
        
        // Also catch generic binary streams that are actually media
        if (contentType.value.includes('octet-stream') || contentType.value.includes('image') || contentType.value.includes('video')) {
          media.verified = true;
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
    // Single download — NO saveAs dialog
    const folder = msg.folder || 'MediaGrabber';
    const filename = `${folder}/${msg.filename || 'media.webp'}`;
    
    chrome.downloads.download({
      url: msg.url,
      filename: filename,
      saveAs: false,  // AUTO DOWNLOAD — no dialog!
      conflictAction: 'uniquify'
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        // Fallback: try without folder
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
    // Batch download — queue all files
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
    // Notify popup that downloads are done
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
    saveAs: false,  // AUTO — no dialog!
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
          downloadState.failed--; // Fallback succeeded
          downloadState.completed++;
        }
        downloadState.completed_count = downloadState.completed + downloadState.failed;
        
        // Progress update
        chrome.runtime.sendMessage({
          type: 'DOWNLOAD_PROGRESS',
          completed: downloadState.completed,
          failed: downloadState.failed,
          total: downloadState.total
        }).catch(() => {});
        
        // Next item with small delay to avoid overwhelming
        setTimeout(() => processDownloadQueue(), 300);
      });
      return;
    }
    
    downloadState.completed++;
    
    // Progress update
    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_PROGRESS',
      completed: downloadState.completed,
      failed: downloadState.failed,
      total: downloadState.total
    }).catch(() => {});
    
    // Next item
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
    const match = pathname.match(/\.(webp|jpg|jpeg|png|gif|avif|bmp|tiff|mp4|webm|mov|avi|mp3|wav|ogg)(\?|$)/i);
    if (match) return '.' + match[1].toLowerCase();
    
    // Check for custom extensions
    const customMatch = pathname.match(/\.(hk|fke|fte)(\?|$)/i);
    if (customMatch) return '.webp'; // Convert custom to webp
    
    return '.webp'; // Default
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

console.log('[Media Grabber] Background service worker loaded');
