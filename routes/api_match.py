"""
Blueprint: Matchmaking engine — event-first and teammate-first ranking.

Routes:
    GET /event/<event_id>  — Rank interested users for an event against current user
    GET /teammate          — Find and rank users by desired skills

Exports:
    api_match_bp — Blueprint instance (registered in app.py with prefix /api/match)
"""

import logging

from flask import Blueprint, g, jsonify, request

from db import get_db
from matcher_engine import rank_by_skills, rank_for_event
from routes.auth import login_required

logger = logging.getLogger(__name__)

api_match_bp = Blueprint("api_match", __name__)

MAX_LIMIT = 50
DEFAULT_LIMIT = 20


def _parse_limit():
    """Extract and clamp the ?limit= query parameter."""
    try:
        limit = int(request.args.get("limit", DEFAULT_LIMIT))
    except (ValueError, TypeError):
        limit = DEFAULT_LIMIT
    return max(1, min(limit, MAX_LIMIT))


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@api_match_bp.route("/event/<int:event_id>")
@login_required
def match_for_event(event_id):
    """Event-first matchmaking: rank all interested users against the current user."""
    db = get_db()

    # Verify the event exists
    event = db.execute("SELECT id FROM events WHERE id = ?", (event_id,)).fetchone()
    if event is None:
        return jsonify({"error": "Event not found"}), 404

    limit = _parse_limit()
    matches = rank_for_event(g.user_id, event_id, db, limit)

    return jsonify({"matches": matches})


@api_match_bp.route("/teammate")
@login_required
def match_by_skills():
    """Teammate-first matchmaking: find users with desired skills, ranked by match score."""
    skill_names = request.args.getlist("skill")

    if not skill_names:
        return jsonify({"error": "At least one 'skill' query parameter is required"}), 400

    db = get_db()
    limit = _parse_limit()
    matches = rank_by_skills(g.user_id, skill_names, db, limit)

    return jsonify({"matches": matches})
