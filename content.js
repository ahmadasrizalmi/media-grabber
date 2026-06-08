// Content script — Media Grabber v3.2
// Intercept MediaSource to capture streaming video data

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

// ========== 2. INTERCEPT MEDIASOURCE API ==========
// This captures video data from HLS/DASH streaming

const mediaSourceBuffers = new Map();
let currentVideoBlob = null;

// Override MediaSource.addSourceBuffer
const origAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
MediaSource.prototype.addSourceBuffer = function(mimeType) {
  console.log('[Media Grabber] MediaSource.addSourceBuffer:', mimeType);
  const sourceBuffer = origAddSourceBuffer.call(this, mimeType);
  
  // Track this source buffer
  const bufferId = `buffer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  mediaSourceBuffers.set(bufferId, {
    mimeType: mimeType,
    chunks: [],
    sourceBuffer: sourceBuffer,
    mediaSource: this
  });
  
  // Intercept appendBuffer to capture video data
  const origAppendBuffer = sourceBuffer.appendBuffer.bind(sourceBuffer);
  sourceBuffer.appendBuffer = function(data) {
    const buffer = mediaSourceBuffers.get(bufferId);
    if (buffer) {
      // Store the chunk
      buffer.chunks.push(new Uint8Array(data));
      console.log(`[Media Grabber] Captured chunk: ${data.byteLength} bytes, total chunks: ${buffer.chunks.length}`);
    }
    return origAppendBuffer(data);
  };
  
  return sourceBuffer;
};

// Override MediaSource.addSourceBuffer (alternative)
const origAddSourceBuffer2 = window.MediaSource?.prototype?.addSourceBuffer;
if (origAddSourceBuffer2) {
  window.MediaSource.prototype.addSourceBuffer = function(mimeType) {
    console.log('[Media Grabber] MediaSource.addSourceBuffer (v2):', mimeType);
    const sourceBuffer = origAddSourceBuffer2.call(this, mimeType);
    
    const bufferId = `buffer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    mediaSourceBuffers.set(bufferId, {
      mimeType: mimeType,
      chunks: [],
      sourceBuffer: sourceBuffer,
      mediaSource: this
    });
    
    const origAppendBuffer = sourceBuffer.appendBuffer.bind(sourceBuffer);
    sourceBuffer.appendBuffer = function(data) {
      const buffer = mediaSourceBuffers.get(bufferId);
      if (buffer) {
        buffer.chunks.push(new Uint8Array(data));
      }
      return origAppendBuffer(data);
    };
    
    return sourceBuffer;
  };
}

