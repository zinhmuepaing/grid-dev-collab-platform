/**
 * Grid — Events Page & Event Detail
 * Browse/search hackathons, interest toggle, match-ranked user lists.
 */

import api from './api.js';
import { escapeHtml, debounce, formatDate, $ } from './utils.js';
import { fetchLikeStatuses, buildLikeButton } from './likes.js';

const PER_PAGE = 12;

// Shared SVG snippets
const SVG_CALENDAR =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">' +
    '<path d="M4.75 0a.75.75 0 0 1 .75.75V2h5V.75a.75.75 0 0 1 1.5 0V2H13.25A1.75 1.75 0 0 1 15 3.75v10.5A1.75 1.75 0 0 1 13.25 16H2.75A1.75 1.75 0 0 1 1 14.25V3.75A1.75 1.75 0 0 1 2.75 2H4V.75A.75.75 0 0 1 4.75 0ZM2.5 7.5v6.75c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V7.5Zm10.75-4H2.75a.25.25 0 0 0-.25.25V6h11V3.75a.25.25 0 0 0-.25-.25Z"/></svg>';

const SVG_LOCATION =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">' +
    '<path d="M12.596 11.596 8 16.192l-4.596-4.596a6.5 6.5 0 1 1 9.192 0ZM8 8.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/></svg>';

const SVG_HEART_OUTLINE =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">' +
    '<path d="m8 14.25.345.666a.75.75 0 0 1-.69 0l-.008-.004-.018-.01a7.152 7.152 0 0 1-.31-.17 22.055 22.055 0 0 1-3.434-2.414C2.045 10.731 0 8.35 0 5.5 0 2.836 2.086 1 4.25 1 5.797 1 7.153 1.802 8 3.02 8.847 1.802 10.203 1 11.75 1 13.914 1 16 2.836 16 5.5c0 2.85-2.045 5.231-3.885 6.818a22.066 22.066 0 0 1-3.744 2.584l-.018.01-.006.003h-.002ZM4.25 2.5c-1.336 0-2.75 1.164-2.75 3 0 2.15 1.58 4.144 3.365 5.682A20.58 20.58 0 0 0 8 13.393a20.58 20.58 0 0 0 3.135-2.211C12.92 9.644 14.5 7.65 14.5 5.5c0-1.836-1.414-3-2.75-3-1.373 0-2.609.986-3.029 2.456a.749.749 0 0 1-1.442 0C6.859 3.486 5.623 2.5 4.25 2.5Z"/></svg>';

// Heart icon SVG paths (for the interest toggle button)
const HEART_FILLED_PATH =
    '<path d="m8 14.25.345.666a.75.75 0 0 1-.69 0l-.008-.004-.018-.01a7.152 7.152 0 0 1-.31-.17 22.055 22.055 0 0 1-3.434-2.414C2.045 10.731 0 8.35 0 5.5 0 2.836 2.086 1 4.25 1 5.797 1 7.153 1.802 8 3.02 8.847 1.802 10.203 1 11.75 1 13.914 1 16 2.836 16 5.5c0 2.85-2.045 5.231-3.885 6.818a22.066 22.066 0 0 1-3.744 2.584l-.018.01-.006.003h-.002Z"/>';

const HEART_OUTLINE_PATH =
    '<path d="m8 14.25.345.666a.75.75 0 0 1-.69 0l-.008-.004-.018-.01a7.152 7.152 0 0 1-.31-.17 22.055 22.055 0 0 1-3.434-2.414C2.045 10.731 0 8.35 0 5.5 0 2.836 2.086 1 4.25 1 5.797 1 7.153 1.802 8 3.02 8.847 1.802 10.203 1 11.75 1 13.914 1 16 2.836 16 5.5c0 2.85-2.045 5.231-3.885 6.818a22.066 22.066 0 0 1-3.744 2.584l-.018.01-.006.003h-.002ZM4.25 2.5c-1.336 0-2.75 1.164-2.75 3 0 2.15 1.58 4.144 3.365 5.682A20.58 20.58 0 0 0 8 13.393a20.58 20.58 0 0 0 3.135-2.211C12.92 9.644 14.5 7.65 14.5 5.5c0-1.836-1.414-3-2.75-3-1.373 0-2.609.986-3.029 2.456a.749.749 0 0 1-1.442 0C6.859 3.486 5.623 2.5 4.25 2.5Z"/>';

