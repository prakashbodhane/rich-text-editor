/*
 * ============================================
 * RICH TEXT EDITOR - Complete JavaScript Module
 *  Author      : Prakash Bodhane
 * ============================================
 * Vanilla JS (ES6+), no dependencies.
 * Modular architecture with clean separation of concerns.
 * 
 * Modules:
 *   - EventBus:        Pub/sub event system
 *   - Sanitizer:       XSS prevention & HTML sanitization
 *   - HistoryManager:  Custom undo/redo stack
 *   - StorageManager:  Auto-save / restore draft (localStorage)
 *   - SelectionMgr:    Selection & Range API utilities
 *   - CommandRegistry: Command pattern for all editor actions
 *   - ToolbarManager:  Toolbar UI, dropdowns, state updates
 *   - ModalManager:    Link / Image / Table modals
 *   - TableManager:    Table operations (insert, row, col, merge)
 *   - EmojiPicker:     Custom built emoji picker
 *   - ContextMenu:     Custom right-click menu
 *   - ExportManager:   Export HTML / text / file download
 *   - DragDropHandler: Image drag & drop
 *   - PasteHandler:    Paste with formatting stripping
 *   - ImageResizer:    In-editor image resize handles
 *   - PluginManager:   Extensible plugin architecture
 *   - RichTextEditor:  Main editor class (orchestrator)
 * ============================================
 */

'use strict';

/* ============================================
   EventBus — Publish / Subscribe event system
   ============================================ */
class EventBus {
    constructor() {
        /** @type {Map<string, Set<Function>>} */
        this._listeners = new Map();
    }

    /**
     * Subscribe to an event.
     * @param {string} event
     * @param {Function} callback
     * @returns {Function} unsubscribe function
     */
    on(event, callback) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
        }
        this._listeners.get(event).add(callback);
        return () => this.off(event, callback);
    }

    /**
     * Unsubscribe from an event.
     */
    off(event, callback) {
        const set = this._listeners.get(event);
        if (set) set.delete(callback);
    }

    /**
     * Emit an event with optional data.
     */
    emit(event, data) {
        const set = this._listeners.get(event);
        if (set) {
            set.forEach(cb => {
                try { cb(data); } catch (e) { console.error(`EventBus error [${event}]:`, e); }
            });
        }
    }
}


/* ============================================
   Sanitizer — XSS prevention & HTML cleaning
   ============================================ */
class Sanitizer {
    constructor() {
        /* Allowed tags (lowercase) */
        this.allowedTags = new Set([
            'p', 'br', 'hr', 'div', 'span',
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'strong', 'b', 'em', 'i', 'u', 'del', 's', 'strike',
            'sub', 'sup', 'small', 'mark',
            'blockquote', 'pre', 'code',
            'ul', 'ol', 'li',
            'a', 'img',
            'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
            'figure', 'figcaption',
        ]);

        /* Allowed attributes per tag (+ global) */
        this.allowedAttrs = {
            '*': ['class', 'style', 'id', 'title', 'dir', 'lang', 'data-*'],
            'a': ['href', 'target', 'rel'],
            'img': ['src', 'alt', 'width', 'height', 'loading'],
            'td': ['colspan', 'rowspan'],
            'th': ['colspan', 'rowspan', 'scope'],
            'ol': ['start', 'type'],
            'col': ['span'],
            'colgroup': ['span'],
        };

        /* Dangerous CSS properties */
        this.dangerousCssProps = /expression|javascript|vbscript|behavior|moz-binding|-o-link/i;

        /* Dangerous URL schemes */
        this.dangerousSchemes = /^\s*(javascript|vbscript|data\s*:(?!image\/(png|jpe?g|gif|webp|svg\+xml)))/i;
    }

    /**
     * Sanitize HTML string — strips dangerous elements and attributes.
     * @param {string} html
     * @returns {string} safe HTML
     */
    sanitize(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        this._walk(doc.body);
        return doc.body.innerHTML;
    }

    /** Recursively walk DOM and clean nodes */
    _walk(node) {
        const children = Array.from(node.childNodes);
        for (const child of children) {
            if (child.nodeType === Node.ELEMENT_NODE) {
                const tag = child.tagName.toLowerCase();

                /* Remove script, style, iframe, object, embed, form, input, textarea, select, link, meta */
                if (!this.allowedTags.has(tag)) {
                    /* Keep child text content */
                    while (child.firstChild) {
                        node.insertBefore(child.firstChild, child);
                    }
                    node.removeChild(child);
                    continue;
                }

                /* Clean attributes */
                this._cleanAttributes(child, tag);

                /* Recurse */
                this._walk(child);
            } else if (child.nodeType === Node.COMMENT_NODE) {
                node.removeChild(child);
            }
        }
    }

    /** Remove disallowed attributes and sanitize URLs / styles */
    _cleanAttributes(el, tag) {
        const allowed = new Set([
            ...(this.allowedAttrs['*'] || []),
            ...(this.allowedAttrs[tag] || []),
        ]);

        const attrs = Array.from(el.attributes);
        for (const attr of attrs) {
            const name = attr.name.toLowerCase();

            /* Allow data-* attributes */
            if (name.startsWith('data-') && allowed.has('data-*')) continue;

            if (!allowed.has(name)) {
                el.removeAttribute(attr.name);
                continue;
            }

            /* Check href / src for dangerous schemes */
            if ((name === 'href' || name === 'src') && this.dangerousSchemes.test(attr.value)) {
                el.removeAttribute(attr.name);
                continue;
            }

            /* Check style for dangerous properties */
            if (name === 'style' && this.dangerousCssProps.test(attr.value)) {
                el.removeAttribute(attr.name);
            }
        }

        /* Ensure target=_blank links have rel=noopener */
        if (tag === 'a' && el.getAttribute('target') === '_blank') {
            el.setAttribute('rel', 'noopener noreferrer');
        }

        /* Remove event handlers (on*) */
        const allAttrs = Array.from(el.attributes);
        for (const attr of allAttrs) {
            if (/^on/i.test(attr.name)) {
                el.removeAttribute(attr.name);
            }
        }
    }
}


/* ============================================
   HistoryManager — Custom undo / redo stack
   ============================================ */
class HistoryManager {
    /**
     * @param {Object} options
     * @param {number} [options.maxSize=100]
     * @param {EventBus} options.events
     */
    constructor({ maxSize = 100, events }) {
        this._undoStack = [];
        this._redoStack = [];
        this._maxSize = maxSize;
        this._events = events;
        this._locked = false;
    }

    /** Save a snapshot (typically editor innerHTML). */
    save(snapshot) {
        if (this._locked) return;
        /* Avoid duplicate consecutive snapshots */
        if (this._undoStack.length && this._undoStack[this._undoStack.length - 1] === snapshot) return;
        this._undoStack.push(snapshot);
        if (this._undoStack.length > this._maxSize) this._undoStack.shift();
        this._redoStack = [];
        this._events.emit('history:change', { canUndo: this.canUndo(), canRedo: this.canRedo() });
    }

    /** Undo — returns previous snapshot or null. */
    undo(currentSnapshot) {
        if (this._undoStack.length === 0) return null;

        /* Ensure current snapshot is represented as the top stack item */
        if (this._undoStack[this._undoStack.length - 1] !== currentSnapshot) {
            this._undoStack.push(currentSnapshot);
        }

        if (this._undoStack.length < 2) return null;

        const current = this._undoStack.pop();
        this._redoStack.push(current);
        const snapshot = this._undoStack[this._undoStack.length - 1];
        this._events.emit('history:change', { canUndo: this.canUndo(), canRedo: this.canRedo() });
        return snapshot;
    }

    /** Redo — returns next snapshot or null. */
    redo(currentSnapshot) {
        if (!this.canRedo()) return null;
        const snapshot = this._redoStack.pop();
        this._undoStack.push(snapshot);
        this._events.emit('history:change', { canUndo: this.canUndo(), canRedo: this.canRedo() });
        return snapshot;
    }

    canUndo() { return this._undoStack.length > 1; }
    canRedo() { return this._redoStack.length > 0; }

    /** Lock to prevent saving during undo/redo apply. */
    lock() { this._locked = true; }
    unlock() { this._locked = false; }

    clear() {
        this._undoStack = [];
        this._redoStack = [];
        this._events.emit('history:change', { canUndo: false, canRedo: false });
    }
}


/* ============================================
   StorageManager — Auto-save & restore drafts
   ============================================ */
class StorageManager {
    /**
     * @param {Object} options
     * @param {string} [options.key='rte-draft']
     * @param {number} [options.interval=3000] auto-save interval ms
     * @param {EventBus} options.events
     */
    constructor({ key = 'rte-draft', interval = 3000, events }) {
        this._key = key;
        this._interval = interval;
        this._events = events;
        this._timer = null;
        this._lastSaved = '';
    }

    /** Start auto-save timer; calls getContent() periodically */
    startAutoSave(getContent) {
        this.stopAutoSave();
        this._timer = setInterval(() => {
            const content = getContent();
            if (content !== this._lastSaved) {
                this._save(content);
            }
        }, this._interval);
    }

    stopAutoSave() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    /** Immediately save content */
    saveNow(content) {
        this._save(content);
    }

    _save(content) {
        try {
            localStorage.setItem(this._key, content);
            this._lastSaved = content;
            this._events.emit('storage:saved');
        } catch (e) {
            console.warn('StorageManager: save failed', e);
        }
    }

    /** Restore draft from localStorage */
    restore() {
        try {
            return localStorage.getItem(this._key) || '';
        } catch (e) {
            return '';
        }
    }

    /** Check if a draft exists */
    hasDraft() {
        try {
            return !!localStorage.getItem(this._key);
        } catch (e) {
            return false;
        }
    }

    clearDraft() {
        try {
            localStorage.removeItem(this._key);
        } catch (e) { /* ignore */ }
    }
}


/* ============================================
   SelectionMgr — Selection & Range utilities
   ============================================ */
class SelectionMgr {
    /**
     * @param {HTMLElement} editorEl - the contenteditable element
     */
    constructor(editorEl) {
        this._editor = editorEl;
        this._savedRange = null;
    }

    /** Get current Selection object */
    getSelection() {
        return window.getSelection();
    }

    /** Get first Range of current selection, or null */
    getRange() {
        const sel = this.getSelection();
        if (sel && sel.rangeCount > 0) return sel.getRangeAt(0);
        return null;
    }

    /** Save current selection (range) for later restoration */
    save() {
        const range = this.getRange();
        if (range) this._savedRange = range.cloneRange();
        return this._savedRange;
    }

    /** Restore a previously saved selection */
    restore() {
        if (!this._savedRange) return false;
        const sel = this.getSelection();
        sel.removeAllRanges();
        sel.addRange(this._savedRange);
        return true;
    }

    /** Check if selection is within the editor */
    isInsideEditor() {
        const sel = this.getSelection();
        if (!sel || sel.rangeCount === 0) return false;
        return this._editor.contains(sel.anchorNode);
    }

    /** Collapse selection to end */
    collapseToEnd() {
        const sel = this.getSelection();
        if (sel) sel.collapseToEnd();
    }

    /** Place cursor at the end of the editor */
    setCursorToEnd() {
        const range = document.createRange();
        range.selectNodeContents(this._editor);
        range.collapse(false);
        const sel = this.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }

    /** Insert a node at the current cursor position */
    insertNode(node) {
        const range = this.getRange();
        if (!range) {
            this._editor.appendChild(node);
            return;
        }
        range.deleteContents();
        range.insertNode(node);
        /* Move cursor after inserted node */
        range.setStartAfter(node);
        range.setEndAfter(node);
        const sel = this.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }

    /** Insert HTML string at cursor position */
    insertHTML(html) {
        const temp = document.createElement('div');
        temp.innerHTML = html;
        const frag = document.createDocumentFragment();
        let lastNode = null;
        while (temp.firstChild) {
            lastNode = frag.appendChild(temp.firstChild);
        }
        const range = this.getRange();
        if (!range) {
            this._editor.appendChild(frag);
            return;
        }
        range.deleteContents();
        range.insertNode(frag);
        if (lastNode) {
            range.setStartAfter(lastNode);
            range.setEndAfter(lastNode);
            const sel = this.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }
    }

    /**
     * Wrap the selected text in the given tag.
     * If selection is collapsed, creates an empty element and places cursor inside.
     * @param {string} tagName e.g. 'strong', 'em'
     * @param {Object} [attrs] optional attributes
     * @returns {HTMLElement|null} the created wrapper element
     */
    wrapSelection(tagName, attrs = {}) {
        const range = this.getRange();
        if (!range || !this.isInsideEditor()) return null;

        const wrapper = document.createElement(tagName);
        for (const [k, v] of Object.entries(attrs)) {
            wrapper.setAttribute(k, v);
        }

        if (range.collapsed) {
            /* Insert empty wrapper with zero-width space for cursor placement */
            wrapper.textContent = '\u200B';
            range.insertNode(wrapper);
            /* Place cursor inside */
            const innerRange = document.createRange();
            innerRange.setStart(wrapper.firstChild, 1);
            innerRange.collapse(true);
            const sel = this.getSelection();
            sel.removeAllRanges();
            sel.addRange(innerRange);
        } else {
            try {
                range.surroundContents(wrapper);
            } catch (e) {
                /* surroundContents fails on partial selections; fallback */
                const contents = range.extractContents();
                wrapper.appendChild(contents);
                range.insertNode(wrapper);
            }
            /* Select the wrapper content */
            const sel = this.getSelection();
            sel.removeAllRanges();
            const newRange = document.createRange();
            newRange.selectNodeContents(wrapper);
            sel.addRange(newRange);
        }
        return wrapper;
    }

    /**
     * Check if the current selection is wrapped in a specific tag.
     * Returns the closest ancestor matching the tag, or null.
     * @param {string} tagName
     * @returns {HTMLElement|null}
     */
    findAncestorTag(tagName) {
        const sel = this.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        let node = sel.anchorNode;
        if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
        const upper = tagName.toUpperCase();
        while (node && node !== this._editor) {
            if (node.nodeType === Node.ELEMENT_NODE && node.tagName === upper) return node;
            node = node.parentNode;
        }
        return null;
    }

    /**
     * Unwrap an element — replace it with its children.
     * @param {HTMLElement} el
     */
    unwrap(el) {
        const parent = el.parentNode;
        while (el.firstChild) {
            parent.insertBefore(el.firstChild, el);
        }
        parent.removeChild(el);
    }

    /**
     * Get the closest block-level ancestor of the current selection.
     */
    getClosestBlock() {
        const blockTags = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV', 'BLOCKQUOTE', 'PRE', 'LI', 'TD', 'TH']);
        let node = this.getSelection()?.anchorNode;
        if (!node) return null;
        if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
        while (node && node !== this._editor) {
            if (node.nodeType === Node.ELEMENT_NODE && blockTags.has(node.tagName)) return node;
            node = node.parentNode;
        }
        return null;
    }

    /** Get the selected text as a string */
    getSelectedText() {
        const sel = this.getSelection();
        return sel ? sel.toString() : '';
    }
}


/* ============================================
   CommandRegistry — Command pattern for all actions
   ============================================ */
class CommandRegistry {
    constructor() {
        /** @type {Map<string, Function>} */
        this._commands = new Map();
    }

    /**
     * Register a command.
     * @param {string} name
     * @param {Function} handler — receives (editor, value?)
     */
    register(name, handler) {
        this._commands.set(name, handler);
    }

    /**
     * Execute a command by name.
     * @param {string} name
     * @param {*} editor — the RichTextEditor instance
     * @param {*} [value]
     */
    execute(name, editor, value) {
        const handler = this._commands.get(name);
        if (!handler) {
            console.warn(`Command not found: ${name}`);
            return false;
        }
        try {
            handler(editor, value);
            return true;
        } catch (e) {
            console.error(`Command error [${name}]:`, e);
            return false;
        }
    }

    has(name) {
        return this._commands.has(name);
    }
}


/* ============================================
   ToolbarManager — Toolbar UI & state updates
   ============================================ */
class ToolbarManager {
    /**
     * @param {Object} opts
     * @param {HTMLElement} opts.toolbarEl
     * @param {RichTextEditor} opts.editor
     */
    constructor({ toolbarEl, editor }) {
        this._toolbar = toolbarEl;
        this._editor = editor;
        this._openDropdown = null;

        this._bindEvents();
    }

