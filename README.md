# Rich Text Editor

A production-ready, feature-rich text editor built from scratch with **pure Vanilla JavaScript**. No libraries. No frameworks. No dependencies.

---

## Overview

This project demonstrates a deep understanding of browser APIs, modular JavaScript architecture, security best practices, and UI/UX design — all without reaching for a single external package.

| Stat | Value |
|------|-------|
| Language | Vanilla JS (ES6+) |
| Dependencies | **0** |
| Modules | 16+ |
| Features | 50+ |
| Lines of JS | ~4,600 |
| Dark Mode | Yes |
| Responsive | Yes |

---

## Features

### Text Formatting
- **Bold**, *Italic*, <u>Underline</u>, ~~Strikethrough~~
- Superscript & Subscript
- Text case conversion: UPPERCASE / lowercase / Title Case / Sentence case
- Clear all formatting

### Block & Layout
- Block formats: Paragraph, Headings (H1–H6), Blockquote, Preformatted
- Text alignment: Left, Center, Right, Justify
- Ordered & Unordered lists with Indent / Outdent
- Line height control (1.0 – 3.0)

### Font Controls
- Font family picker (Arial, Georgia, Times New Roman, Verdana, Courier New, and more)
- Font size picker (10px – 64px)

### Color
- Text color & background highlight color
- Pre-built color swatches
- Recent colors history
- Custom hex input + native color picker

### Insert
- Hyperlinks (insert & remove)
- Images (toolbar insert + drag & drop)
- Tables (with row/column/merge operations)
- Horizontal rule
- Code blocks
- Inline HTML
- Emoji picker (custom-built)
- Special characters
- Date & time stamp
- Auto-generated Table of Contents

### Editing Tools
- Undo / Redo (custom history stack)
- Cut, Copy, Paste (clipboard API)
- Find & Replace (`Ctrl+H`)
- Select All (`Ctrl+A`)
- Source (HTML) code view

### View Modes
- **Dark Mode** toggle
- **Fullscreen** mode
- **Focus Mode** (distraction-free writing)
- **Reading Mode**
- Keyboard shortcuts reference (`Ctrl+/`)

### Export
| Format | Action |
|--------|--------|
| HTML | Copy to clipboard |
| Plain Text | Copy to clipboard |
| `.html` | Download file |
| `.txt` | Download file |
| `.md` | Download Markdown |
| PDF | Print / Save as PDF |

### Status Bar
- Live word count & character count
- Estimated reading time
- Word count goal with progress bar
- Auto-save indicator (localStorage)

---

## Architecture

The editor is built as a collection of single-responsibility ES6 classes wired together by a central orchestrator.

```
RichTextEditor          ← Main orchestrator
├── EventBus            ← Pub/sub event system (decouples all modules)
├── Sanitizer           ← XSS prevention & HTML sanitization
├── HistoryManager      ← Custom undo/redo stack
├── StorageManager      ← Auto-save & draft restore (localStorage)
├── SelectionMgr        ← Selection & Range API utilities
├── CommandRegistry     ← Command pattern for all editor actions
├── ToolbarManager      ← Toolbar UI, dropdowns & state sync
├── ModalManager        ← Link / Image / Table modals
├── TableManager        ← Table insert, row/col add-remove, cell merge
├── EmojiPicker         ← Custom emoji picker UI
├── ContextMenu         ← Right-click context menu
├── ExportManager       ← HTML / text / Markdown / PDF export
├── DragDropHandler     ← Image drag & drop into the editor
├── PasteHandler        ← Paste with smart formatting strip
├── ImageResizer        ← In-editor image resize handles
└── PluginManager       ← Extensible plugin API
```

---

## Security

Security was treated as a first-class concern, not an afterthought.

- **XSS Prevention** — All pasted and inserted HTML passes through a custom `Sanitizer` that uses an allowlist of tags and attributes. Dangerous schemes (`javascript:`, `vbscript:`, `data:`) are stripped from `href` and `src` attributes.
- **Event handler stripping** — All `on*` event attributes are removed from sanitized HTML.
- **CSS injection** — Inline styles containing `expression()`, `javascript:`, `behavior`, and similar dangerous values are removed.
- **Safe links** — `target="_blank"` anchors automatically receive `rel="noopener noreferrer"`.

---

## Getting Started

No build step. No package manager. Just open the file.

```bash
git clone https://github.com/your-username/rich-text-editor.git
cd rich-text-editor
# Open index.html in any modern browser
```

Or serve locally:

```bash
npx serve .
# Visit http://localhost:3000
```


## Project Structure

```
├── index.html    # Editor markup & toolbar
├── editor.js     # All JS modules (~4,600 lines)
└── style.css     # Complete stylesheet with CSS custom properties & dark mode
```

---

## Tech Highlights

- **Zero dependencies** — No jQuery, no React, no Quill, no TipTap
- **contenteditable API** — Full control over the editing surface
- **Selection & Range API** — Precise cursor and selection management
- **CSS custom properties** — Full theme system enabling instant dark mode
- **Plugin API** — Extend the editor with custom commands and UI components
- **ES6+ classes** — Clean, maintainable, modular code structure

*Built by [Prakash Bodhane](https://github.com/PrakashBodhane) — CustomChart.js 