// ========== 3. INTERCEPT FETCH/XHR FOR VIDEO CHUNKS ==========
const origFetch = window.fetch;
window.fetch = async function(...args) {
  const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
  const response = await origFetch.apply(this, args);
  
  if (url) {
    const contentType = response.headers?.get('content-type') || '';
    
    // Detect M3U8 manifests (HLS streams)
    if (/\.m3u8(\?|$|#)/i.test(url)) {
      console.log('[Media Grabber] M3U8 manifest detected:', url);
      chrome.runtime.sendMessage({
        type: 'ADD_MEDIA',
        data: {
          source: 'fetch-m3u8',
          url: url,
          isVideo: true,
          isManifest: true,
          isStream: true,
          timestamp: Date.now()
        }
      }).catch(() => {});
    }
    
    // Detect video segments (HLS .ts, DASH .m4s, fMP4)
    const isVideoSegment = (
      contentType.includes('video/mp4') ||
      contentType.includes('video/webm') ||
      contentType.includes('video/MP2T') ||  // HLS TS segments
      contentType.includes('application/mp4') ||  // fMP4
      url.includes('.ts?') || url.includes('.ts&') ||  // HLS segments
      url.includes('.m4s?') || url.includes('.m4s&') ||  // DASH segments
      url.includes('segment') || url.includes('chunk')
    );
    
    if (isVideoSegment) {
      const clone = response.clone();
      clone.arrayBuffer().then(buffer => {
        if (buffer.byteLength > 10240) { // Min 10KB
          console.log(`[Media Grabber] Video segment detected: ${url} (${buffer.byteLength} bytes)`);
          
          // Store for download
          chrome.runtime.sendMessage({
            type: 'ADD_MEDIA',
            data: {
              source: 'fetch-segment',
              url: url,
              contentType: contentType,
              size: buffer.byteLength,
              isVideo: true,
              isSegment: true,
              timestamp: Date.now()
            }
          });
        }
      }).catch(() => {});
    }
    
    // Capture actual video files
    if (contentType.includes('video/mp4') || contentType.includes('video/webm')) {
      const clone = response.clone();
      clone.blob().then(blob => {
        if (blob.size > 10240) {
          chrome.runtime.sendMessage({
            type: 'ADD_MEDIA',
            data: {
              source: 'fetch-video',
              url: url,
              contentType: contentType,
              size: blob.size,
              isVideo: true,
              timestamp: Date.now()
            }
          });
        }
      }).catch(() => {});
    }
    
    // Capture images
    if (contentType.includes('image/') && !contentType.includes('svg')) {
      const clone = response.clone();
      clone.blob().then(blob => {
        if (blob.size > 1024) {
          chrome.runtime.sendMessage({
            type: 'ADD_MEDIA',
            data: {
              source: 'fetch-image',
              url: url,
              contentType: contentType,
              size: blob.size,
              isVideo: false,
              timestamp: Date.now()
            }
          });
        }
      }).catch(() => {});
    }
    
    // Scan JSON for video URLs
    if (contentType.includes('json')) {
      const clone = response.clone();
      clone.json().then(data => findMediaUrlsInJson(data, url)).catch(() => {});
    }
  }
  
  return response;
};

// ========== 4. INTERCEPT XMLHttpRequest ==========
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
    
    // Detect video segments
    const isVideoSegment = (
      contentType.includes('video/mp4') ||
      contentType.includes('video/webm') ||
      contentType.includes('video/MP2T') ||
      contentType.includes('application/mp4') ||
      url.includes('.ts?') || url.includes('.ts&') ||
      url.includes('.m4s?') || url.includes('.m4s&') ||
      url.includes('segment') || url.includes('chunk')
    );
    
    if (isVideoSegment) {
      console.log(`[Media Grabber] XHR video segment: ${url}`);
      chrome.runtime.sendMessage({
        type: 'ADD_MEDIA',
        data: {
          source: 'xhr-segment',
          url: url,
          contentType: contentType,
          isVideo: true,
          isSegment: true,
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

// ========== 5. SCAN JSON FOR MEDIA URLS ==========
function findMediaUrlsInJson(data, sourceUrl, depth = 0) {
  if (depth > 5 || !data) return;
  
  // Known video API patterns
  const videoApiPatterns = [
    /youtube\.com\/api/i,
    /vimeo\.com/i,
    /dailymotion\.com/i,
    /facebook\.com.*video/i,
    /tiktok\.com/i,
    /instagram\.com.*video/i,
  ];
  
  if (typeof data === 'string') {
    // Check for video URLs
    if (/\.(mp4|webm|mov|m4v)(\?|$|#)/i.test(data)) {
      chrome.runtime.sendMessage({
        type: 'ADD_MEDIA',
        data: {
          source: 'json-video',
          url: data.startsWith('http') ? data : new URL(data, sourceUrl).href,
          isVideo: true,
          timestamp: Date.now()
        }
      });
    }
    // Check for HLS/DASH manifests
    else if (/\.m3u8(\?|$)/i.test(data) || /\.mpd(\?|$)/i.test(data)) {
      chrome.runtime.sendMessage({
        type: 'ADD_MEDIA',
        data: {
          source: 'json-manifest',
          url: data.startsWith('http') ? data : new URL(data, sourceUrl).href,
          isVideo: true,
          isManifest: true,
          timestamp: Date.now()
        }
      });
    }
    // Check for image URLs
    else if (/\.(webp|jpg|jpeg|png|gif|avif)(\?|$|#)/i.test(data)) {
      chrome.runtime.sendMessage({
        type: 'ADD_MEDIA',
        data: {
          source: 'json-image',
          url: data.startsWith('http') ? data : new URL(data, sourceUrl).href,
          isVideo: false,
          timestamp: Date.now()
        }
      });
    }
  } else if (Array.isArray(data)) {
    data.forEach(item => findMediaUrlsInJson(item, sourceUrl, depth + 1));
  } else if (typeof data === 'object') {
    Object.entries(data).forEach(([key, value]) => {
      // Look for video-specific keys
      const videoKeys = ['url', 'src', 'video', 'video_url', 'video_src', 'mp4', 'webm',
                         'download_url', 'stream_url', 'playback_url', 'media_url',
                         'hls_url', 'dash_url', 'manifest_url', 'm3u8_url', 'mpd_url',
                         'quality', 'bitrate', 'resolution'];
      
      if (videoKeys.includes(key.toLowerCase())) {
        findMediaUrlsInJson(value, sourceUrl, depth + 1);
      }
      
      // Also check for nested video objects
      if (key.toLowerCase().includes('video') || key.toLowerCase().includes('stream') ||
          key.toLowerCase().includes('media') || key.toLowerCase().includes('playback')) {
        findMediaUrlsInJson(value, sourceUrl, depth + 1);
      }
    });
  }
}

// ========== 6. MONITOR DOM FOR VIDEO ELEMENTS ==========
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== 1) continue;
      
      // Video elements
      if (node.tagName === 'VIDEO') {
        const src = node.src || node.currentSrc;
        if (src) {
          console.log('[Media Grabber] Video element detected:', src);
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
        
        // Monitor when video starts playing
        node.addEventListener('play', () => {
          console.log('[Media Grabber] Video started playing');
          // Try to get the actual video source
          const currentSrc = node.currentSrc || node.src;
          if (currentSrc && currentSrc.startsWith('blob:')) {
            console.log('[Media Grabber] Video using blob URL:', currentSrc);
          }
        });
      }
      
      // Image elements
      if (node.tagName === 'IMG') {
        const src = node.src;
        if (src && node.width > 50) {
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

// ========== 7. CAPTURE VIDEO FROM CANVAS ==========
// Some players render video to canvas
const origDrawImage = CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.drawImage = function(image, ...args) {
  if (image instanceof HTMLVideoElement) {
    // This is a video being drawn to canvas
    console.log('[Media Grabber] Video drawn to canvas');
    this._hasVideo = true;
  }
  return origDrawImage.call(this, image, ...args);
};

// ========== 8. GET MEDIA SOURCE DATA ==========
// Function to export captured MediaSource buffers
window.__mediaGrabber_exportBuffers = function() {
  const exported = [];
  
  for (const [id, buffer] of mediaSourceBuffers) {
    if (buffer.chunks.length > 0) {
      // Combine all chunks
      const totalSize = buffer.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const combined = new Uint8Array(totalSize);
      let offset = 0;
      
      for (const chunk of buffer.chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      
      exported.push({
        id: id,
        mimeType: buffer.mimeType,
        size: totalSize,
        blob: new Blob([combined], { type: buffer.mimeType })
      });
    }
  }
  
  return exported;
};

// ========== 9. HLS STREAM DOWNLOADER BRIDGE ==========
// Handle HLS download requests from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'DOWNLOAD_HLS') {
    const hlsUrl = msg.url;
    const filename = msg.filename || `video_${Date.now()}.ts`;
    
    console.log(`[Media Grabber] Starting HLS download: ${hlsUrl}`);
    
    const downloader = new HLSDownloader({
      concurrency: 5,
      onProgress: (progress) => {
        chrome.runtime.sendMessage({
          type: 'HLS_PROGRESS',
          ...progress
        }).catch(() => {});
      },
      onComplete: (info) => {
        console.log('[Media Grabber] HLS download complete:', info);
      },
      onError: (error) => {
        console.error('[Media Grabber] HLS download error:', error);
        chrome.runtime.sendMessage({
          type: 'HLS_ERROR',
          error: error.message
        }).catch(() => {});
      }
    });
    
    // Store downloader reference for cancellation
    window.__mediaGrabber_activeHLS = downloader;
    
    downloader.downloadHLS(hlsUrl, filename)
      .then(result => {
        sendResponse({ success: true, size: result.size });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    
    return true; // Keep message channel open for async response
  }
  
  if (msg.type === 'CANCEL_HLS') {
    if (window.__mediaGrabber_activeHLS) {
      window.__mediaGrabber_activeHLS.cancel();
      window.__mediaGrabber_activeHLS = null;
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: 'No active download' });
    }
    return true;
  }
});

console.log('[Media Grabber] Content script v3.3 loaded - MediaSource + HLS streaming active');
