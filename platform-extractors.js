// Platform-specific video extractors — Media Grabber v4.0
// Extracts video URLs from known platforms' page data

class PlatformExtractor {
  
  // ─── YouTube ───────────────────────────────────────────────────────
  
  static extractYouTube() {
    const results = [];
    
    try {
      // Method 1: ytInitialPlayerResponse (most reliable)
      let playerResponse = null;
      
      if (window.ytInitialPlayerResponse) {
        playerResponse = window.ytInitialPlayerResponse;
      } else {
        // Try to find it in page scripts
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
          const text = script.textContent;
          const match = text.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
          if (match) {
            try {
              playerResponse = JSON.parse(match[1]);
              break;
            } catch (e) {}
          }
        }
      }
      
      if (playerResponse?.streamingData) {
        const sd = playerResponse.streamingData;
        const videoDetails = playerResponse.videoDetails || {};
        
        // Progressive formats (combined audio+video, direct mp4)
        if (sd.formats) {
          for (const fmt of sd.formats) {
            if (fmt.url) {
              results.push({
                type: 'video',
                source: 'youtube-progressive',
                url: fmt.url,
                quality: fmt.qualityLabel || fmt.quality || 'unknown',
                qualityLabel: fmt.qualityLabel || '',
                width: fmt.width || 0,
                height: fmt.height || 0,
                format: fmt.mimeType?.includes('webm') ? 'webm' : 'mp4',
                size: fmt.contentLength ? parseInt(fmt.contentLength) : 0,
                hasAudio: true,
                hasVideo: true,
                title: videoDetails.title || '',
                thumbnail: videoDetails.thumbnail?.thumbnails?.pop()?.url || '',
                isVideo: true,
                platform: 'youtube'
              });
            }
          }
        }
        
        // Adaptive formats (separate audio/video streams)
        if (sd.adaptiveFormats) {
          for (const fmt of sd.adaptiveFormats) {
            if (fmt.url) {
              const isAudio = fmt.mimeType?.startsWith('audio/');
              results.push({
                type: isAudio ? 'audio' : 'video',
                source: 'youtube-adaptive',
                url: fmt.url,
                quality: fmt.qualityLabel || fmt.quality || (isAudio ? `${fmt.audioBitrate || '?'}kbps` : 'unknown'),
                qualityLabel: fmt.qualityLabel || '',
                width: fmt.width || 0,
                height: fmt.height || 0,
                format: fmt.mimeType?.split(';')[0]?.split('/')[1] || 'mp4',
                size: fmt.contentLength ? parseInt(fmt.contentLength) : 0,
                hasAudio: isAudio,
                hasVideo: !isAudio,
                bitrate: fmt.audioBitrate || 0,
                title: videoDetails.title || '',
                thumbnail: videoDetails.thumbnail?.thumbnails?.pop()?.url || '',
                isVideo: !isAudio,
                isAudio: isAudio,
                platform: 'youtube'
              });
            }
          }
        }
      }
      
      // Method 2: ytplayer.config (fallback)
      if (results.length === 0 && window.ytplayer?.config?.args) {
        const args = window.ytplayer.config.args;
        if (args.url_encoded_fmt_stream_map) {
          const streams = args.url_encoded_fmt_fmt_stream_map.split(',');
          for (const stream of streams) {
            const params = new URLSearchParams(stream);
            const url = params.get('url');
            if (url) {
              results.push({
                type: 'video',
                source: 'youtube-ytplayer',
                url: url,
                quality: params.get('quality') || 'unknown',
                format: params.get('type')?.split('/')[1]?.split(';')[0] || 'mp4',
                hasAudio: true,
                hasVideo: true,
                isVideo: true,
                platform: 'youtube'
              });
            }
          }
        }
      }
    } catch (e) {
      console.warn('[Media Grabber] YouTube extraction error:', e);
    }
    