    _bindEvents() {
        /* Event delegation for toolbar buttons */
        this._toolbar.addEventListener('mousedown', (e) => {
            /* Prevent losing editor focus/selection on button click */
            const btn = e.target.closest('.rte-btn:not(.rte-dropdown-toggle)');
            if (btn) e.preventDefault();
        });

        this._toolbar.addEventListener('click', (e) => {
            /* Dropdown toggle */
            const toggle = e.target.closest('.rte-dropdown-toggle');
            if (toggle) {
                e.preventDefault();
                const dropdown = toggle.closest('.rte-dropdown');
                this._toggleDropdown(dropdown);
                return;
            }

            /* Dropdown item */
            const item = e.target.closest('.rte-dropdown-item');
            if (item) {
                e.preventDefault();
                const cmd = item.dataset.command;
                const val = item.dataset.value;
                this._closeAllDropdowns();
                this._editor.execCommand(cmd, val);
                return;
            }

            /* Regular button */
            const btn = e.target.closest('.rte-btn[data-command]');
            if (btn) {
                e.preventDefault();
                const cmd = btn.dataset.command;
                this._editor.execCommand(cmd);
            }
        });

        /* Close dropdowns on click outside */
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.rte-dropdown')) {
                this._closeAllDropdowns();
            }
        });

        /* Color picker change — now handled by ColorPickerPanel */
    }

    _toggleDropdown(dropdown) {
        if (!dropdown) return;
        const isOpen = dropdown.classList.contains('open');
        this._closeAllDropdowns();
        if (!isOpen) {
            dropdown.classList.add('open');
            const toggle = dropdown.querySelector('.rte-dropdown-toggle');
            if (toggle) toggle.setAttribute('aria-expanded', 'true');
            this._openDropdown = dropdown;
        }
    }

    _closeAllDropdowns() {
        this._toolbar.querySelectorAll('.rte-dropdown.open').forEach(d => {
            d.classList.remove('open');
            const toggle = d.querySelector('.rte-dropdown-toggle');
            if (toggle) toggle.setAttribute('aria-expanded', 'false');
        });
        this._openDropdown = null;
    }

    /**
     * Update active states of toolbar buttons based on current selection.
     */
    updateState() {
        const sel = this._editor.selection;

        /* Inline formatting toggles */
        const inlineMap = {
            bold: ['STRONG', 'B'],
            italic: ['EM', 'I'],
            underline: ['U'],
            strikethrough: ['DEL', 'S', 'STRIKE'],
            superscript: ['SUP'],
            subscript: ['SUB'],
        };

        for (const [cmd, tags] of Object.entries(inlineMap)) {
            const btn = this._toolbar.querySelector(`[data-command="${cmd}"]`);
            if (!btn) continue;
            const isActive = tags.some(tag => sel.findAncestorTag(tag));
            btn.classList.toggle('active', !!isActive);
        }

        /* Block format */
        const block = sel.getClosestBlock();
        const formatLabel = this._toolbar.querySelector('#dropdown-format .rte-dropdown-label');
        if (formatLabel && block) {
            const tagMap = { P: 'Paragraph', H1: 'Heading 1', H2: 'Heading 2', H3: 'Heading 3', H4: 'Heading 4', H5: 'Heading 5', H6: 'Heading 6', BLOCKQUOTE: 'Blockquote', PRE: 'Preformatted' };
            formatLabel.textContent = tagMap[block.tagName] || 'Paragraph';
        }

        /* Alignment */
        if (block) {
            const align = block.style?.textAlign || 'left';
            ['Left', 'Center', 'Right', 'Justify'].forEach(a => {
                const btn = this._toolbar.querySelector(`[data-command="align${a}"]`);
                if (btn) btn.classList.toggle('active', align === a.toLowerCase());
            });
        }

        /* Link */
        const linkBtn = this._toolbar.querySelector('[data-command="removeLink"]');
        if (linkBtn) {
            const inLink = sel.findAncestorTag('a');
            linkBtn.classList.toggle('active', !!inLink);
        }

        /* Undo/Redo */
        const undoBtn = this._toolbar.querySelector('[data-command="undo"]');
        const redoBtn = this._toolbar.querySelector('[data-command="redo"]');
        if (undoBtn) undoBtn.disabled = !this._editor.history.canUndo();
        if (redoBtn) redoBtn.disabled = !this._editor.history.canRedo();
    }

    /**
     * Get all available toolbar group names.
     * @returns {string[]} Array of group names
     */
    getGroupNames() {
        const groups = this._toolbar.querySelectorAll('[data-group]');
        return Array.from(groups).map(g => g.dataset.group);
    }

    /**
     * Show a specific toolbar group by name.
     * @param {string} groupName - The group name (e.g., 'history', 'formatting', 'colors')
     */
    showGroup(groupName) {
        const group = this._toolbar.querySelector(`[data-group="${groupName}"]`);
        const divider = this._toolbar.querySelector(`[data-for-group="${groupName}"]`);
        if (group) group.style.display = '';
        if (divider) divider.style.display = '';
    }

    /**
     * Hide a specific toolbar group by name.
     * @param {string} groupName - The group name (e.g., 'history', 'formatting', 'colors')
     */
    hideGroup(groupName) {
        const group = this._toolbar.querySelector(`[data-group="${groupName}"]`);
        const divider = this._toolbar.querySelector(`[data-for-group="${groupName}"]`);
        if (group) group.style.display = 'none';
        if (divider) divider.style.display = 'none';
    }

    /**
     * Toggle a specific toolbar group visibility.
     * @param {string} groupName - The group name
     * @returns {boolean} New visibility state
     */
    toggleGroup(groupName) {
        const group = this._toolbar.querySelector(`[data-group="${groupName}"]`);
        if (!group) return false;
        const isHidden = group.style.display === 'none';
        if (isHidden) this.showGroup(groupName);
        else this.hideGroup(groupName);
        return isHidden;
    }

    /**
     * Check if a toolbar group is visible.
     * @param {string} groupName - The group name
     * @returns {boolean}
     */
    isGroupVisible(groupName) {
        const group = this._toolbar.querySelector(`[data-group="${groupName}"]`);
        return group ? group.style.display !== 'none' : false;
    }

    /**
     * Set visibility for multiple groups at once.
     * @param {Object} config - Object mapping group names to visibility (true/false)
     * @example editor.toolbar.setGroups({ history: true, clipboard: false, formatting: true })
     */
    setGroups(config) {
        for (const [name, visible] of Object.entries(config)) {
            if (visible) this.showGroup(name);
            else this.hideGroup(name);
        }
    }

    /**
     * Show only the specified groups, hide all others.
     * @param {string[]} groupNames - Array of group names to show
     */
    showOnlyGroups(groupNames) {
        const allGroups = this.getGroupNames();
        for (const name of allGroups) {
            if (groupNames.includes(name)) this.showGroup(name);
            else this.hideGroup(name);
        }
    }
}


/* ============================================
   ColorPickerPanel — Advanced color picker dropdown
   ============================================ */
class ColorPickerPanel {
    constructor(editor) {
        this._editor = editor;
        this._recentFore = [];
        this._recentBack = [];
        this._maxRecent = 10;
        this._currentFore = '#000000';
        this._currentBack = '#ffff00';

        this._presetColors = [
            '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
            '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
            '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc',
            '#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd',
            '#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0',
            '#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79',
            '#85200c', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#1155cc', '#0b5394', '#351c75', '#741b47',
            '#5b0f00', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#1c4587', '#073763', '#20124d', '#4c1130',
        ];

        this._init();
    }

    _init() {
        this._setupPanel('fore');
        this._setupPanel('back');
    }

    _setupPanel(type) {
        const prefix = type === 'fore' ? 'forecolor' : 'backcolor';
        const btn = document.getElementById(`${prefix}-btn`);
        const panel = document.getElementById(`${prefix}-panel`);
        const swatchesEl = document.getElementById(`${prefix}-swatches`);
        const hexInput = document.getElementById(`${prefix}-hex`);
        const nativeInput = document.getElementById(`${prefix}-native`);
        const applyBtn = document.getElementById(`${prefix}-apply`);
        const previewEl = document.getElementById(`${prefix}-preview`);

        if (!btn || !panel || !swatchesEl) return;

        /* Build preset swatches */
        this._presetColors.forEach(color => {
            const swatch = document.createElement('div');
            swatch.className = 'rte-color-swatch';
            swatch.style.background = color;
            swatch.title = color;
            swatch.dataset.color = color;
            swatchesEl.appendChild(swatch);
        });

        /* No color option for background */
        if (type === 'back') {
            const noneBtn = document.createElement('div');
            noneBtn.className = 'rte-color-swatch no-color';
            noneBtn.title = 'White';
            noneBtn.dataset.color = '#ffffff';
            swatchesEl.prepend(noneBtn);
        }

        /* Swatch click */
        swatchesEl.addEventListener('click', (e) => {
            const swatch = e.target.closest('.rte-color-swatch');
            if (!swatch) return;
            const color = swatch.dataset.color;
            this._applyColor(type, color);
            this._hidePanel(panel);
        });

        /* Toggle panel on button click */
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._editor.selection.save();
            if (panel.style.display === 'none') {
                this._hideAllPanels();
                this._renderRecent(type);
                panel.style.display = 'block';
            } else {
                panel.style.display = 'none';
            }
        });

        /* Hex input sync with native picker & preview */
        if (nativeInput && hexInput) {
            nativeInput.addEventListener('input', () => {
                hexInput.value = nativeInput.value;
                if (previewEl) previewEl.style.background = nativeInput.value;
            });
            hexInput.addEventListener('input', () => {
                const val = hexInput.value.trim();
                if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
                    nativeInput.value = val;
                    if (previewEl) previewEl.style.background = val;
                }
            });
        }

        /* Apply button */
        if (applyBtn && hexInput) {
            applyBtn.addEventListener('click', () => {
                const color = hexInput.value.trim();
                if (color) {
                    this._applyColor(type, color);
                    this._hidePanel(panel);
                }
            });

            hexInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    applyBtn.click();
                }
            });
        }

        /* Close panel on outside click */
        document.addEventListener('mousedown', (e) => {
            if (!panel.contains(e.target) && !btn.contains(e.target)) {
                this._hidePanel(panel);
            }
        });
    }

    _applyColor(type, color) {
        if (type === 'back' && (color === 'transparent' || color === 'none')) {
            color = '#ffffff';
        }

        const cmd = type === 'fore' ? 'foreColor' : 'backColor';
        const prefix = type === 'fore' ? 'forecolor' : 'backcolor';

        this._editor.selection.restore();
        this._editor.execCommand(cmd, color);

        /* Update indicator */
        const indicator = document.getElementById(`${prefix}-indicator`);
        if (indicator) {
            indicator.classList.toggle('is-transparent', false);
            indicator.style.background = color;
        }

        /* Update current */
        if (type === 'fore') this._currentFore = color;
        else this._currentBack = color;

        /* Add to recent */
        this._addRecent(type, color);
    }

    _addRecent(type, color) {
        if (color === 'transparent') return;
        const list = type === 'fore' ? this._recentFore : this._recentBack;
        const idx = list.indexOf(color);
        if (idx !== -1) list.splice(idx, 1);
        list.unshift(color);
        if (list.length > this._maxRecent) list.pop();
    }

    _renderRecent(type) {
        const prefix = type === 'fore' ? 'forecolor' : 'backcolor';
        const container = document.getElementById(`${prefix}-recent`);
        if (!container) return;
        const list = type === 'fore' ? this._recentFore : this._recentBack;
        container.innerHTML = '';
        if (list.length === 0) {
            container.innerHTML = '<span style="font-size:11px;color:var(--rte-statusbar-text);">None yet</span>';
            return;
        }
        list.forEach(color => {
            const swatch = document.createElement('div');
            swatch.className = 'rte-color-swatch';
            swatch.style.background = color;
            swatch.title = color;
            swatch.dataset.color = color;
            swatch.addEventListener('click', () => {
                this._applyColor(type, color);
                this._hidePanel(document.getElementById(`${prefix}-panel`));
            });
            container.appendChild(swatch);
        });
    }

    _hidePanel(panel) {
        if (panel) panel.style.display = 'none';
    }

    _hideAllPanels() {
        document.querySelectorAll('.rte-color-panel').forEach(p => p.style.display = 'none');
    }
}


/* ============================================
   FindReplaceManager — Find & Replace functionality
   ============================================ */
class FindReplaceManager {
    constructor(editor) {
        this._editor = editor;
        this._bar = document.getElementById('rte-find-bar');
        this._findInput = document.getElementById('find-input');
        this._replaceInput = document.getElementById('replace-input');
        this._countEl = document.getElementById('find-count');
        this._caseCheck = document.getElementById('find-case');
        this._wholeCheck = document.getElementById('find-whole');
        this._regexCheck = document.getElementById('find-regex');
        this._matches = [];
        this._currentIndex = -1;
        this._visible = false;

        this._bindEvents();
    }

    _bindEvents() {
        const closeBtn = document.getElementById('find-close');
        const prevBtn = document.getElementById('find-prev');
        const nextBtn = document.getElementById('find-next');
        const replaceBtn = document.getElementById('replace-btn');
        const replaceAllBtn = document.getElementById('replace-all-btn');

        if (closeBtn) closeBtn.addEventListener('click', () => this.hide());
        if (prevBtn) prevBtn.addEventListener('click', () => this._navigate(-1));
        if (nextBtn) nextBtn.addEventListener('click', () => this._navigate(1));
        if (replaceBtn) replaceBtn.addEventListener('click', () => this._replaceCurrent());
        if (replaceAllBtn) replaceAllBtn.addEventListener('click', () => this._replaceAll());

        if (this._findInput) {
            this._findInput.addEventListener('input', () => this._doSearch());
            this._findInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this._navigate(e.shiftKey ? -1 : 1);
                }
                if (e.key === 'Escape') this.hide();
            });
        }
        if (this._replaceInput) {
            this._replaceInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') this.hide();
            });
        }

        /* Options change */
        [this._caseCheck, this._wholeCheck, this._regexCheck].forEach(cb => {
            if (cb) cb.addEventListener('change', () => this._doSearch());
        });
    }

    show() {
        if (!this._bar) return;
        this._bar.style.display = 'block';
        this._bar.setAttribute('aria-hidden', 'false');
        this._visible = true;
        const selectedText = this._editor.selection.getSelectedText();
        if (selectedText && this._findInput) {
            this._findInput.value = selectedText;
        }
        setTimeout(() => this._findInput?.focus(), 50);
        this._doSearch();
    }

    hide() {
        if (!this._bar) return;
        this._bar.style.display = 'none';
        this._bar.setAttribute('aria-hidden', 'true');
        this._visible = false;
        this._clearHighlights();
        this._matches = [];
        this._currentIndex = -1;
        this._updateCount();
        this._editor.editorEl.focus();
    }

    toggle() {
        if (this._visible) this.hide();
        else this.show();
    }

    _doSearch() {
        this._clearHighlights();
        this._matches = [];
        this._currentIndex = -1;

        const query = this._findInput?.value;
        if (!query) { this._updateCount(); return; }

        const caseSensitive = this._caseCheck?.checked || false;
        const wholeWord = this._wholeCheck?.checked || false;
        const isRegex = this._regexCheck?.checked || false;

        let pattern;
        try {
            if (isRegex) {
                pattern = new RegExp(query, caseSensitive ? 'g' : 'gi');
            } else {
                const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const wordBoundary = wholeWord ? `\\b${escaped}\\b` : escaped;
                pattern = new RegExp(wordBoundary, caseSensitive ? 'g' : 'gi');
            }
        } catch (e) {
            this._updateCount(); return;
        }

        const editorEl = this._editor.editorEl;
        const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT, null, false);
        const textNodes = [];
        while (walker.nextNode()) textNodes.push(walker.currentNode);

        textNodes.forEach(node => {
            const text = node.textContent;
            let match;
            const parts = [];
            let lastIndex = 0;
            pattern.lastIndex = 0;

            while ((match = pattern.exec(text)) !== null) {
                if (match.index > lastIndex) {
                    parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
                }
                parts.push({ type: 'match', value: match[0] });
                lastIndex = pattern.lastIndex;
                if (!pattern.global) break;
            }

            if (parts.length > 0) {
                if (lastIndex < text.length) {
                    parts.push({ type: 'text', value: text.slice(lastIndex) });
                }
                const frag = document.createDocumentFragment();
                parts.forEach(part => {
                    if (part.type === 'match') {
                        const mark = document.createElement('mark');
                        mark.className = 'rte-find-highlight';
                        mark.textContent = part.value;
                        frag.appendChild(mark);
                        this._matches.push(mark);
                    } else {
                        frag.appendChild(document.createTextNode(part.value));
                    }
                });
                node.parentNode.replaceChild(frag, node);
            }
        });

        this._updateCount();
        if (this._matches.length > 0) {
            this._currentIndex = 0;
            this._highlightCurrent();
        }
    }

    _navigate(direction) {
        if (this._matches.length === 0) return;
        if (this._currentIndex >= 0 && this._currentIndex < this._matches.length) {
            this._matches[this._currentIndex].classList.remove('current');
        }
        this._currentIndex += direction;
        if (this._currentIndex >= this._matches.length) this._currentIndex = 0;
        if (this._currentIndex < 0) this._currentIndex = this._matches.length - 1;
        this._highlightCurrent();
    }

    _highlightCurrent() {
        if (this._currentIndex < 0 || this._currentIndex >= this._matches.length) return;
        const mark = this._matches[this._currentIndex];
        mark.classList.add('current');
        const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        mark.scrollIntoView({ block: 'center', behavior: prefersReducedMotion ? 'auto' : 'smooth' });
        this._updateCount();
    }

    _replaceCurrent() {
        if (this._currentIndex < 0 || this._currentIndex >= this._matches.length) return;
        const mark = this._matches[this._currentIndex];
        const replacement = this._replaceInput?.value || '';
        const textNode = document.createTextNode(replacement);
        mark.parentNode.replaceChild(textNode, mark);
        this._matches.splice(this._currentIndex, 1);
        if (this._currentIndex >= this._matches.length) this._currentIndex = 0;
        this._updateCount();
        if (this._matches.length > 0) this._highlightCurrent();
        this._editor._updateCounters();
        this._editor.saveHistory();
        this._editor.events.emit('change');
    }

    _replaceAll() {
        const replacement = this._replaceInput?.value || '';
        this._matches.forEach(mark => {
            const textNode = document.createTextNode(replacement);
            mark.parentNode.replaceChild(textNode, mark);
        });
        this._matches = [];
        this._currentIndex = -1;
        this._updateCount();
        this._editor._updateCounters();
        this._editor.saveHistory();
        this._editor.events.emit('change');
    }

    _clearHighlights() {
        const editorEl = this._editor.editorEl;
        editorEl.querySelectorAll('mark.rte-find-highlight').forEach(mark => {
            const text = document.createTextNode(mark.textContent);
            mark.parentNode.replaceChild(text, mark);
        });
        editorEl.normalize();
    }

    _updateCount() {
        if (!this._countEl) return;
        const total = this._matches.length;
        if (total === 0) {
            this._countEl.textContent = this._findInput?.value ? 'No results' : '0 results';
        } else {
            this._countEl.textContent = `${this._currentIndex + 1} of ${total}`;
        }
    }
}


