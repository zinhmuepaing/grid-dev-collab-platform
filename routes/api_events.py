"""
Blueprint: Hackathon events — browsing, detail, and interest toggling.

Routes:
    GET  /                      — List events (paginated, searchable)
    GET  /<event_id>            — Single event detail with interest info
    GET  /<event_id>/interested — Users interested in this event
    POST /<event_id>/interest   — Mark current user as interested
    DELETE /<event_id>/interest — Remove current user's interest

Exports:
    api_events_bp — Blueprint instance (registered in app.py with prefix /api/events)
"""

import json
import logging

from flask import Blueprint, g, jsonify, request, session

from db import get_db
from routes.auth import login_required

logger = logging.getLogger(__name__)

api_events_bp = Blueprint("api_events", __name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _event_dict(row):
    """Convert an event database row to a JSON-safe dict."""
    tags = row["tags"]
    if isinstance(tags, str):
        try:
            tags = json.loads(tags)
        except (json.JSONDecodeError, TypeError):
            tags = []

    return {
        "id": row["id"],
        "title": row["title"],
        "url": row["url"],
        "description": row["description"],
        "organizer": row["organizer"],
        "start_date": row["start_date"],
        "end_date": row["end_date"],
        "registration_deadline": row["registration_deadline"],
        "location": row["location"],
        "tags": tags,
        "image_url": row["image_url"],
        "source_site": row["source_site"],
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@api_events_bp.route("/", strict_slashes=False)
def list_events():
    """Return paginated list of active events. Optional ?q= search, ?interested=mine filter."""
    db = get_db()

    q = request.args.get("q", "").strip()
    interested = request.args.get("interested", "").strip()
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 20, type=int)

    # Clamp values
    page = max(1, page)
    per_page = max(1, min(per_page, 100))
    offset = (page - 1) * per_page

    # Filter to only events the current user is interested in
    filter_mine = interested == "mine"
    current_user_id = session.get("user_id")

    if filter_mine and not current_user_id:
        return jsonify({"events": [], "total": 0, "page": page})

    # Build the JOIN and WHERE clauses
    join_clause = ""
    where_conditions = ["e.is_active = 1"]
    params = []

    if filter_mine:
        join_clause = "JOIN event_interests ei_filter ON ei_filter.event_id = e.id AND ei_filter.user_id = ?"
        params.append(current_user_id)

    if q:
        like_pattern = f"%{q}%"
        where_conditions.append("(e.title LIKE ? OR e.description LIKE ?)")
        params.append(like_pattern)
        params.append(like_pattern)

    where_clause = " AND ".join(where_conditions)

    count_row = db.execute(
        f"SELECT COUNT(*) FROM events e {join_clause} WHERE {where_clause}",
        params,
    ).fetchone()
    total = count_row[0]

    rows = db.execute(
        f"""
        SELECT e.*,
               (SELECT COUNT(*) FROM event_interests ei WHERE ei.event_id = e.id) AS interested_count
        FROM events e
        {join_clause}
        WHERE {where_clause}
        ORDER BY e.start_date ASC, e.created_at DESC
        LIMIT ? OFFSET ?
        """,
        params + [per_page, offset],
    ).fetchall()

    events = []
    for row in rows:
        event = _event_dict(row)
        event["interested_count"] = row["interested_count"]
        events.append(event)

    return jsonify({"events": events, "total": total, "page": page})


@api_events_bp.route("/<int:event_id>")
@login_required
def get_event(event_id):
    """Return a single event with interested_count and user_interested flag."""
    db = get_db()

    row = db.execute(
        """
        SELECT e.*,
               (SELECT COUNT(*) FROM event_interests ei WHERE ei.event_id = e.id) AS interested_count
        FROM events e
        WHERE e.id = ?
        """,
        (event_id,),
    ).fetchone()

    if row is None:
        return jsonify({"error": "Event not found"}), 404

    # Check if the current user is interested
    interest = db.execute(
        "SELECT 1 FROM event_interests WHERE user_id = ? AND event_id = ?",
        (g.user_id, event_id),
    ).fetchone()

    event = _event_dict(row)
    event["interested_count"] = row["interested_count"]
    event["user_interested"] = interest is not None

    return jsonify({
        "event": event,
        "interested_count": row["interested_count"],
        "user_interested": interest is not None,
    })


@api_events_bp.route("/<int:event_id>/interested")
@login_required
def get_interested_users(event_id):
    """Return list of users interested in this event, with avatar, handle, and skills."""
    db = get_db()

    # Verify event exists
    event = db.execute("SELECT id FROM events WHERE id = ?", (event_id,)).fetchone()
    if event is None:
        return jsonify({"error": "Event not found"}), 404

    rows = db.execute(
        """
        SELECT u.id, u.github_handle, u.email, u.auth_provider, u.display_name, u.avatar_url
        FROM event_interests ei
        JOIN users u ON ei.user_id = u.id
        WHERE ei.event_id = ? AND ei.user_id != ?
        ORDER BY ei.created_at DESC
        """,
        (event_id, g.user_id),
    ).fetchall()

    users = []
    for row in rows:
        # Fetch skills for each interested user
        skill_rows = db.execute(
            """
            SELECT s.id, s.name, us.level
            FROM user_skills us
            JOIN skills s ON us.skill_id = s.id
            WHERE us.user_id = ?
            ORDER BY s.name
            """,
            (row["id"],),
        ).fetchall()

        users.append({
            "id": row["id"],
            "github_handle": row["github_handle"],
            "email": row["email"],
            "auth_provider": row["auth_provider"],
            "display_name": row["display_name"],
            "avatar_url": row["avatar_url"],
            "skills": [{"id": s["id"], "name": s["name"], "level": s["level"]} for s in skill_rows],
        })

    return jsonify({"users": users})


@api_events_bp.route("/<int:event_id>/interest", methods=["POST"])
@login_required
def add_interest(event_id):
    """Add current user's interest in an event."""
    db = get_db()

    # Verify event exists
    event = db.execute("SELECT id FROM events WHERE id = ?", (event_id,)).fetchone()
    if event is None:
        return jsonify({"error": "Event not found"}), 404

    db.execute(
        "INSERT OR IGNORE INTO event_interests (user_id, event_id) VALUES (?, ?)",
        (g.user_id, event_id),
    )
    db.commit()

    return jsonify({"interested": True})


@api_events_bp.route("/<int:event_id>/interest", methods=["DELETE"])
@login_required
def remove_interest(event_id):
    """Remove current user's interest in an event."""
    db = get_db()

    db.execute(
        "DELETE FROM event_interests WHERE user_id = ? AND event_id = ?",
        (g.user_id, event_id),
    )
    db.commit()

    return jsonify({"interested": False})
