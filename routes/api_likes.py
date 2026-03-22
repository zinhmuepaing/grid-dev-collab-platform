"""
Blueprint: Mutual matching ("like") system.

Routes:
    POST   /<user_id>          — Like a user (returns mutual status)
    DELETE /<user_id>          — Unlike a user
    GET    /status/<user_id>   — Single user like status
    GET    /status?ids=3,7,12  — Batch status check
    GET    /mutual             — All mutual matches
    GET    /received           — Users who liked current user (non-mutual)

Exports:
    api_likes_bp — Blueprint instance (registered in app.py with prefix /api/likes)
"""

import logging
from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request

from db import get_db
from routes.auth import login_required

logger = logging.getLogger(__name__)

api_likes_bp = Blueprint("api_likes", __name__)


def _now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _send_system_message(db, receiver_id, content):
    """Insert a system message (sender_id=0)."""
    db.execute(
        "INSERT INTO messages (sender_id, receiver_id, content, created_at) VALUES (0, ?, ?, ?)",
        (receiver_id, content, _now_iso()),
    )


def _get_user_display(db, user_id):
    """Get a display name for a user."""
    row = db.execute(
        "SELECT display_name, github_handle, email FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    if not row:
        return "Someone"
    return row["display_name"] or row["github_handle"] or row["email"] or "Someone"


# ---------------------------------------------------------------------------
# Like / Unlike
# ---------------------------------------------------------------------------

@api_likes_bp.route("/<int:user_id>", methods=["POST"])
@login_required
def like_user(user_id):
    me = g.user_id
    if user_id == me:
        return jsonify({"error": "Cannot like yourself"}), 400

    db = get_db()

    # Check target user exists
    target = db.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
    if not target:
        return jsonify({"error": "User not found"}), 404

    # Parse optional context
    data = request.get_json(silent=True) or {}
    context = data.get("context", "general")
    event_id = data.get("event_id")
    if context not in ("general", "event"):
        context = "general"
    if context != "event":
        event_id = None

    # Idempotent insert
    db.execute(
        "INSERT OR IGNORE INTO user_likes (liker_id, liked_id, context, event_id) VALUES (?, ?, ?, ?)",
        (me, user_id, context, event_id),
    )

    # Check if mutual
    mutual_row = db.execute(
        "SELECT 1 FROM user_likes WHERE liker_id = ? AND liked_id = ?",
        (user_id, me),
    ).fetchone()
    mutual = mutual_row is not None

    if mutual:
        my_name = _get_user_display(db, me)
        their_name = _get_user_display(db, user_id)
        _send_system_message(
            db, user_id,
            f"It's a match! You and {my_name} have both liked each other. Start a conversation!",
        )
        _send_system_message(
            db, me,
            f"It's a match! You and {their_name} have both liked each other. Start a conversation!",
        )

    db.commit()
    return jsonify({"ok": True, "mutual": mutual})


@api_likes_bp.route("/<int:user_id>", methods=["DELETE"])
@login_required
def unlike_user(user_id):
    me = g.user_id
    db = get_db()
    db.execute(
        "DELETE FROM user_likes WHERE liker_id = ? AND liked_id = ?",
        (me, user_id),
    )
    db.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Status checks
# ---------------------------------------------------------------------------

@api_likes_bp.route("/status/<int:user_id>")
@login_required
def like_status_single(user_id):
    me = g.user_id
    db = get_db()

    i_liked = db.execute(
        "SELECT 1 FROM user_likes WHERE liker_id = ? AND liked_id = ?",
        (me, user_id),
    ).fetchone() is not None

    they_liked = db.execute(
        "SELECT 1 FROM user_likes WHERE liker_id = ? AND liked_id = ?",
        (user_id, me),
    ).fetchone() is not None

    return jsonify({
        "user_id": user_id,
        "i_liked": i_liked,
        "they_liked": they_liked,
        "mutual": i_liked and they_liked,
    })


@api_likes_bp.route("/status")
@login_required
def like_status_batch():
    me = g.user_id
    ids_param = request.args.get("ids", "")
    if not ids_param:
        return jsonify({"statuses": {}})

    try:
        user_ids = [int(x.strip()) for x in ids_param.split(",") if x.strip()]
    except ValueError:
        return jsonify({"error": "Invalid ids parameter"}), 400

    if not user_ids:
        return jsonify({"statuses": {}})

    db = get_db()
    placeholders = ",".join("?" * len(user_ids))

    # My outgoing likes
    i_liked_rows = db.execute(
        f"SELECT liked_id FROM user_likes WHERE liker_id = ? AND liked_id IN ({placeholders})",
        (me, *user_ids),
    ).fetchall()
    i_liked_set = {row["liked_id"] for row in i_liked_rows}

    # Incoming likes to me
    they_liked_rows = db.execute(
        f"SELECT liker_id FROM user_likes WHERE liked_id = ? AND liker_id IN ({placeholders})",
        (me, *user_ids),
    ).fetchall()
    they_liked_set = {row["liker_id"] for row in they_liked_rows}

    statuses = {}
    for uid in user_ids:
        i_liked = uid in i_liked_set
        they_liked = uid in they_liked_set
        statuses[str(uid)] = {
            "i_liked": i_liked,
            "they_liked": they_liked,
            "mutual": i_liked and they_liked,
        }

    return jsonify({"statuses": statuses})


# ---------------------------------------------------------------------------
# Lists
# ---------------------------------------------------------------------------

@api_likes_bp.route("/mutual")
@login_required
def mutual_matches():
    me = g.user_id
    db = get_db()

    rows = db.execute("""
        SELECT u.id, u.github_handle, u.display_name, u.avatar_url, u.email,
               l1.created_at AS liked_at
        FROM user_likes l1
        JOIN user_likes l2 ON l1.liked_id = l2.liker_id AND l1.liker_id = l2.liked_id
        JOIN users u ON u.id = l1.liked_id
        WHERE l1.liker_id = ?
        ORDER BY l1.created_at DESC
    """, (me,)).fetchall()

    matches = []
    for row in rows:
        matches.append({
            "id": row["id"],
            "github_handle": row["github_handle"],
            "display_name": row["display_name"],
            "avatar_url": row["avatar_url"],
            "email": row["email"],
            "liked_at": row["liked_at"],
        })

    return jsonify({"matches": matches})


@api_likes_bp.route("/received")
@login_required
def received_likes():
    me = g.user_id
    db = get_db()

    rows = db.execute("""
        SELECT u.id, u.github_handle, u.display_name, u.avatar_url, u.email,
               l.created_at AS liked_at
        FROM user_likes l
        JOIN users u ON u.id = l.liker_id
        WHERE l.liked_id = ?
          AND NOT EXISTS (
              SELECT 1 FROM user_likes l2
              WHERE l2.liker_id = ? AND l2.liked_id = l.liker_id
          )
        ORDER BY l.created_at DESC
    """, (me, me)).fetchall()

    received = []
    for row in rows:
        received.append({
            "id": row["id"],
            "github_handle": row["github_handle"],
            "display_name": row["display_name"],
            "avatar_url": row["avatar_url"],
            "email": row["email"],
            "liked_at": row["liked_at"],
        })

    return jsonify({"received": received})