/* ============================================
   ModalManager — Link / Image / Table modals
   ============================================ */
class ModalManager {
    constructor(editor) {
        this._editor = editor;
        this._activeModal = null;
        this._lastFocusedEl = null;
        this._bindCloseButtons();
        this._bindFocusTrap();
    }

    _bindCloseButtons() {
        /* Close modal only via close button */
        document.querySelectorAll('[data-modal-close]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.close(btn.dataset.modalClose);
            });
        });
    }

    open(id) {
        const modal = document.getElementById(id);
        if (modal) {
            this._lastFocusedEl = document.activeElement;
            this._activeModal = modal;
            modal.classList.add('active');
            modal.setAttribute('aria-hidden', 'false');
            /* Focus first input */
            setTimeout(() => {
                const input = modal.querySelector('.rte-input');
                if (input) input.focus();
                else {
                    const firstBtn = modal.querySelector('button, [href], [tabindex]:not([tabindex="-1"])');
                    if (firstBtn) firstBtn.focus();
                }
            }, 100);
        }
    }

    close(id) {
        const modal = document.getElementById(id);
        if (modal) {
            modal.classList.remove('active');
            modal.setAttribute('aria-hidden', 'true');
            if (this._activeModal === modal) this._activeModal = null;
            if (this._lastFocusedEl && typeof this._lastFocusedEl.focus === 'function') {
                this._lastFocusedEl.focus();
            } else {
                this._editor.editorEl.focus();
            }
        }
    }

    isOpen(id) {
        const modal = document.getElementById(id);
        return modal && modal.classList.contains('active');
    }

    _bindFocusTrap() {
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab' || !this._activeModal || !this._activeModal.classList.contains('active')) return;

            const focusable = Array.from(this._activeModal.querySelectorAll(
                'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )).filter(el => el.offsetParent !== null);

            if (focusable.length === 0) return;

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;

            if (e.shiftKey && active === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && active === last) {
                e.preventDefault();
                first.focus();
            }
        });
    }
}


/* ============================================
   TableManager — Table operations (enhanced)
   ============================================ */
class TableManager {
    constructor(editor) {
        this._editor = editor;
        this._selectedCells = [];
        this._isSelecting = false;
        this._selectionStart = null;
        this._initGrid();
        this._bindEvents();
    }

