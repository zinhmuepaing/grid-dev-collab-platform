"""
Blueprint: Team management and Discord workspace integration.

Routes:
    POST /                   — Create a new team
    GET  /mine               — List teams the current user belongs to
    GET  /<team_id>          — Team detail with members and Discord info
    POST /<team_id>/invite   — Invite a user to the team (owner only)
    POST /<team_id>/respond  — Accept or decline a team invite
    POST /<team_id>/discord  — Generate Discord workspace (owner only)
    DELETE /<team_id>/leave  — Leave a team
    DELETE /<team_id>        — Delete a team (owner only)

Exports:
    api_teams_bp — Blueprint instance (registered in app.py with prefix /api/teams)
"""

import logging

import requests as http_requests
from flask import Blueprint, current_app, g, jsonify, request

from db import get_db
from routes.auth import login_required

logger = logging.getLogger(__name__)

api_teams_bp = Blueprint("api_teams", __name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

DISCORD_API_BASE = "https://discord.com/api/v10"


def _team_dict(row):
    """Convert a team database row to a JSON-safe dict."""
    return {
        "id": row["id"],
        "name": row["name"],
        "event_id": row["event_id"],
        "created_by": row["created_by"],
        "discord_invite_url": row["discord_invite_url"],
        "discord_channel_id": row["discord_channel_id"],
        "created_at": row["created_at"],
    }


def _member_dict(row):
    """Convert a joined team_members + users row to a JSON-safe dict."""
    return {
        "user_id": row["user_id"],
        "github_handle": row["github_handle"],
        "email": row["email"],
        "auth_provider": row["auth_provider"],
        "display_name": row["display_name"],
        "avatar_url": row["avatar_url"],
        "role": row["role"],
        "status": row["status"],
    }


def _fetch_team_members(db, team_id):
    """Return list of member dicts for a team."""
    rows = db.execute(
        """
        SELECT tm.user_id, tm.role, tm.status,
               u.github_handle, u.email, u.auth_provider, u.display_name, u.avatar_url
        FROM team_members tm
        JOIN users u ON tm.user_id = u.id
        WHERE tm.team_id = ?
        ORDER BY tm.role DESC, tm.joined_at
        """,
        (team_id,),
    ).fetchall()
    return [_member_dict(r) for r in rows]


def _is_team_member(db, team_id, user_id):
    """Check if user is an accepted member of the team."""
    row = db.execute(
        "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ? AND status = 'accepted'",
        (team_id, user_id),
    ).fetchone()
    return row is not None


def _is_team_owner(db, team_id, user_id):
    """Check if user is the owner of the team."""
    row = db.execute(
        "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ? AND role = 'owner'",
        (team_id, user_id),
    ).fetchone()
    return row is not None


def _discord_headers():
    """Return headers for Discord API requests."""
    token = current_app.config.get("DISCORD_BOT_TOKEN", "")
    return {
        "Authorization": f"Bot {token}",
        "Content-Type": "application/json",
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@api_teams_bp.route("/", methods=["POST"])
@login_required
def create_team():
    """Create a new team. The current user becomes the owner."""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Team name is required"}), 400

    event_id = data.get("event_id")

    db = get_db()

    # Validate event exists if provided
    if event_id is not None:
        event = db.execute("SELECT id FROM events WHERE id = ?", (event_id,)).fetchone()
        if event is None:
            return jsonify({"error": "Event not found"}), 404

    # Insert team
    cursor = db.execute(
        "INSERT INTO teams (name, event_id, created_by) VALUES (?, ?, ?)",
        (name, event_id, g.user_id),
    )
    team_id = cursor.lastrowid

    # Insert creator as owner with accepted status
    db.execute(
        "INSERT INTO team_members (team_id, user_id, role, status) VALUES (?, ?, 'owner', 'accepted')",
        (team_id, g.user_id),
    )
    db.commit()

    # Fetch the created team
    team_row = db.execute("SELECT * FROM teams WHERE id = ?", (team_id,)).fetchone()
    members = _fetch_team_members(db, team_id)

    result = _team_dict(team_row)
    result["members"] = members

    # Include event info if linked
    if event_id is not None:
        event_row = db.execute(
            "SELECT id, title, url, start_date, image_url FROM events WHERE id = ?",
            (event_id,),
        ).fetchone()
        if event_row:
            result["event"] = {
                "id": event_row["id"],
                "title": event_row["title"],
                "url": event_row["url"],
                "start_date": event_row["start_date"],
                "image_url": event_row["image_url"],
            }

    return jsonify({"team": result}), 201


@api_teams_bp.route("/<int:team_id>", methods=["PUT"])
@login_required
def update_team(team_id):
    """Update team details. Only the owner can update."""
    db = get_db()

    team = db.execute("SELECT * FROM teams WHERE id = ?", (team_id,)).fetchone()
    if team is None:
        return jsonify({"error": "Team not found"}), 404

    if not _is_team_owner(db, team_id, g.user_id):
        return jsonify({"error": "Only the team owner can update the team"}), 403

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON"}), 400

    # Update event_id if provided (null to unlink)
    if "event_id" in data:
        event_id = data["event_id"]
        if event_id is not None:
            event = db.execute("SELECT id FROM events WHERE id = ?", (event_id,)).fetchone()
            if event is None:
                return jsonify({"error": "Event not found"}), 404
        db.execute("UPDATE teams SET event_id = ? WHERE id = ?", (event_id, team_id))

    # Update name if provided
    if "name" in data:
        name = (data["name"] or "").strip()
        if name:
            db.execute("UPDATE teams SET name = ? WHERE id = ?", (name, team_id))

    db.commit()

    # Return updated team
    team_row = db.execute("SELECT * FROM teams WHERE id = ?", (team_id,)).fetchone()
    result = _team_dict(team_row)
    result["members"] = _fetch_team_members(db, team_id)

    if team_row["event_id"] is not None:
        event_row = db.execute(
            "SELECT id, title, url, start_date, end_date, image_url FROM events WHERE id = ?",
            (team_row["event_id"],),
        ).fetchone()
        if event_row:
            result["event"] = {
                "id": event_row["id"],
                "title": event_row["title"],
                "url": event_row["url"],
                "start_date": event_row["start_date"],
                "end_date": event_row["end_date"],
                "image_url": event_row["image_url"],
            }
        else:
            result["event"] = None
    else:
        result["event"] = None

    return jsonify({"team": result})


@api_teams_bp.route("/mine")
@login_required
def list_my_teams():
    """List all teams the current user is an accepted member of.

    Query params:
        invites=pending — return teams where the user has a pending invite instead.
    """
    db = get_db()

    invites_filter = request.args.get("invites")
    if invites_filter == "pending":
        status_filter = "pending"
    else:
        status_filter = "accepted"

    rows = db.execute(
        """
        SELECT t.id, t.name, t.event_id, t.created_by,
               t.discord_invite_url, t.discord_channel_id, t.created_at,
               e.title AS event_title, e.start_date AS event_start_date, e.image_url AS event_image_url,
               (SELECT COUNT(*) FROM team_members
                WHERE team_id = t.id AND status = 'accepted') AS member_count
        FROM teams t
        JOIN team_members tm ON t.id = tm.team_id
        LEFT JOIN events e ON t.event_id = e.id
        WHERE tm.user_id = ? AND tm.status = ?
        ORDER BY t.created_at DESC
        """,
        (g.user_id, status_filter),
    ).fetchall()

    teams = []
    for r in rows:
        team = {
            "id": r["id"],
            "name": r["name"],
            "event_id": r["event_id"],
            "created_by": r["created_by"],
            "discord_invite_url": r["discord_invite_url"],
            "created_at": r["created_at"],
            "member_count": r["member_count"],
            "event": None,
        }
        if invites_filter == "pending":
            team["invite_status"] = "pending"
        if r["event_id"] is not None and r["event_title"] is not None:
            team["event"] = {
                "id": r["event_id"],
                "title": r["event_title"],
                "start_date": r["event_start_date"],
                "image_url": r["event_image_url"],
            }
        # Include member details (accepted members only)
        team["members"] = _fetch_team_members(db, r["id"])
        teams.append(team)

    return jsonify({"teams": teams})


@api_teams_bp.route("/<int:team_id>")
@login_required
def get_team(team_id):
    """Return team detail. Only accessible to team members."""
    db = get_db()

    # Check membership (any status — so pending members can view too)
    membership = db.execute(
        "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?",
        (team_id, g.user_id),
    ).fetchone()
    if membership is None:
        return jsonify({"error": "You are not a member of this team"}), 403

    team_row = db.execute("SELECT * FROM teams WHERE id = ?", (team_id,)).fetchone()
    if team_row is None:
        return jsonify({"error": "Team not found"}), 404

    result = _team_dict(team_row)

    # Event info
    if team_row["event_id"] is not None:
        event_row = db.execute(
            "SELECT id, title, url, start_date, end_date, image_url FROM events WHERE id = ?",
            (team_row["event_id"],),
        ).fetchone()
        if event_row:
            result["event"] = {
                "id": event_row["id"],
                "title": event_row["title"],
                "url": event_row["url"],
                "start_date": event_row["start_date"],
                "end_date": event_row["end_date"],
                "image_url": event_row["image_url"],
            }
        else:
            result["event"] = None
    else:
        result["event"] = None

    # Members
    result["members"] = _fetch_team_members(db, team_id)

    # Discord invite
    result["discord_invite"] = team_row["discord_invite_url"]

    return jsonify({"team": result})


@api_teams_bp.route("/<int:team_id>/invite", methods=["POST"])
@login_required
def invite_member(team_id):
    """Invite a user to the team. Only the team owner can invite."""
    db = get_db()

    # Verify team exists
    team = db.execute("SELECT id FROM teams WHERE id = ?", (team_id,)).fetchone()
    if team is None:
        return jsonify({"error": "Team not found"}), 404

    # Verify current user is owner
    if not _is_team_owner(db, team_id, g.user_id):
        return jsonify({"error": "Only the team owner can invite members"}), 403

    data = request.get_json(silent=True)
    if not data or "user_id" not in data:
        return jsonify({"error": "Request body must include 'user_id'"}), 400

    invitee_id = data["user_id"]

    # Check invitee exists
    invitee = db.execute("SELECT id FROM users WHERE id = ?", (invitee_id,)).fetchone()
    if invitee is None:
        return jsonify({"error": "User not found"}), 404

    # Check not already a member
    existing = db.execute(
        "SELECT status FROM team_members WHERE team_id = ? AND user_id = ?",
        (team_id, invitee_id),
    ).fetchone()
    if existing is not None:
        if existing["status"] == "accepted":
            return jsonify({"error": "User is already a member of this team"}), 409
        if existing["status"] == "pending":
            return jsonify({"error": "User already has a pending invite"}), 409

    # Insert invite record
    db.execute(
        "INSERT OR REPLACE INTO team_invites (team_id, inviter_id, invitee_id, status) VALUES (?, ?, ?, 'pending')",
        (team_id, g.user_id, invitee_id),
    )

    # Insert into team_members with pending status
    db.execute(
        "INSERT OR REPLACE INTO team_members (team_id, user_id, role, status) VALUES (?, ?, 'member', 'pending')",
        (team_id, invitee_id),
    )
    db.commit()

    return jsonify({"ok": True})


@api_teams_bp.route("/<int:team_id>/respond", methods=["POST"])
@login_required
def respond_invite(team_id):
    """Accept or decline a team invite."""
    data = request.get_json(silent=True)
    if not data or "action" not in data:
        return jsonify({"error": "Request body must include 'action'"}), 400

    action = data["action"]
    if action not in ("accepted", "declined"):
        return jsonify({"error": "Action must be 'accepted' or 'declined'"}), 400

    db = get_db()

    # Verify pending membership exists
    membership = db.execute(
        "SELECT status FROM team_members WHERE team_id = ? AND user_id = ?",
        (team_id, g.user_id),
    ).fetchone()
    if membership is None:
        return jsonify({"error": "No pending invite found"}), 404
    if membership["status"] != "pending":
        return jsonify({"error": f"Invite already {membership['status']}"}), 409

    # Update team_members status
    db.execute(
        "UPDATE team_members SET status = ? WHERE team_id = ? AND user_id = ?",
        (action, team_id, g.user_id),
    )

    # Update team_invites status
    db.execute(
        "UPDATE team_invites SET status = ? WHERE team_id = ? AND invitee_id = ?",
        (action, team_id, g.user_id),
    )
    db.commit()

    return jsonify({"ok": True})


@api_teams_bp.route("/<int:team_id>/discord", methods=["POST"])
@login_required
def generate_discord(team_id):
    """Generate a Discord workspace (role + private channel + invite) for the team."""
    db = get_db()

    # Verify team exists
    team = db.execute("SELECT * FROM teams WHERE id = ?", (team_id,)).fetchone()
    if team is None:
        return jsonify({"error": "Team not found"}), 404

    # Verify current user is owner
    if not _is_team_owner(db, team_id, g.user_id):
        return jsonify({"error": "Only the team owner can generate a Discord workspace"}), 403

    # Idempotent: if channel already exists, return existing invite
    if team["discord_channel_id"] and team["discord_invite_url"]:
        return jsonify({"invite_url": team["discord_invite_url"]})

    guild_id = current_app.config.get("DISCORD_GUILD_ID", "")
    bot_token = current_app.config.get("DISCORD_BOT_TOKEN", "")

    if not guild_id or not bot_token:
        return jsonify({"error": "Discord integration is not configured"}), 503

    headers = _discord_headers()

    def _handle_discord_error(resp, step):
        """Return a user-friendly error tuple or None if OK."""
        if resp.status_code == 429:
            retry_after = resp.json().get("retry_after", 5)
            return jsonify({"error": f"Discord rate limited. Retry after {retry_after}s."}), 503
        if resp.status_code == 403:
            logger.error("Discord 403 at %s: %s", step, resp.text)
            return jsonify({
                "error": "Discord bot lacks permissions. Make sure the bot has been invited to "
                         "the server with Manage Roles, Manage Channels, and Create Instant Invite permissions."
            }), 403
        if resp.status_code == 401:
            logger.error("Discord 401 at %s: %s", step, resp.text)
            return jsonify({"error": "Discord bot token is invalid or expired. Check DISCORD_BOT_TOKEN in .env."}), 502
        if not resp.ok:
            logger.error("Discord error %s at %s: %s", resp.status_code, step, resp.text)
            return jsonify({"error": f"Discord API error ({resp.status_code}). Please try again."}), 502
        return None

    try:
        # Step 1: Create a role for the team
        role_resp = http_requests.post(
            f"{DISCORD_API_BASE}/guilds/{guild_id}/roles",
            json={
                "name": f"grid-team-{team_id}",
                "mentionable": True,
            },
            headers=headers,
            timeout=15,
        )
        err = _handle_discord_error(role_resp, "create role")
        if err:
            return err
        role_data = role_resp.json()
        role_id = role_data["id"]

        # Step 2: Create a private text channel
        # Permission overwrites:
        #   - Deny @everyone (guild_id) VIEW_CHANNEL (0x400 = 1024)
        #   - Allow team role VIEW_CHANNEL + SEND_MESSAGES (0x400 | 0x800 = 3072)
        channel_resp = http_requests.post(
            f"{DISCORD_API_BASE}/guilds/{guild_id}/channels",
            json={
                "name": f"grid-team-{team_id}",
                "type": 0,  # GUILD_TEXT
                "permission_overwrites": [
                    {
                        "id": guild_id,
                        "type": 0,  # role
                        "deny": "1024",
                    },
                    {
                        "id": role_id,
                        "type": 0,  # role
                        "allow": "3072",
                    },
                ],
            },
            headers=headers,
            timeout=15,
        )
        err = _handle_discord_error(channel_resp, "create channel")
        if err:
            return err
        channel_data = channel_resp.json()
        channel_id = channel_data["id"]

        # Step 3: Generate an invite link
        invite_resp = http_requests.post(
            f"{DISCORD_API_BASE}/channels/{channel_id}/invites",
            json={
                "max_age": 604800,   # 7 days
                "max_uses": 10,
            },
            headers=headers,
            timeout=15,
        )
        err = _handle_discord_error(invite_resp, "create invite")
        if err:
            return err
        invite_data = invite_resp.json()
        invite_url = f"https://discord.gg/{invite_data['code']}"

    except http_requests.RequestException as exc:
        logger.error("Discord API error: %s", exc)
        return jsonify({"error": "Failed to communicate with Discord. Please try again."}), 502

    # Store in database
    db.execute(
        "UPDATE teams SET discord_channel_id = ?, discord_invite_url = ? WHERE id = ?",
        (channel_id, invite_url, team_id),
    )

    # Deliver invite link to all accepted team members via the messaging system
    members = db.execute(
        "SELECT user_id FROM team_members WHERE team_id = ? AND status = 'accepted'",
        (team_id,),
    ).fetchall()

    team_name = team["name"]
    message_content = f"Your Discord workspace for team \"{team_name}\" is ready! Join here: {invite_url}"

    for member in members:
        db.execute(
            "INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)",
            (g.user_id, member["user_id"], message_content),
        )

    db.commit()

    return jsonify({"invite_url": invite_url})


@api_teams_bp.route("/<int:team_id>/leave", methods=["DELETE"])
@login_required
def leave_team(team_id):
    """Leave a team. Owner cannot leave unless they are the last member."""
    db = get_db()

    # Check membership
    membership = db.execute(
        "SELECT role, status FROM team_members WHERE team_id = ? AND user_id = ?",
        (team_id, g.user_id),
    ).fetchone()
    if membership is None:
        return jsonify({"error": "You are not a member of this team"}), 404

    # Owner cannot leave if other accepted members remain
    if membership["role"] == "owner":
        other_count = db.execute(
            "SELECT COUNT(*) AS cnt FROM team_members WHERE team_id = ? AND user_id != ? AND status = 'accepted'",
            (team_id, g.user_id),
        ).fetchone()["cnt"]
        if other_count > 0:
            return jsonify({"error": "Owner cannot leave while other members remain. Transfer ownership first."}), 409

    db.execute(
        "DELETE FROM team_members WHERE team_id = ? AND user_id = ?",
        (team_id, g.user_id),
    )

    # Also clean up any invite record
    db.execute(
        "DELETE FROM team_invites WHERE team_id = ? AND invitee_id = ?",
        (team_id, g.user_id),
    )
    db.commit()

    return jsonify({"ok": True})


@api_teams_bp.route("/<int:team_id>", methods=["DELETE"])
@login_required
def delete_team(team_id):
    """Delete a team. Only the team owner can delete."""
    db = get_db()

    # Verify team exists
    team = db.execute("SELECT id FROM teams WHERE id = ?", (team_id,)).fetchone()
    if team is None:
        return jsonify({"error": "Team not found"}), 404

    # Verify current user is owner
    if not _is_team_owner(db, team_id, g.user_id):
        return jsonify({"error": "Only the team owner can delete the team"}), 403

    # Delete all related records and the team itself
    db.execute("DELETE FROM team_members WHERE team_id = ?", (team_id,))
    db.execute("DELETE FROM team_invites WHERE team_id = ?", (team_id,))
    db.execute("DELETE FROM teams WHERE id = ?", (team_id,))
    db.commit()

    return jsonify({"ok": True})
