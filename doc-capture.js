// Minimal PDF Builder — Media Grabber v4.2
// Creates image-based PDFs entirely client-side (no external libs)

class PDFBuilder {
  constructor() {
    this.objects = [];
    this.pages = [];
    this.pageWidth = 595.28;  // A4 width in points
    this.pageHeight = 841.89; // A4 height in points
  }

  // ─── Add an image page ─────────────────────────────────────────────
  
  async addImage(imageSource) {
    // imageSource can be: URL string, Blob, or ImageData
    let imageBytes, imgWidth, imgHeight;
    
    if (typeof imageSource === 'string') {
      // URL — fetch and convert
      const response = await fetch(imageSource, { mode: 'cors' });
      const blob = await response.blob();
      imageBytes = await this.blobToBytes(blob);
      const dims = await this.getImageDimensions(blob);
      imgWidth = dims.width;
      imgHeight = dims.height;
    } else if (imageSource instanceof Blob) {
      imageBytes = await this.blobToBytes(imageSource);
      const dims = await this.getImageDimensions(imageSource);
      imgWidth = dims.width;
      imgHeight = dims.height;
    } else if (imageSource instanceof HTMLCanvasElement) {
      const blob = await new Promise(r => imageSource.toBlob(r, 'image/jpeg', 0.92));
      imageBytes = await this.blobToBytes(blob);
      imgWidth = imageSource.width;
      imgHeight = imageSource.height;
    } else {
      throw new Error('Unsupported image source');
    }
    
    // Calculate page dimensions to fit image (maintain aspect ratio)
    const scale = Math.min(this.pageWidth / imgWidth, this.pageHeight / imgHeight);
    const drawWidth = imgWidth * scale;
    const drawHeight = imgHeight * scale;
    const offsetX = (this.pageWidth - drawWidth) / 2;
    const offsetY = (this.pageHeight - drawHeight) / 2;
    
    this.pages.push({
      imageBytes,
      imgWidth,
      imgHeight,
      drawWidth,
      drawHeight,
      offsetX,
      offsetY
    });
  }

  // ─── Build PDF file ────────────────────────────────────────────────
  
  build() {
    const objects = [];
    let objIndex = 1;
    
    // Obj 1: Catalog
    const catalogId = objIndex++;
    objects.push({ id: catalogId, content: null }); // placeholder
    
    // Obj 2: Pages (page tree)
    const pagesId = objIndex++;
    objects.push({ id: pagesId, content: null }); // placeholder
    
    // Page objects
    const pageIds = [];
    const imageIds = [];
    const streamIds = [];
    
    for (const page of this.pages) {
      // Image XObject
      const imageId = objIndex++;
      imageIds.push(imageId);
      
      // Image stream
      const streamId = objIndex++;
      streamIds.push(streamId);
      
      // Page object
      const pageId = objIndex++;
      pageIds.push(pageId);
    }
    
    // Now build actual content
    let pdf = '%PDF-1.4\n';
    const offsets = [];
    
    // Write Catalog
    offsets[catalogId] = pdf.length;
    pdf += `${catalogId} 0 obj\n<< /Type /Catalog /Pages ${pagesId} 0 R >>\nendobj\n`;
    
    // Write Pages tree
    offsets[pagesId] = pdf.length;
    const kidsStr = pageIds.map(id => `${id} 0 R`).join(' ');
    pdf += `${pagesId} 0 obj\n<< /Type /Pages /Kids [${kidsStr}] /Count ${this.pages.length} >>\nendobj\n`;
    
    // Write each page
    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i];
      const pageId = pageIds[i];
      const imageId = imageIds[i];
      const streamId = streamIds[i];
      
      // Image stream object
      offsets[streamId] = pdf.length;
      const imgData = this.encodeBytes(page.imageBytes);
      pdf += `${streamId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.imgWidth} /Height ${page.imgHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgData.length} >>\nstream\n`;
      pdf += imgData;
      pdf += '\nendstream\nendobj\n';
      
      // Image XObject reference
      offsets[imageId] = pdf.length;
      pdf += `${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.imgWidth} /Height ${page.imgHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.imageBytes.length} >>\nstream\n`;
      // Write raw bytes for image
      pdf += this.encodeBytes(page.imageBytes);
      pdf += '\nendstream\nendobj\n';
      