/* ================================================================
   events.html — Browse / Search
   ================================================================ */

/**
 * Initialize the events browse page.
 * Fetches the first page and wires up search + pagination.
 */
export function initEvents() {
    let currentPage = 1;
    let currentQuery = '';
    let totalEvents = 0;

    const grid      = $('#eventsGrid');
    const emptyEl   = $('#eventsEmpty');
    const loadingEl = $('#eventsLoading');
    const pagEl     = $('#eventsPagination');
    const pageInfo  = $('#pageInfo');
    const prevBtn   = $('#prevPage');
    const nextBtn   = $('#nextPage');
    const searchIn  = $('#eventSearch');

    if (!grid) return;

    /* ---- Fetch & Render ---- */

    async function fetchEvents() {
        grid.innerHTML = '';
        emptyEl.classList.add('hidden');
        pagEl.classList.add('hidden');
        loadingEl.classList.remove('hidden');

        try {
            let url = '/api/events/?page=' + currentPage + '&per_page=' + PER_PAGE;
            if (currentQuery) {
                url += '&q=' + encodeURIComponent(currentQuery);
            }

            const data = await api.get(url);
            totalEvents = data.total || 0;
            loadingEl.classList.add('hidden');

            if (!data.events || data.events.length === 0) {
                emptyEl.classList.remove('hidden');
                return;
            }

            renderEventCards(data.events);
            updatePagination();
        } catch (err) {
            loadingEl.classList.add('hidden');
            emptyEl.classList.remove('hidden');
            console.error('Failed to fetch events:', err);
        }
    }

    function renderEventCards(events) {
        grid.innerHTML = '';
        for (const ev of events) {
            grid.appendChild(buildEventCard(ev));
        }
    }

    function buildEventCard(ev) {
        const tags = parseTags(ev.tags);
        const tagsHtml = tags
            .map(function (t) { return '<span class="tag-badge">' + escapeHtml(t) + '</span>'; })
            .join('');

        const card = document.createElement('div');
        card.className = 'card card-clickable event-card';
        card.setAttribute('role', 'link');
        card.setAttribute('tabindex', '0');

        const imageHtml = ev.image_url
            ? '<img class="event-image" src="' + escapeHtml(ev.image_url) + '" alt="" loading="lazy">'
            : '';

        const startDateHtml = ev.start_date
            ? '<span class="event-meta-item">' + SVG_CALENDAR + ' ' + escapeHtml(formatDate(ev.start_date)) + '</span>'
            : '';

        const locationHtml = ev.location
            ? '<span class="event-meta-item">' + SVG_LOCATION + ' ' + escapeHtml(ev.location) + '</span>'
            : '';

        const interestedVal = (ev.interested_count != null) ? ev.interested_count : 0;

        card.innerHTML =
            imageHtml +
            '<h3 class="event-title">' + escapeHtml(ev.title) + '</h3>' +
            '<div class="event-meta">' + startDateHtml + locationHtml + '</div>' +
            '<p class="event-description">' + escapeHtml(ev.description || '') + '</p>' +
            (tagsHtml ? '<div class="event-tags">' + tagsHtml + '</div>' : '') +
            '<div class="event-footer">' +
            '  <span class="interested-count">' + SVG_HEART_OUTLINE + ' ' + interestedVal + ' interested</span>' +
            '</div>';

        card.addEventListener('click', function () {
            window.location.href = '/events/' + ev.id;
        });
        card.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                window.location.href = '/events/' + ev.id;
            }
        });

        return card;
    }

    /* ---- Pagination ---- */

    function updatePagination() {
        const totalPages = Math.ceil(totalEvents / PER_PAGE);
        if (totalPages <= 1) {
            pagEl.classList.add('hidden');
            return;
        }
        pagEl.classList.remove('hidden');
        pageInfo.textContent = 'Page ' + currentPage + ' of ' + totalPages;
        prevBtn.disabled = currentPage <= 1;
        nextBtn.disabled = currentPage >= totalPages;
    }

    prevBtn.addEventListener('click', function () {
        if (currentPage > 1) {
            currentPage--;
            fetchEvents();
        }
    });

    nextBtn.addEventListener('click', function () {
        const totalPages = Math.ceil(totalEvents / PER_PAGE);
        if (currentPage < totalPages) {
            currentPage++;
            fetchEvents();
        }
    });

    /* ---- Search ---- */

    const handleSearch = debounce(function (value) {
        currentQuery = value.trim();
        currentPage = 1;
        fetchEvents();
    }, 300);

    searchIn.addEventListener('input', function (e) {
        handleSearch(e.target.value);
    });

    /* ---- Boot ---- */
    fetchEvents();
}

