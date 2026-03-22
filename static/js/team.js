/**
 * Grid — Team Page
 *
 * Manages team detail view, member list, invites, and Discord workspace generation.
 * Exports initTeamPage() to be called from team.html.
 */

import api from './api.js';
import { escapeHtml, debounce, formatDate, $, $$ } from './utils.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let teamId = null;
let teamData = null;
let currentUserId = null;
let isOwner = false;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export async function initTeamPage() {
    teamId = window.__teamId;
    if (!teamId) return;

    // Get current user
    try {
        const meData = await api.get('/auth/me');
        currentUserId = meData.user.id;
    } catch (err) {
        console.error('Not authenticated:', err);
        return;
    }

    await loadTeam();
}

// ---------------------------------------------------------------------------
// Load team data
// ---------------------------------------------------------------------------

async function loadTeam() {
    const loading = $('#teamLoading');
    const content = $('#teamContent');

    try {
        const data = await api.get(`/api/teams/${teamId}`);
        teamData = data.team;

        isOwner = teamData.members.some(
            m => m.user_id === currentUserId && m.role === 'owner'
        );

        renderTeam();

        if (loading) loading.style.display = 'none';
        if (content) content.style.display = '';
    } catch (err) {
        console.error('Failed to load team:', err);
        if (loading) loading.innerHTML = '<p class="text-muted">Could not load team.</p>';
    }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderTeam() {
    // Team name & event
    const nameEl = $('#teamName');
    const eventEl = $('#teamEvent');
    if (nameEl) nameEl.textContent = teamData.name;
    if (eventEl) {
        renderEventLink(eventEl);
    }

    // Discord banner
    const discordBanner = $('#discordBanner');
    const discordLink = $('#discordLink');
    if (teamData.discord_invite && discordBanner && discordLink) {
        discordBanner.style.display = '';
        discordLink.href = teamData.discord_invite;
    }

    // Action buttons
    renderActions();

    // Members
    renderMembers();
}

function renderActions() {
    const actionsEl = $('#teamActions');
    if (!actionsEl) return;
    actionsEl.innerHTML = '';

    if (isOwner) {
        // Invite button
        const inviteBtn = document.createElement('button');
        inviteBtn.className = 'btn btn-primary';
        inviteBtn.textContent = 'Invite Member';
        inviteBtn.addEventListener('click', openInviteModal);
        actionsEl.appendChild(inviteBtn);

        // Discord workspace button (only if not yet created)
        if (!teamData.discord_invite) {
            const discordBtn = document.createElement('button');
            discordBtn.className = 'btn btn-accent';
            discordBtn.textContent = 'Generate Discord Workspace';
            discordBtn.addEventListener('click', () => generateWorkspace(discordBtn));
            actionsEl.appendChild(discordBtn);
        }

        // Delete team button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-danger';
        deleteBtn.textContent = 'Delete Team';
        deleteBtn.addEventListener('click', deleteTeam);
        actionsEl.appendChild(deleteBtn);
    } else {
        // Check if current user is pending
        const myMembership = teamData.members.find(m => m.user_id === currentUserId);
        if (myMembership && myMembership.status === 'pending') {
            const acceptBtn = document.createElement('button');
            acceptBtn.className = 'btn btn-accent';
            acceptBtn.textContent = 'Accept Invite';
            acceptBtn.addEventListener('click', () => respondToInvite('accepted'));
            actionsEl.appendChild(acceptBtn);

            const declineBtn = document.createElement('button');
            declineBtn.className = 'btn btn-danger';
            declineBtn.textContent = 'Decline';
            declineBtn.addEventListener('click', () => respondToInvite('declined'));
            actionsEl.appendChild(declineBtn);
        } else if (myMembership && myMembership.status === 'accepted') {
            const leaveBtn = document.createElement('button');
            leaveBtn.className = 'btn btn-outline';
            leaveBtn.textContent = 'Leave Team';
            leaveBtn.addEventListener('click', leaveTeam);
            actionsEl.appendChild(leaveBtn);
        }
    }
}

function renderMembers() {
    const listEl = $('#membersList');
    if (!listEl) return;
    listEl.innerHTML = '';

    const accepted = teamData.members.filter(m => m.status === 'accepted');
    const pending = teamData.members.filter(m => m.status === 'pending');

    for (const member of accepted) {
        listEl.appendChild(buildMemberCard(member));
    }

    // Show pending section for owner
    const pendingSection = $('#pendingSection');
    const pendingList = $('#pendingList');
    if (isOwner && pending.length > 0 && pendingSection && pendingList) {
        pendingSection.style.display = '';
        pendingList.innerHTML = '';
        for (const member of pending) {
            pendingList.appendChild(buildMemberCard(member));
        }
    }
}

function buildMemberCard(member) {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.padding = 'calc(var(--spacing-unit) * 2)';

    const avatar = member.avatar_url || '/static/img/default-avatar.svg';
    const isMe = member.user_id === currentUserId;
    const name = isMe ? 'You' : escapeHtml(member.display_name || member.github_handle || member.email || 'User');
    const handle = escapeHtml(member.github_handle || member.email || '');

    let roleBadge = '';
    if (member.role === 'owner') {
        roleBadge = '<span class="role-badge owner">Owner</span>';
    }

    let statusBadge = '';
    if (member.status === 'pending') {
        statusBadge = '<span class="status-badge pending">Pending</span>';
    }

    card.innerHTML = `
        <div style="display:flex;align-items:center;gap:calc(var(--spacing-unit)*1.5)">
            <img src="${escapeHtml(avatar)}" alt="" style="width:40px;height:40px;border-radius:50%">
            <div style="flex:1">
                <div style="font-weight:600">${name} ${roleBadge}</div>
                <div class="text-muted" style="font-size:0.85rem">@${handle} ${statusBadge}</div>
            </div>
            <a href="/profile/${encodeURIComponent(member.user_id)}" class="btn btn-sm btn-outline">Profile</a>
        </div>
    `;

    return card;
}

// ---------------------------------------------------------------------------
// Event linking
// ---------------------------------------------------------------------------

function renderEventLink(eventEl) {
    eventEl.innerHTML = '';

    if (teamData.event) {
        // Event thumbnail + title row
        const eventRow = document.createElement('div');
        eventRow.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;';

        if (teamData.event.image_url) {
            const thumb = document.createElement('img');
            thumb.src = teamData.event.image_url;
            thumb.alt = '';
            thumb.style.cssText = 'width:36px;height:36px;border-radius:var(--radius);object-fit:cover;flex-shrink:0;';
            eventRow.appendChild(thumb);
        }

        const link = document.createElement('a');
        link.href = '/events/' + teamData.event.id;
        link.textContent = teamData.event.title;
        link.style.color = 'var(--color-primary)';
        eventRow.appendChild(link);

        eventEl.appendChild(eventRow);

        if (isOwner) {
            const changeBtn = document.createElement('button');
            changeBtn.className = 'btn btn-outline btn-sm';
            changeBtn.textContent = 'Change';
            changeBtn.style.marginLeft = '8px';
            changeBtn.addEventListener('click', openEventPicker);
            eventEl.appendChild(changeBtn);

            const unlinkBtn = document.createElement('button');
            unlinkBtn.className = 'btn btn-outline btn-sm';
            unlinkBtn.textContent = 'Unlink';
            unlinkBtn.style.marginLeft = '4px';
            unlinkBtn.addEventListener('click', async () => {
                unlinkBtn.disabled = true;
                try {
                    const data = await api.put('/api/teams/' + teamId, { event_id: null });
                    teamData = data.team;
                    renderEventLink(eventEl);
                } catch (err) {
                    unlinkBtn.disabled = false;
                    console.error('Failed to unlink event:', err);
                }
            });
            eventEl.appendChild(unlinkBtn);
        }
    } else {
        if (isOwner) {
            const btn = document.createElement('button');
            btn.className = 'btn btn-primary btn-sm';
            btn.textContent = 'Link a Hackathon Event';
            btn.addEventListener('click', openEventPicker);
            eventEl.appendChild(btn);
        } else {
            eventEl.textContent = 'No linked event';
        }
    }
}

function openEventPicker() {
    // Remove existing modal
    const existing = document.getElementById('eventPickerModal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'eventPickerModal';
    overlay.className = 'modal-overlay';

    overlay.innerHTML =
        '<div class="modal-content">' +
        '  <div class="modal-header">' +
        '    <h3>Select a Hackathon Event</h3>' +
        '    <button class="modal-close" id="eventPickerClose">&times;</button>' +
        '  </div>' +
        '  <div class="modal-body" style="padding:var(--spacing-3)">' +
        '    <input type="text" class="form-input" id="eventPickerSearch" placeholder="Search events..." style="width:100%;margin-bottom:var(--spacing-2)">' +
        '    <div id="eventPickerResults" style="max-height:320px;overflow-y:auto;">' +
        '      <p class="text-muted">Loading events...</p>' +
        '    </div>' +
        '  </div>' +
        '</div>';

    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('open'); });

    function closeModal() {
        overlay.classList.remove('open');
        overlay.addEventListener('transitionend', function () { overlay.remove(); }, { once: true });
        document.removeEventListener('keydown', onEscape);
    }
    function onEscape(e) { if (e.key === 'Escape') closeModal(); }

    overlay.querySelector('#eventPickerClose').addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
    document.addEventListener('keydown', onEscape);

    const searchInput = overlay.querySelector('#eventPickerSearch');
    const resultsEl = overlay.querySelector('#eventPickerResults');

    // Load initial events
    loadEventResults('', resultsEl, closeModal);
    setTimeout(function () { searchInput.focus(); }, 100);

    // Search with debounce
    const handleSearch = debounce(function (value) {
        loadEventResults(value.trim(), resultsEl, closeModal);
    }, 300);
    searchInput.addEventListener('input', function (e) {
        handleSearch(e.target.value);
    });
}

