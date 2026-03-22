"""
Blueprint: User profiles, skills, and availability.

Routes:
    GET  /skills/all          — Master skill list (with optional ?q= filter)
    GET  /<user_id>           — Public profile with skills & availability
    PUT  /me                  — Update current user's profile fields
    PUT  /me/skills           — Replace current user's skill set
    PUT  /me/availability     — Replace current user's availability grid
    POST /me/onboard          — First-time onboarding (bio + skills + availability)

Exports:
    api_users_bp — Blueprint instance (registered in app.py with prefix /api/users)
"""

import logging

from flask import Blueprint, g, jsonify, request

from db import get_db
from routes.auth import login_required

logger = logging.getLogger(__name__)

api_users_bp = Blueprint("api_users", __name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

VALID_LEVELS = {"beginner", "intermediate", "advanced"}


def _user_dict(row):
    """Convert a user database row to a JSON-safe dict."""
    return {
        "id": row["id"],
        "github_handle": row["github_handle"],
        "email": row["email"] if "email" in row.keys() else None,
        "auth_provider": row["auth_provider"] if "auth_provider" in row.keys() else "github",
        "display_name": row["display_name"],
        "avatar_url": row["avatar_url"],
        "bio": row["bio"],
        "timezone": row["timezone"],
    }


def _fetch_user_skills(db, user_id):
    """Return list of skill dicts for a user."""
    rows = db.execute(
        """
        SELECT s.id, s.name, us.level
        FROM user_skills us
        JOIN skills s ON us.skill_id = s.id
        WHERE us.user_id = ?
        ORDER BY s.name
        """,
        (user_id,),
    ).fetchall()
    return [{"id": r["id"], "name": r["name"], "level": r["level"]} for r in rows]


def _fetch_user_availability(db, user_id):
    """Return list of [day_of_week, hour_block] pairs for a user."""
    rows = db.execute(
        "SELECT day_of_week, hour_block FROM availability WHERE user_id = ? ORDER BY day_of_week, hour_block",
        (user_id,),
    ).fetchall()
    return [[r["day_of_week"], r["hour_block"]] for r in rows]


def _replace_skills(db, user_id, skills_list):
    """Delete existing skills and insert new ones. Returns the new skill list."""
    db.execute("DELETE FROM user_skills WHERE user_id = ?", (user_id,))
    for entry in skills_list:
        skill_id = entry.get("skill_id")
        level = entry.get("level", "intermediate")
        if skill_id is None:
            continue
        if level not in VALID_LEVELS:
            level = "intermediate"
        db.execute(
            "INSERT INTO user_skills (user_id, skill_id, level) VALUES (?, ?, ?)",
            (user_id, skill_id, level),
        )
    return _fetch_user_skills(db, user_id)


def _replace_availability(db, user_id, slots):
    """Delete existing availability and insert new slots. Returns count."""
    db.execute("DELETE FROM availability WHERE user_id = ?", (user_id,))
    count = 0
    for slot in slots:
        if not isinstance(slot, (list, tuple)) or len(slot) != 2:
            continue
        day, hour = slot
        if not isinstance(day, int) or not isinstance(hour, int):
            continue
        if not (0 <= day <= 6) or not (0 <= hour <= 23):
            continue
        db.execute(
            "INSERT OR IGNORE INTO availability (user_id, day_of_week, hour_block) VALUES (?, ?, ?)",
            (user_id, day, hour),
        )
        count += 1
    return count


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@api_users_bp.route("/skills/all")
def get_all_skills():
    """Return master skill list. Optional ?q= param filters by name."""
    db = get_db()
    q = request.args.get("q", "").strip()

    if q:
        rows = db.execute(
            "SELECT id, name FROM skills WHERE name LIKE ? ORDER BY name",
            (f"%{q}%",),
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT id, name FROM skills ORDER BY name"
        ).fetchall()

    return jsonify({"skills": [{"id": r["id"], "name": r["name"]} for r in rows]})


@api_users_bp.route("/search")
@login_required
def search_users():
    """Search users by name or handle. Excludes the current user and system user."""
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"users": []})

    db = get_db()
    pattern = f"%{q}%"

    rows = db.execute(
        """
        SELECT id, github_handle, email, auth_provider, display_name, avatar_url
        FROM users
        WHERE id != ? AND id != 0
          AND (display_name LIKE ? OR github_handle LIKE ? OR email LIKE ?)
        ORDER BY display_name
        LIMIT 20
        """,
        (g.user_id, pattern, pattern, pattern),
    ).fetchall()

    users = []
    for r in rows:
        users.append({
            "id": r["id"],
            "github_handle": r["github_handle"],
            "email": r["email"],
            "display_name": r["display_name"],
            "avatar_url": r["avatar_url"],
        })

    return jsonify({"users": users})