/* ================================================================
   event_detail.html — Single Event
   ================================================================ */

/**
 * Initialize the event detail page.
 * @param {number} eventId - The event ID passed from the template.
 */
export async function initEventDetail(eventId) {
    const loadingEl       = $('#eventLoading');
    const detailEl        = $('#eventDetail');
    const titleEl         = $('#eventTitle');
    const locationEl      = $('#eventLocation');
    const startDateEl     = $('#eventStartDate');
    const endDateEl       = $('#eventEndDate');
    const deadlineEl      = $('#eventDeadline');
    const tagsEl          = $('#eventTags');
    const descriptionEl   = $('#eventDescription');
    const sourceWrap      = $('#eventSourceWrap');
    const sourceEl        = $('#eventSource');
    const interestBtn     = $('#interestBtn');
    const interestIcon    = $('#interestIcon');
    const interestText    = $('#interestText');
    const interestCount   = $('#interestCount');
    const findMatchesBtn  = $('#findMatchesBtn');
    const interestedGrid  = $('#interestedGrid');
    const interestedEmpty = $('#interestedEmpty');
    const matchesLoading  = $('#matchesLoading');

    if (!detailEl) return;

    let isInterested = false;
    let interestedCountVal = 0;

    /* ---- Load Event ---- */

    try {
        const data = await api.get('/api/events/' + eventId);
        const ev = data.event;

        // Banner image
        if (ev.image_url) {
            const bannerImg = document.createElement('img');
            bannerImg.src = ev.image_url;
            bannerImg.alt = ev.title || 'Event banner';
            bannerImg.style.maxWidth = '100%';
            bannerImg.style.maxHeight = '360px';
            bannerImg.style.borderRadius = '12px';
            bannerImg.style.objectFit = 'cover';
            bannerImg.style.width = '100%';
            bannerImg.style.marginBottom = '16px';
            // Insert at the top of the detail container, before the page-header
            detailEl.insertBefore(bannerImg, detailEl.firstChild);
        }

        titleEl.textContent = ev.title || '';
        locationEl.textContent = ev.location || '';
        startDateEl.textContent = formatDate(ev.start_date) || 'TBA';
        endDateEl.textContent = formatDate(ev.end_date) || 'TBA';
        deadlineEl.textContent = formatDate(ev.registration_deadline) || 'TBA';
        descriptionEl.textContent = ev.description || '';

        // Tags
        const tags = parseTags(ev.tags);
        tagsEl.innerHTML = tags
            .map(function (t) { return '<span class="tag-badge">' + escapeHtml(t) + '</span>'; })
            .join('');

        // Source link
        if (ev.url) {
            sourceEl.href = ev.url;
            sourceWrap.classList.remove('hidden');
        }

        // Interest state
        isInterested = !!data.user_interested;
        interestedCountVal = data.interested_count || 0;
        updateInterestUI();

        loadingEl.classList.add('hidden');
        detailEl.classList.remove('hidden');

        // Load interested users
        loadInterestedUsers();
    } catch (err) {
        loadingEl.innerHTML =
            '<span class="text-danger">Failed to load event. ' + escapeHtml(err.message) + '</span>';
        console.error('Failed to load event:', err);
        return;
    }

    /* ---- Interest Toggle ---- */

    function updateInterestUI() {
        if (isInterested) {
            interestBtn.classList.remove('btn-outline');
            interestBtn.classList.add('btn-accent');
            interestIcon.innerHTML = HEART_FILLED_PATH;
            interestText.textContent = 'Interested';
        } else {
            interestBtn.classList.remove('btn-accent');
            interestBtn.classList.add('btn-outline');
            interestIcon.innerHTML = HEART_OUTLINE_PATH;
            interestText.textContent = "I'm Interested";
        }
        interestCount.textContent = interestedCountVal + ' interested';
    }

    interestBtn.addEventListener('click', async function () {
        interestBtn.classList.add('loading');
        interestBtn.disabled = true;
        try {
            if (isInterested) {
                await api.delete('/api/events/' + eventId + '/interest');
                isInterested = false;
                interestedCountVal = Math.max(0, interestedCountVal - 1);
            } else {
                await api.post('/api/events/' + eventId + '/interest');
                isInterested = true;
                interestedCountVal++;
            }
            updateInterestUI();
            loadInterestedUsers();
        } catch (err) {
            console.error('Interest toggle failed:', err);
        } finally {
            interestBtn.classList.remove('loading');
            interestBtn.disabled = false;
        }
    });

    /* ---- Interested Users ---- */

    async function loadInterestedUsers() {
        interestedGrid.innerHTML = '';
        interestedEmpty.classList.add('hidden');

        try {
            const data = await api.get('/api/events/' + eventId + '/interested');
            const users = data.users || [];

            if (users.length === 0) {
                interestedEmpty.classList.remove('hidden');
                return;
            }

            renderUserCards(users, interestedGrid);
            await addLikeButtonsToCards(interestedGrid, users.map(function (u) { return u.id; }), eventId);
        } catch (err) {
            console.error('Failed to load interested users:', err);
        }
    }

    /* ---- Find Best Matches ---- */

    findMatchesBtn.addEventListener('click', async function () {
        findMatchesBtn.classList.add('loading');
        findMatchesBtn.disabled = true;
        interestedGrid.innerHTML = '';
        interestedEmpty.classList.add('hidden');
        matchesLoading.classList.remove('hidden');

        try {
            const data = await api.get('/api/match/event/' + eventId);
            matchesLoading.classList.add('hidden');
            const matches = data.matches || [];

            if (matches.length === 0) {
                interestedEmpty.classList.remove('hidden');
                return;
            }

            renderMatchedUserCards(matches, interestedGrid);
            await addLikeButtonsToCards(interestedGrid, matches.map(function (m) { return m.user.id; }), eventId);
        } catch (err) {
            matchesLoading.classList.add('hidden');
            interestedEmpty.classList.remove('hidden');
            console.error('Failed to find matches:', err);
        } finally {
            findMatchesBtn.classList.remove('loading');
            findMatchesBtn.disabled = false;
        }
    });
}

