/**
 * Grid — 7x24 Availability Matrix
 * Interactive click-and-drag grid for selecting weekly availability.
 */

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const HOUR_LABELS = [
    '12a', '1a', '2a', '3a', '4a', '5a', '6a', '7a', '8a', '9a', '10a', '11a',
    '12p', '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '10p', '11p',
];

/** @type {Set<string>} Active cells stored as "day-hour" strings */
let activeCells = new Set();

/** @type {HTMLElement|null} The grid container */
let gridEl = null;

// Drag state
let isDragging = false;
let paintMode = true; // true = activate, false = deactivate

/**
 * Initialize the interactive availability matrix.
 * @param {string} containerSelector - CSS selector for the container element
 * @param {Array<[number, number]>} [existingData] - Pre-selected [day, hour] pairs
 */
export function initMatrix(containerSelector, existingData) {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    activeCells = new Set();

    if (existingData) {
        for (const [day, hour] of existingData) {
            activeCells.add(`${day}-${hour}`);
        }
    }

    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'matrix-wrapper';

    gridEl = document.createElement('div');
    gridEl.className = 'matrix-grid';

    buildHeader(gridEl);
    buildRows(gridEl);
    applyActiveState();

    wrapper.appendChild(gridEl);

    // Legend
    const legend = document.createElement('div');
    legend.className = 'matrix-legend';
    legend.innerHTML = `
        <div class="matrix-legend-item">
            <div class="matrix-legend-swatch swatch-available"></div>
            <span>Available</span>
        </div>
        <div class="matrix-legend-item">
            <div class="matrix-legend-swatch swatch-unavailable"></div>
            <span>Unavailable</span>
        </div>
    `;
    wrapper.appendChild(legend);

    container.appendChild(wrapper);
    attachEventListeners(gridEl);
}

/**
 * Get current matrix state as array of [day, hour] pairs.
 * @returns {Array<[number, number]>}
 */
export function getMatrixData() {
    const result = [];
    for (const key of activeCells) {
        const [day, hour] = key.split('-').map(Number);
        result.push([day, hour]);
    }
    return result;
}

/**
 * Set matrix state from array of [day, hour] pairs.
 * @param {Array<[number, number]>} data
 */
export function setMatrixData(data) {
    activeCells.clear();
    if (data) {
        for (const [day, hour] of data) {
            activeCells.add(`${day}-${hour}`);
        }
    }
    applyActiveState();
}

/**
 * Initialize a read-only heatmap view (no interaction).
 * @param {string} containerSelector - CSS selector for the container
 * @param {Array<[number, number]>} data - Active [day, hour] pairs
 */
export function initReadOnlyMatrix(containerSelector, data) {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    activeCells = new Set();
    if (data) {
        for (const [day, hour] of data) {
            activeCells.add(`${day}-${hour}`);
        }
    }

    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'matrix-wrapper';

    const grid = document.createElement('div');
    grid.className = 'matrix-grid readonly';

    buildHeader(grid);
    buildRows(grid);

    // Apply active state
    const cells = grid.querySelectorAll('.matrix-cell');
    for (const cell of cells) {
        const key = `${cell.dataset.day}-${cell.dataset.hour}`;
        if (activeCells.has(key)) {
            cell.classList.add('active');
        }
    }

    wrapper.appendChild(grid);

    // Legend
    const legend = document.createElement('div');
    legend.className = 'matrix-legend';
    legend.innerHTML = `
        <div class="matrix-legend-item">
            <div class="matrix-legend-swatch swatch-available"></div>
            <span>Available</span>
        </div>
        <div class="matrix-legend-item">
            <div class="matrix-legend-swatch swatch-unavailable"></div>
            <span>Unavailable</span>
        </div>
    `;
    wrapper.appendChild(legend);

    container.appendChild(wrapper);
}

// ---- Internal: Build Grid Structure ----

function buildHeader(grid) {
    const header = document.createElement('div');
    header.className = 'matrix-header';

    // Top-left spacer
    const spacer = document.createElement('div');
    spacer.className = 'matrix-header-spacer';
    header.appendChild(spacer);

    // Hour labels
    for (let h = 0; h < 24; h++) {
        const label = document.createElement('div');
        label.className = 'matrix-hour-label';
        label.textContent = HOUR_LABELS[h];
        label.dataset.hour = h;
        header.appendChild(label);
    }

    grid.appendChild(header);
}

