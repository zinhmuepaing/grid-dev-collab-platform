"""
Blueprint: Direct messaging between users.

Routes:
    GET  /conversations      — List conversation partners with last message & unread count
    GET  /<user_id>          — Fetch messages with a specific user (supports ?after= polling)
    POST /<user_id>          — Send a message to a user
    GET  /unread-count       — Total unread message count for current user
    POST /read/<user_id>     — Mark all messages from user_id as read

Exports:
    api_messages_bp — Blueprint instance (registered in app.py with prefix /api/messages)
"""

import logging
from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request

from db import get_db
from routes.auth import login_required

logger = logging.getLogger(__name__)

api_messages_bp = Blueprint("api_messages", __name__)

MAX_CONTENT_LENGTH = 2000


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_iso():
    """Return current UTC time as ISO 8601 string (matches SQLite datetime('now'))."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@api_messages_bp.route("/conversations")
@login_required
def list_conversations():
    """List all conversation partners for the current user.

    For each unique partner, returns their user info, the last message,
    and unread count.  Ordered by most recent message first.
    """
    db = get_db()
    uid = g.user_id

    # Find distinct conversation partners with the most recent message
    rows = db.execute(
        """
        SELECT
            u.id,
            u.github_handle,
            u.email,
            u.auth_provider,
            u.display_name,
            u.avatar_url,
            last_msg.content      AS last_content,
            last_msg.created_at   AS last_timestamp,
            last_msg.sender_id    AS last_sender_id,
            COALESCE(unread.cnt, 0) AS unread
        FROM (
            -- All distinct partners
            SELECT DISTINCT
                CASE WHEN sender_id = :uid THEN receiver_id ELSE sender_id END AS partner_id
            FROM messages
            WHERE sender_id = :uid OR receiver_id = :uid
        ) partners
        JOIN users u ON u.id = partners.partner_id
        -- Latest message in each conversation
        JOIN messages last_msg ON last_msg.id = (
            SELECT m.id FROM messages m
            WHERE (m.sender_id = :uid AND m.receiver_id = partners.partner_id)
               OR (m.sender_id = partners.partner_id AND m.receiver_id = :uid)
            ORDER BY m.created_at DESC
            LIMIT 1
        )
        -- Unread count from this partner
        LEFT JOIN (
            SELECT sender_id, COUNT(*) AS cnt
            FROM messages
            WHERE receiver_id = :uid AND is_read = 0
            GROUP BY sender_id
        ) unread ON unread.sender_id = partners.partner_id
        ORDER BY last_msg.created_at DESC
        """,
        {"uid": uid},
    ).fetchall()

    conversations = []
    for r in rows:
        conversations.append({
            "user": {
                "id": r["id"],
                "github_handle": r["github_handle"],
                "email": r["email"],
                "auth_provider": r["auth_provider"],
                "display_name": r["display_name"],
                "avatar_url": r["avatar_url"],
            },
            "last_message": {
                "content": r["last_content"],
                "timestamp": r["last_timestamp"],
                "is_mine": r["last_sender_id"] == uid,
            },
            "unread": r["unread"],
        })

    return jsonify({"conversations": conversations})


@api_messages_bp.route("/<int:user_id>")
@login_required
def get_messages(user_id):
    """Get messages between current user and user_id.

    Query params:
        after  — ISO timestamp; only return messages created after this time
        limit  — max number of messages to return (default 50)
    """
    db = get_db()
    uid = g.user_id

    after = request.args.get("after")
    limit = request.args.get("limit", 50, type=int)
    limit = min(max(limit, 1), 200)  # clamp between 1 and 200

    if after:
        rows = db.execute(
            """
            SELECT id, sender_id, content, created_at
            FROM messages
            WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
              AND created_at > ?
            ORDER BY created_at ASC
            LIMIT ?
            """,
            (uid, user_id, user_id, uid, after, limit),
        ).fetchall()
    else:
        rows = db.execute(
            """
            SELECT id, sender_id, content, created_at
            FROM messages
            WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
            ORDER BY created_at ASC
            LIMIT ?
            """,
            (uid, user_id, user_id, uid, limit),
        ).fetchall()

    messages = [
        {
            "id": r["id"],
            "sender_id": r["sender_id"],
            "content": r["content"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]

    return jsonify({
        "messages": messages,
        "server_time": _now_iso(),
    })


@api_messages_bp.route("/<int:user_id>", methods=["POST"])
@login_required
def send_message(user_id):
    """Send a message to user_id. Expects JSON: {"content": "..."}."""
    db = get_db()
    uid = g.user_id

    if uid == user_id:
        return jsonify({"error": "Cannot send a message to yourself"}), 400

    # Verify recipient exists
    recipient = db.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
    if recipient is None:
        return jsonify({"error": "User not found"}), 404

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    content = (data.get("content") or "").strip()
    if not content:
        return jsonify({"error": "Message content cannot be empty"}), 400

    if len(content) > MAX_CONTENT_LENGTH:
        return jsonify({"error": f"Message exceeds {MAX_CONTENT_LENGTH} character limit"}), 400

    cursor = db.execute(
        """
        INSERT INTO messages (sender_id, receiver_id, content)
        VALUES (?, ?, ?)
        """,
        (uid, user_id, content),
    )
    db.commit()

    msg = db.execute(
        "SELECT id, sender_id, receiver_id, content, created_at FROM messages WHERE id = ?",
        (cursor.lastrowid,),
    ).fetchone()

    return jsonify({
        "message": {
            "id": msg["id"],
            "sender_id": msg["sender_id"],
            "receiver_id": msg["receiver_id"],
            "content": msg["content"],
            "created_at": msg["created_at"],
        }
    }), 201


@api_messages_bp.route("/unread-count")
@login_required
def unread_count():
    """Return the total number of unread messages for the current user."""
    db = get_db()

    row = db.execute(
        "SELECT COUNT(*) AS cnt FROM messages WHERE receiver_id = ? AND is_read = 0",
        (g.user_id,),
    ).fetchone()

    return jsonify({"count": row["cnt"]})


@api_messages_bp.route("/read/<int:user_id>", methods=["POST"])
@login_required
def mark_read(user_id):
    """Mark all messages from user_id to the current user as read."""
    db = get_db()

    db.execute(
        """
        UPDATE messages
        SET is_read = 1
        WHERE sender_id = ? AND receiver_id = ? AND is_read = 0
        """,
        (user_id, g.user_id),
    )
    db.commit()

    return jsonify({"ok": True})
