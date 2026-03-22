/**
 * Grid — Mutual Matching (Like) System
 * Shared module for like buttons across /find, /events/<id>, and /inbox.
 */

import api from './api.js';
import { escapeHtml } from './utils.js';

/**
 * Batch-fetch like statuses for an array of user IDs.
 * @param {number[]} userIds
 * @returns {Promise<Map<number, {i_liked: boolean, they_liked: boolean, mutual: boolean}>>}
 */
export async function fetchLikeStatuses(userIds) {
    const map = new Map();
    if (!userIds || userIds.length === 0) return map;

    const unique = [...new Set(userIds)];
    try {
        const data = await api.get('/api/likes/status?ids=' + unique.join(','));
        const statuses = data.statuses || {};
        for (const [id, status] of Object.entries(statuses)) {
            map.set(Number(id), status);
        }
    } catch (err) {
        console.error('Failed to fetch like statuses:', err);
    }
    return map;
}

/**
 * Toggle like for a user. Returns the API response.
 * @param {number} userId
 * @param {boolean} currentlyLiked - Whether the current user already liked them
 * @param {number|null} eventId - Optional event context
 * @returns {Promise<{ok: boolean, mutual?: boolean}>}
 */
export async function toggleLike(userId, currentlyLiked, eventId) {
    if (currentlyLiked) {
        return api.delete('/api/likes/' + userId);
    } else {
        const body = {};
        if (eventId) {
            body.context = 'event';
            body.event_id = eventId;
        }
        return api.post('/api/likes/' + userId, body);
    }
}

/**
 * Build a like button DOM element with click handler.
 * @param {number} userId
 * @param {{i_liked: boolean, they_liked: boolean, mutual: boolean}} status
 * @param {number|null} eventId
 * @returns {HTMLButtonElement}
 */
export function buildLikeButton(userId, status, eventId, userMeta = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm btn-like';
    btn.dataset.userId = userId;

    applyLikeState(btn, status);

    btn.addEventListener('click', async function (e) {
        e.stopPropagation();
        btn.disabled = true;

        try {
            const wasLiked = btn.classList.contains('liked') || btn.classList.contains('mutual');
            const result = await toggleLike(userId, wasLiked, eventId);

            // Update state based on result
            let newStatus;
            if (wasLiked) {
                // We unliked — check if they still like us
                const theyLiked = btn.dataset.theyLiked === 'true';
                newStatus = { i_liked: false, they_liked: theyLiked, mutual: false };
            } else {
                // We liked — check for mutual
                const theyLiked = btn.dataset.theyLiked === 'true';
                const mutual = result.mutual || false;
                newStatus = { i_liked: true, they_liked: theyLiked || mutual, mutual: mutual };
            }

            applyLikeState(btn, newStatus);

            if (newStatus.mutual) {
                btn.classList.add('match-flash');
                setTimeout(function () { btn.classList.remove('match-flash'); }, 1000);
                showMatchModal(userId, userMeta.displayName || 'this user', userMeta.avatarUrl || '');
            }
        } catch (err) {
            console.error('Like toggle failed:', err);
        } finally {
            btn.disabled = false;
        }
    });

    return btn;
}

/**
 * Show a celebration modal when a mutual match occurs.
 */
function showMatchModal(userId, displayName, avatarUrl) {
    // Remove any existing match modal
    var existing = document.getElementById('matchModal');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'matchModal';
    overlay.className = 'modal-overlay';

    var avatarHtml = avatarUrl
        ? '<img src="' + escapeHtml(avatarUrl) + '" alt="" style="width:72px;height:72px;border-radius:50%;border:3px solid var(--color-accent);object-fit:cover;margin-bottom:12px;">'
        : '';

    overlay.innerHTML =
        '<div class="modal-content modal-sm modal-confirm">' +
        '  <div class="modal-body" style="padding-top:var(--spacing-4);padding-bottom:var(--spacing-2);">' +
        '    <div class="modal-icon icon-success">\u2605</div>' +
        avatarHtml +
        '    <h3 style="margin-bottom:8px;color:#e6edf3;">It\'s a Match!</h3>' +
        '    <p>You and <strong>' + escapeHtml(displayName) + '</strong> have liked each other. Start a conversation!</p>' +
        '  </div>' +
        '  <div class="modal-footer">' +
        '    <button class="btn btn-outline" id="matchModalClose">Close</button>' +
        '    <a href="/inbox?user=' + userId + '" class="btn btn-primary">Go to Chat</a>' +
        '  </div>' +
        '</div>';

    document.body.appendChild(overlay);

    // Open with transition
    requestAnimationFrame(function () {
        overlay.classList.add('open');
    });

    function closeModal() {
        overlay.classList.remove('open');
        overlay.addEventListener('transitionend', function () {
            overlay.remove();
        }, { once: true });
        document.removeEventListener('keydown', onEscape);
    }

    function onEscape(e) {
        if (e.key === 'Escape') closeModal();
    }

    overlay.querySelector('#matchModalClose').addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeModal();
    });
    document.addEventListener('keydown', onEscape);
}

/**
 * Apply visual state to a like button.
 */
function applyLikeState(btn, status) {
    btn.classList.remove('liked', 'they-liked', 'mutual');
    btn.dataset.theyLiked = String(status.they_liked || false);

    if (status.mutual) {
        btn.classList.add('mutual');
        btn.innerHTML = '\u2605 Mutual Match';
    } else if (status.i_liked) {
        btn.classList.add('liked');
        btn.innerHTML = '\u2665 Liked';
    } else if (status.they_liked) {
        btn.classList.add('they-liked');
        btn.innerHTML = '\u2661 Like Back';
    } else {
        btn.innerHTML = '\u2661 Like';
    }
}
