# Media Grabber

Chrome extension for batch downloading media (images, videos) from any website.

## Features

- 🔍 **Auto-detect media** — Scans all images and videos on any webpage
- 📁 **Custom folder** — Organize downloads in custom-named folders
- 📊 **Batch download** — Download all detected media with one click
- ⚡ **No save-as popup** — Direct download to Chrome's default folder
- 🎯 **Smart filtering** — Filter by file type (images, videos, all)
- 📱 **Modern UI** — Clean, dark-themed interface

## Installation

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select the extension folder
5. The Media Grabber icon will appear in your toolbar

## Usage

1. Navigate to any website with media content
2. Click the Media Grabber icon in your toolbar
3. The extension will scan and list all detected media
4. Select which items to download (or use "Select All")
5. Enter a custom folder name (optional)
6. Click "Download Selected"

## How It Works

- **Content Script** (`content.js`) — Scans the DOM for `<img>`, `<video>`, `<source>`, and CSS background images
- **Background Script** (`background.js`) — Handles download requests and folder management
- **Popup** (`popup.js`, `popup.html`) — User interface for controlling the extension

## Permissions

- `activeTab` — Access current tab to scan for media
- `downloads` — Download detected media files
- `storage` — Save user preferences

## Development

```bash
# Clone the repo
git clone https://github.com/ahmadasrizalmi/media-grabber.git

# Make changes to the source files

# Reload the extension in Chrome
# Go to chrome://extensions/ and click the refresh icon
```

## License

MIT