function buildRows(grid) {
    for (let d = 0; d < 7; d++) {
        const row = document.createElement('div');
        row.className = 'matrix-row';

        // Day label
        const label = document.createElement('div');
        label.className = 'matrix-label';
        label.textContent = DAY_LABELS[d];
        label.dataset.day = d;
        row.appendChild(label);

        // Hour cells
        for (let h = 0; h < 24; h++) {
            const cell = document.createElement('div');
            cell.className = 'matrix-cell';
            cell.dataset.day = d;
            cell.dataset.hour = h;
            row.appendChild(cell);
        }

        grid.appendChild(row);
    }
}

function applyActiveState() {
    if (!gridEl) return;
    const cells = gridEl.querySelectorAll('.matrix-cell');
    for (const cell of cells) {
        const key = `${cell.dataset.day}-${cell.dataset.hour}`;
        cell.classList.toggle('active', activeCells.has(key));
    }
}

// ---- Internal: Event Handling (delegated) ----

function attachEventListeners(grid) {
    // Mouse events (delegated)
    grid.addEventListener('mousedown', onPointerDown);
    grid.addEventListener('mouseenter', onPointerMove, true); // capture for delegation
    document.addEventListener('mouseup', onPointerUp);

    // Touch events
    grid.addEventListener('touchstart', onTouchStart, { passive: false });
    grid.addEventListener('touchmove', onTouchMove, { passive: false });
    grid.addEventListener('touchend', onTouchEnd);

    // Prevent text selection during drag
    grid.addEventListener('selectstart', (e) => {
        if (isDragging) e.preventDefault();
    });
}

function onPointerDown(e) {
    const cell = e.target.closest('.matrix-cell');
    if (cell) {
        e.preventDefault();
        isDragging = true;
        const key = `${cell.dataset.day}-${cell.dataset.hour}`;
        // Paint mode: if cell was inactive, we activate; if active, we deactivate
        paintMode = !activeCells.has(key);
        toggleCell(cell, key);
        return;
    }

    // Row header click — toggle entire day
    const dayLabel = e.target.closest('.matrix-label');
    if (dayLabel) {
        const day = dayLabel.dataset.day;
        toggleRow(Number(day));
        return;
    }

    // Column header click — toggle entire hour
    const hourLabel = e.target.closest('.matrix-hour-label');
    if (hourLabel) {
        const hour = hourLabel.dataset.hour;
        toggleColumn(Number(hour));
        return;
    }
}

function onPointerMove(e) {
    if (!isDragging) return;
    const cell = e.target.closest('.matrix-cell');
    if (!cell) return;
    const key = `${cell.dataset.day}-${cell.dataset.hour}`;
    applyPaint(cell, key);
}

function onPointerUp() {
    isDragging = false;
}

function onTouchStart(e) {
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!el) return;

    const cell = el.closest('.matrix-cell');
    if (cell) {
        e.preventDefault();
        isDragging = true;
        const key = `${cell.dataset.day}-${cell.dataset.hour}`;
        paintMode = !activeCells.has(key);
        toggleCell(cell, key);
    }
}

function onTouchMove(e) {
    if (!isDragging) return;
    e.preventDefault();
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!el) return;
    const cell = el.closest('.matrix-cell');
    if (!cell) return;
    const key = `${cell.dataset.day}-${cell.dataset.hour}`;
    applyPaint(cell, key);
}

function onTouchEnd() {
    isDragging = false;
}

function toggleCell(cell, key) {
    if (paintMode) {
        activeCells.add(key);
        cell.classList.add('active');
    } else {
        activeCells.delete(key);
        cell.classList.remove('active');
    }
}

function applyPaint(cell, key) {
    if (paintMode) {
        activeCells.add(key);
        cell.classList.add('active');
    } else {
        activeCells.delete(key);
        cell.classList.remove('active');
    }
}

function toggleRow(day) {
    // If all cells in the row are active, deactivate all; otherwise activate all
    let allActive = true;
    for (let h = 0; h < 24; h++) {
        if (!activeCells.has(`${day}-${h}`)) {
            allActive = false;
            break;
        }
    }

    for (let h = 0; h < 24; h++) {
        const key = `${day}-${h}`;
        if (allActive) {
            activeCells.delete(key);
        } else {
            activeCells.add(key);
        }
    }

    applyActiveState();
}

function toggleColumn(hour) {
    // If all cells in the column are active, deactivate all; otherwise activate all
    let allActive = true;
    for (let d = 0; d < 7; d++) {
        if (!activeCells.has(`${d}-${hour}`)) {
            allActive = false;
            break;
        }
    }

    for (let d = 0; d < 7; d++) {
        const key = `${d}-${hour}`;
        if (allActive) {
            activeCells.delete(key);
        } else {
            activeCells.add(key);
        }
    }

    applyActiveState();
}
