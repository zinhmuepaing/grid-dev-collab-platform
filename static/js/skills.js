/**
 * Grid — Tag-Input Skill Picker with Autocomplete
 * Fetches the master skill list, provides filtered autocomplete,
 * and manages selected skills with proficiency levels.
 */

import api from './api.js';
import { escapeHtml } from './utils.js';

/** @type {Array<{id: number, name: string}>} Master list of all skills */
let masterSkills = [];

/** @type {Array<{skill_id: number, name: string, level: string}>} Currently selected skills */
let selectedSkills = [];

/** @type {HTMLElement|null} */
let containerEl = null;

/** @type {HTMLElement|null} */
let inputEl = null;

/** @type {HTMLElement|null} */
let dropdownEl = null;

/** @type {HTMLElement|null} */
let badgesEl = null;

/** @type {number} Index of the currently highlighted dropdown item (-1 = none) */
let highlightIndex = -1;

/**
 * Initialize the skill picker component.
 * @param {string} containerSelector - CSS selector for the container
 * @param {Array<{id: number, name: string, level: string}>} [existingSkills] - Pre-populated skills
 */
export async function initSkillPicker(containerSelector, existingSkills) {
    containerEl = document.querySelector(containerSelector);
    if (!containerEl) return;

    selectedSkills = [];
    containerEl.innerHTML = '';

    // Build the component structure
    badgesEl = document.createElement('div');
    badgesEl.className = 'skill-badges';

    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'skill-input-wrapper';
    inputWrapper.style.position = 'relative';

    inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.className = 'skill-input';
    inputEl.placeholder = 'Type to search skills...';
    inputEl.autocomplete = 'off';

    dropdownEl = document.createElement('div');
    dropdownEl.className = 'skill-dropdown';
    dropdownEl.style.display = 'none';

    inputWrapper.appendChild(inputEl);
    inputWrapper.appendChild(dropdownEl);

    containerEl.appendChild(badgesEl);
    containerEl.appendChild(inputWrapper);

    // Fetch master skill list
    try {
        const data = await api.get('/api/users/skills/all');
        masterSkills = data.skills || [];
    } catch (err) {
        console.error('Failed to fetch skills:', err);
        masterSkills = [];
    }

    // Pre-populate existing skills
    if (existingSkills && existingSkills.length > 0) {
        for (const skill of existingSkills) {
            addSkill(skill.id, skill.name, skill.level || 'intermediate');
        }
    }

    // Attach event listeners
    inputEl.addEventListener('input', onInput);
    inputEl.addEventListener('keydown', onKeyDown);
    inputEl.addEventListener('focus', onInput);

    // Close dropdown on click outside
    document.addEventListener('click', onDocumentClick);

    // Close on Escape
    document.addEventListener('keydown', onDocumentKeyDown);
}

/**
 * Get selected skills formatted for API submission.
 * @returns {Array<{skill_id: number, level: string}>}
 */
export function getSelectedSkills() {
    return selectedSkills.map((s) => ({
        skill_id: s.skill_id,
        level: s.level,
    }));
}

// ---- Internal: Event Handlers ----

function onInput() {
    const query = inputEl.value.trim().toLowerCase();
    highlightIndex = -1;

    if (query.length === 0) {
        hideDropdown();
        return;
    }

    const selectedIds = new Set(selectedSkills.map((s) => s.skill_id));
    const matches = masterSkills.filter(
        (skill) => skill.name.toLowerCase().includes(query) && !selectedIds.has(skill.id)
    );

    if (matches.length === 0) {
        hideDropdown();
        return;
    }

    renderDropdown(matches.slice(0, 10));
}

function onKeyDown(e) {
    if (dropdownEl.style.display === 'none') return;

    const items = dropdownEl.querySelectorAll('.skill-dropdown-item');

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlightIndex = Math.min(highlightIndex + 1, items.length - 1);
        updateHighlight(items);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightIndex = Math.max(highlightIndex - 1, 0);
        updateHighlight(items);
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightIndex >= 0 && highlightIndex < items.length) {
            const item = items[highlightIndex];
            selectFromDropdown(Number(item.dataset.skillId), item.dataset.skillName);
        }
    } else if (e.key === 'Escape') {
        hideDropdown();
    }
}

function onDocumentClick(e) {
    if (!containerEl) return;
    if (!containerEl.contains(e.target)) {
        hideDropdown();
    }
}

function onDocumentKeyDown(e) {
    if (e.key === 'Escape') {
        hideDropdown();
    }
}

// ---- Internal: Dropdown Rendering ----

function renderDropdown(matches) {
    dropdownEl.innerHTML = '';
    for (const skill of matches) {
        const item = document.createElement('div');
        item.className = 'skill-dropdown-item';
        item.dataset.skillId = skill.id;
        item.dataset.skillName = skill.name;
        item.textContent = skill.name;
        item.addEventListener('mousedown', (e) => {
            // mousedown instead of click to fire before blur
            e.preventDefault();
            selectFromDropdown(skill.id, skill.name);
        });
        dropdownEl.appendChild(item);
    }
    dropdownEl.style.display = 'block';
}

function updateHighlight(items) {
    for (let i = 0; i < items.length; i++) {
        items[i].classList.toggle('highlighted', i === highlightIndex);
    }
}

function hideDropdown() {
    if (dropdownEl) {
        dropdownEl.style.display = 'none';
        dropdownEl.innerHTML = '';
    }
    highlightIndex = -1;
}

function selectFromDropdown(skillId, skillName) {
    addSkill(skillId, skillName, 'intermediate');
    inputEl.value = '';
    hideDropdown();
    inputEl.focus();
}

// ---- Internal: Skill Badge Management ----

function addSkill(skillId, skillName, level) {
    // Prevent duplicates
    if (selectedSkills.some((s) => s.skill_id === skillId)) return;

    const skillEntry = { skill_id: skillId, name: skillName, level: level };
    selectedSkills.push(skillEntry);

    renderBadge(skillEntry);
}

function removeSkill(skillId) {
    selectedSkills = selectedSkills.filter((s) => s.skill_id !== skillId);
    const badge = badgesEl.querySelector(`[data-skill-id="${skillId}"]`);
    if (badge) badge.remove();
}

function renderBadge(skillEntry) {
    const badge = document.createElement('span');
    badge.className = 'skill-badge';
    badge.dataset.skillId = skillEntry.skill_id;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'skill-badge-name';
    nameSpan.textContent = skillEntry.name;

    const levelSelect = document.createElement('select');
    levelSelect.className = 'skill-badge-level';
    levelSelect.title = 'Proficiency level';
    const levels = [
        { value: 'beginner', label: 'Beginner' },
        { value: 'intermediate', label: 'Intermediate' },
        { value: 'advanced', label: 'Advanced' },
    ];
    for (const lvl of levels) {
        const opt = document.createElement('option');
        opt.value = lvl.value;
        opt.textContent = lvl.label;
        if (lvl.value === skillEntry.level) opt.selected = true;
        levelSelect.appendChild(opt);
    }
    levelSelect.addEventListener('change', () => {
        const entry = selectedSkills.find((s) => s.skill_id === skillEntry.skill_id);
        if (entry) entry.level = levelSelect.value;
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'skill-badge-remove';
    removeBtn.innerHTML = '&times;';
    removeBtn.title = 'Remove skill';
    removeBtn.addEventListener('click', () => {
        removeSkill(skillEntry.skill_id);
    });

    badge.appendChild(nameSpan);
    badge.appendChild(levelSelect);
    badge.appendChild(removeBtn);

    badgesEl.appendChild(badge);
}