    _initGrid() {
        const grid = document.getElementById('table-grid');
        if (!grid) return;
        grid.innerHTML = '';
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 10; c++) {
                const cell = document.createElement('div');
                cell.className = 'rte-table-grid-cell';
                cell.dataset.row = r;
                cell.dataset.col = c;
                grid.appendChild(cell);
            }
        }
    }

    _bindEvents() {
        const grid = document.getElementById('table-grid');
        const label = document.getElementById('table-size-label');
        const rowsInput = document.getElementById('table-rows');
        const colsInput = document.getElementById('table-cols');

        if (grid) {
            let isLocked = false;
            
            grid.addEventListener('mousemove', (e) => {
                if (isLocked) return;
                const cell = e.target.closest('.rte-table-grid-cell');
                if (!cell) return;
                const r = parseInt(cell.dataset.row);
                const c = parseInt(cell.dataset.col);
                this._highlightGrid(r, c);
                if (label) label.textContent = `${r + 1} × ${c + 1}`;
                if (rowsInput) rowsInput.value = r + 1;
                if (colsInput) colsInput.value = c + 1;
            });

            grid.addEventListener('click', (e) => {
                const cell = e.target.closest('.rte-table-grid-cell');
                if (!cell) return;
                const r = parseInt(cell.dataset.row);
                const c = parseInt(cell.dataset.col);
                isLocked = true;
                this._highlightGrid(r, c, true);
                if (label) label.textContent = `${r + 1} × ${c + 1} ✓`;
                if (rowsInput) rowsInput.value = r + 1;
                if (colsInput) colsInput.value = c + 1;
            });

            grid.addEventListener('mouseleave', () => {
                if (!isLocked) {
                    this._highlightGrid(-1, -1);
                    if (label) label.textContent = '0 × 0';
                }
            });

            /* Reset lock when modal opens */
            const modal = document.getElementById('modal-table');
            if (modal) {
                const observer = new MutationObserver(() => {
                    if (modal.classList.contains('active')) {
                        isLocked = false;
                        this._highlightGrid(-1, -1);
                        if (label) label.textContent = '0 × 0';
                    }
                });
                observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
            }
        }

        /* Insert table button */
        const insertBtn = document.getElementById('table-insert-btn');
        if (insertBtn) {
            insertBtn.addEventListener('click', () => {
                const rows = parseInt(rowsInput?.value) || 3;
                const cols = parseInt(colsInput?.value) || 3;
                const hasHeader = document.getElementById('table-header')?.checked;
                this.insertTable(rows, cols, hasHeader);
                this._editor.modal.close('modal-table');
            });
        }

        /* Multi-cell selection via mouse drag */
        this._bindCellSelection();
    }

    /** Bind mouse-based multi-cell selection */
    _bindCellSelection() {
        const editorEl = this._editor.editorEl;

        editorEl.addEventListener('mousedown', (e) => {
            const cell = e.target.closest('td, th');
            if (!cell || !cell.closest('table')) return;
            
            /* Don't interfere with resize handles */
            if (e.target.classList.contains('rte-table-col-resize') || e.target.classList.contains('rte-table-row-resize')) return;

            /* Start selection with Shift or Ctrl for extending */
            if (!e.shiftKey && !e.ctrlKey) {
                this.clearSelection();
            }

            this._isSelecting = true;
            this._selectionStart = cell;
            const table = cell.closest('table');
            if (table) table.classList.add('selecting');

            if (e.ctrlKey) {
                /* Toggle individual cell */
                cell.classList.toggle('cell-selected');
                this._updateSelectedCells(table);
            } else {
                cell.classList.add('cell-selected');
                this._updateSelectedCells(table);
            }
        });

        editorEl.addEventListener('mouseover', (e) => {
            if (!this._isSelecting || !this._selectionStart) return;
            const cell = e.target.closest('td, th');
            if (!cell) return;
            const table = cell.closest('table');
            const startTable = this._selectionStart.closest('table');
            if (!table || table !== startTable) return;

            /* Select rectangular range */
            this._selectRange(this._selectionStart, cell, table);
        });

        document.addEventListener('mouseup', () => {
            if (this._isSelecting) {
                this._isSelecting = false;
                const table = this._selectionStart?.closest('table');
                if (table) table.classList.remove('selecting');
            }
        });

        /* Clear selection on click outside tables */
        editorEl.addEventListener('click', (e) => {
            if (!e.target.closest('td, th') && !e.target.closest('.rte-table-col-resize') && !e.target.closest('.rte-table-row-resize')) {
                this.clearSelection();
            }
        });
    }

    /** Select a rectangular range of cells between two cells */
    _selectRange(startCell, endCell, table) {
        const allCells = Array.from(table.querySelectorAll('td, th'));
        const startPos = this._getCellPosition(startCell, table);
        const endPos = this._getCellPosition(endCell, table);
        if (!startPos || !endPos) return;

        const minRow = Math.min(startPos.row, endPos.row);
        const maxRow = Math.max(startPos.row, endPos.row);
        const minCol = Math.min(startPos.col, endPos.col);
        const maxCol = Math.max(startPos.col, endPos.col);

        /* Clear previous selection */
        allCells.forEach(c => c.classList.remove('cell-selected'));

        /* Select cells in range */
        const rows = Array.from(table.querySelectorAll('tr'));
        rows.forEach((row, rIdx) => {
            if (rIdx < minRow || rIdx > maxRow) return;
            Array.from(row.cells).forEach((cell, cIdx) => {
                if (cIdx >= minCol && cIdx <= maxCol) {
                    cell.classList.add('cell-selected');
                }
            });
        });

        this._updateSelectedCells(table);
    }

    /** Get row/col position of a cell in its table */
    _getCellPosition(cell, table) {
        const rows = Array.from(table.querySelectorAll('tr'));
        for (let r = 0; r < rows.length; r++) {
            const cells = Array.from(rows[r].cells);
            for (let c = 0; c < cells.length; c++) {
                if (cells[c] === cell) return { row: r, col: c };
            }
        }
        return null;
    }

    /** Update the internal selected cells array */
    _updateSelectedCells(table) {
        if (!table) return;
        this._selectedCells = Array.from(table.querySelectorAll('.cell-selected'));
    }

    /** Select an entire row */
    selectRow() {
        const cell = this._getCurrentCell();
        if (!cell) return;
        const tr = cell.closest('tr');
        const table = cell.closest('table');
        if (!tr || !table) return;

        this.clearSelection();
        Array.from(tr.cells).forEach(c => c.classList.add('cell-selected'));
        this._updateSelectedCells(table);
    }

    /** Select an entire column */
    selectCol() {
        const cell = this._getCurrentCell();
        if (!cell) return;
        const table = cell.closest('table');
        if (!table) return;
        const colIdx = cell.cellIndex;

        this.clearSelection();
        table.querySelectorAll('tr').forEach(row => {
            if (row.cells[colIdx]) row.cells[colIdx].classList.add('cell-selected');
        });
        this._updateSelectedCells(table);
    }

    /** Select all cells in the table */
    selectAllCells() {
        const cell = this._getCurrentCell();
        if (!cell) return;
        const table = cell.closest('table');
        if (!table) return;

        table.querySelectorAll('td, th').forEach(c => c.classList.add('cell-selected'));
        this._updateSelectedCells(table);
    }

    /** Clear all cell selections */
    clearSelection() {
        this._editor.editorEl.querySelectorAll('.cell-selected').forEach(c => c.classList.remove('cell-selected'));
        this._selectedCells = [];
    }

    _highlightGrid(row, col, locked = false) {
        const grid = document.getElementById('table-grid');
        if (!grid) return;
        grid.querySelectorAll('.rte-table-grid-cell').forEach(cell => {
            const r = parseInt(cell.dataset.row);
            const c = parseInt(cell.dataset.col);
            const isInRange = r <= row && c <= col;
            cell.classList.remove('highlighted', 'highlighted-full');
            if (isInRange) {
                cell.classList.add(locked ? 'highlighted-full' : 'highlighted');
            }
        });
    }

    /**
     * Create and insert a table.
     */
    insertTable(rows, cols, hasHeader = true) {
        const editor = this._editor;
        editor.selection.restore();

        const table = document.createElement('table');
        table.style.width = '100%';
        table.style.minWidth = '100%';
        table.style.maxWidth = '100%';
        table.style.tableLayout = 'fixed';

        if (hasHeader) {
            const thead = document.createElement('thead');
            const tr = document.createElement('tr');
            for (let c = 0; c < cols; c++) {
                const th = document.createElement('th');
                th.innerHTML = '<br>';
                this._addColResize(th);
                tr.appendChild(th);
            }
            thead.appendChild(tr);
            table.appendChild(thead);
        }

        const tbody = document.createElement('tbody');
        const bodyRows = hasHeader ? rows - 1 : rows;
        for (let r = 0; r < bodyRows; r++) {
            const tr = document.createElement('tr');
            for (let c = 0; c < cols; c++) {
                const td = document.createElement('td');
                td.innerHTML = '<br>';
                this._addColResize(td);
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);

        this._normalizeTableColumnWidths(table);

        editor.selection.insertNode(table);
        /* Insert a paragraph after the table for continued editing */
        const p = document.createElement('p');
        p.innerHTML = '<br>';
        table.parentNode.insertBefore(p, table.nextSibling);
        editor.saveHistory();
    }

    _addColResize(cell) {
        const handle = document.createElement('div');
        handle.className = 'rte-table-col-resize';
        cell.appendChild(handle);
    }

    _addRowResize(tr) {
        const handle = document.createElement('div');
        handle.className = 'rte-table-row-resize';
        tr.style.position = 'relative';
        tr.appendChild(handle);
    }

    _normalizeTableColumnWidths(table) {
        if (!table) return;

        const firstRow = table.querySelector('tr');
        if (!firstRow || firstRow.cells.length === 0) return;

        const columnCount = firstRow.cells.length;
        const width = `${100 / columnCount}%`;

        table.style.width = '100%';
        table.style.minWidth = '100%';
        table.style.maxWidth = '100%';
        table.style.tableLayout = 'fixed';

        table.querySelectorAll('tr').forEach(row => {
            Array.from(row.cells).forEach(cell => {
                if ((cell.colSpan || 1) === 1) {
                    cell.style.width = width;
                }
            });
        });
    }

    /** Insert a row above or below the current cell */
    insertRow(position = 'below') {
        const cell = this._getCurrentCell();
        if (!cell) return;
        const tr = cell.closest('tr');
        if (!tr) return;
        const cols = tr.cells.length;
        const newRow = document.createElement('tr');
        for (let i = 0; i < cols; i++) {
            const td = document.createElement('td');
            td.innerHTML = '<br>';
            this._addColResize(td);
            newRow.appendChild(td);
        }
        if (position === 'above') {
            tr.parentNode.insertBefore(newRow, tr);
        } else {
            tr.parentNode.insertBefore(newRow, tr.nextSibling);
        }
        this._editor.saveHistory();
    }

    /** Insert a column left or right of the current cell */
    insertCol(position = 'right') {
        const cell = this._getCurrentCell();
        if (!cell) return;
        const table = cell.closest('table');
        if (!table) return;
        const colIdx = cell.cellIndex;
        const rows = table.querySelectorAll('tr');
        rows.forEach(row => {
            const isHeader = row.closest('thead');
            const newCell = document.createElement(isHeader ? 'th' : 'td');
            newCell.innerHTML = '<br>';
            this._addColResize(newCell);
            if (position === 'left') {
                row.insertBefore(newCell, row.cells[colIdx]);
            } else {
                row.insertBefore(newCell, row.cells[colIdx + 1] || null);
            }
        });

        this._normalizeTableColumnWidths(table);
        this._editor.saveHistory();
    }

    /** Delete the row containing the current cell */
    deleteRow() {
        const cell = this._getCurrentCell();
        if (!cell) return;
        const tr = cell.closest('tr');
        if (!tr) return;
        const table = tr.closest('table');
        tr.remove();
        if (table && table.querySelectorAll('tr').length === 0) table.remove();
        this._editor.saveHistory();
    }

    /** Delete the column containing the current cell */
    deleteCol() {
        const cell = this._getCurrentCell();
        if (!cell) return;
        const table = cell.closest('table');
        if (!table) return;
        const colIdx = cell.cellIndex;
        table.querySelectorAll('tr').forEach(row => {
            if (row.cells[colIdx]) row.cells[colIdx].remove();
        });
        const firstRow = table.querySelector('tr');
        if (!firstRow || firstRow.cells.length === 0) table.remove();
        else this._normalizeTableColumnWidths(table);
        this._editor.saveHistory();
    }

    /** Delete the entire table */
    deleteTable() {
        const cell = this._getCurrentCell();
        if (!cell) return;
        const table = cell.closest('table');
        if (table) {
            const p = document.createElement('p');
            p.innerHTML = '<br>';
            table.parentNode.insertBefore(p, table);
            table.remove();
            
            /* Place cursor in the new paragraph */
            const range = document.createRange();
            const sel = window.getSelection();
            range.setStart(p, 0);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            p.focus();
            
            this._editor.saveHistory();
            this._editor.events.emit('change');
        }
    }

    /** Merge selected cells — works with multi-cell selection */
    mergeCells() {
        if (this._selectedCells.length < 2) {
            /* Fallback: merge all cells in current row */
            const cell = this._getCurrentCell();
            if (!cell) return;
            const tr = cell.closest('tr');
            if (!tr || tr.cells.length < 2) return;
            const first = tr.cells[0];
            let content = '';
            Array.from(tr.cells).forEach((c, i) => {
                if (i > 0) {
                    content += c.innerHTML;
                    c.remove();
                }
            });
            first.innerHTML += content;
            const table = tr.closest('table');
            if (table) {
                const maxCols = Math.max(...Array.from(table.querySelectorAll('tr')).map(r => r.cells.length));
                first.setAttribute('colspan', maxCols);
            }
            this._editor.saveHistory();
            return;
        }

        /* Get the bounding rectangle of selected cells */
        const table = this._selectedCells[0].closest('table');
        if (!table) return;

        let minRow = Infinity, maxRow = -1, minCol = Infinity, maxCol = -1;
        this._selectedCells.forEach(cell => {
            const pos = this._getCellPosition(cell, table);
            if (!pos) return;
            minRow = Math.min(minRow, pos.row);
            maxRow = Math.max(maxRow, pos.row);
            minCol = Math.min(minCol, pos.col);
            maxCol = Math.max(maxCol, pos.col);
        });

        const rows = Array.from(table.querySelectorAll('tr'));
        const firstCell = rows[minRow]?.cells[minCol];
        if (!firstCell) return;

        /* Gather content and remove non-first cells */
        let mergedContent = '';
        for (let r = minRow; r <= maxRow; r++) {
            const rowCells = Array.from(rows[r].cells);
            for (let c = minCol; c <= maxCol; c++) {
                const cell = rowCells[c];
                if (!cell) continue;
                if (cell === firstCell) continue;
                const inner = cell.innerHTML.trim();
                if (inner && inner !== '<br>') mergedContent += ' ' + inner;
                cell.remove();
            }
        }

        if (mergedContent) firstCell.innerHTML += mergedContent;

        const colSpan = maxCol - minCol + 1;
        const rowSpan = maxRow - minRow + 1;
        if (colSpan > 1) firstCell.setAttribute('colspan', colSpan);
        if (rowSpan > 1) firstCell.setAttribute('rowspan', rowSpan);

        this.clearSelection();
        this._editor.saveHistory();
    }

    /** Split a merged cell back into individual cells */
    splitCell() {
        const cell = this._getCurrentCell();
        if (!cell) return;
        const colspan = parseInt(cell.getAttribute('colspan')) || 1;
        const rowspan = parseInt(cell.getAttribute('rowspan')) || 1;
        if (colspan <= 1 && rowspan <= 1) return;

        const table = cell.closest('table');
        if (!table) return;
        const pos = this._getCellPosition(cell, table);
        if (!pos) return;

        cell.removeAttribute('colspan');
        cell.removeAttribute('rowspan');

        const rows = Array.from(table.querySelectorAll('tr'));

        /* Add cells to the same row for extra columns */
        for (let c = 1; c < colspan; c++) {
            const isHeader = rows[pos.row]?.closest('thead');
            const newCell = document.createElement(isHeader ? 'th' : 'td');
            newCell.innerHTML = '<br>';
            this._addColResize(newCell);
            const nextCell = cell.nextElementSibling;
            if (nextCell) {
                cell.parentNode.insertBefore(newCell, nextCell);
            } else {
                cell.parentNode.appendChild(newCell);
            }
        }

        /* Add cells to subsequent rows */
        for (let r = 1; r < rowspan; r++) {
            const row = rows[pos.row + r];
            if (!row) continue;
            for (let c = 0; c < colspan; c++) {
                const isHeader = row.closest('thead');
                const newCell = document.createElement(isHeader ? 'th' : 'td');
                newCell.innerHTML = '<br>';
                this._addColResize(newCell);
                if (row.cells[pos.col]) {
                    row.insertBefore(newCell, row.cells[pos.col]);
                } else {
                    row.appendChild(newCell);
                }
            }
        }

        this._editor.saveHistory();
    }

    /** Get the current table cell where cursor is */
    _getCurrentCell() {
        const sel = this._editor.selection;
        let node = sel.getSelection()?.anchorNode;
        if (!node) return null;
        if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
        return node.closest?.('td, th');
    }

    /** Check if cursor is inside a table */
    isInTable() {
        return !!this._getCurrentCell();
    }

    /** Initialize column resize for all tables in editor */
    initResize(editorEl) {
        /* Column resize */
        let startX, startWidth, th;
        editorEl.addEventListener('mousedown', (e) => {
            if (!e.target.classList.contains('rte-table-col-resize')) return;
            e.preventDefault();
            th = e.target.closest('td, th');
            if (!th) return;
            startX = e.pageX;
            startWidth = th.offsetWidth;

            const onMove = (ev) => {
                const diff = ev.pageX - startX;
                th.style.width = Math.max(40, startWidth + diff) + 'px';
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                this._editor.saveHistory();
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        /* Row resize */
        let startY, startHeight, resizeTr;
        editorEl.addEventListener('mousedown', (e) => {
            if (!e.target.classList.contains('rte-table-row-resize')) return;
            e.preventDefault();
            resizeTr = e.target.closest('tr');
            if (!resizeTr) return;
            startY = e.pageY;
            startHeight = resizeTr.offsetHeight;

            const onMove = (ev) => {
                const diff = ev.pageY - startY;
                const newH = Math.max(24, startHeight + diff);
                resizeTr.style.height = newH + 'px';
                /* Also set all cells in this row */
                Array.from(resizeTr.cells).forEach(cell => {
                    cell.style.height = newH + 'px';
                });
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                this._editor.saveHistory();
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        /* Add row resize handles to existing tables on mutation */
        const observer = new MutationObserver(() => {
            editorEl.querySelectorAll('table tr').forEach(tr => {
                if (!tr.querySelector('.rte-table-row-resize')) {
                    tr.style.position = 'relative';
                    const handle = document.createElement('div');
                    handle.className = 'rte-table-row-resize';
                    tr.appendChild(handle);
                }
            });
        });
        observer.observe(editorEl, { childList: true, subtree: true });
    }
}


/* ============================================
   EmojiPicker — Custom built emoji picker
   ============================================ */
class EmojiPicker {
    constructor(editor) {
        this._editor = editor;
        this._picker = document.getElementById('emoji-picker');
        this._grid = document.getElementById('emoji-grid');
        this._searchInput = document.getElementById('emoji-search');
        this._catsContainer = document.getElementById('emoji-categories');
        this._visible = false;
        this._currentCategory = 'smileys';

        this._categories = {
            smileys: { icon: '😀', label: 'Smileys', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐','😱','😨','😰','😥','😢','😭','😤','😡','🤬'] },
            gestures: { icon: '👋', label: 'Gestures', emojis: ['👋','🤚','🖐','✋','🖖','👌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','💪','🦶','🦵','👂','👃','👀','👁️','👅','👄'] },
            hearts: { icon: '❤️', label: 'Hearts', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','💌','💋','💍','💎','🔮','🎁','🎀','🎊','🎉','🎈','🎄','🎃','🎂','🧸'] },
            animals: { icon: '🐶', label: 'Animals', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🐢','🐍','🦎','🐙','🦑','🦀','🐠','🐟','🐬','🐳','🐋','🦈'] },
            food: { icon: '🍕', label: 'Food', emojis: ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🌽','🥕','🧄','🧅','🥔','🍠','🍕','🍔','🍟','🌭','🍿','🧈','🥚','🍳','🥓','🥩','🍗','🍖','🌮','🌯','🍜','🍝','🍣','🍱','🍰','🎂','🍩','🍪'] },
            travel: { icon: '✈️', label: 'Travel', emojis: ['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🚚','🚛','🚜','🏍️','🛵','🚲','🚁','✈️','🛩️','🚀','🚢','⛵','🚤','🗺️','🗿','🗼','🏰','🗽','🏠','🏡','🏢','🏣','🏥','🏨','🏩','🏪','🏫','⛪','🕌','🕍','⛲','🎡','🎢','🎠'] },
            objects: { icon: '💡', label: 'Objects', emojis: ['⌚','📱','💻','⌨️','🖥️','🖨️','🖱️','💾','💿','📀','🎥','📽️','📺','📷','📹','🔍','🔬','🔭','📡','💡','🔦','🏮','📔','📕','📖','📗','📘','📙','📓','📒','📃','📄','✏️','✒️','🖊️','🖋️','🔒','🔓','🔑','🔨','🪓','⛏️','🔧','🔩'] },
            symbols: { icon: '✅', label: 'Symbols', emojis: ['❤️','✅','❌','⭐','🔥','💯','🎵','🎶','➡️','⬅️','⬆️','⬇️','↗️','↘️','↙️','↖️','↕️','↔️','🔄','⚡','❄️','☀️','🌙','🌈','☁️','🔔','📌','📎','🔗','✂️','🏁','🚩','🔑','♻️','⚠️','🚫','⛔','❓','❗','💤','💬','💭','🗯️','♠️','♣️','♥️','♦️'] },
        };

        this._init();
    }

    _init() {
        if (!this._catsContainer || !this._grid) return;

        /* Build category buttons */
        for (const [key, cat] of Object.entries(this._categories)) {
            const btn = document.createElement('button');
            btn.className = 'rte-emoji-cat-btn';
            btn.title = cat.label;
            btn.textContent = cat.icon;
            btn.dataset.category = key;
            if (key === this._currentCategory) btn.classList.add('active');
            this._catsContainer.appendChild(btn);
        }

        /* Category click */
        this._catsContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.rte-emoji-cat-btn');
            if (!btn) return;
            this._currentCategory = btn.dataset.category;
            this._catsContainer.querySelectorAll('.rte-emoji-cat-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this._renderEmojis(this._categories[this._currentCategory].emojis);
        });

        /* Grid click — insert emoji */
        this._grid.addEventListener('click', (e) => {
            const item = e.target.closest('.rte-emoji-item');
            if (!item) return;
            this._editor.selection.restore();
            this._editor.selection.insertHTML(item.textContent);
            this._editor.saveHistory();
            this._editor.events.emit('change');
            this.hide();
        });

        /* Search */
        if (this._searchInput) {
            this._searchInput.addEventListener('input', () => {
                const q = this._searchInput.value.toLowerCase().trim();
                if (!q) {
                    this._renderEmojis(this._categories[this._currentCategory].emojis);
                    return;
                }
                /* Search all categories */
                const all = [];
                for (const cat of Object.values(this._categories)) {
                    all.push(...cat.emojis);
                }
                this._renderEmojis(all); // show all on search
            });
        }

        /* Initial render */
        this._renderEmojis(this._categories[this._currentCategory].emojis);
    }

    _renderEmojis(emojis) {
        if (!this._grid) return;
        this._grid.innerHTML = '';
        for (const emoji of emojis) {
            const btn = document.createElement('button');
            btn.className = 'rte-emoji-item';
            btn.textContent = emoji;
            btn.title = emoji;
            this._grid.appendChild(btn);
        }
    }

    show(anchorEl) {
        if (!this._picker) return;
        this._editor.selection.save();
        const rect = anchorEl.getBoundingClientRect();
        this._picker.style.display = 'flex';
        /* Position below the button using fixed viewport coordinates */
        this._picker.style.position = 'fixed';
        this._picker.style.top = (rect.bottom + 4) + 'px';
        this._picker.style.left = Math.min(rect.left, window.innerWidth - 330) + 'px';
        this._visible = true;

        /* Close on outside click */
        setTimeout(() => {
            const handler = (e) => {
                if (!this._picker.contains(e.target) && !anchorEl.contains(e.target)) {
                    this.hide();
                    document.removeEventListener('mousedown', handler);
                }
            };
            document.addEventListener('mousedown', handler);
        }, 0);
    }

    hide() {
        if (this._picker) this._picker.style.display = 'none';
        this._visible = false;
    }

    toggle(anchorEl) {
        if (this._visible) this.hide();
        else this.show(anchorEl);
    }
}


/* ============================================
   ContextMenu — Custom right-click menu
   ============================================ */
class ContextMenuManager {
    constructor(editor) {
        this._editor = editor;
        this._menu = document.getElementById('rte-context-menu');
        this._bindEvents();
    }

    _bindEvents() {
        const editorEl = this._editor.editorEl;

        editorEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this._showTableItems();
            this._show(e.clientX, e.clientY);
        });

        /* Click items */
        if (this._menu) {
            this._menu.addEventListener('click', (e) => {
                const item = e.target.closest('.rte-context-item');
                if (!item) return;
                const cmd = item.dataset.command;
                if (cmd) {
                    this._editor.execCommand(cmd);
                }
                this._hide();
            });
        }

        /* Hide on click elsewhere */
        document.addEventListener('click', (e) => {
            if (this._menu && !this._menu.contains(e.target)) this._hide();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this._hide();
        });

        /* Hide on scroll */
        editorEl.addEventListener('scroll', () => this._hide());
    }

    _show(x, y) {
        if (!this._menu) return;
        
        /* Reset position and show to measure dimensions */
        this._menu.style.left = '-9999px';
        this._menu.style.top = '-9999px';
        this._menu.style.display = 'block';
        
        const mw = this._menu.offsetWidth;
        const mh = this._menu.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const scrollX = window.scrollX || window.pageXOffset;
        const scrollY = window.scrollY || window.pageYOffset;
        const padding = 8;
        
        /* Calculate position - prefer right and below cursor */
        let finalX = x;
        let finalY = y;
        
        /* Horizontal: if would go off right edge, flip to left of cursor */
        if (x + mw + padding > vw + scrollX) {
            finalX = Math.max(padding, x - mw);
        }
        /* If still off left edge, snap to left edge */
        if (finalX < padding) {
            finalX = padding;
        }
        
        /* Vertical: if would go off bottom, flip above cursor */
        if (y + mh + padding > vh + scrollY) {
            finalY = Math.max(padding, y - mh);
        }
        /* If still off top, snap to top */
        if (finalY < padding) {
            finalY = padding;
        }
        
        this._menu.style.left = finalX + 'px';
        this._menu.style.top = finalY + 'px';
    }

    _hide() {
        if (this._menu) this._menu.style.display = 'none';
    }

    _showTableItems() {
        const inTable = this._editor.table.isInTable();
        const tableItems = ['ctx-table-sep', 'ctx-row-above', 'ctx-row-below', 'ctx-col-left', 'ctx-col-right', 'ctx-del-row', 'ctx-del-col', 'ctx-del-table', 'ctx-merge-cells', 'ctx-split-cell', 'ctx-select-row', 'ctx-select-col', 'ctx-select-table'];
        tableItems.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = inTable ? '' : 'none';
        });
    }
}


/* ============================================
   ExportManager — Export / download content
   ============================================ */
class ExportManager {
    constructor(editor) {
        this._editor = editor;
    }

    /** Get HTML content */
    getHTML() {
        return this._editor.sanitizer.sanitize(this._editor.editorEl.innerHTML);
    }

    /** Get plain text */
    getText() {
        return this._editor.editorEl.innerText || this._editor.editorEl.textContent || '';
    }

    /** Copy HTML to clipboard */
    async copyHTML() {
        try {
            await navigator.clipboard.writeText(this.getHTML());
            this._editor.events.emit('export:copied', 'html');
        } catch (e) {
            this._fallbackCopy(this.getHTML());
        }
    }

    /** Copy plain text to clipboard */
    async copyText() {
        try {
            await navigator.clipboard.writeText(this.getText());
            this._editor.events.emit('export:copied', 'text');
        } catch (e) {
            this._fallbackCopy(this.getText());
        }
    }

    /** Download as .html file */
    downloadHTML(filename = 'document.html') {
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Document</title></head><body>${this.getHTML()}</body></html>`;
        this._download(html, filename, 'text/html');
    }

    /** Download as .txt file */
    downloadText(filename = 'document.txt') {
        this._download(this.getText(), filename, 'text/plain');
    }

    _download(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    _fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) { /* ignore */ }
        document.body.removeChild(ta);
    }
}


/* ============================================
   DragDropHandler — Image drag & drop
   ============================================ */
class DragDropHandler {
    constructor(editor) {
        this._editor = editor;
        this._bindEvents();
    }

    _bindEvents() {
        const el = this._editor.editorEl;
        let dragCounter = 0;

        el.addEventListener('dragenter', (e) => {
            e.preventDefault();
            dragCounter++;
            el.classList.add('drag-over');
        });

        el.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dragCounter--;
            if (dragCounter <= 0) {
                el.classList.remove('drag-over');
                dragCounter = 0;
            }
        });

        el.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });

        el.addEventListener('drop', (e) => {
            e.preventDefault();
            el.classList.remove('drag-over');
            dragCounter = 0;

            const files = e.dataTransfer.files;
            if (files.length > 0) {
                for (const file of files) {
                    if (file.type.startsWith('image/')) {
                        this._readAndInsertImage(file);
                    }
                }
            }
        });
    }

    _readAndInsertImage(file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = document.createElement('img');
            img.src = ev.target.result;
            img.alt = file.name;
            img.style.maxWidth = '100%';
            this._editor.selection.insertNode(img);
            this._editor.saveHistory();
            this._editor.events.emit('change');
        };
        reader.readAsDataURL(file);
    }
}


/* ============================================
   PasteHandler — Paste with format stripping
   ============================================ */
class PasteHandler {
    constructor(editor) {
        this._editor = editor;
        this._bindEvents();
    }

    _bindEvents() {
        this._editor.editorEl.addEventListener('paste', (e) => {
            const clipboardData = e.clipboardData || window.clipboardData;
            if (!clipboardData) return;

            /* Check for images in clipboard */
            const items = clipboardData.items;
            if (items) {
                for (const item of items) {
                    if (item.type.startsWith('image/')) {
                        e.preventDefault();
                        const file = item.getAsFile();
                        if (file) this._insertImageFile(file);
                        return;
                    }
                }
            }

            /* Get HTML or plain text */
            const html = clipboardData.getData('text/html');
            const text = clipboardData.getData('text/plain');

            if (html) {
                e.preventDefault();
                /* Sanitize pasted HTML */
                const clean = this._editor.sanitizer.sanitize(html);
                this._editor.selection.insertHTML(clean);
                this._editor.saveHistory();
                this._editor.events.emit('change');
            } else if (text) {
                e.preventDefault();
                /* Convert plain text to HTML (preserve line breaks) */
                const safeText = this._escapeHtml(text);
                const htmlText = safeText.replace(/\n/g, '<br>');
                this._editor.selection.insertHTML(htmlText);
                this._editor.saveHistory();
                this._editor.events.emit('change');
            }
        });
    }

    _insertImageFile(file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = document.createElement('img');
            img.src = ev.target.result;
            img.alt = 'Pasted image';
            img.style.maxWidth = '100%';
            this._editor.selection.insertNode(img);
            this._editor.saveHistory();
            this._editor.events.emit('change');
        };
        reader.readAsDataURL(file);
    }

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}


/* ============================================
   ImageResizer — In-editor image resize handles
   ============================================ */
class ImageResizer {
    constructor(editor) {
        this._editor = editor;
        this._currentImg = null;
        this._wrapper = null;
        this._bindEvents();
    }

    _bindEvents() {
        const editorEl = this._editor.editorEl;

        editorEl.addEventListener('click', (e) => {
            if (e.target.tagName === 'IMG') {
                this._selectImage(e.target);
            } else {
                this._deselect();
            }
        });

        /* Deselect on typing */
        editorEl.addEventListener('keydown', () => this._deselect());
    }

    _selectImage(img) {
        this._deselect();
        this._currentImg = img;
        img.classList.add('rte-img-selected');

        /* Create wrapper with resize handles */
        const wrapper = document.createElement('span');
        wrapper.className = 'rte-img-resize-wrapper active';
        wrapper.contentEditable = 'false';
        img.parentNode.insertBefore(wrapper, img);
        wrapper.appendChild(img);

        ['se', 'sw', 'ne', 'nw'].forEach(pos => {
            const handle = document.createElement('span');
            handle.className = `rte-img-resize-handle ${pos}`;
            handle.dataset.dir = pos;
            wrapper.appendChild(handle);
        });

        this._wrapper = wrapper;

        /* Resize logic */
        let startX, startY, startW, startH, dir;

        const onMouseDown = (e) => {
            if (!e.target.classList.contains('rte-img-resize-handle')) return;
            e.preventDefault();
            dir = e.target.dataset.dir;
            startX = e.clientX;
            startY = e.clientY;
            startW = img.offsetWidth;
            startH = img.offsetHeight;

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        const onMouseMove = (e) => {
            let dx = e.clientX - startX;
            let dy = e.clientY - startY;

            if (dir.includes('w')) dx = -dx;
            if (dir.includes('n')) dy = -dy;

            const aspectRatio = startW / startH;
            let newW = Math.max(50, startW + dx);
            let newH = newW / aspectRatio;

            img.style.width = Math.round(newW) + 'px';
            img.style.height = Math.round(newH) + 'px';
            img.removeAttribute('width');
            img.removeAttribute('height');
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            this._editor.saveHistory();
        };

        wrapper.addEventListener('mousedown', onMouseDown);
    }

    _deselect() {
        if (this._wrapper && this._currentImg) {
            const img = this._currentImg;
            img.classList.remove('rte-img-selected');
            const parent = this._wrapper.parentNode;
            if (parent) {
                parent.insertBefore(img, this._wrapper);
                this._wrapper.remove();
            }
        }
        this._wrapper = null;
        this._currentImg = null;
    }
}


/* ============================================
   PluginManager — Extensible plugin architecture
   ============================================ */
class PluginManager {
    constructor(editor) {
        this._editor = editor;
        /** @type {Map<string, Object>} */
        this._plugins = new Map();
    }

    /**
     * Register a plugin. Plugin must have { name, init(editor), destroy? }
     * @param {Object} plugin
     */
    register(plugin) {
        if (!plugin.name || !plugin.init) {
            console.warn('Plugin must have name and init()');
            return;
        }
        if (this._plugins.has(plugin.name)) {
            console.warn(`Plugin "${plugin.name}" already registered`);
            return;
        }
        this._plugins.set(plugin.name, plugin);
        plugin.init(this._editor);
        this._editor.events.emit('plugin:registered', plugin.name);
    }

    /** Unregister and destroy a plugin */
    unregister(name) {
        const plugin = this._plugins.get(name);
        if (plugin) {
            if (typeof plugin.destroy === 'function') plugin.destroy(this._editor);
            this._plugins.delete(name);
            this._editor.events.emit('plugin:unregistered', name);
        }
    }

    get(name) {
        return this._plugins.get(name);
    }
}


/* ============================================
   SpecialCharsPicker — Special characters picker
   ============================================ */
class SpecialCharsPicker {
    constructor(editor) {
        this._editor = editor;
        this._picker = document.getElementById('special-chars-picker');
        this._grid = document.getElementById('special-chars-grid');
        this._searchInput = document.getElementById('special-chars-search');
        this._catsContainer = document.getElementById('special-chars-categories');
        this._visible = false;
        this._currentCategory = 'math';

        this._categories = {
            math: { label: 'Math', chars: ['±','×','÷','≠','≈','≤','≥','∞','√','∑','∏','∫','∂','∆','∇','π','µ','°','∠','⊥','∥','≡','∝','∈','∉','⊂','⊃','∪','∩','∅','⊕','⊗','ℕ','ℤ','ℚ','ℝ','ℂ','ℵ','⌈','⌉','⌊','⌋'] },
            arrows: { label: 'Arrows', chars: ['←','→','↑','↓','↔','↕','⇐','⇒','⇑','⇓','⇔','⇕','↗','↘','↙','↖','↰','↱','↲','↳','⟵','⟶','⟷','↺','↻','⟲','⟳','➜','➝','➞','➡','⬅','⬆','⬇'] },
            currency: { label: 'Currency', chars: ['$','€','£','¥','¢','₹','₩','₽','₿','฿','₫','₴','₦','₱','₲','₵','₡','₢','₮','₯','₰','₳','₸','₺','₼','₾','﷼','﹩'] },
            punctuation: { label: 'Punctuation', chars: ['…','–','—','·','•','‣','※','†','‡','§','¶','©','®','™','℠','℗','℃','℉','‰','‱','′','″','‴','⁗','‼','⁉','⁈','⁇','‽','⸮','¡','¿'] },
            greek: { label: 'Greek', chars: ['α','β','γ','δ','ε','ζ','η','θ','ι','κ','λ','μ','ν','ξ','ο','π','ρ','σ','τ','υ','φ','χ','ψ','ω','Α','Β','Γ','Δ','Ε','Ζ','Η','Θ','Ι','Κ','Λ','Μ','Ν','Ξ','Ο','Π','Ρ','Σ','Τ','Υ','Φ','Χ','Ψ','Ω'] },
            shapes: { label: 'Shapes', chars: ['■','□','▪','▫','▬','▭','▮','▯','▰','▱','▲','△','▴','▵','▶','▷','▸','▹','►','▻','▼','▽','▾','▿','◀','◁','◂','◃','◄','◅','◆','◇','◈','◉','◊','○','◌','◍','◎','●','◐','◑','★','☆','✦','✧','✕','✖','✚','✜'] },
            misc: { label: 'Misc', chars: ['♠','♣','♥','♦','♤','♧','♡','♢','♩','♪','♫','♬','♭','♮','♯','☀','☁','☂','☃','☄','★','☆','☎','☏','☑','☒','☓','☔','☕','☘','☛','☜','☝','☞','☟','☠','☢','☣','☮','☯','☸','☹','☺','☻','♲','♻','⚐','⚑','⚒','⚓','⚔','⚕','⚖','⚗','⚘','⚙','⚚'] },
        };

        this._init();
    }

    _init() {
        if (!this._catsContainer || !this._grid) return;

        for (const [key, cat] of Object.entries(this._categories)) {
            const btn = document.createElement('button');
            btn.className = 'rte-special-chars-cat-btn';
            btn.textContent = cat.label;
            btn.dataset.category = key;
            if (key === this._currentCategory) btn.classList.add('active');
            this._catsContainer.appendChild(btn);
        }

        this._catsContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.rte-special-chars-cat-btn');
            if (!btn) return;
            this._currentCategory = btn.dataset.category;
            this._catsContainer.querySelectorAll('.rte-special-chars-cat-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this._renderChars(this._categories[this._currentCategory].chars);
        });

        this._grid.addEventListener('click', (e) => {
            const item = e.target.closest('.rte-special-char-item');
            if (!item) return;
            this._editor.selection.restore();
            this._editor.selection.insertHTML(item.textContent);
            this._editor.saveHistory();
            this._editor.events.emit('change');
            this.hide();
        });

        if (this._searchInput) {
            this._searchInput.addEventListener('input', () => {
                const q = this._searchInput.value.toLowerCase().trim();
                if (!q) {
                    this._renderChars(this._categories[this._currentCategory].chars);
                    return;
                }
                const all = [];
                for (const cat of Object.values(this._categories)) all.push(...cat.chars);
                this._renderChars(all);
            });
        }

        this._renderChars(this._categories[this._currentCategory].chars);
    }

    _renderChars(chars) {
        if (!this._grid) return;
        this._grid.innerHTML = '';
        for (const ch of chars) {
            const btn = document.createElement('button');
            btn.className = 'rte-special-char-item';
            btn.textContent = ch;
            btn.title = ch + ' (U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0') + ')';
            this._grid.appendChild(btn);
        }
    }

    show(anchorEl) {
        if (!this._picker) return;
        this._editor.selection.save();
        const rect = anchorEl.getBoundingClientRect();
        this._picker.style.display = 'flex';
        /* Position below the button using fixed viewport coordinates */
        this._picker.style.position = 'fixed';
        this._picker.style.top = (rect.bottom + 4) + 'px';
        this._picker.style.left = Math.min(rect.left, window.innerWidth - 350) + 'px';
        this._visible = true;

        setTimeout(() => {
            const handler = (e) => {
                if (!this._picker.contains(e.target) && !anchorEl.contains(e.target)) {
                    this.hide();
                    document.removeEventListener('mousedown', handler);
                }
            };
            document.addEventListener('mousedown', handler);
        }, 0);
    }

    hide() {
        if (this._picker) this._picker.style.display = 'none';
        this._visible = false;
    }

    toggle(anchorEl) {
        if (this._visible) this.hide();
        else this.show(anchorEl);
    }
}


/* ============================================
   DateTimePicker — Insert date/time
   ============================================ */
class DateTimePicker {
    constructor(editor) {
        this._editor = editor;
        this._picker = document.getElementById('datetime-picker');
        this._optionsContainer = document.getElementById('datetime-options');
        this._visible = false;
        this._init();
    }

    _init() {
        if (!this._optionsContainer) return;

        this._optionsContainer.addEventListener('click', (e) => {
            const option = e.target.closest('.rte-datetime-option');
            if (!option) return;
            const format = option.dataset.format;
            const text = this._formatDate(new Date(), format);
            this._editor.selection.restore();
            this._editor.selection.insertHTML(text);
            this._editor.saveHistory();
            this._editor.events.emit('change');
            this.hide();
        });
    }

    _buildOptions() {
        if (!this._optionsContainer) return;
        this._optionsContainer.innerHTML = '';
        const now = new Date();
        const formats = [
            { format: 'full', label: 'Full date & time', example: this._formatDate(now, 'full') },
            { format: 'longDate', label: 'Long date', example: this._formatDate(now, 'longDate') },
            { format: 'shortDate', label: 'Short date', example: this._formatDate(now, 'shortDate') },
            { format: 'isoDate', label: 'ISO date', example: this._formatDate(now, 'isoDate') },
            { format: 'time12', label: '12-hour time', example: this._formatDate(now, 'time12') },
            { format: 'time24', label: '24-hour time', example: this._formatDate(now, 'time24') },
            { format: 'iso', label: 'ISO 8601', example: this._formatDate(now, 'iso') },
            { format: 'relative', label: 'Day of week', example: this._formatDate(now, 'relative') },
        ];

        for (const f of formats) {
            const btn = document.createElement('button');
            btn.className = 'rte-datetime-option';
            btn.dataset.format = f.format;
            btn.innerHTML = `<span>${f.example}</span><span class="rte-dt-label">${f.label}</span>`;
            this._optionsContainer.appendChild(btn);
        }
    }

    _formatDate(date, format) {
        switch (format) {
            case 'full':
                return date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
                    + ' ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
            case 'longDate':
                return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
            case 'shortDate':
                return date.toLocaleDateString();
            case 'isoDate':
                return date.toISOString().split('T')[0];
            case 'time12':
                return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true });
            case 'time24':
                return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
            case 'iso':
                return date.toISOString();
            case 'relative':
                return date.toLocaleDateString(undefined, { weekday: 'long' })
                    + ', ' + date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            default:
                return date.toLocaleString();
        }
    }

    show(anchorEl) {
        if (!this._picker) return;
        this._editor.selection.save();
        this._buildOptions();
        const rect = anchorEl.getBoundingClientRect();
        const editorRect = document.getElementById('editor-root').getBoundingClientRect();
        this._picker.style.display = 'block';
        this._picker.style.position = 'absolute';
        this._picker.style.top = (rect.bottom - editorRect.top + 4) + 'px';
        this._picker.style.left = Math.min(rect.left - editorRect.left, editorRect.width - 290) + 'px';
        this._visible = true;

        setTimeout(() => {
            const handler = (e) => {
                if (!this._picker.contains(e.target) && !anchorEl.contains(e.target)) {
                    this.hide();
                    document.removeEventListener('mousedown', handler);
                }
            };
            document.addEventListener('mousedown', handler);
        }, 0);
    }

    hide() {
        if (this._picker) this._picker.style.display = 'none';
        this._visible = false;
    }

    toggle(anchorEl) {
        if (this._visible) this.hide();
        else this.show(anchorEl);
    }
}


/* ============================================
   KeyboardShortcutsHelp — Show keyboard shortcuts
   ============================================ */
class KeyboardShortcutsHelp {
    constructor(editor) {
        this._editor = editor;
    }

    show() {
        const body = document.getElementById('shortcuts-body');
        if (!body) return;

        const sections = [
            {
                title: 'Text Formatting',
                shortcuts: [
                    ['Bold', ['Ctrl', 'B']],
                    ['Italic', ['Ctrl', 'I']],
                    ['Underline', ['Ctrl', 'U']],
                ]
            },
            {
                title: 'Editing',
                shortcuts: [
                    ['Undo', ['Ctrl', 'Z']],
                    ['Redo', ['Ctrl', 'Y']],
                    ['Redo (alt)', ['Ctrl', 'Shift', 'Z']],
                    ['Select All', ['Ctrl', 'A']],
                    ['Cut', ['Ctrl', 'X']],
                    ['Copy', ['Ctrl', 'C']],
                    ['Paste', ['Ctrl', 'V']],
                ]
            },
            {
                title: 'Insert & Navigate',
                shortcuts: [
                    ['Insert Link', ['Ctrl', 'K']],
                    ['Find & Replace', ['Ctrl', 'H']],
                    ['Find & Replace (alt)', ['Ctrl', 'F']],
                    ['Print', ['Ctrl', 'P']],
                    ['Keyboard Shortcuts', ['Ctrl', '/']],
                ]
            },
            {
                title: 'Lists',
                shortcuts: [
                    ['Indent (in list)', ['Tab']],
                    ['Outdent (in list)', ['Shift', 'Tab']],
                ]
            },
            {
                title: 'Other',
                shortcuts: [
                    ['Exit Fullscreen', ['Esc']],
                    ['New line (in code block)', ['Enter']],
                    ['Line break', ['Shift', 'Enter']],
                ]
            }
        ];

        body.innerHTML = sections.map(section => `
            <div class="rte-shortcuts-section">
                <h4>${section.title}</h4>
                <div class="rte-shortcuts-list">
                    ${section.shortcuts.map(([action, keys]) => `
                        <div class="rte-shortcut-row">
                            <span class="rte-shortcut-action">${action}</span>
                            <span class="rte-shortcut-keys">
                                ${keys.map((k, i) => `<span class="rte-key">${k}</span>${i < keys.length - 1 ? '<span class="rte-key-plus">+</span>' : ''}`).join('')}
                            </span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');

        this._editor.modal.open('modal-shortcuts');
    }
}




/* ============================================
   WordCountGoal — Word/Character count goal with progress
   ============================================ */
class WordCountGoal {
    constructor(editor) {
        this._editor = editor;
        this._goal = 0;
        this._goalType = 'words'; // 'words' or 'chars'
        this._notify = true;
        this._notified = false;
        this._init();
    }

    _init() {
        const goalBtn = document.getElementById('wc-goal-btn');
        const setBtn = document.getElementById('wc-goal-set');
        const clearBtn = document.getElementById('wc-goal-clear');

        if (goalBtn) {
            goalBtn.addEventListener('click', () => {
                const input = document.getElementById('wc-goal-input');
                const typeRadios = document.querySelectorAll('input[name="wc-goal-type"]');
                if (input) input.value = this._goal || '';
                typeRadios.forEach(r => {
                    r.checked = r.value === this._goalType;
                });
                this._editor.modal.open('modal-wc-goal');
            });
        }

        if (setBtn) {
            setBtn.addEventListener('click', () => {
                const input = document.getElementById('wc-goal-input');
                const notifyCheck = document.getElementById('wc-goal-notify');
                const typeRadio = document.querySelector('input[name="wc-goal-type"]:checked');
                const val = parseInt(input?.value);
                if (val > 0) {
                    this._goal = val;
                    this._goalType = typeRadio?.value || 'words';
                    this._notify = notifyCheck?.checked ?? true;
                    this._notified = false;
                    this._showGoalUI(true);
                    this._update();
                }
                this._editor.modal.close('modal-wc-goal');
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this._goal = 0;
                this._notified = false;
                this._showGoalUI(false);
                this._editor.modal.close('modal-wc-goal');
            });
        }

        this._editor.events.on('change', () => this._update());
    }

    update() { this._update(); }

    _showGoalUI(show) {
        const wrapper = document.getElementById('wc-goal-wrapper');
        const sep = document.getElementById('wc-goal-sep');
        if (wrapper) wrapper.style.display = show ? 'inline-flex' : 'none';
        if (sep) sep.style.display = show ? '' : 'none';
    }

    _update() {
        if (!this._goal) return;

        const text = this._editor.editorEl.innerText || '';
        let current, label;
        
        if (this._goalType === 'chars') {
            current = text.replace(/\n/g, '').length;
            label = 'Chars';
        } else {
            current = text.trim() ? text.trim().split(/\s+/).length : 0;
            label = 'Words';
        }
        
        const percentage = Math.min(100, Math.round((current / this._goal) * 100));

        const goalText = document.getElementById('wc-goal-text');
        const goalFill = document.getElementById('wc-goal-fill');

        if (goalText) goalText.textContent = `${label}: ${current.toLocaleString()}/${this._goal.toLocaleString()}`;
        if (goalFill) {
            goalFill.style.width = percentage + '%';
            goalFill.classList.toggle('complete', percentage >= 100);
        }

        if (this._notify && percentage >= 100 && !this._notified) {
            this._notified = true;
            this._showNotification();
        }
    }

    _showNotification() {
        const goalLabel = this._goalType === 'chars' ? 'Character' : 'Word';
        const notification = document.createElement('div');
        notification.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);padding:12px 24px;background:#16a34a;color:#fff;border-radius:6px;font-size:14px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;z-index:100010;box-shadow:0 4px 12px rgba(0,0,0,0.2);opacity:0;transition:opacity 0.3s ease;';
        notification.textContent = `\u2705 ${goalLabel} count goal reached!`;
        document.body.appendChild(notification);
        requestAnimationFrame(() => { notification.style.opacity = '1'; });
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
}


/* ============================================
   MarkdownExporter — Convert HTML to Markdown
   ============================================ */
class MarkdownExporter {
    constructor(editor) {
        this._editor = editor;
    }

    convert() {
        const el = this._editor.editorEl.cloneNode(true);
        return this._processNode(el).trim();
    }

    _processNode(node) {
        let result = '';
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === Node.TEXT_NODE) {
                result += child.textContent;
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                result += this._convertElement(child);
            }
        }
        return result;
    }

    _convertElement(el) {
        const tag = el.tagName.toLowerCase();
        const inner = this._processNode(el);

        switch (tag) {
            case 'h1': return `# ${inner.trim()}\n\n`;
            case 'h2': return `## ${inner.trim()}\n\n`;
            case 'h3': return `### ${inner.trim()}\n\n`;
            case 'h4': return `#### ${inner.trim()}\n\n`;
            case 'h5': return `##### ${inner.trim()}\n\n`;
            case 'h6': return `###### ${inner.trim()}\n\n`;
            case 'p': return `${inner.trim()}\n\n`;
            case 'br': return '\n';
            case 'hr': return '---\n\n';
            case 'strong': case 'b': return `**${inner}**`;
            case 'em': case 'i': return `*${inner}*`;
            case 'u': return `<u>${inner}</u>`;
            case 'del': case 's': case 'strike': return `~~${inner}~~`;
            case 'code': return `\`${inner}\``;
            case 'pre': {
                const code = el.querySelector('code');
                const text = code ? code.textContent : el.textContent;
                return `\`\`\`\n${text}\n\`\`\`\n\n`;
            }
            case 'blockquote': return inner.split('\n').filter(l => l.trim()).map(l => `> ${l.trim()}`).join('\n') + '\n\n';
            case 'a': return `[${inner}](${el.getAttribute('href') || ''})`;
            case 'img': return `![${el.getAttribute('alt') || ''}](${el.getAttribute('src') || ''})`;
            case 'ul': return this._convertList(el, false);
            case 'ol': return this._convertList(el, true);
            case 'li': return inner.trim();
            case 'table': return this._convertTable(el);
            case 'div': case 'span': case 'figure': case 'figcaption':
                return inner;
            case 'sub': return `<sub>${inner}</sub>`;
            case 'sup': return `<sup>${inner}</sup>`;
            default: return inner;
        }
    }

    _convertList(ul, ordered, depth = 0) {
        const items = Array.from(ul.children).filter(c => c.tagName === 'LI');
        const indent = '  '.repeat(depth);
        let result = '';
        items.forEach((li, i) => {
            const prefix = ordered ? `${i + 1}. ` : '- ';
            const subLists = li.querySelectorAll(':scope > ul, :scope > ol');
            let text = '';
            for (const child of li.childNodes) {
                if (child.nodeType === Node.ELEMENT_NODE && (child.tagName === 'UL' || child.tagName === 'OL')) {
                    continue;
                }
                if (child.nodeType === Node.TEXT_NODE) text += child.textContent;
                else if (child.nodeType === Node.ELEMENT_NODE) text += this._convertElement(child);
            }
            result += `${indent}${prefix}${text.trim()}\n`;
            subLists.forEach(sub => {
                result += this._convertList(sub, sub.tagName === 'OL', depth + 1);
            });
        });
        if (depth === 0) result += '\n';
        return result;
    }

    _convertTable(table) {
        const rows = Array.from(table.querySelectorAll('tr'));
        if (rows.length === 0) return '';
        let md = '';

        rows.forEach((row, i) => {
            const cells = Array.from(row.cells).map(c => this._processNode(c).trim());
            md += '| ' + cells.join(' | ') + ' |\n';
            if (i === 0) {
                md += '| ' + cells.map(() => '---').join(' | ') + ' |\n';
            }
        });

        return md + '\n';
    }

    download(filename = 'document.md') {
        const md = this.convert();
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}


/* ============================================
   COMMAND DEFINITIONS
   ============================================
   All editor commands are registered here. Each
   command is a function: (editor, value?) => void
   ============================================ */
function registerAllCommands(registry) {

    /* ----- Inline formatting ----- */

    const runNativeInlineCommand = (editor, command) => {
        if (!editor.selection.isInsideEditor()) {
            editor.editorEl.focus();
        }
        document.execCommand(command, false, null);
        editor.saveHistory();
        editor.events.emit('change');
    };

    registry.register('bold', (editor) => runNativeInlineCommand(editor, 'bold'));
    registry.register('italic', (editor) => runNativeInlineCommand(editor, 'italic'));
    registry.register('underline', (editor) => runNativeInlineCommand(editor, 'underline'));
    registry.register('strikethrough', (editor) => runNativeInlineCommand(editor, 'strikeThrough'));
    registry.register('superscript', (editor) => runNativeInlineCommand(editor, 'superscript'));
    registry.register('subscript', (editor) => runNativeInlineCommand(editor, 'subscript'));

    /* ----- Clear Formatting ----- */
    registry.register('clearFormatting', (editor) => {
        const sel = editor.selection;
        const range = sel.getRange();
        if (!range || range.collapsed) return;

        const text = sel.getSelectedText();
        range.deleteContents();
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);
        /* Select the text */
        const newRange = document.createRange();
        newRange.selectNode(textNode);
        const s = sel.getSelection();
        s.removeAllRanges();
        s.addRange(newRange);
        editor.saveHistory();
        editor.events.emit('change');
    });

    /* ----- Format Block ----- */
    registry.register('formatBlock', (editor, value) => {
        const sel = editor.selection;
        if (!sel.isInsideEditor()) { editor.editorEl.focus(); }
        const block = sel.getClosestBlock();
        if (!block) {
            /* Wrap in new element */
            const el = document.createElement(value);
            sel.wrapSelection(value.toLowerCase());
            editor.saveHistory();
            editor.events.emit('change');
            return;
        }
        /* Change the block tag */
        const newEl = document.createElement(value);
        newEl.innerHTML = block.innerHTML;
        /* Copy alignment style */
        if (block.style.textAlign) newEl.style.textAlign = block.style.textAlign;
        block.parentNode.replaceChild(newEl, block);
        /* Place cursor in new element */
        const range = document.createRange();
        range.selectNodeContents(newEl);
        range.collapse(false);
        const s = sel.getSelection();
        s.removeAllRanges();
        s.addRange(range);
        editor.saveHistory();
        editor.events.emit('change');
    });

    /* ----- Blockquote ----- */
    registry.register('blockquote', (editor) => {
        registry.execute('formatBlock', editor, 'BLOCKQUOTE');
    });

    /* ----- Code Block ----- */
    registry.register('codeBlock', (editor) => {
        const sel = editor.selection;
        if (!sel.isInsideEditor()) editor.editorEl.focus();
        const existing = sel.findAncestorTag('PRE');
        if (existing) {
            /* Convert back to paragraph */
            const p = document.createElement('p');
            p.innerHTML = existing.textContent;
            existing.parentNode.replaceChild(p, existing);
        } else {
            const block = sel.getClosestBlock();
            const pre = document.createElement('pre');
            const code = document.createElement('code');
            code.textContent = block ? block.textContent : '\u200B';
            pre.appendChild(code);
            if (block) {
                block.parentNode.replaceChild(pre, block);
            } else {
                sel.insertNode(pre);
            }
        }
        editor.saveHistory();
        editor.events.emit('change');
    });

    /* ----- Font Family ----- */
    registry.register('fontFamily', (editor, value) => {
        const sel = editor.selection;
        if (!sel.isInsideEditor()) return;
        const range = sel.getRange();
        if (!range) return;

        if (range.collapsed) {
            const span = document.createElement('span');
            span.style.fontFamily = value;
            span.textContent = '\u200B';
            range.insertNode(span);

            const newRange = document.createRange();
            newRange.setStart(span.firstChild, 1);
            newRange.collapse(true);
            const docSel = window.getSelection();
            docSel.removeAllRanges();
            docSel.addRange(newRange);
        } else {
            const span = sel.wrapSelection('span', { style: `font-family: ${value}` });
            if (span) span.style.fontFamily = value;
        }
        editor.saveHistory();
        editor.events.emit('change');
    });

    /* ----- Font Size ----- */
    registry.register('fontSize', (editor, value) => {
        const sel = editor.selection;
        if (!sel.isInsideEditor()) return;
        const range = sel.getRange();
        if (!range) return;

        if (range.collapsed) {
            const span = document.createElement('span');
            span.style.fontSize = value;
            span.textContent = '\u200B';
            range.insertNode(span);

            const newRange = document.createRange();
            newRange.setStart(span.firstChild, 1);
            newRange.collapse(true);
            const docSel = window.getSelection();
            docSel.removeAllRanges();
            docSel.addRange(newRange);
        } else {
            const span = sel.wrapSelection('span', { style: `font-size: ${value}` });
            if (span) span.style.fontSize = value;
        }
        editor.saveHistory();
        editor.events.emit('change');
    });

    /* ----- Text Color ----- */
    registry.register('foreColor', (editor, value) => {
        const sel = editor.selection;
        if (!sel.isInsideEditor()) return;
        if (sel.getRange()?.collapsed) {
            /* Insert zero-width span so next typed text uses this color */
            const span = document.createElement('span');
            span.style.color = value;
            span.textContent = '\u200B';
            const range = sel.getRange();
            range.insertNode(span);
            const newRange = document.createRange();
            newRange.setStart(span.firstChild, 1);
            newRange.collapse(true);
            const docSel = window.getSelection();
            docSel.removeAllRanges();
            docSel.addRange(newRange);
        } else {
            const span = sel.wrapSelection('span');
            if (span) span.style.color = value;
        }
        editor.saveHistory();
        editor.events.emit('change');
    });

    /* ----- Background Color ----- */
    registry.register('backColor', (editor, value) => {
        const sel = editor.selection;
        if (!sel.isInsideEditor()) return;
        const appliedColor = (value === 'transparent' || value === 'none') ? '#ffffff' : value;

        if (sel.getRange()?.collapsed) {
            /* Insert zero-width span so next typed text gets highlight */
            const span = document.createElement('span');
            span.style.backgroundColor = appliedColor;
            span.textContent = '\u200B';
            const range = sel.getRange();
            range.insertNode(span);
            const newRange = document.createRange();
            newRange.setStart(span.firstChild, 1);
            newRange.collapse(true);
            const docSel = window.getSelection();
            docSel.removeAllRanges();
            docSel.addRange(newRange);
        } else {
            const span = sel.wrapSelection('span');
            if (span) {
                span.style.backgroundColor = appliedColor;
            }
        }
        editor.saveHistory();
        editor.events.emit('change');
    });

    /* ----- Text Alignment ----- */
    const setAlign = (editor, align) => {
        const sel = editor.selection;
        const block = sel.getClosestBlock();
        if (block) {
            block.style.textAlign = align;
        }
        editor.saveHistory();
        editor.events.emit('change');
    };

    registry.register('alignLeft', (editor) => setAlign(editor, 'left'));
    registry.register('alignCenter', (editor) => setAlign(editor, 'center'));
    registry.register('alignRight', (editor) => setAlign(editor, 'right'));
    registry.register('alignJustify', (editor) => setAlign(editor, 'justify'));

    /* ----- Line Height ----- */
    registry.register('lineHeight', (editor, value) => {
        const sel = editor.selection;
        if (!sel.isInsideEditor()) return;
        const range = sel.getRange();
        if (!range) return;

        if (range.collapsed) {
            const span = document.createElement('span');
            span.style.lineHeight = value;
            span.textContent = '\u200B';
            range.insertNode(span);

            const newRange = document.createRange();
            newRange.setStart(span.firstChild, 1);
            newRange.collapse(true);
            const docSel = window.getSelection();
            docSel.removeAllRanges();
            docSel.addRange(newRange);
        } else {
            const span = sel.wrapSelection('span', { style: `line-height: ${value}` });
            if (span) span.style.lineHeight = value;
        }
        editor.saveHistory();
        editor.events.emit('change');
    });

    /* ----- Lists ----- */
    registry.register('orderedList', (editor) => {
        insertList(editor, 'ol');
    });

    registry.register('unorderedList', (editor) => {
        insertList(editor, 'ul');
    });

    function insertList(editor, listTag) {
        const sel = editor.selection;
        if (!sel.isInsideEditor()) editor.editorEl.focus();

        /* Check if already in this list type */
        const existingList = sel.findAncestorTag(listTag.toUpperCase());
        if (existingList) {
            /* Convert list items back to paragraphs */
            const items = existingList.querySelectorAll('li');
            const frag = document.createDocumentFragment();
            items.forEach(li => {
                const p = document.createElement('p');
                p.innerHTML = li.innerHTML;
                frag.appendChild(p);
            });
            existingList.parentNode.replaceChild(frag, existingList);
        } else {
            /* Create new list */
            const block = sel.getClosestBlock();
            const list = document.createElement(listTag);
            const li = document.createElement('li');

            if (block && block.tagName !== 'LI') {
                li.innerHTML = block.innerHTML;
                list.appendChild(li);
                block.parentNode.replaceChild(list, block);
            } else if (block && block.tagName === 'LI') {
                /* Toggle list type */
                const oldList = block.parentNode;
                const newList = document.createElement(listTag);
                while (oldList.firstChild) newList.appendChild(oldList.firstChild);
                oldList.parentNode.replaceChild(newList, oldList);
            } else {
                li.innerHTML = '<br>';
                list.appendChild(li);
                sel.insertNode(list);
            }

            /* Place cursor in first li */
            const firstLi = list.querySelector('li');
            if (firstLi) {
                const range = document.createRange();
                range.selectNodeContents(firstLi);
                range.collapse(false);
                const s = sel.getSelection();
                s.removeAllRanges();
                s.addRange(range);
            }
        }
        editor.saveHistory();
        editor.events.emit('change');
    }

    /* ----- Indent / Outdent ----- */
    registry.register('indent', (editor) => {
        const sel = editor.selection;
        const li = sel.findAncestorTag('LI');
        if (li) {
            /* Indent = nest in a new sub-list */
            const prevLi = li.previousElementSibling;
            if (prevLi) {
                const parentList = li.parentNode;
                const subListTag = parentList.tagName.toLowerCase();
                let subList = prevLi.querySelector(subListTag);
                if (!subList) {
                    subList = document.createElement(subListTag);
                    prevLi.appendChild(subList);
                }
                subList.appendChild(li);
            }
        } else {
            /* For non-list content, increase margin */
            const block = sel.getClosestBlock();
            if (block) {
                const current = parseInt(block.style.marginLeft) || 0;
                block.style.marginLeft = (current + 40) + 'px';
            }
        }
        editor.saveHistory();
        editor.events.emit('change');
    });

    registry.register('outdent', (editor) => {
        const sel = editor.selection;
        const li = sel.findAncestorTag('LI');
        if (li) {
            const parentList = li.parentNode;
            const grandparentLi = parentList.parentNode?.closest?.('li');
            if (grandparentLi) {
                /* Move li out of nested list */
                const grandparentList = grandparentLi.parentNode;
                grandparentList.insertBefore(li, grandparentLi.nextSibling);
                if (parentList.children.length === 0) parentList.remove();
            }
        } else {
            const block = sel.getClosestBlock();
            if (block) {
                const current = parseInt(block.style.marginLeft) || 0;
                block.style.marginLeft = Math.max(0, current - 40) + 'px';
                if (parseInt(block.style.marginLeft) === 0) block.style.marginLeft = '';
            }
        }
        editor.saveHistory();
        editor.events.emit('change');
    });

    /* ----- Insert Link ----- */
    registry.register('insertLink', (editor) => {
        editor.selection.save();
        const selectedText = editor.selection.getSelectedText();
        const linkTextInput = document.getElementById('link-text');
        const linkUrlInput = document.getElementById('link-url');
        const linkTitleInput = document.getElementById('link-title');
        if (linkTextInput) linkTextInput.value = selectedText || '';
        if (linkUrlInput) linkUrlInput.value = '';
        if (linkTitleInput) linkTitleInput.value = '';
        editor.modal.open('modal-link');
    });

    /* ----- Remove Link ----- */
    registry.register('removeLink', (editor) => {
        const anchor = editor.selection.findAncestorTag('A');
        if (anchor) {
            editor.selection.unwrap(anchor);
            editor.saveHistory();
            editor.events.emit('change');
        }
    });

    /* ----- Insert Image ----- */
    registry.register('insertImage', (editor) => {
        editor.selection.save();
        /* Reset modal state */
        const fileInput = document.getElementById('image-file-input');
        const urlInput = document.getElementById('image-url');
        const altInput = document.getElementById('image-alt');
        const widthInput = document.getElementById('image-width');
        const preview = document.getElementById('image-preview');
        const previewContainer = document.getElementById('image-preview-container');
        if (fileInput) fileInput.value = '';
        if (urlInput) urlInput.value = '';
        if (altInput) altInput.value = '';
        if (widthInput) widthInput.value = '';
        if (preview) preview.src = '';
        if (previewContainer) previewContainer.style.display = 'none';
        editor.modal.open('modal-image');
    });

    /* ----- Insert Table ----- */
    registry.register('insertTable', (editor) => {
        editor.selection.save();
        editor.modal.open('modal-table');
    });

    /* ----- Insert HTML Code ----- */
    registry.register('insertHtmlCode', (editor) => {
        editor.selection.save();
        const htmlInput = document.getElementById('html-code-input');
        if (htmlInput) htmlInput.value = '';
        editor.modal.open('modal-html-code');
    });

    /* ----- Insert Horizontal Rule ----- */
    registry.register('insertHR', (editor) => {
        const hr = document.createElement('hr');
        editor.selection.insertNode(hr);
        /* Add a paragraph after for continued editing */
        const p = document.createElement('p');
        p.innerHTML = '<br>';
        if (hr.nextSibling) {
            hr.parentNode.insertBefore(p, hr.nextSibling);
        } else {
            hr.parentNode.appendChild(p);
        }
        /* Place cursor in the new paragraph */
        const range = document.createRange();
        range.setStart(p, 0);
        range.collapse(true);
        const sel = editor.selection.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        editor.saveHistory();
        editor.events.emit('change');
    });

    /* ----- Undo / Redo ----- */
    registry.register('undo', (editor) => {
        const current = editor.editorEl.innerHTML;
        const snapshot = editor.history.undo(current);
        if (snapshot !== null) {
            editor.history.lock();
            editor.editorEl.innerHTML = snapshot;
            editor.history.unlock();
            editor.events.emit('change');
        }
    });

    registry.register('redo', (editor) => {
        const current = editor.editorEl.innerHTML;
        const snapshot = editor.history.redo(current);
        if (snapshot !== null) {
            editor.history.lock();
            editor.editorEl.innerHTML = snapshot;
            editor.history.unlock();
            editor.events.emit('change');
        }
    });

    /* ----- Source View Toggle ----- */
    registry.register('sourceView', (editor) => {
        editor.toggleSourceView();
    });

    /* ----- Fullscreen ----- */
    registry.register('fullscreen', (editor) => {
        editor.toggleFullscreen();
    });

    /* ----- Dark Mode ----- */
    registry.register('darkMode', (editor) => {
        editor.toggleDarkMode();
    });

    /* ----- Emoji ----- */
    registry.register('emoji', (editor) => {
        const btn = editor.toolbarEl.querySelector('[data-command="emoji"]');
        editor.emoji.toggle(btn);
    });

    /* ----- Export Commands ----- */
    registry.register('exportHTML', (editor) => editor.exporter.copyHTML());
    registry.register('exportText', (editor) => editor.exporter.copyText());
    registry.register('downloadHTML', (editor) => editor.exporter.downloadHTML());
    registry.register('downloadText', (editor) => editor.exporter.downloadText());

    /* ----- Cut / Copy / Paste (context menu) ----- */
    registry.register('cut', () => document.execCommand('cut'));
    registry.register('copy', () => document.execCommand('copy'));
    registry.register('paste', async () => {
        try {
            const text = await navigator.clipboard.readText();
            document.execCommand('insertText', false, text);
        } catch (e) {
            /* Fallback handled by browser */
        }
    });

    /* ----- Table Context Menu Commands ----- */
    registry.register('tableRowAbove', (editor) => editor.table.insertRow('above'));
    registry.register('tableRowBelow', (editor) => editor.table.insertRow('below'));
    registry.register('tableColLeft', (editor) => editor.table.insertCol('left'));
    registry.register('tableColRight', (editor) => editor.table.insertCol('right'));
    registry.register('tableDeleteRow', (editor) => editor.table.deleteRow());
    registry.register('tableDeleteCol', (editor) => editor.table.deleteCol());
    registry.register('tableDelete', (editor) => editor.table.deleteTable());
    registry.register('tableMergeCells', (editor) => editor.table.mergeCells());
    registry.register('tableSplitCell', (editor) => editor.table.splitCell());
    registry.register('tableSelectRow', (editor) => editor.table.selectRow());
    registry.register('tableSelectCol', (editor) => editor.table.selectCol());
    registry.register('tableSelectAll', (editor) => editor.table.selectAllCells());

    /* ----- Find & Replace ----- */
    registry.register('findReplace', (editor) => editor.findReplace.toggle());

    /* ----- Print ----- */
    registry.register('print', () => window.print());

    /* ----- Select All ----- */
    registry.register('selectAll', (editor) => {
        const range = document.createRange();
        range.selectNodeContents(editor.editorEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    });

    /* ----- Text Case Commands ----- */
    const changeCase = (editor, transformer) => {
        const sel = editor.selection;
        const text = sel.getSelectedText();
        if (!text) return;
        const range = sel.getRange();
        if (!range) return;
        range.deleteContents();
        const textNode = document.createTextNode(transformer(text));
        range.insertNode(textNode);
        const newRange = document.createRange();
        newRange.selectNode(textNode);
        const s = sel.getSelection();
        s.removeAllRanges();
        s.addRange(newRange);
        editor.saveHistory();
        editor.events.emit('change');
    };

    registry.register('textCaseUpper', (editor) => changeCase(editor, t => t.toUpperCase()));
    registry.register('textCaseLower', (editor) => changeCase(editor, t => t.toLowerCase()));
    registry.register('textCaseTitle', (editor) => changeCase(editor, t =>
        t.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    ));
    registry.register('textCaseSentence', (editor) => changeCase(editor, t =>
        t.toLowerCase().replace(/(^\s*\w|[.!?]\s+\w)/g, c => c.toUpperCase())
    ));

    /* ----- Special Characters ----- */
    registry.register('specialChars', (editor) => {
        const btn = editor.toolbarEl.querySelector('[data-command="specialChars"]');
        editor.specialChars.toggle(btn);
    });

    /* ----- Insert Date/Time ----- */
    registry.register('insertDateTime', (editor) => {
        const btn = editor.toolbarEl.querySelector('[data-command="insertDateTime"]');
        editor.dateTimePicker.toggle(btn);
    });

    /* ----- Table of Contents ----- */
    registry.register('insertTOC', (editor) => {
        const headings = editor.editorEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
        if (headings.length === 0) return;

        /* Remove existing TOC if present */
        const existingTOC = editor.editorEl.querySelector('.rte-toc');
        if (existingTOC) existingTOC.remove();

        const toc = document.createElement('div');
        toc.className = 'rte-toc';
        toc.contentEditable = 'false';
        const title = document.createElement('div');
        title.className = 'rte-toc-title';
        title.textContent = 'Table of Contents';
        toc.appendChild(title);

        const ul = document.createElement('ul');
        headings.forEach((h, i) => {
            const id = 'heading-' + i;
            h.id = id;
            const level = parseInt(h.tagName.charAt(1));
            const li = document.createElement('li');
            li.style.paddingLeft = ((level - 1) * 16) + 'px';
            const a = document.createElement('a');
            a.href = '#' + id;
            a.textContent = h.textContent;
            a.addEventListener('click', (e) => {
                e.preventDefault();
                h.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
            li.appendChild(a);
            ul.appendChild(li);
        });
        toc.appendChild(ul);

        /* Insert at top of editor */
        editor.editorEl.insertBefore(toc, editor.editorEl.firstChild);
        editor.saveHistory();
        editor.events.emit('change');
    });

    /* ----- Focus Mode ----- */
    registry.register('focusMode', (editor) => {
        editor.toggleFocusMode();
    });

    /* ----- Reading Mode ----- */
    registry.register('readingMode', (editor) => {
        editor.toggleReadingMode();
    });

    /* ----- Keyboard Shortcuts Help ----- */
    registry.register('keyboardHelp', (editor) => {
        editor.shortcutsHelp.show();
    });


    /* ----- Download Markdown ----- */
    registry.register('downloadMarkdown', (editor) => {
        editor.markdownExporter.download();
    });

    /* ----- Download PDF (Print) ----- */
    registry.register('downloadPDF', () => window.print());
}


/* ============================================
   RichTextEditor — Main editor class (Orchestrator)
   ============================================ */
class RichTextEditor {
    /**
     * @param {Object} options
     * @param {string} [options.selector='#editor-root'] root container selector
     * @param {boolean} [options.autoFocus=true]
     * @param {boolean} [options.autoSave=true]
     * @param {number} [options.autoSaveInterval=3000]
     * @param {string} [options.storageKey='rte-draft']
     * @param {boolean} [options.restoreDraft=true]
     * @param {boolean} [options.darkMode=false]
     */
    constructor(options = {}) {
        const opts = Object.assign({
            selector: '#editor-root',
            autoFocus: true,
            autoSave: true,
            autoSaveInterval: 3000,
            storageKey: 'rte-draft',
            restoreDraft: true,
            darkMode: false,
        }, options);

        /* Root element */
        this.root = document.querySelector(opts.selector);
        if (!this.root) throw new Error(`Editor root not found: ${opts.selector}`);

        /* Key elements */
        this.editorEl = this.root.querySelector('.rte-editor');
        this.sourceEl = this.root.querySelector('.rte-source');
        this.toolbarEl = this.root.querySelector('.rte-toolbar');
        this.statusBar = this.root.querySelector('.rte-statusbar');

        /* State */
        this._isFullscreen = false;
        this._isDarkMode = opts.darkMode;
        this._isFocusMode = false;
        this._isReadingMode = false;

        /* Initialize modules */
        this.events = new EventBus();
        this.sanitizer = new Sanitizer();
        this.history = new HistoryManager({ events: this.events });
        this.storage = new StorageManager({ key: opts.storageKey, interval: opts.autoSaveInterval, events: this.events });
        this.selection = new SelectionMgr(this.editorEl);
        this.commands = new CommandRegistry();
        this.modal = new ModalManager(this);
        this.table = new TableManager(this);
        this.emoji = new EmojiPicker(this);
        this.contextMenu = new ContextMenuManager(this);
        this.exporter = new ExportManager(this);
        this.dragDrop = new DragDropHandler(this);
        this.pasteHandler = new PasteHandler(this);
        this.imageResizer = new ImageResizer(this);
        this.plugins = new PluginManager(this);
        this.toolbar = new ToolbarManager({ toolbarEl: this.toolbarEl, editor: this });
        this.colorPicker = new ColorPickerPanel(this);
        this.findReplace = new FindReplaceManager(this);
        this.specialChars = new SpecialCharsPicker(this);
        this.dateTimePicker = new DateTimePicker(this);
        this.shortcutsHelp = new KeyboardShortcutsHelp(this);
        this.wordCountGoal = new WordCountGoal(this);
        this.markdownExporter = new MarkdownExporter(this);

        this._enhanceAccessibility();

        /* Register all commands */
        registerAllCommands(this.commands);

        /* Bind editor events */
        this._bindEditorEvents();
        this._bindModalEvents();
        this._bindKeyboardShortcuts();

        /* Initialize table column resize */
        this.table.initResize(this.editorEl);

        /* Restore draft */
        if (opts.restoreDraft && this.storage.hasDraft()) {
            const draft = this.storage.restore();
            if (draft) {
                this.editorEl.innerHTML = this.sanitizer.sanitize(draft);
            }
        }

        /* Save initial state */
        this.history.save(this.editorEl.innerHTML);

        /* Auto-save */
        if (opts.autoSave) {
            this.storage.startAutoSave(() => this.editorEl.innerHTML);
        }

        /* Dark mode */
        if (opts.darkMode) {
            this.root.classList.add('dark-mode');
        }

        /* Auto focus */
        if (opts.autoFocus) {
            setTimeout(() => this.editorEl.focus(), 100);
        }

        /* Storage saved indicator */
        this.events.on('storage:saved', () => {
            const el = document.getElementById('autosave-status');
            if (el) {
                el.textContent = 'Draft saved';
                el.classList.add('visible');
                setTimeout(() => el.classList.remove('visible'), 2000);
            }
        });

        /* History change: update toolbar undo/redo state */
        this.events.on('history:change', () => {
            this.toolbar.updateState();
        });

        this.events.on('change', () => {
            this._updateCounters();
        });

        /* Update counters initially */
        this._updateCounters();
    }

    /* ========== Public API ========== */

    /** Execute a registered command */
    execCommand(name, value) {
        this.commands.execute(name, this, value);
        /* Update toolbar state after command execution */
        setTimeout(() => this.toolbar.updateState(), 10);
    }

    /** Save current state to history */
    saveHistory() {
        this.history.save(this.editorEl.innerHTML);
    }

    /** Get editor HTML content (sanitized) */
    getHTML() {
        return this.sanitizer.sanitize(this.editorEl.innerHTML);
    }

    /** Get editor plain text content */
    getText() {
        return this.editorEl.innerText || '';
    }

    /** Set editor content */
    setContent(html) {
        this.editorEl.innerHTML = this.sanitizer.sanitize(html);
        this.saveHistory();
        this.events.emit('change');
    }

    /** Toggle source code view - opens modal */
    toggleSourceView() {
        const sourceInput = document.getElementById('source-code-input');
        const lineNumbers = document.getElementById('source-line-numbers');
        const sourceInfo = document.getElementById('source-info');

        if (!sourceInput) return;

        /* Populate modal with current HTML */
        const html = this._formatHTML(this.editorEl.innerHTML);
        sourceInput.value = html;

        /* Update line numbers */
        this._updateSourceLineNumbers(sourceInput, lineNumbers);

        /* Update info */
        if (sourceInfo) {
            const lines = html.split('\n').length;
            const chars = html.length;
            sourceInfo.textContent = `HTML Source • ${lines} lines • ${chars.toLocaleString()} chars`;
        }

        /* Bind line number updates */
        sourceInput.oninput = () => this._updateSourceLineNumbers(sourceInput, lineNumbers);
        sourceInput.onscroll = () => {
            if (lineNumbers) lineNumbers.scrollTop = sourceInput.scrollTop;
        };

        /* Open modal */
        this.modal.open('modal-source-view');
        setTimeout(() => sourceInput.focus(), 100);
    }

    _updateSourceLineNumbers(textarea, lineNumbersEl) {
        if (!textarea || !lineNumbersEl) return;
        const lines = textarea.value.split('\n').length;
        const nums = [];
        for (let i = 1; i <= lines; i++) nums.push(i);
        lineNumbersEl.innerHTML = nums.join('<br>');
    }

    /** Toggle fullscreen mode */
    toggleFullscreen() {
        this._isFullscreen = !this._isFullscreen;
        this.root.classList.toggle('fullscreen', this._isFullscreen);
        const btn = this.toolbarEl.querySelector('[data-command="fullscreen"]');
        if (btn) {
            btn.classList.toggle('active', this._isFullscreen);
            btn.setAttribute('aria-pressed', String(this._isFullscreen));
        }
        document.body.style.overflow = this._isFullscreen ? 'hidden' : '';
    }

    /** Toggle dark mode */
    toggleDarkMode() {
        this._isDarkMode = !this._isDarkMode;
        this.root.classList.toggle('dark-mode', this._isDarkMode);
        const btn = this.toolbarEl.querySelector('[data-command="darkMode"]');
        if (btn) {
            btn.classList.toggle('active', this._isDarkMode);
            btn.setAttribute('aria-pressed', String(this._isDarkMode));
        }
        this.events.emit('darkMode:change', this._isDarkMode);
    }

    /** Toggle focus/zen mode */
    toggleFocusMode() {
        /* Exit reading mode first if active */
        if (this._isReadingMode) this.toggleReadingMode();

        this._isFocusMode = !this._isFocusMode;
        this.root.classList.toggle('focus-mode', this._isFocusMode);
        const btn = this.toolbarEl.querySelector('[data-command="focusMode"]');
        if (btn) {
            btn.classList.toggle('active', this._isFocusMode);
            btn.setAttribute('aria-pressed', String(this._isFocusMode));
        }
        if (this._isFocusMode) this.editorEl.focus();
    }

    /** Toggle reading mode */
    toggleReadingMode() {
        /* Exit focus mode first if active */
        if (this._isFocusMode) this.toggleFocusMode();

        this._isReadingMode = !this._isReadingMode;
        this.root.classList.toggle('reading-mode', this._isReadingMode);
        this.editorEl.contentEditable = this._isReadingMode ? 'false' : 'true';
        const btn = this.toolbarEl.querySelector('[data-command="readingMode"]');
        if (btn) {
            btn.classList.toggle('active', this._isReadingMode);
            btn.setAttribute('aria-pressed', String(this._isReadingMode));
        }
        const exitBtn = document.getElementById('reading-mode-exit');
        if (exitBtn) exitBtn.style.display = this._isReadingMode ? 'block' : 'none';
    }

    /** Destroy editor — cleanup */
    destroy() {
        this.storage.stopAutoSave();
        this.events.emit('destroy');
    }

    /* ========== Private Methods ========== */

    _bindEditorEvents() {
        /* Input event — update counters, toolbar state, auto-save */
        this.editorEl.addEventListener('input', () => {
            this._updateCounters();
            this.toolbar.updateState();
            this.events.emit('change');
        });

        /* Reading Mode exit button */
        const exitBtn = document.getElementById('reading-mode-exit');
        if (exitBtn) {
            exitBtn.addEventListener('click', () => this.toggleReadingMode());
        }

        /* Debounced history save on input */
        let historyTimer = null;
        this.editorEl.addEventListener('input', () => {
            clearTimeout(historyTimer);
            historyTimer = setTimeout(() => this.saveHistory(), 500);
        });

        /* Selection change */
        document.addEventListener('selectionchange', () => {
            if (this.selection.isInsideEditor()) {
                this.toolbar.updateState();
            }
        });

        /* Focus / Blur events */
        this.editorEl.addEventListener('focus', () => {
            this.events.emit('focus');
        });

        this.editorEl.addEventListener('blur', () => {
            this.events.emit('blur');
        });

        /* Ensure editor always has at least a paragraph */
        this.editorEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                const sel = this.selection;
                const block = sel.getClosestBlock();

                /* Inside a pre/code block, just insert a newline */
                if (block && (block.tagName === 'PRE' || sel.findAncestorTag('PRE'))) {
                    e.preventDefault();
                    document.execCommand('insertLineBreak');
                    return;
                }
            }

            if (e.key === 'Backspace' || e.key === 'Delete') {
                if (this._isSelectionCoveringWholeEditor()) {
                    e.preventDefault();
                    this._resetToEmptyParagraph();
                    this.saveHistory();
                    this.events.emit('change');
                    return;
                }
            }

            /* Tab key for indent/outdent in lists */
            if (e.key === 'Tab') {
                const li = this.selection.findAncestorTag('LI');
                if (li) {
                    e.preventDefault();
                    if (e.shiftKey) {
                        this.execCommand('outdent');
                    } else {
                        this.execCommand('indent');
                    }
                }
            }
        });

        /* Ensure there's always a default block element */
        this.editorEl.addEventListener('keyup', () => {
            if (this.editorEl.innerHTML === '' || this.editorEl.innerHTML === '<br>') {
                this.editorEl.innerHTML = '<p><br></p>';
                const p = this.editorEl.querySelector('p');
                const range = document.createRange();
                range.setStart(p, 0);
                range.collapse(true);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            }
        });
    }

    _enhanceAccessibility() {
        this.root.setAttribute('role', 'region');
        this.root.setAttribute('aria-label', 'Rich text editor container');

        if (this.toolbarEl) {
            this.toolbarEl.setAttribute('role', 'toolbar');
            this.toolbarEl.setAttribute('aria-label', 'Rich text editor toolbar');
        }

        if (this.editorEl) {
            this.editorEl.setAttribute('role', 'textbox');
            this.editorEl.setAttribute('aria-multiline', 'true');
            this.editorEl.setAttribute('aria-label', 'Rich text editor');
        }

        if (this.sourceEl) {
            this.sourceEl.setAttribute('aria-label', 'HTML source editor');
            this.sourceEl.setAttribute('spellcheck', 'false');
        }

        const autosaveStatus = document.getElementById('autosave-status');
        if (autosaveStatus) {
            autosaveStatus.setAttribute('role', 'status');
            autosaveStatus.setAttribute('aria-live', 'polite');
        }

        const findBar = document.getElementById('rte-find-bar');
        if (findBar) {
            findBar.setAttribute('role', 'region');
            findBar.setAttribute('aria-label', 'Find and replace');
            findBar.setAttribute('aria-hidden', 'true');
        }

        this.root.querySelectorAll('button').forEach(btn => {
            if (!btn.hasAttribute('type')) btn.setAttribute('type', 'button');

            if (!btn.hasAttribute('aria-label')) {
                const labelFromTitle = btn.getAttribute('title')?.trim();
                const labelFromText = (btn.textContent || '').replace(/\s+/g, ' ').trim();
                const labelFromCommand = btn.dataset.command
                    ? btn.dataset.command.replace(/([A-Z])/g, ' $1').trim()
                    : '';
                const label = labelFromTitle || labelFromText || labelFromCommand;
                if (label) btn.setAttribute('aria-label', label);
            }
        });

        this.root.querySelectorAll('.rte-dropdown-toggle').forEach(toggle => {
            toggle.setAttribute('aria-haspopup', 'menu');
            toggle.setAttribute('aria-expanded', 'false');
        });

        ['sourceView', 'fullscreen', 'darkMode'].forEach(cmd => {
            const toggleBtn = this.toolbarEl?.querySelector(`[data-command="${cmd}"]`);
            if (toggleBtn) toggleBtn.setAttribute('aria-pressed', 'false');
        });

        this.root.querySelectorAll('.rte-modal-overlay').forEach(modal => {
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            modal.setAttribute('aria-hidden', 'true');

            const heading = modal.querySelector('.rte-modal-header h3');
            if (heading) {
                if (!heading.id) heading.id = `${modal.id}-title`;
                modal.setAttribute('aria-labelledby', heading.id);
            }
        });
    }

    _bindModalEvents() {
        /* ----- Link Modal ----- */
        const linkInsertBtn = document.getElementById('link-insert-btn');
        if (linkInsertBtn) {
            linkInsertBtn.addEventListener('click', () => {
                const url = document.getElementById('link-url')?.value?.trim();
                const text = document.getElementById('link-text')?.value?.trim();
                const title = document.getElementById('link-title')?.value?.trim();
                const newTab = document.getElementById('link-newtab')?.checked;

                if (!url) return;

                this.modal.close('modal-link');
                this.selection.restore();

                const a = document.createElement('a');
                a.href = url;
                a.textContent = text || url;
                if (title) a.title = title;
                if (newTab) {
                    a.target = '_blank';
                    a.rel = 'noopener noreferrer';
                }

                this.selection.insertNode(a);
                this.saveHistory();
                this.events.emit('change');
            });
        }

        /* ----- Image Modal ----- */
        this._setupImageModal();

        /* ----- HTML Code Modal ----- */
        this._setupHtmlCodeModal();

        /* ----- Source View Modal ----- */
        this._setupSourceViewModal();

        /* ----- Table Modal (handled in TableManager) ----- */
    }

    _setupSourceViewModal() {
        const sourceInput = document.getElementById('source-code-input');
        const applyBtn = document.getElementById('source-apply-btn');
        const copyBtn = document.getElementById('source-copy');
        const formatBtn = document.getElementById('source-format');

        if (!sourceInput) return;

        /* Apply changes */
        if (applyBtn) {
            applyBtn.addEventListener('click', () => {
                const html = this.sanitizer.sanitize(sourceInput.value);
                this.editorEl.innerHTML = html;
                this.modal.close('modal-source-view');
                this.editorEl.focus();
                this.saveHistory();
                this.events.emit('change');
                this._updateCounters();
            });
        }

        /* Copy to clipboard */
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(sourceInput.value).then(() => {
                    const originalText = copyBtn.innerHTML;
                    copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
                    setTimeout(() => {
                        copyBtn.innerHTML = originalText;
                    }, 1500);
                });
            });
        }

        /* Format code */
        if (formatBtn) {
            formatBtn.addEventListener('click', () => {
                sourceInput.value = this._formatHTML(sourceInput.value);
                this._updateSourceLineNumbers(sourceInput, document.getElementById('source-line-numbers'));
                sourceInput.focus();
            });
        }

        /* Handle Tab key for indentation */
        sourceInput.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = sourceInput.selectionStart;
                const end = sourceInput.selectionEnd;
                sourceInput.value = sourceInput.value.substring(0, start) + '  ' + sourceInput.value.substring(end);
                sourceInput.selectionStart = sourceInput.selectionEnd = start + 2;
                this._updateSourceLineNumbers(sourceInput, document.getElementById('source-line-numbers'));
            }
        });
    }

    _setupHtmlCodeModal() {
        const htmlInput = document.getElementById('html-code-input');
        const insertBtn = document.getElementById('html-insert-btn');
        const zoomInBtn = document.getElementById('html-zoom-in');
        const zoomOutBtn = document.getElementById('html-zoom-out');
        const zoomValue = document.getElementById('html-zoom-value');

        if (!htmlInput) return;

        let currentZoom = 100;
        const minZoom = 70;
        const maxZoom = 200;
        const step = 10;

        const applyZoom = () => {
            htmlInput.style.fontSize = `${Math.round((13 * currentZoom) / 100)}px`;
            if (zoomValue) zoomValue.textContent = `${currentZoom}%`;
            if (zoomOutBtn) zoomOutBtn.disabled = currentZoom <= minZoom;
            if (zoomInBtn) zoomInBtn.disabled = currentZoom >= maxZoom;
        };

        applyZoom();

        if (zoomInBtn) {
            zoomInBtn.addEventListener('click', () => {
                currentZoom = Math.min(maxZoom, currentZoom + step);
                applyZoom();
                htmlInput.focus();
            });
        }

        if (zoomOutBtn) {
            zoomOutBtn.addEventListener('click', () => {
                currentZoom = Math.max(minZoom, currentZoom - step);
                applyZoom();
                htmlInput.focus();
            });
        }

        const insertHtml = () => {
            const raw = htmlInput.value?.trim();
            if (!raw) return;

            const safeHtml = this.sanitizer.sanitize(raw);
            if (!safeHtml) return;

            this.modal.close('modal-html-code');
            this.selection.restore();
            this.selection.insertHTML(safeHtml);
            this.saveHistory();
            this.events.emit('change');
        };

        if (insertBtn) {
            insertBtn.addEventListener('click', insertHtml);
        }

        htmlInput.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'enter') {
                e.preventDefault();
                insertHtml();
            }
        });
    }

    _setupImageModal() {
        const uploadArea = document.getElementById('image-upload-area');
        const fileInput = document.getElementById('image-file-input');
        const preview = document.getElementById('image-preview');
        const previewContainer = document.getElementById('image-preview-container');
        const insertBtn = document.getElementById('image-insert-btn');
        const tabs = document.querySelectorAll('#modal-image .rte-tab');
        let imageData = null;

        /* Tab switching */
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById('tab-upload').style.display = tab.dataset.tab === 'upload' ? 'block' : 'none';
                document.getElementById('tab-upload').classList.toggle('active', tab.dataset.tab === 'upload');
                document.getElementById('tab-url').style.display = tab.dataset.tab === 'url' ? 'block' : 'none';
                document.getElementById('tab-url').classList.toggle('active', tab.dataset.tab === 'url');
            });
        });

        /* Upload area click */
        if (uploadArea) {
            uploadArea.addEventListener('click', () => fileInput?.click());

            /* Drag & drop on upload area */
            uploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadArea.classList.add('dragover');
            });
            uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
            uploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadArea.classList.remove('dragover');
                const file = e.dataTransfer.files[0];
                if (file && file.type.startsWith('image/')) {
                    this._readImageFile(file, (data) => {
                        imageData = data;
                        if (preview) preview.src = data;
                        if (previewContainer) previewContainer.style.display = 'block';
                    });
                }
            });
        }

        /* File input change */
        if (fileInput) {
            fileInput.addEventListener('change', () => {
                const file = fileInput.files[0];
                if (file) {
                    this._readImageFile(file, (data) => {
                        imageData = data;
                        if (preview) preview.src = data;
                        if (previewContainer) previewContainer.style.display = 'block';
                    });
                }
            });
        }

        /* Insert button */
        if (insertBtn) {
            insertBtn.addEventListener('click', () => {
                const urlInput = document.getElementById('image-url');
                const altInput = document.getElementById('image-alt');
                const widthInput = document.getElementById('image-width');
                const activeTab = document.querySelector('#modal-image .rte-tab.active');
                const isUpload = activeTab?.dataset.tab === 'upload';

                const src = isUpload ? imageData : urlInput?.value?.trim();
                if (!src) return;

                this.modal.close('modal-image');
                this.selection.restore();

                const img = document.createElement('img');
                img.src = src;
                img.alt = altInput?.value || '';
                const w = widthInput?.value?.trim();
                if (w) {
                    img.style.width = w.includes('%') ? w : w + 'px';
                }
                img.style.maxWidth = '100%';

                this.selection.insertNode(img);
                imageData = null;
                this.saveHistory();
                this.events.emit('change');
            });
        }
    }

    _readImageFile(file, callback) {
        const reader = new FileReader();
        reader.onload = (e) => callback(e.target.result);
        reader.readAsDataURL(file);
    }

    _bindKeyboardShortcuts() {
        this.editorEl.addEventListener('keydown', (e) => {
            const ctrl = e.ctrlKey || e.metaKey;
            if (!ctrl) return;

            const shortcuts = {
                'b': 'bold',
                'i': 'italic',
                'u': 'underline',
                'z': e.shiftKey ? 'redo' : 'undo',
                'y': 'redo',
                'k': 'insertLink',
                'h': 'findReplace',
                'f': 'findReplace',
                'p': 'print',
                '/': 'keyboardHelp',
            };

            const key = e.key.toLowerCase();
            if (shortcuts[key]) {
                e.preventDefault();
                this.execCommand(shortcuts[key]);
            }
        });

        /* Escape to exit fullscreen */
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this._isFullscreen) {
                this.toggleFullscreen();
            }
        });
    }

    _updateCounters() {
        const text = this.editorEl.innerText || '';
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        const chars = text.replace(/\n/g, '').length;
        const readingMins = Math.max(1, Math.ceil(words / 200));

        const wordEl = document.getElementById('word-count');
        const charEl = document.getElementById('char-count');
        const readEl = document.getElementById('reading-time');
        if (wordEl) wordEl.textContent = `Words: ${words}`;
        if (charEl) charEl.textContent = `Characters: ${chars}`;
        if (readEl) readEl.textContent = `Reading time: ${words === 0 ? '0' : readingMins} min`;

        /* Update word count goal progress */
        if (this.wordCountGoal) this.wordCountGoal.update(words);
    }

    _isSelectionCoveringWholeEditor() {
        const range = this.selection.getRange();
        if (!range) return false;
        if (!this.selection.isInsideEditor()) return false;

        const fullRange = document.createRange();
        fullRange.selectNodeContents(this.editorEl);

        const startsAtOrBeforeEditorStart = range.compareBoundaryPoints(Range.START_TO_START, fullRange) <= 0;
        const endsAtOrAfterEditorEnd = range.compareBoundaryPoints(Range.END_TO_END, fullRange) >= 0;

        return startsAtOrBeforeEditorStart && endsAtOrAfterEditorEnd;
    }

    _resetToEmptyParagraph() {
        this.editorEl.innerHTML = '<p><br></p>';
        const p = this.editorEl.querySelector('p');
        if (!p) return;

        const range = document.createRange();
        range.setStart(p, 0);
        range.collapse(true);

        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        this._updateCounters();
    }

    /** Simple HTML formatter for source view */
    _formatHTML(html) {
        let formatted = '';
        let indent = 0;
        const tab = '  ';

        /* Split HTML into tags and text */
        const tokens = html.replace(/>\s*</g, '>\n<').split('\n');

        tokens.forEach(token => {
            const trimmed = token.trim();
            if (!trimmed) return;

            /* Closing tag */
            if (/^<\//.test(trimmed)) {
                indent = Math.max(0, indent - 1);
            }

            formatted += tab.repeat(indent) + trimmed + '\n';

            /* Opening tag (not self-closing, not closing) */
            if (/^<[^/!][^>]*[^/]>$/.test(trimmed) && !/^<(br|hr|img|input|meta|link)/i.test(trimmed)) {
                indent++;
            }
        });

        return formatted.trim();
    }
}


/* ============================================
   INITIALIZATION
   ============================================ */
document.addEventListener('DOMContentLoaded', () => {
    /* Create the editor instance */
    const editor = new RichTextEditor({
        selector: '#editor-root',
        autoFocus: true,
        autoSave: true,
        autoSaveInterval: 3000,
        storageKey: 'rte-draft',
        restoreDraft: true,
        darkMode: false,
    });

    /* Expose globally for debugging / API access (optional) */
    window.rteEditor = editor;

    /* Example: listen to events */
    editor.events.on('change', () => {
        /* Content changed */
    });

    editor.events.on('focus', () => {
        /* Editor focused */
    });

    editor.events.on('blur', () => {
        /* Editor blurred */
    });

    /* Example: register a plugin */
    // editor.plugins.register({
    //     name: 'myPlugin',
    //     init(ed) { console.log('Plugin initialized', ed); },
    //     destroy(ed) { console.log('Plugin destroyed', ed); }
    // });
});
