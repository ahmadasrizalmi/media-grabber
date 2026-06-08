// HLS Downloader — Media Grabber v3.3
// Parse M3U8, download segments, decrypt AES-128, merge to single file

class HLSDownloader {
  constructor(options = {}) {
    this.concurrency = options.concurrency || 5;
    this.onProgress = options.onProgress || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onError = options.onError || (() => {});
    this.isCancelled = false;
    this.activeFetches = new Set();
    this.abortController = null;
  }

  // ─── Parse M3U8 Playlist ──────────────────────────────────────────
  
  async parsePlaylist(url, headers = {}) {
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      
      // Check if it's a master playlist (has #EXT-X-STREAM-INF)
      if (text.includes('#EXT-X-STREAM-INF')) {
        return this.parseMasterPlaylist(text, url);
      }
      
      // It's a media playlist
      return this.parseMediaPlaylist(text, url);
    } catch (error) {
      throw new Error(`Failed to parse playlist: ${error.message}`);
    }
  }

  parseMasterPlaylist(text, baseUrl) {
    const lines = text.split('\n');
    const variants = [];
    let currentBandwidth = 0;
    let currentResolution = '';
    
    for (const line of lines) {
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
        const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/);
        
        currentBandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1]) : 0;
        currentResolution = resolutionMatch ? resolutionMatch[1] : '';
      } else if (line && !line.startsWith('#')) {
        const variantUrl = new URL(line.trim(), baseUrl).href;
        variants.push({
          url: variantUrl,
          bandwidth: currentBandwidth,
          resolution: currentResolution
        });
      }
    }
    
    // Sort by bandwidth (highest first)
    variants.sort((a, b) => b.bandwidth - a.bandwidth);
    
    // Return the highest quality variant
    if (variants.length > 0) {
      return this.parsePlaylist(variants[0].url);
    }
    
    throw new Error('No variants found in master playlist');
  }

  parseMediaPlaylist(text, baseUrl) {
    const lines = text.split('\n');
    const segments = [];
    let currentDuration = 0;
    let currentKey = null;
    let currentKeyIV = null;
    let segmentIndex = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line.startsWith('#EXT-X-KEY:')) {
        // Parse encryption key info
        const methodMatch = line.match(/METHOD=([^,]+)/);
        const uriMatch = line.match(/URI="([^"]+)"/);
        const ivMatch = line.match(/IV=([^,]+)/);
        
        if (methodMatch && methodMatch[1] !== 'NONE') {
          currentKey = {
            method: methodMatch[1],
            uri: uriMatch ? new URL(uriMatch[1], baseUrl).href : null,
            iv: ivMatch ? ivMatch[1] : null
          };
        } else {
          currentKey = null;
        }
      } else if (line.startsWith('#EXTINF:')) {
        const durationMatch = line.match(/#EXTINF:([\d.]+)/);
        currentDuration = durationMatch ? parseFloat(durationMatch[1]) : 0;
      } else if (line && !line.startsWith('#')) {
        const segmentUrl = new URL(line, baseUrl).href;
        
        // Generate IV if not specified (use segment sequence number)
        let iv = currentKey?.iv;
        if (currentKey && !iv) {
          iv = `0x${segmentIndex.toString(16).padStart(32, '0')}`;
        }
        
        segments.push({
          url: segmentUrl,
          duration: currentDuration,
          index: segmentIndex,
          key: currentKey ? {
            ...currentKey,
            iv: iv
          } : null
        });
        
        segmentIndex++;
      }
    }
    
    return {
      type: 'media',
      segments: segments,
      totalDuration: segments.reduce((sum, s) => sum + s.duration, 0)
    };
  }

  // ─── Download HLS Stream ──────────────────────────────────────────
  
  async downloadHLS(url, filename, headers = {}) {
    this.isCancelled = false;
    this.abortController = new AbortController();
    
    try {
      // Step 1: Parse playlist
      this.onProgress({ stage: 'parsing', message: 'Parsing playlist...' });
      const playlist = await this.parsePlaylist(url, headers);
      
      if (!playlist.segments || playlist.segments.length === 0) {
        throw new Error('No segments found in playlist');
      }
      
      this.onProgress({ 
        stage: 'downloading', 
        message: `Downloading ${playlist.segments.length} segments...`,
        total: playlist.segments.length,
        completed: 0
      });
      
      // Step 2: Download segments in parallel
      const segmentBuffers = await this.downloadSegments(
        playlist.segments, 
        headers
      );
      
      if (this.isCancelled) {
        throw new Error('Download cancelled');
      }
      
      // Step 3: Merge segments
      this.onProgress({ stage: 'merging', message: 'Merging segments...' });
      const mergedBuffer = this.mergeBuffers(segmentBuffers);
      
      // Step 4: Create blob and download
      this.onProgress({ stage: 'saving', message: 'Saving file...' });
      const blob = new Blob([mergedBuffer], { type: 'video/mp2t' });
      const blobUrl = URL.createObjectURL(blob);
      
      // Trigger download
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename || `video_${Date.now()}.ts`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      // Cleanup
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      
      this.onComplete({
        filename: filename,
        size: mergedBuffer.byteLength,
        segments: playlist.segments.length,
        duration: playlist.totalDuration
      });
      
      return { success: true, size: mergedBuffer.byteLength };
      
    } catch (error) {
      if (!this.isCancelled) {
        this.onError(error);
      }
      throw error;
    }
  }

  // ─── Download Segments with Concurrency ───────────────────────────
  
  async downloadSegments(segments, headers = {}) {
    const results = new Array(segments.length);
    const queue = [...Array(segments.length).keys()];
    const workers = [];
    let completed = 0;
    
    // Create worker pool
    for (let i = 0; i < Math.min(this.concurrency, segments.length); i++) {
      workers.push(this.segmentWorker(queue, segments, results, headers, 
        (index, buffer) => {
          completed++;
          this.onProgress({
            stage: 'downloading',
            message: `Downloading segment ${completed}/${segments.length}...`,
            total: segments.length,
            completed: completed,
            percent: Math.round((completed / segments.length) * 100)
          });
        }
      ));
    }
    
    // Wait for all workers to complete
    await Promise.all(workers);
    
    return results;
  }

  async segmentWorker(queue, segments, results, headers, onSegmentComplete) {
    while (queue.length > 0 && !this.isCancelled) {
      const index = queue.shift();
      if (index === undefined) break;
      
      const segment = segments[index];
      const controller = new AbortController();
      this.activeFetches.add(controller);
      
      try {
        const response = await fetch(segment.url, {
          headers: {
            ...headers,
            'Accept': '*/*'
          },
          signal: controller.signal
        });
        
        if (!response.ok) {
          throw new Error(`Segment ${index} HTTP ${response.status}`);
        }
        
        let buffer = await response.arrayBuffer();
        
        // Decrypt if encrypted
        if (segment.key && segment.key.uri) {
          buffer = await this.decryptSegment(buffer, segment.key);
        }
        
        results[index] = buffer;
        onSegmentComplete(index, buffer);
        
      } catch (error) {
        if (error.name === 'AbortError') {
          break;
        }
        console.warn(`[HLSDownloader] Segment ${index} failed:`, error.message);
        results[index] = new ArrayBuffer(0); // Empty buffer for failed segment
      } finally {
        this.activeFetches.delete(controller);
      }
    }
  }

  // ─── Decrypt AES-128 Encrypted Segments ───────────────────────────
  
  async decryptSegment(buffer, keyInfo) {
    try {
      // Fetch the decryption key
      const keyResponse = await fetch(keyInfo.uri);
      const keyBuffer = await keyResponse.arrayBuffer();
      
      // Parse IV
      let iv;
      if (keyInfo.iv) {
        // Convert hex string to Uint8Array
        const hex = keyInfo.iv.replace('0x', '');
        iv = new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
      } else {
        iv = new Uint8Array(16); // All zeros
      }
      
      // Import key
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBuffer,
        { name: 'AES-CBC' },
        false,
        ['decrypt']
      );
      
      // Decrypt
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-CBC', iv: iv },
        cryptoKey,
        buffer
      );
      
      return decrypted;
      
    } catch (error) {
      console.warn('[HLSDownloader] Decryption failed:', error.message);
      return buffer; // Return unencrypted buffer as fallback
    }
  }

  // ─── Merge Segment Buffers ────────────────────────────────────────
  
  mergeBuffers(buffers) {
    // Calculate total size
    const validBuffers = buffers.filter(b => b && b.byteLength > 0);
    const totalSize = validBuffers.reduce((sum, b) => sum + b.byteLength, 0);
    
    // Create merged buffer
    const merged = new Uint8Array(totalSize);
    let offset = 0;
    
    for (const buffer of validBuffers) {
      merged.set(new Uint8Array(buffer), offset);
      offset += buffer.byteLength;
    }
    
    return merged.buffer;
  }

  // ─── Cancel Download ──────────────────────────────────────────────
  
  cancel() {
    this.isCancelled = true;
    for (const controller of this.activeFetches) {
      controller.abort();
    }
    this.activeFetches.clear();
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined') {
  module.exports = HLSDownloader;
}
