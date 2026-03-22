"""
Blueprint: OAuth authentication flow (GitHub + Google).

Routes:
    GET  /auth/github/login    — Redirect to GitHub for authorization
    GET  /auth/github/callback — Handle GitHub's OAuth callback
    GET  /auth/google/login    — Redirect to Google for authorization
    GET  /auth/google/callback — Handle Google's OAuth callback
    POST /auth/logout          — Clear session
    GET  /auth/me              — Return current user as JSON

Exports:
    login_required — Decorator for protected routes
"""

import secrets
import functools
import logging

import requests as http_requests
from flask import (
    Blueprint,
    abort,
    current_app,
    flash,
    g,
    jsonify,
    redirect,
    request,
    session,
    url_for,
)

from db import get_db

logger = logging.getLogger(__name__)

auth_bp = Blueprint("auth", __name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_USER_URL = "https://api.github.com/user"

DEFAULT_REDIRECT_URI = "http://127.0.0.1:5000/auth/github/callback"

GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"

DEFAULT_GOOGLE_REDIRECT_URI = "http://127.0.0.1:5000/auth/google/callback"


def _is_ajax(req):
    """Return True if the request looks like an AJAX / JSON API call."""
    if req.headers.get("X-Requested-With", "").lower() == "xmlhttprequest":
        return True
    accept = req.headers.get("Accept", "")
    if "application/json" in accept and "text/html" not in accept:
        return True
    return False


# ---------------------------------------------------------------------------
# login_required decorator
# ---------------------------------------------------------------------------

def login_required(view):
    """Decorator that enforces authentication.

    * For AJAX requests: returns 401 JSON when unauthenticated.
    * For browser requests: redirects to the GitHub login page.
    * Sets ``flask.g.user_id`` for convenience.

    Usage::

        from routes.auth import login_required

        @app.route("/protected")
        @login_required
        def protected():
            ...
    """
    @functools.wraps(view)
    def wrapped_view(**kwargs):
        user_id = session.get("user_id")
        if user_id is None:
            if _is_ajax(request):
                return jsonify({"error": "Not authenticated"}), 401
            return redirect("/auth/github/login")
        g.user_id = user_id
        return view(**kwargs)
    return wrapped_view


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@auth_bp.route("/auth/github/login")
def github_login():
    """Redirect the user to GitHub's OAuth authorization page."""
    client_id = current_app.config.get("GITHUB_CLIENT_ID", "")
    if not client_id:
        logger.error("GITHUB_CLIENT_ID is not configured")
        abort(500, description="OAuth is not configured on this server.")

    redirect_uri = current_app.config.get("GITHUB_REDIRECT_URI", DEFAULT_REDIRECT_URI)

    state = secrets.token_hex(16)
    session["oauth_state"] = state

    params = (
        f"?client_id={client_id}"
        f"&redirect_uri={redirect_uri}"
        f"&scope=read:user"
        f"&state={state}"
    )
    return redirect(GITHUB_AUTHORIZE_URL + params)


@auth_bp.route("/auth/github/callback")
def github_callback():
    """Handle the redirect back from GitHub after user authorizes (or denies)."""

    # --- Handle user-denied consent ---
    error = request.args.get("error")
    if error == "access_denied":
        flash("GitHub authorization was denied.", "warning")
        return redirect("/")

    # --- Validate state (CSRF protection) ---
    state = request.args.get("state", "")
    expected_state = session.pop("oauth_state", None)
    if not state or state != expected_state:
        abort(403, description="Invalid OAuth state. Please try logging in again.")

    # --- Exchange authorization code for access token ---
    code = request.args.get("code")
    if not code:
        flash("Missing authorization code from GitHub.", "error")
        return redirect("/")

    client_id = current_app.config.get("GITHUB_CLIENT_ID", "")
    client_secret = current_app.config.get("GITHUB_CLIENT_SECRET", "")
    redirect_uri = current_app.config.get("GITHUB_REDIRECT_URI", DEFAULT_REDIRECT_URI)

    try:
        token_resp = http_requests.post(
            GITHUB_TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "redirect_uri": redirect_uri,
            },
            headers={"Accept": "application/json"},
            timeout=10,
        )
        token_resp.raise_for_status()
        token_data = token_resp.json()
    except (http_requests.RequestException, ValueError) as exc:
        logger.error("Failed to exchange code for token: %s", exc)
        flash("Could not connect to GitHub. Please try again.", "error")
        return redirect("/")

    access_token = token_data.get("access_token")
    if not access_token:
        error_desc = token_data.get("error_description", "Unknown error")
        logger.error("GitHub token error: %s", error_desc)
        flash("GitHub authentication failed. Please try again.", "error")
        return redirect("/")

    # --- Fetch user profile from GitHub ---
    try:
        user_resp = http_requests.get(
            GITHUB_USER_URL,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/json",
            },
            timeout=10,
        )
        user_resp.raise_for_status()
        gh_user = user_resp.json()
    except (http_requests.RequestException, ValueError) as exc:
        logger.error("Failed to fetch GitHub user profile: %s", exc)
        flash("Could not fetch your GitHub profile. Please try again.", "error")
        return redirect("/")

    # --- Validate required fields ---
    github_id = gh_user.get("id")
    github_handle = gh_user.get("login")
    if not github_id or not github_handle:
        logger.error("GitHub profile missing id or login: %s", gh_user)
        flash("Unexpected response from GitHub. Please try again.", "error")
        return redirect("/")

    display_name = gh_user.get("name") or github_handle
    avatar_url = gh_user.get("avatar_url", "")
    bio = gh_user.get("bio") or ""

    # --- Upsert user into database ---
    db = get_db()
    try:
        db.execute(
            """
            INSERT INTO users (github_id, github_handle, display_name, avatar_url, bio)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(github_id) DO UPDATE SET
                github_handle = excluded.github_handle,
                display_name  = excluded.display_name,
                avatar_url    = excluded.avatar_url,
                bio           = excluded.bio,
                updated_at    = datetime('now')
            """,
            (github_id, github_handle, display_name, avatar_url, bio),
        )
        db.commit()
    except Exception as exc:
        logger.error("Database error during user upsert: %s", exc)
        flash("An internal error occurred. Please try again.", "error")
        return redirect("/")

    # Fetch the row to get the local id and onboarded status
    user_row = db.execute(
        "SELECT id, is_onboarded FROM users WHERE github_id = ?",
        (github_id,),
    ).fetchone()

    if user_row is None:
        logger.error("User row not found after upsert for github_id=%s", github_id)
        flash("An internal error occurred. Please try again.", "error")
        return redirect("/")

    session["user_id"] = user_row["id"]

    if user_row["is_onboarded"]:
        return redirect("/dashboard")
    return redirect("/onboarding")