@api_users_bp.route("/<int:user_id>")
@login_required
def get_user_profile(user_id):
    """Return a user's public profile with skills and availability."""
    db = get_db()

    user = db.execute(
        "SELECT id, github_handle, email, auth_provider, display_name, avatar_url, bio, timezone FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()

    if user is None:
        return jsonify({"error": "User not found"}), 404

    skills = _fetch_user_skills(db, user_id)
    availability = _fetch_user_availability(db, user_id)

    return jsonify({
        "user": _user_dict(user),
        "skills": skills,
        "availability": availability,
    })


@api_users_bp.route("/me", methods=["PUT"])
@login_required
def update_profile():
    """Update current user's basic profile fields (bio, display_name, timezone)."""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    allowed_fields = {"bio", "display_name", "timezone"}
    updates = {k: v for k, v in data.items() if k in allowed_fields}

    if not updates:
        return jsonify({"error": "No valid fields provided"}), 400

    db = get_db()

    set_clauses = ", ".join(f"{field} = ?" for field in updates)
    values = list(updates.values())
    values.append(g.user_id)

    db.execute(
        f"UPDATE users SET {set_clauses}, updated_at = datetime('now') WHERE id = ?",
        values,
    )
    db.commit()

    user = db.execute(
        "SELECT id, github_handle, email, auth_provider, display_name, avatar_url, bio, timezone FROM users WHERE id = ?",
        (g.user_id,),
    ).fetchone()

    return jsonify({"user": _user_dict(user)})


@api_users_bp.route("/me/skills", methods=["PUT"])
@login_required
def update_skills():
    """Replace current user's skill set."""
    data = request.get_json(silent=True)
    if not data or "skills" not in data:
        return jsonify({"error": "Request body must include 'skills' array"}), 400

    if not isinstance(data["skills"], list):
        return jsonify({"error": "'skills' must be an array"}), 400

    db = get_db()
    skills = _replace_skills(db, g.user_id, data["skills"])
    db.commit()

    return jsonify({"skills": skills})


@api_users_bp.route("/me/availability", methods=["PUT"])
@login_required
def update_availability():
    """Replace current user's availability grid."""
    data = request.get_json(silent=True)
    if not data or "slots" not in data:
        return jsonify({"error": "Request body must include 'slots' array"}), 400

    if not isinstance(data["slots"], list):
        return jsonify({"error": "'slots' must be an array"}), 400

    db = get_db()
    count = _replace_availability(db, g.user_id, data["slots"])
    db.commit()

    return jsonify({"count": count})


@api_users_bp.route("/me/onboard", methods=["POST"])
@login_required
def onboard():
    """First-time onboarding: set bio, skills, availability, and flip is_onboarded."""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    db = get_db()

    # Update bio if provided
    bio = data.get("bio")
    if bio is not None:
        db.execute(
            "UPDATE users SET bio = ?, updated_at = datetime('now') WHERE id = ?",
            (bio, g.user_id),
        )

    # Replace skills if provided
    skills = data.get("skills")
    if skills is not None:
        if not isinstance(skills, list):
            return jsonify({"error": "'skills' must be an array"}), 400
        _replace_skills(db, g.user_id, skills)

    # Replace availability if provided
    slots = data.get("slots")
    if slots is not None:
        if not isinstance(slots, list):
            return jsonify({"error": "'slots' must be an array"}), 400
        _replace_availability(db, g.user_id, slots)

    # Mark user as onboarded
    db.execute(
        "UPDATE users SET is_onboarded = 1, updated_at = datetime('now') WHERE id = ?",
        (g.user_id,),
    )
    db.commit()

    return jsonify({"ok": True, "redirect": "/dashboard"})