async function loadEventResults(query, container, closeModal) {
    try {
        let url = '/api/events/?per_page=20';
        if (query) url += '&q=' + encodeURIComponent(query);
        const data = await api.get(url);
        const events = data.events || [];

        if (events.length === 0) {
            container.innerHTML = '<p class="text-muted">No events found.</p>';
            return;
        }

        container.innerHTML = '';
        for (const ev of events) {
            const item = document.createElement('div');
            item.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px;border-bottom:1px solid var(--color-border);cursor:pointer;transition:background 150ms;border-radius:var(--radius);';

            const imgHtml = ev.image_url
                ? '<img src="' + escapeHtml(ev.image_url) + '" alt="" style="width:40px;height:40px;border-radius:var(--radius);object-fit:cover;flex-shrink:0;">'
                : '<div style="width:40px;height:40px;border-radius:var(--radius);background:var(--color-border);flex-shrink:0;"></div>';

            const dateStr = ev.start_date ? formatDate(ev.start_date) : '';

            item.innerHTML = imgHtml +
                '<div style="flex:1;min-width:0;">' +
                '  <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(ev.title) + '</div>' +
                '  <div class="text-muted" style="font-size:0.8rem;">' + escapeHtml(dateStr) + (ev.location ? ' &middot; ' + escapeHtml(ev.location) : '') + '</div>' +
                '</div>';

            item.addEventListener('mouseenter', function () { item.style.background = 'var(--color-surface-hover)'; });
            item.addEventListener('mouseleave', function () { item.style.background = ''; });

            item.addEventListener('click', async function () {
                item.style.pointerEvents = 'none';
                item.style.opacity = '0.5';
                try {
                    const result = await api.put('/api/teams/' + teamId, { event_id: ev.id });
                    teamData = result.team;
                    renderEventLink($('#teamEvent'));
                    closeModal();
                } catch (err) {
                    item.style.pointerEvents = '';
                    item.style.opacity = '';
                    console.error('Failed to link event:', err);
                }
            });

            container.appendChild(item);
        }
    } catch (err) {
        container.innerHTML = '<p class="text-muted">Failed to load events.</p>';
        console.error('Event search failed:', err);
    }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function generateWorkspace(btn) {
    btn.disabled = true;
    btn.textContent = 'Creating...';

    try {
        const data = await api.post(`/api/teams/${teamId}/discord`);
        teamData.discord_invite = data.invite_url;

        // Show banner
        const discordBanner = $('#discordBanner');
        const discordLink = $('#discordLink');
        if (discordBanner && discordLink) {
            discordBanner.style.display = '';
            discordLink.href = data.invite_url;
        }

        // Remove the generate button
        btn.remove();
    } catch (err) {
        console.error('Failed to generate workspace:', err);
        btn.disabled = false;
        btn.textContent = 'Generate Discord Workspace';
        alert(err.data?.error || 'Failed to create Discord workspace. Please try again.');
    }
}

async function respondToInvite(action) {
    try {
        await api.post(`/api/teams/${teamId}/respond`, { action });
        await loadTeam();
    } catch (err) {
        console.error('Failed to respond to invite:', err);
    }
}

async function leaveTeam() {
    if (!confirm('Are you sure you want to leave this team?')) return;

    try {
        await api.del(`/api/teams/${teamId}/leave`);
        window.location.href = '/dashboard';
    } catch (err) {
        console.error('Failed to leave team:', err);
        alert(err.data?.error || 'Could not leave team.');
    }
}

async function deleteTeam() {
    if (!confirm('Are you sure you want to delete this team? This action cannot be undone.')) return;

    try {
        await api.delete(`/api/teams/${teamId}`);
        window.location.href = '/dashboard';
    } catch (err) {
        console.error('Failed to delete team:', err);
        alert(err.data?.error || 'Could not delete team.');
    }
}

// ---------------------------------------------------------------------------
// Invite modal
// ---------------------------------------------------------------------------

function closeInviteModal() {
    const modal = $('#inviteModal');
    if (modal) {
        modal.classList.remove('open');
        modal.style.display = 'none';
    }
}

function openInviteModal() {
    const modal = $('#inviteModal');
    if (modal) {
        modal.style.display = '';
        modal.classList.add('open');
    }

    const closeBtn = $('#inviteModalClose');
    if (closeBtn) {
        closeBtn.onclick = () => closeInviteModal();
    }

    // Close on overlay click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeInviteModal();
    });

    const searchInput = $('#inviteSearch');
    const resultsEl = $('#inviteResults');
    if (!searchInput || !resultsEl) return;

    searchInput.value = '';
    resultsEl.innerHTML = '<p class="text-muted">Type a username to search.</p>';
    searchInput.focus();

    let debounceTimer = null;
    searchInput.oninput = () => {
        clearTimeout(debounceTimer);
        const q = searchInput.value.trim();
        if (!q) {
            resultsEl.innerHTML = '<p class="text-muted">Type a username to search.</p>';
            return;
        }
        debounceTimer = setTimeout(() => searchUsers(q, resultsEl), 300);
    };
}

