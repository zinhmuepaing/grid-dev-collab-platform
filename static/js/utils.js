/**
 * Grid — DOM Helpers & Utility Functions
 */

/**
 * Escape HTML entities to prevent XSS.
 * @param {string} str - Raw string
 * @returns {string} Escaped string safe for innerHTML
 */
export function escapeHtml(str) {
    if (str == null) return '';
    const s = String(str);
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    };
    return s.replace(/[&<>"']/g, (ch) => map[ch]);
}

/**
 * Standard debounce — delays invoking fn until ms milliseconds
 * have elapsed since the last call.
 * @param {Function} fn - Function to debounce
 * @param {number} ms - Delay in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(fn, ms) {
    let timerId = null;
    return function (...args) {
        clearTimeout(timerId);
        timerId = setTimeout(() => fn.apply(this, args), ms);
    };
}

/**
 * Format an ISO date string to a readable format like "Mar 22, 2026".
 * @param {string} isoString - ISO 8601 date string
 * @returns {string} Formatted date
 */
export function formatDate(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';
    const months = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/**
 * Format an ISO date string to a relative time string like "2 hours ago".
 * @param {string} isoString - ISO 8601 date string
 * @returns {string} Relative time string
 */
export function formatRelativeTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';

    const now = Date.now();
    const diffMs = now - date.getTime();

    // Future dates
    if (diffMs < 0) return 'just now';

    const seconds = Math.floor(diffMs / 1000);
    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${seconds} seconds ago`;

    const minutes = Math.floor(seconds / 60);
    if (minutes === 1) return '1 minute ago';
    if (minutes < 60) return `${minutes} minutes ago`;

    const hours = Math.floor(minutes / 60);
    if (hours === 1) return '1 hour ago';
    if (hours < 24) return `${hours} hours ago`;

    const days = Math.floor(hours / 24);
    if (days === 1) return '1 day ago';
    if (days < 30) return `${days} days ago`;

    const months = Math.floor(days / 30);
    if (months === 1) return '1 month ago';
    if (months < 12) return `${months} months ago`;

    const years = Math.floor(months / 12);
    if (years === 1) return '1 year ago';
    return `${years} years ago`;
}

/**
 * Shorthand for document.querySelector.
 * @param {string} selector - CSS selector
 * @returns {Element|null}
 */
export function $(selector) {
    return document.querySelector(selector);
}

/**
 * Shorthand for document.querySelectorAll.
 * @param {string} selector - CSS selector
 * @returns {NodeList}
 */
export function $$(selector) {
    return document.querySelectorAll(selector);
}

/**
 * Create a DOM element with attributes and children.
 * @param {string} tag - HTML tag name
 * @param {object} [attrs] - Attribute key/value pairs. Special keys:
 *   - "class" or "className": sets className
 *   - "dataset": object of data-* attributes
 *   - event listeners via "onclick", "onchange", etc.
 *   - all others set as attributes via setAttribute
 * @param {Array<Node|string>} [children] - Child nodes or text strings
 * @returns {HTMLElement}
 */
export function createElement(tag, attrs, children) {
    const el = document.createElement(tag);

    if (attrs) {
        for (const [key, value] of Object.entries(attrs)) {
            if (key === 'class' || key === 'className') {
                el.className = value;
            } else if (key === 'dataset') {
                for (const [dataKey, dataValue] of Object.entries(value)) {
                    el.dataset[dataKey] = dataValue;
                }
            } else if (key.startsWith('on') && typeof value === 'function') {
                el.addEventListener(key.slice(2).toLowerCase(), value);
            } else {
                el.setAttribute(key, value);
            }
        }
    }

    if (children) {
        for (const child of children) {
            if (typeof child === 'string') {
                el.appendChild(document.createTextNode(child));
            } else if (child instanceof Node) {
                el.appendChild(child);
            }
        }
    }

    return el;
}

/**
 * Scroll an element to the bottom, but only if the user is already
 * near the bottom (within 100px). Prevents jarring jumps when
 * the user is reading scroll history.
 * @param {HTMLElement} element - Scrollable container
 */
export function scrollToBottom(element) {
    if (!element) return;
    const threshold = 100;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distanceFromBottom <= threshold) {
        element.scrollTop = element.scrollHeight;
    }
}
