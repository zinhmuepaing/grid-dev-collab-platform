"""
Grid — Student Innovator Matchmaker
Flask application factory with blueprint registration and page-serving routes.
"""

import os
from dotenv import load_dotenv

load_dotenv(override=True)

from flask import Flask, render_template


def create_app():
    app = Flask(__name__)

    # Load configuration
    import config
    app.config.from_mapping(
        SECRET_KEY=config.SECRET_KEY,
        DATABASE=config.DATABASE,
        GITHUB_CLIENT_ID=config.GITHUB_CLIENT_ID,
        GITHUB_CLIENT_SECRET=config.GITHUB_CLIENT_SECRET,
        GITHUB_REDIRECT_URI=config.GITHUB_REDIRECT_URI,
        APIFY_API_TOKEN=config.APIFY_API_TOKEN,
        APIFY_ACTOR_ID=config.APIFY_ACTOR_ID,
        APIFY_WEBHOOK_SECRET=config.APIFY_WEBHOOK_SECRET,
        GOOGLE_CLIENT_ID=config.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET=config.GOOGLE_CLIENT_SECRET,
        GOOGLE_REDIRECT_URI=config.GOOGLE_REDIRECT_URI,
        DISCORD_BOT_TOKEN=config.DISCORD_BOT_TOKEN,
        DISCORD_GUILD_ID=config.DISCORD_GUILD_ID,
    )

    # Import and configure database helpers
    from db import close_db, init_db_command

    app.teardown_appcontext(close_db)
    app.cli.add_command(init_db_command)

    # ------------------------------------------------------------------
    # Register blueprints (wrapped in try/except so the app can start
    # even if some blueprint files don't exist yet)
    # ------------------------------------------------------------------
    blueprint_imports = [
        ("routes.auth", "auth_bp", None),
        ("routes.api_users", "api_users_bp", "/api/users"),
        ("routes.api_events", "api_events_bp", "/api/events"),
        ("routes.api_match", "api_match_bp", "/api/match"),
        ("routes.api_messages", "api_messages_bp", "/api/messages"),
        ("routes.api_teams", "api_teams_bp", "/api/teams"),
        ("routes.api_scraper", "api_scraper_bp", "/api/scraper"),
        ("routes.api_likes", "api_likes_bp", "/api/likes"),
    ]

    for module_name, bp_attr, url_prefix in blueprint_imports:
        try:
            module = __import__(module_name, fromlist=[bp_attr])
            bp = getattr(module, bp_attr)
            if url_prefix:
                app.register_blueprint(bp, url_prefix=url_prefix)
            else:
                app.register_blueprint(bp)
        except (ImportError, AttributeError):
            app.logger.warning(f"Blueprint '{module_name}' not found, skipping.")

    # ------------------------------------------------------------------
    # Page-serving routes (return Jinja2 templates)
    # ------------------------------------------------------------------
    @app.route("/")
    def landing():
        return render_template("landing.html")

    @app.route("/onboarding")
    def onboarding():
        return render_template("onboarding.html")

    @app.route("/dashboard")
    def dashboard():
        return render_template("dashboard.html")

    @app.route("/profile/<username>")
    def profile(username):
        return render_template("profile.html", username=username)

    @app.route("/profile/edit")
    def profile_edit():
        return render_template("profile_edit.html")

    @app.route("/events")
    def events():
        return render_template("events.html")

    @app.route("/events/<int:event_id>")
    def event_detail(event_id):
        return render_template("event_detail.html", event_id=event_id)

    @app.route("/find")
    def find_teammates():
        return render_template("find_teammates.html")

    @app.route("/inbox")
    def inbox():
        return render_template("inbox.html")

    @app.route("/team/<int:team_id>")
    def team(team_id):
        return render_template("team.html", team_id=team_id)

    # ------------------------------------------------------------------
    # Custom error handlers
    # ------------------------------------------------------------------
    @app.errorhandler(404)
    def page_not_found(e):
        return render_template("404.html"), 404

    return app


# Allow `flask run` to discover the app
app = create_app()

if __name__ == "__main__":
    app.run(debug=True)