async function searchUsers(query, resultsEl) {
    try {
        const data = await api.get('/api/users/search?q=' + encodeURIComponent(query));
        renderInviteResults(data.users || [], resultsEl);
    } catch (err) {
        resultsEl.innerHTML = '<p class="text-muted">No users found.</p>';
        console.error('User search failed:', err);
    }
}

function renderInviteResults(users, container) {
    container.innerHTML = '';

    if (users.length === 0) {
        container.innerHTML = '<p class="text-muted">No users found.</p>';
        return;
    }

    // Filter out users already in team
    const memberIds = new Set(teamData.members.map(m => m.user_id));

    for (const user of users) {
        if (memberIds.has(user.id)) continue;

        const item = document.createElement('div');
        item.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid var(--color-border)';

        const avatar = user.avatar_url || '/static/img/default-avatar.svg';
        const name = escapeHtml(user.display_name || user.github_handle || user.email || 'User');

        item.innerHTML = `
            <img src="${escapeHtml(avatar)}" alt="" style="width:32px;height:32px;border-radius:50%">
            <span style="flex:1;font-weight:500">${name}</span>
        `;

        const btn = document.createElement('button');
        btn.className = 'btn btn-sm btn-primary';
        btn.textContent = 'Invite';
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.textContent = 'Invited';
            try {
                await api.post(`/api/teams/${teamId}/invite`, { user_id: user.id });
                await loadTeam();
            } catch (err) {
                btn.disabled = false;
                btn.textContent = 'Invite';
                console.error('Failed to invite:', err);
            }
        });

        item.appendChild(btn);
        container.appendChild(item);
    }

    if (container.children.length === 0) {
        container.innerHTML = '<p class="text-muted">All matching users are already in this team.</p>';
    }
}