/* ================================================================
   Shared Renderers
   ================================================================ */

/**
 * Render simple user cards (no match scores).
 */
function renderUserCards(users, container) {
    for (const user of users) {
        container.appendChild(buildUserCard(user, null));
    }
}

/**
 * Render user cards with match score bars.
 */
function renderMatchedUserCards(matches, container) {
    for (const match of matches) {
        container.appendChild(buildUserCard(match.user, match));
    }
}

/**
 * Build a single user card DOM element.
 * @param {object} user  - User data object
 * @param {object|null} match - Match scores, or null for plain cards
 * @returns {HTMLElement}
 */
function buildUserCard(user, match) {
    const card = document.createElement('div');
    card.className = 'card user-card';
    card.style.cursor = 'pointer';

    const skills = (user.skills || []).slice(0, 5);
    const skillsHtml = skills
        .map(function (s) {
            const name = typeof s === 'string' ? s : s.name;
            const level = (typeof s === 'object' && s.level) ? s.level : '';
            return '<span class="skill-badge ' + escapeHtml(level) + '">' + escapeHtml(name) + '</span>';
        })
        .join('');

    let matchHtml = '';
    if (match) {
        const finalPct = Math.round((match.final_score || 0) * 100);
        const overlapPct = Math.round((match.overlap_score || 0) * 100);
        const skillPct = Math.round((match.skill_score || 0) * 100);
        const scoreClass =
            finalPct >= 70 ? 'score-high' : (finalPct >= 40 ? 'score-medium' : 'score-low');

        matchHtml =
            '<div class="user-match">' +
            '  <div class="match-label">Match Score</div>' +
            '  <div class="match-percent">' + finalPct + '%</div>' +
            '  <div class="match-score-bar ' + scoreClass + '" style="margin-top:8px;">' +
            '    <div class="match-score-track">' +
            '      <div class="match-score-fill" style="width:' + finalPct + '%"></div>' +
            '    </div>' +
            '    <span class="match-score-value">' + finalPct + '%</span>' +
            '  </div>' +
            '  <div style="display:flex;justify-content:space-between;margin-top:6px;">' +
            '    <span class="text-xs text-muted">Overlap: ' + overlapPct + '%</span>' +
            '    <span class="text-xs text-muted">Skills: ' + skillPct + '%</span>' +
            '  </div>' +
            '</div>';
    }

    const avatarUrl = escapeHtml(user.avatar_url || '/static/img/default-avatar.svg');
    const displayName = escapeHtml(user.display_name || user.github_handle || user.email || 'User');
    const handle = escapeHtml(user.github_handle || user.email || '');

    card.innerHTML =
        '<img class="user-avatar" src="' + avatarUrl + '" alt="' + displayName + '" loading="lazy">' +
        '<span class="user-name">' + displayName + '</span>' +
        (handle ? '<span class="user-handle">' + (user.github_handle ? '@' : '') + handle + '</span>' : '') +
        '<div class="user-skills">' + skillsHtml + '</div>' +
        matchHtml +
        '<div class="card-actions" data-user-id="' + user.id + '" data-display-name="' + displayName + '" data-avatar-url="' + avatarUrl + '" style="margin-top:var(--spacing-2);width:100%;display:flex;gap:8px;">' +
        '  <span class="like-btn-slot"></span>' +
        '  <a href="/inbox?user=' + user.id + '" class="btn btn-outline btn-sm" style="flex:1;" onclick="event.stopPropagation();">' +
        '    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">' +
        '      <path d="M1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 14H1.75A1.75 1.75 0 0 1 0 12.25v-8.5C0 2.784.784 2 1.75 2ZM1.5 12.251c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V5.809L8.38 9.397a.75.75 0 0 1-.76 0L1.5 5.809v6.442Zm13-8.181v-.32a.25.25 0 0 0-.25-.25H1.75a.25.25 0 0 0-.25.25v.32L8 7.88Z"/>' +
        '    </svg>' +
        '    Message' +
        '  </a>' +
        '</div>';

    card.addEventListener('click', function () {
        window.location.href = '/profile/' + user.id;
    });

    return card;
}

/**
 * Add like buttons to all user cards in a container after batch-fetching statuses.
 */
async function addLikeButtonsToCards(container, userIds, eventId) {
    if (!userIds || userIds.length === 0) return;
    const statuses = await fetchLikeStatuses(userIds);

    const slots = container.querySelectorAll('.like-btn-slot');
    for (const slot of slots) {
        const actionsEl = slot.closest('.card-actions');
        if (!actionsEl) continue;
        const uid = Number(actionsEl.dataset.userId);
        const status = statuses.get(uid) || { i_liked: false, they_liked: false, mutual: false };
        const likeBtn = buildLikeButton(uid, status, eventId || null, {
            displayName: actionsEl.dataset.displayName || 'User',
            avatarUrl: actionsEl.dataset.avatarUrl || ''
        });
        likeBtn.style.flex = '1';
        slot.replaceWith(likeBtn);
    }
}

/* ================================================================
   Helpers
   ================================================================ */

/**
 * Parse tags from either a JSON string or an array.
 * @param {string|Array} tags
 * @returns {string[]}
 */
function parseTags(tags) {
    if (!tags) return [];
    if (Array.isArray(tags)) return tags;
    try {
        const parsed = JSON.parse(tags);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}
