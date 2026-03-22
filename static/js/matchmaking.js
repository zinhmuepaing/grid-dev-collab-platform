/**
 * Grid — Matchmaking / Find Teammates
 * Skill-based teammate search with match score display.
 */

import api from './api.js';
import { escapeHtml, $ } from './utils.js';
import { fetchLikeStatuses, buildLikeButton } from './likes.js';

/**
 * Initialize the Find Teammates page.
 * Loads available skills, renders filter UI, handles search.
 */
export async function initMatchmaking() {
    const skillsFilter   = $('#skillsFilter');
    const skillsLoading  = $('#skillsLoading');
    const selectedCountEl = $('#selectedCount');
    const searchBtn      = $('#searchBtn');
    const clearBtn       = $('#clearSkillsBtn');
    const initialState   = $('#initialState');
    const resultsLoading = $('#resultsLoading');
    const resultsSection = $('#resultsSection');
    const resultsTitle   = $('#resultsTitle');
    const resultsGrid    = $('#resultsGrid');
    const noResults      = $('#noResults');

    if (!skillsFilter) return;

    const selectedSkills = new Set();

    /* ---- Load Skills ---- */

    try {
        const data = await api.get('/api/users/skills/all');
        const skills = data.skills || [];
        skillsLoading.classList.add('hidden');

        if (skills.length === 0) {
            skillsFilter.innerHTML = '<span class="text-muted text-sm">No skills available.</span>';
            return;
        }

        renderSkillBadges(skills);
    } catch (err) {
        skillsLoading.textContent = 'Failed to load skills.';
        skillsLoading.classList.add('text-danger');
        console.error('Failed to load skills:', err);
        return;
    }

    /* ---- Render Skill Badges ---- */

    function renderSkillBadges(skills) {
        skillsFilter.innerHTML = '';
        for (const skill of skills) {
            const badge = document.createElement('button');
            badge.type = 'button';
            badge.className = 'skill-badge';
            badge.textContent = skill.name;
            badge.dataset.skillName = skill.name;
            badge.style.cursor = 'pointer';
            badge.style.transition = 'all 150ms ease';

            badge.addEventListener('click', function () {
                const name = skill.name;
                if (selectedSkills.has(name)) {
                    selectedSkills.delete(name);
                    badge.classList.remove('advanced');
                    badge.classList.add('beginner');
                    // Reset to default style
                    badge.className = 'skill-badge';
                } else {
                    selectedSkills.add(name);
                    badge.classList.remove('beginner');
                    badge.classList.add('advanced');
                }
                updateSelectedCount();
            });

            skillsFilter.appendChild(badge);
        }
    }

    /* ---- Update Selected Count ---- */

    function updateSelectedCount() {
        const count = selectedSkills.size;
        selectedCountEl.textContent = count + ' skill' + (count !== 1 ? 's' : '') + ' selected';
        searchBtn.disabled = count === 0;
        clearBtn.disabled = count === 0;
    }

    /* ---- Clear Button ---- */

    clearBtn.addEventListener('click', function () {
        selectedSkills.clear();
        // Reset all badge styles
        const badges = skillsFilter.querySelectorAll('.skill-badge');
        for (const badge of badges) {
            badge.classList.remove('advanced', 'beginner');
        }
        updateSelectedCount();

        // Reset view
        resultsSection.classList.add('hidden');
        noResults.classList.add('hidden');
        initialState.classList.remove('hidden');
    });

    /* ---- Search Button ---- */

    searchBtn.addEventListener('click', async function () {
        if (selectedSkills.size === 0) return;

        // Hide other states
        initialState.classList.add('hidden');
        resultsSection.classList.add('hidden');
        noResults.classList.add('hidden');
        resultsLoading.classList.remove('hidden');

        searchBtn.classList.add('loading');
        searchBtn.disabled = true;

        try {
            // Build query string: ?skill=X&skill=Y
            const params = new URLSearchParams();
            for (const skill of selectedSkills) {
                params.append('skill', skill);
            }

            const data = await api.get('/api/match/teammate?' + params.toString());
            resultsLoading.classList.add('hidden');
            const matches = data.matches || [];

            if (matches.length === 0) {
                noResults.classList.remove('hidden');
                return;
            }

            resultsTitle.textContent = matches.length + ' teammate' + (matches.length !== 1 ? 's' : '') + ' found';
            await renderMatchResults(matches);
            resultsSection.classList.remove('hidden');
        } catch (err) {
            resultsLoading.classList.add('hidden');
            noResults.classList.remove('hidden');
            console.error('Teammate search failed:', err);
        } finally {
            searchBtn.classList.remove('loading');
            searchBtn.disabled = selectedSkills.size === 0;
        }
    });

    /* ---- Render Match Results ---- */

    async function renderMatchResults(matches) {
        resultsGrid.innerHTML = '';

        const userIds = matches.map(function (m) { return m.user.id; });
        const likeStatuses = await fetchLikeStatuses(userIds);

        for (const match of matches) {
            const user = match.user;
            const finalPct = Math.round((match.final_score || 0) * 100);
            const overlapPct = Math.round((match.overlap_score || 0) * 100);
            const skillPct = Math.round((match.skill_score || 0) * 100);
            const scoreClass =
                finalPct >= 70 ? 'score-high' : (finalPct >= 40 ? 'score-medium' : 'score-low');

            const skills = (user.skills || []).slice(0, 6);
            const skillsHtml = skills
                .map(function (s) {
                    const name = typeof s === 'string' ? s : s.name;
                    const level = (typeof s === 'object' && s.level) ? s.level : '';
                    return '<span class="skill-badge ' + escapeHtml(level) + '">' + escapeHtml(name) + '</span>';
                })
                .join('');

            const card = document.createElement('div');
            card.className = 'card user-card';

            const avatarUrl = escapeHtml(user.avatar_url || '/static/img/default-avatar.svg');
            const displayName = escapeHtml(user.display_name || user.github_handle || user.email || 'User');
            const handle = escapeHtml(user.github_handle || user.email || '');

            card.innerHTML =
                '<img class="user-avatar" src="' + avatarUrl + '" alt="' + displayName + '" loading="lazy">' +
                '<span class="user-name">' + displayName + '</span>' +
                (handle ? '<span class="user-handle">' + (user.github_handle ? '@' : '') + handle + '</span>' : '') +
                '<div class="user-skills">' + skillsHtml + '</div>' +
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
                '</div>' +
                '<div class="card-actions" style="margin-top:var(--spacing-2);width:100%;display:flex;gap:8px;">' +
                '  <span class="like-btn-slot" data-user-id="' + user.id + '"></span>' +
                '  <a href="/inbox?user=' + user.id + '" class="btn btn-outline btn-sm" style="flex:1;" onclick="event.stopPropagation();">' +
                '    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">' +
                '      <path d="M1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 14H1.75A1.75 1.75 0 0 1 0 12.25v-8.5C0 2.784.784 2 1.75 2ZM1.5 12.251c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V5.809L8.38 9.397a.75.75 0 0 1-.76 0L1.5 5.809v6.442Zm13-8.181v-.32a.25.25 0 0 0-.25-.25H1.75a.25.25 0 0 0-.25.25v.32L8 7.88Z"/>' +
                '    </svg>' +
                '    Message' +
                '  </a>' +
                '</div>';

            // Insert like button into its slot
            const likeSlot = card.querySelector('.like-btn-slot');
            const status = likeStatuses.get(user.id) || { i_liked: false, they_liked: false, mutual: false };
            const likeBtn = buildLikeButton(user.id, status, null, {
                displayName: user.display_name || user.github_handle || user.email || 'User',
                avatarUrl: user.avatar_url || ''
            });
            likeBtn.style.flex = '1';
            likeSlot.replaceWith(likeBtn);

            card.style.cursor = 'pointer';
            card.addEventListener('click', function () {
                window.location.href = '/profile/' + user.id;
            });

            resultsGrid.appendChild(card);
        }
    }
}