      // Page object
      offsets[pageId] = pdf.length;
      const contentStream = `q ${page.drawWidth.toFixed(2)} 0 0 ${page.drawHeight.toFixed(2)} ${page.offsetX.toFixed(2)} ${page.offsetY.toFixed(2)} cm /Im${i} Do Q`;
      const contentId = objIndex++;
      offsets[contentId] = pdf.length;
      pdf += `${contentId} 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`;
      
      offsets[pageId] = pdf.length;
      pdf += `${pageId} 0 obj\n<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}] /Contents ${contentId} 0 R /Resources << /XObject << /Im${i} ${imageId} 0 R >> >> >>\nendobj\n`;
    }
    
    // Cross-reference table
    const xrefOffset = pdf.length;
    const totalObjects = objIndex;
    pdf += `xref\n0 ${totalObjects}\n`;
    pdf += '0000000000 65535 f \n';
    for (let i = 1; i < totalObjects; i++) {
      pdf += `${String(offsets[i] || 0).padStart(10, '0')} 00000 n \n`;
    }
    
    // Trailer
    pdf += `trailer\n<< /Size ${totalObjects} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    
    return new Blob([pdf], { type: 'application/pdf' });
  }

  // ─── Simple PDF from canvas images (simpler approach) ─────────────
  
  static async createPDFFromImages(imageSources, onProgress) {
    const builder = new PDFBuilder();
    
    for (let i = 0; i < imageSources.length; i++) {
      if (onProgress) onProgress({ current: i + 1, total: imageSources.length, stage: 'processing' });
      
      try {
        await builder.addImage(imageSources[i]);
      } catch (e) {
        console.warn(`[PDFBuilder] Failed to add image ${i}:`, e.message);
      }
    }
    
    if (onProgress) onProgress({ stage: 'building' });
    return builder.build();
  }

  // ─── Helpers ───────────────────────────────────────────────────────
  
  async blobToBytes(blob) {
    const buffer = await blob.arrayBuffer();
    return new Uint8Array(buffer);
  }
  
  async getImageDimensions(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        reject(new Error('Failed to load image'));
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
  }
  
  encodeBytes(bytes) {
    // Convert bytes to string for embedding in PDF
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return binary;
  }
}

// ─── Document Site Page Image Capture ────────────────────────────────

class DocumentCapture {
  constructor() {
    this.pages = [];
    this.observer = null;
    this.isCapturing = false;
  }

  // ─── Detect document hosting site ──────────────────────────────────
  
  static detectSite() {
    const hostname = window.location.hostname.toLowerCase();
    const url = window.location.href.toLowerCase();
    
    if (hostname.includes('scribd.com')) return 'scribd';
    if (hostname.includes('slideshare.net')) return 'slideshare';
    if (hostname.includes('issuu.com')) return 'issuu';
    if (hostname.includes('academia.edu')) return 'academia';
    if (hostname.includes('docplayer') || hostname.includes('doc-droid')) return 'docplayer';
    if (hostname.includes('pdfdrive.com')) return 'pdfdrive';
    if (hostname.includes('docs.google.com') && url.includes('/document/')) return 'gdocs';
    if (hostname.includes('notion.site') || hostname.includes('notion.so')) return 'notion';
    if (hostname.includes('medium.com')) return 'medium';
    
    // Generic: check for document viewer patterns
    if (document.querySelector('.document_viewer, .doc-viewer, #viewer, .pdfViewer, .page-images')) return 'generic';
    
    return null;
  }

  // ─── Capture pages from specific sites ─────────────────────────────
  
  async captureScribd() {
    const pages = [];
    
    // Scribd renders pages as images in the viewer
    // Method 1: Find page images in the document viewer
    const pageImages = document.querySelectorAll('.page-image, .document_page img, .outer_page img, [class*="page"] img');
    for (const img of pageImages) {
      const src = img.src || img.dataset.src || '';
      if (src && (src.includes('scribd') || src.includes('documentcloud')) && !pages.includes(src)) {
        pages.push(src);
      }
    }
    
    // Method 2: Find lazy-loaded page images
    const lazyImages = document.querySelectorAll('[data-page], [data-src*="page"]');
    for (const el of lazyImages) {
      const src = el.dataset.src || el.dataset.page || el.src || '';
      if (src && !pages.includes(src)) {
        pages.push(src);
      }
    }
    
    // Method 3: Intercept API responses for page images
    // Scribd loads pages via AJAX — already intercepted by fetch/XHR hooks
    
    // Method 4: Canvas-based rendering
    const canvases = document.querySelectorAll('canvas');
    for (const canvas of canvases) {
      if (canvas.width > 200 && canvas.height > 200) {
        try {
          const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92));
          if (blob && blob.size > 10000) {
            pages.push(blob);
          }
        } catch (e) {}
      }
    }
    
    return pages;
  }

  async captureSlideshare() {
    const pages = [];
    const images = document.querySelectorAll('.slide-image img, [class*="slide"] img, .vertical-slide img');
    for (const img of images) {
      const src = img.src || img.dataset.src || '';
      if (src && !pages.includes(src)) pages.push(src);
    }
    return pages;
  }

  async captureIssuu() {
    const pages = [];
    const images = document.querySelectorAll('[class*="page"] img, canvas');
    for (const el of images) {
      if (el.tagName === 'IMG') {
        const src = el.src || el.dataset.src || '';
        if (src && !pages.includes(src)) pages.push(src);
      } else if (el.tagName === 'CANVAS' && el.width > 200) {
        try {
          const blob = await new Promise(r => el.toBlob(r, 'image/jpeg', 0.92));
          if (blob && blob.size > 10000) pages.push(blob);
        } catch (e) {}
      }
    }
    return pages;
  }

  async captureGeneric() {
    const pages = [];
    
    // Look for common document viewer patterns
    const selectors = [
      '.page img', '.page-image', '[data-page] img',
      '.pdfViewer canvas', '.textLayer', '#viewer canvas',
      '.document-page img', '.slide img',
      'canvas[width]', 'img[class*="page"]'
    ];
    
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        if (el.tagName === 'IMG') {
          const src = el.src || el.dataset.src || '';
          if (src && src.startsWith('http') && !pages.includes(src)) {
            pages.push(src);
          }
        } else if (el.tagName === 'CANVAS' && el.width > 100 && el.height > 100) {
          try {
            const blob = await new Promise(r => el.toBlob(r, 'image/jpeg', 0.92));
            if (blob && blob.size > 5000) pages.push(blob);
          } catch (e) {}
        }
      }
      if (pages.length > 0) break;
    }
    
    return pages;
  }

  // ─── Main capture method ───────────────────────────────────────────
  
  async capture() {
    const site = DocumentCapture.detectSite();
    let pages = [];
    
    switch (site) {
      case 'scribd':
        pages = await this.captureScribd();
        break;
      case 'slideshare':
        pages = await this.captureSlideshare();
        break;
      case 'issuu':
        pages = await this.captureIssuu();
        break;
      default:
        pages = await this.captureGeneric();
        break;
    }
    
    // Filter out duplicates and small images
    const seen = new Set();
    const filtered = [];
    for (const page of pages) {
      const key = typeof page === 'string' ? page : `blob_${filtered.length}`;
      if (!seen.has(key)) {
        seen.add(key);
        filtered.push(page);
      }
    }
    
    return { site, pages: filtered };
  }

  // ─── Auto-scroll to load all pages ─────────────────────────────────
  
  async autoScrollLoadAll(onProgress) {
    const totalHeight = document.documentElement.scrollHeight;
    const viewportHeight = window.innerHeight;
    let currentScroll = 0;
    let lastPageCount = 0;
    let stuckCount = 0;
    
    while (currentScroll < totalHeight && stuckCount < 5) {
      window.scrollTo(0, currentScroll);
      await new Promise(r => setTimeout(r, 800));
      
      const result = await this.capture();
      const newCount = result.pages.length;
      
      if (onProgress) {
        onProgress({
          stage: 'scrolling',
          scroll: Math.round((currentScroll / totalHeight) * 100),
          pagesFound: newCount
        });
      }
      
      if (newCount === lastPageCount) {
        stuckCount++;
      } else {
        stuckCount = 0;
        lastPageCount = newCount;
      }
      
      currentScroll += viewportHeight * 0.8;
    }
    
    // Scroll back to top
    window.scrollTo(0, 0);
    
    return this.capture();
  }
}

// Export
window.__mediaGrabber_pdfBuilder = PDFBuilder;
window.__mediaGrabber_docCapture = DocumentCapture;