    return results;
  }
  
  // ─── TikTok ────────────────────────────────────────────────────────
  
  static extractTikTok() {
    const results = [];
    
    try {
      // Method 1: __NEXT_DATA__
      const nextData = document.getElementById('__NEXT_DATA__');
      if (nextData) {
        const data = JSON.parse(nextData.textContent);
        const videoData = data?.props?.pageProps?.itemInfo?.itemStruct?.video;
        if (videoData?.playAddr) {
          results.push({
            type: 'video',
            source: 'tiktok-nextdata',
            url: videoData.playAddr,
            quality: videoData.definition || 'standard',
            width: videoData.width || 0,
            height: videoData.height || 0,
            format: 'mp4',
            isVideo: true,
            platform: 'tiktok'
          });
        }
        // Also check for downloadAddr
        if (videoData?.downloadAddr) {
          results.push({
            type: 'video',
            source: 'tiktok-download',
            url: videoData.downloadAddr,
            quality: 'original',
            format: 'mp4',
            isVideo: true,
            platform: 'tiktok'
          });
        }
      }
      
      // Method 2: SIGI_STATE
      if (results.length === 0) {
        const sigiState = document.getElementById('SIGI_STATE');
        if (sigiState) {
          const data = JSON.parse(sigiState.textContent);
          const itemModule = data?.ItemModule;
          if (itemModule) {
            const item = Object.values(itemModule)[0];
            const video = item?.video;
            if (video?.playAddr) {
              results.push({
                type: 'video',
                source: 'tiktok-sigi',
                url: video.playAddr,
                quality: video.definition || 'standard',
                format: 'mp4',
                isVideo: true,
                platform: 'tiktok'
              });
            }
          }
        }
      }
      
      // Method 3: Script tag with __UNIVERSAL_DATA_FOR_REHYDRATION__
      if (results.length === 0) {
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
          if (script.textContent.includes('__UNIVERSAL_DATA_FOR_REHYDRATION__')) {
            const match = script.textContent.match(/__UNIVERSAL_DATA_FOR_REHYDRATION__\s*=\s*(\{.+?\})\s*;?\s*<\/script/s);
            if (match) {
              try {
                const data = JSON.parse(match[1]);
                const defaultScope = data?.['__DEFAULT_SCOPE__'];
                const videoData = defaultScope?.['webapp.video-detail']?.itemInfo?.itemStruct?.video;
                if (videoData?.playAddr) {
                  results.push({
                    type: 'video',
                    source: 'tiktok-universal',
                    url: videoData.playAddr,
                    quality: videoData.definition || 'standard',
                    format: 'mp4',
                    isVideo: true,
                    platform: 'tiktok'
                  });
                }
              } catch (e) {}
            }
          }
        }
      }
    } catch (e) {
      console.warn('[Media Grabber] TikTok extraction error:', e);
    }
    
    return results;
  }
  
  // ─── Instagram ─────────────────────────────────────────────────────
  
  static extractInstagram() {
    const results = [];
    
    try {
      // Method 1: _sharedData
      if (window._sharedData?.entry_data) {
        const pages = window._sharedData.entry_data;
        // Check PostPage
        if (pages.PostPage) {
          for (const page of pages.PostPage) {
            const media = page?.graphql?.shortcode_media;
            if (media?.video_url) {
              results.push({
                type: 'video',
                source: 'instagram-shared',
                url: media.video_url,
                quality: 'standard',
                width: media.dimensions?.width || 0,
                height: media.dimensions?.height || 0,
                format: 'mp4',
                isVideo: true,
                platform: 'instagram'
              });
            }
            // Check for sidecar (multiple media)
            if (media?.edge_sidecar_to_children?.edges) {
              for (const edge of media.edge_sidecar_to_children.edges) {
                const node = edge.node;
                if (node.video_url) {
                  results.push({
                    type: 'video',
                    source: 'instagram-sidecar',
                    url: node.video_url,
                    quality: 'standard',
                    format: 'mp4',
                    isVideo: true,
                    platform: 'instagram'
                  });
                } else if (node.display_url) {
                  results.push({
                    type: 'image',
                    source: 'instagram-sidecar',
                    url: node.display_url,
                    isVideo: false,
                    platform: 'instagram'
                  });
                }
              }
            }
          }
        }
      }
      
      // Method 2: Intercept GraphQL responses (already handled by fetch interceptor)
      // Method 3: Check for video elements with blob URLs
      if (results.length === 0) {
        const videos = document.querySelectorAll('video');
        for (const video of videos) {
          const src = video.src || video.currentSrc;
          if (src && src.startsWith('http')) {
            results.push({
              type: 'video',
              source: 'instagram-dom',
              url: src,
              quality: 'standard',
              format: 'mp4',
              isVideo: true,
              platform: 'instagram'
            });
          }
        }
      }
    } catch (e) {
      console.warn('[Media Grabber] Instagram extraction error:', e);
    }
    
    return results;
  }
  
  // ─── Twitter / X ───────────────────────────────────────────────────
  
  static extractTwitter() {
    const results = [];
    
    try {
      // Twitter stores data in various script tags
      const scripts = document.querySelectorAll('script');
      
      for (const script of scripts) {
        const text = script.textContent;
        
        // Look for video.twimg.com URLs in script data
        const videoUrls = text.match(/https:\/\/video\.twimg\.com\/[^"'\s]+/g);
        if (videoUrls) {
          for (const url of videoUrls) {
            const cleanUrl = url.replace(/\\u002F/g, '/');
            if (cleanUrl.includes('.mp4') || cleanUrl.includes('.m3u8')) {
              results.push({
                type: 'video',
                source: 'twitter-script',
                url: cleanUrl,
                quality: cleanUrl.match(/(\d+x\d+)/)?.[1] || 'standard',
                format: cleanUrl.includes('.m3u8') ? 'hls' : 'mp4',
                isVideo: true,
                platform: 'twitter'
              });
            }
          }
        }
      }
      
      // Also check video elements
      const videos = document.querySelectorAll('video');
      for (const video of videos) {
        const src = video.src || video.currentSrc;
        if (src && (src.includes('video.twimg.com') || src.startsWith('http'))) {
          results.push({
            type: 'video',
            source: 'twitter-dom',
            url: src,
            quality: 'standard',
            format: src.includes('.m3u8') ? 'hls' : 'mp4',
            isVideo: true,
            platform: 'twitter'
          });
        }
      }
    } catch (e) {
      console.warn('[Media Grabber] Twitter extraction error:', e);
    }
    
    return results;
  }
  
  // ─── Facebook ──────────────────────────────────────────────────────
  
  static extractFacebook() {
    const results = [];
    
    try {
      // Look for video URLs in page source
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent;
        // Facebook video URLs pattern
        const fbVideoUrls = text.match(/https:\/\/(?:scontent|external|video)[^"'\s]*\.fbcdn\.net\/[^"'\s]+\.mp4[^"'\s]*/g);
        if (fbVideoUrls) {
          for (const url of fbVideoUrls) {
            const cleanUrl = url.replace(/\\u002F/g, '/').replace(/\\u0025/g, '%');
            results.push({
              type: 'video',
              source: 'facebook-script',
              url: cleanUrl,
              quality: 'standard',
              format: 'mp4',
              isVideo: true,
              platform: 'facebook'
            });
          }
        }
      }
      
      // Check video elements
      const videos = document.querySelectorAll('video');
      for (const video of videos) {
        const src = video.src || video.currentSrc;
        if (src && src.startsWith('http') && !src.startsWith('blob:')) {
          results.push({
            type: 'video',
            source: 'facebook-dom',
            url: src,
            quality: 'standard',
            format: 'mp4',
            isVideo: true,
            platform: 'facebook'
          });
        }
      }
    } catch (e) {
      console.warn('[Media Grabber] Facebook extraction error:', e);
    }
    
    return results;
  }
  
  // ─── Vimeo ─────────────────────────────────────────────────────────
  
  static extractVimeo() {
    const results = [];
    
    try {
      // Vimeo stores config in window.vimeo or player config
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent;
        
        // Look for vimeo config JSON
        const configMatch = text.match(/var config\s*=\s*(\{.+?\});/s);
        if (configMatch) {
          try {
            const config = JSON.parse(configMatch[1]);
            const files = config?.video?.files || config?.request?.files;
            if (files) {
              // Progressive files
              if (files.progressive) {
                for (const file of files.progressive) {
                  results.push({
                    type: 'video',
                    source: 'vimeo-config',
                    url: file.url,
                    quality: `${file.height}p` || 'standard',
                    width: file.width || 0,
                    height: file.height || 0,
                    format: file.mime?.split('/')[1] || 'mp4',
                    isVideo: true,
                    platform: 'vimeo'
                  });
                }
              }
              // HLS
              if (files.hls) {
                results.push({
                  type: 'stream',
                  source: 'vimeo-hls',
                  url: files.hls.cdns?.akamai_interx || files.hls.cdns?.fastly_skyfire || files.hls.default_cdn,
                  quality: 'adaptive',
                  format: 'hls',
                  isVideo: true,
                  isManifest: true,
                  isStream: true,
                  platform: 'vimeo'
                });
              }
            }
          } catch (e) {}
        }
      }
    } catch (e) {
      console.warn('[Media Grabber] Vimeo extraction error:', e);
    }
    
    return results;
  }
  
  // ─── Dailymotion ───────────────────────────────────────────────────
  
  static extractDailymotion() {
    const results = [];
    
    try {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent;
        const match = text.match(/__PLAYER_CONFIG__\s*=\s*(\{.+?\})\s*;/s);
        if (match) {
          try {
            const config = JSON.parse(match[1]);
            const qualities = config?.metadata?.qualities;
            if (qualities) {
              for (const [quality, streams] of Object.entries(qualities)) {
                for (const stream of streams) {
                  if (stream.url) {
                    results.push({
                      type: 'video',
                      source: 'dailymotion',
                      url: stream.url,
                      quality: `${quality}p`,
                      format: stream.type?.includes('mp4') ? 'mp4' : 'hls',
                      isVideo: true,
                      platform: 'dailymotion'
                    });
                  }
                }
              }
            }
          } catch (e) {}
        }
      }
    } catch (e) {
      console.warn('[Media Grabber] Dailymotion extraction error:', e);
    }
    
    return results;
  }
  
  // ─── Reddit ────────────────────────────────────────────────────────
  
  static extractReddit() {
    const results = [];
    
    try {
      // Reddit stores data in window.__INITIAL_STATE__ or script tags
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent;
        
        // Look for Reddit video URLs
        const redditVideoUrls = text.match(/https:\/\/v\.redd\.it\/[^"'\s]+/g);
        if (redditVideoUrls) {
          for (const url of redditVideoUrls) {
            if (url.includes('.mp4') || url.includes('DASHPlaylist.mpd')) {
              results.push({
                type: url.includes('.mpd') ? 'stream' : 'video',
                source: 'reddit-script',
                url: url,
                quality: 'standard',
                format: url.includes('.mpd') ? 'dash' : 'mp4',
                isVideo: true,
                isManifest: url.includes('.mpd'),
                platform: 'reddit'
              });
            }
          }
        }
      }
    } catch (e) {
      console.warn('[Media Grabber] Reddit extraction error:', e);
    }
    
    return results;
  }
  
  // ─── Auto-detect platform ──────────────────────────────────────────
  
  static detectPlatform() {
    const hostname = window.location.hostname.toLowerCase();
    
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'youtube';
    if (hostname.includes('tiktok.com')) return 'tiktok';
    if (hostname.includes('instagram.com')) return 'instagram';
    if (hostname.includes('twitter.com') || hostname.includes('x.com')) return 'twitter';
    if (hostname.includes('facebook.com') || hostname.includes('fb.watch')) return 'facebook';
    if (hostname.includes('vimeo.com')) return 'vimeo';
    if (hostname.includes('dailymotion.com')) return 'dailymotion';
    if (hostname.includes('reddit.com') || hostname.includes('redd.it')) return 'reddit';
    
    return 'unknown';
  }
  
  // ─── Main extract method ───────────────────────────────────────────
  
  static extract() {
    const platform = this.detectPlatform();
    let results = [];
    
    switch (platform) {
      case 'youtube':
        results = this.extractYouTube();
        break;
      case 'tiktok':
        results = this.extractTikTok();
        break;
      case 'instagram':
        results = this.extractInstagram();
        break;
      case 'twitter':
        results = this.extractTwitter();
        break;
      case 'facebook':
        results = this.extractFacebook();
        break;
      case 'vimeo':
        results = this.extractVimeo();
        break;
      case 'dailymotion':
        results = this.extractDailymotion();
        break;
      case 'reddit':
        results = this.extractReddit();
        break;
    }
    
    // Deduplicate by URL
    const seen = new Set();
    results = results.filter(r => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });
    
    return { platform, results };
  }
}

// Export for content script usage
window.__mediaGrabber_extractors = PlatformExtractor;