@auth_bp.route("/auth/google/login")
def google_login():
    """Redirect the user to Google's OAuth authorization page."""
    client_id = current_app.config.get("GOOGLE_CLIENT_ID", "")
    if not client_id:
        logger.error("GOOGLE_CLIENT_ID is not configured")
        abort(500, description="Google OAuth is not configured on this server.")

    redirect_uri = current_app.config.get("GOOGLE_REDIRECT_URI", DEFAULT_GOOGLE_REDIRECT_URI)

    state = secrets.token_hex(16)
    session["oauth_state"] = state

    from urllib.parse import urlencode
    params = urlencode({
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "offline",
        "prompt": "select_account",
    })
    return redirect(f"{GOOGLE_AUTHORIZE_URL}?{params}")


@auth_bp.route("/auth/google/callback")
def google_callback():
    """Handle the redirect back from Google after user authorizes."""

    # --- Handle errors ---
    error = request.args.get("error")
    if error:
        flash(f"Google authorization failed: {error}", "warning")
        return redirect("/")

    # --- Validate state (CSRF protection) ---
    state = request.args.get("state", "")
    expected_state = session.pop("oauth_state", None)
    if not state or state != expected_state:
        abort(403, description="Invalid OAuth state. Please try logging in again.")

    # --- Exchange authorization code for access token ---
    code = request.args.get("code")
    if not code:
        flash("Missing authorization code from Google.", "error")
        return redirect("/")

    client_id = current_app.config.get("GOOGLE_CLIENT_ID", "")
    client_secret = current_app.config.get("GOOGLE_CLIENT_SECRET", "")
    redirect_uri = current_app.config.get("GOOGLE_REDIRECT_URI", DEFAULT_GOOGLE_REDIRECT_URI)

    try:
        token_resp = http_requests.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
            timeout=10,
        )
        token_resp.raise_for_status()
        token_data = token_resp.json()
    except (http_requests.RequestException, ValueError) as exc:
        logger.error("Failed to exchange Google code for token: %s", exc)
        flash("Could not connect to Google. Please try again.", "error")
        return redirect("/")

    access_token = token_data.get("access_token")
    if not access_token:
        error_desc = token_data.get("error_description", "Unknown error")
        logger.error("Google token error: %s", error_desc)
        flash("Google authentication failed. Please try again.", "error")
        return redirect("/")

    # --- Fetch user profile from Google ---
    try:
        user_resp = http_requests.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        user_resp.raise_for_status()
        g_user = user_resp.json()
    except (http_requests.RequestException, ValueError) as exc:
        logger.error("Failed to fetch Google user profile: %s", exc)
        flash("Could not fetch your Google profile. Please try again.", "error")
        return redirect("/")

    # --- Validate required fields ---
    google_id = g_user.get("id")
    email = g_user.get("email")
    if not google_id or not email:
        logger.error("Google profile missing id or email: %s", g_user)
        flash("Unexpected response from Google. Please try again.", "error")
        return redirect("/")

    display_name = g_user.get("name") or email.split("@")[0]
    avatar_url = g_user.get("picture", "")

    # --- Upsert user into database ---
    db = get_db()
    try:
        db.execute(
            """
            INSERT INTO users (google_id, email, auth_provider, display_name, avatar_url)
            VALUES (?, ?, 'google', ?, ?)
            ON CONFLICT(google_id) DO UPDATE SET
                email         = excluded.email,
                display_name  = excluded.display_name,
                avatar_url    = excluded.avatar_url,
                updated_at    = datetime('now')
            """,
            (google_id, email, display_name, avatar_url),
        )
        db.commit()
    except Exception as exc:
        logger.error("Database error during Google user upsert: %s", exc)
        flash("An internal error occurred. Please try again.", "error")
        return redirect("/")

    # Fetch the row to get the local id and onboarded status
    user_row = db.execute(
        "SELECT id, is_onboarded FROM users WHERE google_id = ?",
        (google_id,),
    ).fetchone()

    if user_row is None:
        logger.error("User row not found after upsert for google_id=%s", google_id)
        flash("An internal error occurred. Please try again.", "error")
        return redirect("/")

    session["user_id"] = user_row["id"]

    if user_row["is_onboarded"]:
        return redirect("/dashboard")
    return redirect("/onboarding")


@auth_bp.route("/auth/logout", methods=["POST"])
def logout():
    """Clear the session. Returns JSON for AJAX or redirects for form posts."""
    session.clear()

    if _is_ajax(request):
        return jsonify({"ok": True})

    return redirect("/")


@auth_bp.route("/auth/me")
def me():
    """Return the currently authenticated user as JSON."""
    user_id = session.get("user_id")
    if user_id is None:
        return jsonify({"error": "Not authenticated"}), 401

    db = get_db()
    user = db.execute(
        """
        SELECT id, github_handle, google_id, email, auth_provider,
               display_name, avatar_url, bio, is_onboarded
        FROM users
        WHERE id = ?
        """,
        (user_id,),
    ).fetchone()

    if user is None:
        # Stale session — user was deleted from DB
        session.clear()
        return jsonify({"error": "Not authenticated"}), 401

    return jsonify({
        "user": {
            "id": user["id"],
            "github_handle": user["github_handle"],
            "email": user["email"],
            "auth_provider": user["auth_provider"],
            "display_name": user["display_name"],
            "avatar_url": user["avatar_url"],
            "bio": user["bio"],
            "is_onboarded": bool(user["is_onboarded"]),
        }
    })
