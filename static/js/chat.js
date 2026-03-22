/**
 * Grid — Inbox / Direct Messaging
 *
 * Short-polling chat with 2-second intervals.
 * Renders messages with avatar-beside-bubble layout (shadcn ChatBubble pattern).
 * Exports initInbox() to be called from inbox.html.
 */

import api from './api.js';
import { escapeHtml, formatRelativeTime, scrollToBottom, $ } from './utils.js';
import { fetchLikeStatuses, buildLikeButton } from './likes.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentConversationUserId = null;
let currentConversationUser = null; // full user object for avatar etc.
let lastTimestamp = null;
let pollingIntervalId = null;
let myUserId = null; // current logged-in user's ID

// Track the last rendered message date for date dividers
let lastRenderedDate = null;

// Discord invite URL pattern
const DISCORD_INVITE_RE = /https?:\/\/(discord\.gg|discord\.com\/invite)\/[\w-]+/i;

// DOM references (set in initInbox)
let conversationListEl = null;
let chatPanelEl = null;
let chatEmptyEl = null;
let chatActiveEl = null;
let chatMessagesEl = null;
let chatUserNameEl = null;
let chatUserHandleEl = null;
let chatUserAvatarEl = null;
let messageInput = null;
let sendBtn = null;
let scrollToBottomBtn = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dateDividerLabel(dateStr) {
    const msgDate = new Date(dateStr);
    const today = new Date();
    const msgDay = new Date(msgDate.getFullYear(), msgDate.getMonth(), msgDate.getDate());
    const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const diffMs = todayDay - msgDay;
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';

    return msgDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

function toDateKey(dateStr) {
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function extractDiscordInviteUrl(text) {
    const match = text.match(DISCORD_INVITE_RE);
    return match ? match[0] : null;
}

// ---------------------------------------------------------------------------
// Fetch current user
// ---------------------------------------------------------------------------

async function fetchMyUser() {
    try {
        const data = await api.get('/auth/me');
        if (data && data.user) {
            myUserId = data.user.id;
        }
    } catch (err) {
        // non-critical
    }
}

// ---------------------------------------------------------------------------
// Conversations sidebar
// ---------------------------------------------------------------------------

async function loadConversations() {
    try {
        const data = await api.get('/api/messages/conversations');
        renderConversationList(data.conversations);
        await addLikeIndicators(data.conversations);
    } catch (err) {
        console.error('Failed to load conversations:', err);
    }
}

async function addLikeIndicators(conversations) {
    if (!conversations || conversations.length === 0) return;
    const userIds = conversations.map(function (c) { return c.user.id; });
    const statuses = await fetchLikeStatuses(userIds);

    const indicators = document.querySelectorAll('.conv-like-indicator');
    for (const el of indicators) {
        const uid = Number(el.dataset.convUserId);
        const status = statuses.get(uid);
        if (!status) continue;

        if (status.mutual) {
            el.textContent = '\u2605';
            el.classList.add('mutual');
            el.title = 'Mutual match';
        } else if (status.they_liked) {
            el.textContent = '\u2661';
            el.classList.add('they-liked');
            el.title = 'Likes you';
        } else if (status.i_liked) {
            el.textContent = '\u2665';
            el.classList.add('i-liked');
            el.title = 'You liked';
        }
    }
}

function renderConversationList(conversations) {
    if (!conversationListEl) return;

    if (conversations.length === 0) {
        conversationListEl.innerHTML =
            '<div class="inbox-empty-state" style="padding:24px"><p style="color:var(--color-text-muted);font-size:0.8125rem">No conversations yet.</p></div>';
        return;
    }

    conversationListEl.innerHTML = '';

    for (const conv of conversations) {
        const el = document.createElement('div');
        el.className = 'conversation-item' +
            (conv.unread > 0 ? ' unread' : '') +
            (conv.user.id === currentConversationUserId ? ' active' : '');
        el.dataset.userId = conv.user.id;
        el.dataset.displayName = (conv.user.display_name || '').toLowerCase();
        el.dataset.githubHandle = (conv.user.github_handle || '').toLowerCase();
        el.dataset.email = (conv.user.email || '').toLowerCase();

        const avatarSrc = escapeHtml(conv.user.avatar_url || '/static/img/default-avatar.svg');
        const name = escapeHtml(conv.user.display_name || conv.user.github_handle || conv.user.email || 'User');
        const preview = conv.last_message.is_mine
            ? 'You: ' + escapeHtml(conv.last_message.content)
            : escapeHtml(conv.last_message.content);
        const time = formatRelativeTime(conv.last_message.timestamp);

        el.innerHTML = `
            <img class="conv-avatar" src="${avatarSrc}" alt="">
            <div class="conv-details">
                <div class="conv-name">${name}</div>
                <div class="conv-preview">${preview}</div>
            </div>
            <div class="conv-meta">
                <span class="conv-time">${escapeHtml(time)}</span>
                ${conv.unread > 0 ? `<span class="conv-unread">${conv.unread}</span>` : ''}
                <span class="conv-like-indicator" data-conv-user-id="${conv.user.id}"></span>
            </div>
        `;

        el.addEventListener('click', () => {
            openConversation(conv.user);
        });

        conversationListEl.appendChild(el);
    }
}

// ---------------------------------------------------------------------------
// Conversation search / filter
// ---------------------------------------------------------------------------

function filterConversations(query) {
    if (!conversationListEl) return;
    const q = (query || '').toLowerCase().trim();
    const items = conversationListEl.querySelectorAll('.conversation-item');

    for (const item of items) {
        if (!q) {
            item.classList.remove('hidden');
            continue;
        }
        const displayName = item.dataset.displayName || '';
        const githubHandle = item.dataset.githubHandle || '';
        const email = item.dataset.email || '';
        const matches = displayName.includes(q) || githubHandle.includes(q) || email.includes(q);
        item.classList.toggle('hidden', !matches);
    }
}

// ---------------------------------------------------------------------------
// Open a conversation
// ---------------------------------------------------------------------------

async function openConversation(user) {
    stopPolling();

    currentConversationUserId = user.id;
    currentConversationUser = user;
    lastRenderedDate = null;

    // Update sidebar active state
    const items = conversationListEl.querySelectorAll('.conversation-item');
    for (const item of items) {
        item.classList.toggle('active', Number(item.dataset.userId) === user.id);
        if (Number(item.dataset.userId) === user.id) {
            item.classList.remove('unread');
            const badge = item.querySelector('.conv-unread');
            if (badge) badge.remove();
        }
    }

    // Show active chat panel, hide empty state
    if (chatEmptyEl) chatEmptyEl.style.display = 'none';
    if (chatActiveEl) chatActiveEl.style.display = 'flex';

    // Set header
    const avatarSrc = user.avatar_url || '/static/img/default-avatar.svg';
    if (chatUserAvatarEl) chatUserAvatarEl.src = avatarSrc;
    if (chatUserNameEl) chatUserNameEl.textContent = user.display_name || user.github_handle || user.email || 'User';
    if (chatUserHandleEl) {
        if (user.github_handle) {
            chatUserHandleEl.textContent = '@' + user.github_handle;
        } else if (user.email) {
            chatUserHandleEl.textContent = user.email;
        } else {
            chatUserHandleEl.textContent = '';
        }
    }

    // Set up profile link + like button in chat header actions
    const actionsEl = document.getElementById('chatHeaderActions');
    if (actionsEl) {
        actionsEl.innerHTML = `<a href="/profile/${user.id}" class="btn btn-sm btn-outline">Profile</a>`;

        try {
            const statuses = await fetchLikeStatuses([user.id]);
            const likeStatus = statuses.get(user.id) || { i_liked: false, they_liked: false, mutual: false };
            const likeBtn = buildLikeButton(user.id, likeStatus, null, {
                displayName: user.display_name || user.github_handle || user.email || 'User',
                avatarUrl: user.avatar_url || ''
            });
            actionsEl.appendChild(likeBtn);
        } catch (err) {
            // non-critical
        }
    }

    // Set loading indicator avatar
    const loadingAvatar = document.getElementById('chatLoadingAvatar');
    if (loadingAvatar) loadingAvatar.src = avatarSrc;

    // Clear messages area
    if (chatMessagesEl) chatMessagesEl.innerHTML = '';

    // Focus input
    if (messageInput) messageInput.focus();

    // Fetch message history
    try {
        const data = await api.get(`/api/messages/${user.id}`);
        renderMessages(data.messages);
        lastTimestamp = data.server_time;

        // Scroll to bottom on initial load
        if (chatMessagesEl) {
            chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
        }
    } catch (err) {
        console.error('Failed to load messages:', err);
    }

    // Mark as read
    try {
        await api.post(`/api/messages/read/${user.id}`);
    } catch (err) {
        // non-critical
    }

    startPolling();
}

// ---------------------------------------------------------------------------
// Message rendering (shadcn ChatBubble pattern: avatar + message side by side)
// ---------------------------------------------------------------------------

function renderMessages(messages) {
    if (!chatMessagesEl) return;
    for (const msg of messages) {
        maybeInsertDateDivider(msg.created_at);
        appendBubble(msg);
    }
}

function maybeInsertDateDivider(createdAt) {
    if (!chatMessagesEl) return;
    const dateKey = toDateKey(createdAt);
    if (dateKey !== lastRenderedDate) {
        lastRenderedDate = dateKey;
        const divider = document.createElement('div');
        divider.className = 'message-date-divider';
        divider.innerHTML = `<span>${dateDividerLabel(createdAt)}</span>`;
        chatMessagesEl.appendChild(divider);
    }
}

function appendBubble(msg) {
    if (!chatMessagesEl) return;

    const isSystem = msg.sender_id === 0;

    // Discord invite card for system messages
    if (isSystem) {
        const discordUrl = extractDiscordInviteUrl(msg.content);
        if (discordUrl) {
            appendDiscordInviteCard(msg, discordUrl);
            return;
        }
        // Regular system message
        const sysEl = document.createElement('div');
        sysEl.className = 'chat-bubble system';
        sysEl.dataset.messageId = msg.id || '';
        sysEl.innerHTML = `<div class="system-message-text">${escapeHtml(msg.content)}</div>`;
        chatMessagesEl.appendChild(sysEl);
        return;
    }

    const isMine = msg.sender_id !== currentConversationUserId;
    const variant = isMine ? 'sent' : 'received';
    const time = formatRelativeTime(msg.created_at);

    // Avatar: for sent messages use current user's avatar (fallback), for received use partner's
    const myAvatar = '/static/img/default-avatar.svg'; // will be overridden if we have it
    const partnerAvatar = currentConversationUser
        ? (currentConversationUser.avatar_url || '/static/img/default-avatar.svg')
        : '/static/img/default-avatar.svg';

    const avatarSrc = isMine ? myAvatar : partnerAvatar;

    // Build the chat-bubble element (shadcn pattern: flex row with avatar + message)
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${variant}`;
    bubble.dataset.messageId = msg.id || '';

    bubble.innerHTML = `
        <img class="chat-bubble-avatar" src="${escapeHtml(avatarSrc)}" alt="" loading="lazy">
        <div class="chat-bubble-message ${variant}">
            <span class="message-text">${escapeHtml(msg.content)}</span>
            <span class="message-time">${escapeHtml(time)}</span>
        </div>
    `;

    chatMessagesEl.appendChild(bubble);
}

function appendDiscordInviteCard(msg, url) {
    if (!chatMessagesEl) return;

    const card = document.createElement('div');
    card.className = 'chat-bubble system';
    card.dataset.messageId = msg.id || '';

    card.innerHTML = `
        <div class="discord-invite-card">
            <div class="discord-invite-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="#5865F2"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
            </div>
            <div class="discord-invite-info">
                <div class="discord-invite-label">Team Discord Workspace</div>
                <div class="discord-invite-desc">You've been invited to join your team's workspace</div>
            </div>
            <a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="discord-join-btn">Join</a>
        </div>
    `;

    chatMessagesEl.appendChild(card);
}

// ---------------------------------------------------------------------------
// Scroll-to-bottom button
// ---------------------------------------------------------------------------

function updateScrollToBottomBtn() {
    if (!scrollToBottomBtn || !chatMessagesEl) return;
    const atBottom = isScrolledToBottom();
    scrollToBottomBtn.classList.toggle('visible', !atBottom);
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

function startPolling() {
    if (pollingIntervalId) clearInterval(pollingIntervalId);

    pollingIntervalId = setInterval(async () => {
        if (!currentConversationUserId || !lastTimestamp) return;

        try {
            const data = await api.get(
                `/api/messages/${currentConversationUserId}?after=${encodeURIComponent(lastTimestamp)}`
            );

            if (data.messages.length > 0) {
                const wasAtBottom = isScrolledToBottom();

                for (const msg of data.messages) {
                    maybeInsertDateDivider(msg.created_at);
                    appendBubble(msg);
                }

                lastTimestamp = data.server_time;

                if (wasAtBottom && chatMessagesEl) {
                    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
                }

                // Mark new messages as read
                try {
                    await api.post(`/api/messages/read/${currentConversationUserId}`);
                } catch (err) {
                    // non-critical
                }
            }
        } catch (err) {
            console.error('Polling error:', err);
        }
    }, 2000);
}

function stopPolling() {
    if (pollingIntervalId) {
        clearInterval(pollingIntervalId);
        pollingIntervalId = null;
    }
}

function isScrolledToBottom() {
    if (!chatMessagesEl) return true;
    const threshold = 100;
    return (chatMessagesEl.scrollHeight - chatMessagesEl.scrollTop - chatMessagesEl.clientHeight) <= threshold;
}

// ---------------------------------------------------------------------------
// Send message
// ---------------------------------------------------------------------------

async function sendMessage() {
    if (!currentConversationUserId || !messageInput) return;

    const content = messageInput.value.trim();
    if (!content) return;

    // Clear input immediately
    messageInput.value = '';
    messageInput.style.height = 'auto';

    // Optimistically append bubble (with date divider if needed)
    const now = new Date().toISOString();
    const tempMsg = {
        id: 'temp-' + Date.now(),
        sender_id: null,
        content: content,
        created_at: now,
    };
    maybeInsertDateDivider(now);
    appendBubble(tempMsg);

    // Scroll to bottom
    if (chatMessagesEl) {
        chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    }

    try {
        const data = await api.post(`/api/messages/${currentConversationUserId}`, { content });
        const tempBubble = chatMessagesEl.querySelector(`[data-message-id="temp-${tempMsg.id.split('-')[1]}"]`);
        if (tempBubble) {
            tempBubble.dataset.messageId = data.message.id;
        }
    } catch (err) {
        console.error('Failed to send message:', err);
        const bubbles = chatMessagesEl.querySelectorAll('.chat-bubble.sent');
        const lastBubble = bubbles[bubbles.length - 1];
        if (lastBubble) {
            const msgEl = lastBubble.querySelector('.chat-bubble-message');
            if (msgEl) msgEl.classList.add('failed');
            const retryBtn = document.createElement('span');
            retryBtn.className = 'retry-btn';
            retryBtn.textContent = 'Failed to send. Click to retry.';
            retryBtn.addEventListener('click', async () => {
                if (msgEl) msgEl.classList.remove('failed');
                retryBtn.remove();
                try {
                    await api.post(`/api/messages/${currentConversationUserId}`, { content });
                } catch (retryErr) {
                    if (msgEl) msgEl.classList.add('failed');
                    if (msgEl) msgEl.appendChild(retryBtn);
                }
            });
            if (msgEl) msgEl.appendChild(retryBtn);
        }
    }
}

// ---------------------------------------------------------------------------
// Auto-resize textarea
// ---------------------------------------------------------------------------

function autoResizeTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export function initInbox() {
    // Cache DOM references
    conversationListEl = $('#conversationList');
    chatPanelEl = $('#chatPanel');
    chatEmptyEl = $('#chatEmpty');
    chatActiveEl = $('#chatActive');
    chatMessagesEl = $('#chatMessages');
    chatUserNameEl = $('#chatUserName');
    chatUserHandleEl = $('#chatUserHandle');
    chatUserAvatarEl = $('#chatUserAvatar');
    messageInput = $('#messageInput');
    sendBtn = $('#sendBtn');
    scrollToBottomBtn = document.getElementById('scrollToBottomBtn');

    // Fetch current user info (for avatar in sent bubbles)
    fetchMyUser();

    // Load conversation list
    loadConversations();

    // Conversation search / filter
    const searchInput = document.getElementById('conversationSearch');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            filterConversations(searchInput.value);
        });
    }

    // Send button
    if (sendBtn) {
        sendBtn.addEventListener('click', sendMessage);
    }

    // Enter to send (Shift+Enter for new line)
    if (messageInput) {
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        messageInput.addEventListener('input', () => {
            autoResizeTextarea(messageInput);
        });
    }

    // Scroll-to-bottom button
    if (scrollToBottomBtn) {
        scrollToBottomBtn.addEventListener('click', () => {
            if (chatMessagesEl) {
                chatMessagesEl.scrollTo({ top: chatMessagesEl.scrollHeight, behavior: 'smooth' });
            }
        });
    }

    // Track scroll position for scroll-to-bottom button visibility
    if (chatMessagesEl) {
        chatMessagesEl.addEventListener('scroll', updateScrollToBottomBtn);
    }

    // Back button (mobile)
    const backBtn = $('#chatBackBtn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            stopPolling();
            currentConversationUserId = null;
            currentConversationUser = null;
            if (chatEmptyEl) chatEmptyEl.style.display = '';
            if (chatActiveEl) chatActiveEl.style.display = 'none';

            const sidebar = $('.inbox-sidebar');
            const panel = $('.chat-panel');
            if (sidebar) sidebar.classList.remove('hidden-mobile');
            if (panel) panel.classList.add('hidden-mobile');
        });
    }

    // Check URL params for ?user=<id> to auto-open a conversation
    const params = new URLSearchParams(window.location.search);
    const autoOpenUserId = params.get('user');
    if (autoOpenUserId) {
        api.get(`/api/users/${autoOpenUserId}`)
            .then((data) => {
                openConversation(data.user);
            })
            .catch((err) => {
                console.error('Could not auto-open conversation:', err);
            });
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        stopPolling();
    });
}
