import os
import sqlite3

import click
from flask import current_app, g


def get_db():
    """Get a database connection, storing it on Flask's g object for reuse."""
    if "db" not in g:
        g.db = sqlite3.connect(
            current_app.config["DATABASE"],
            detect_types=sqlite3.PARSE_DECLTYPES,
        )
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def close_db(e=None):
    """Close the database connection at the end of each request."""
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """Initialize the database from schema.sql and seed_skills.sql."""
    db = get_db()

    schema_path = os.path.join(current_app.root_path, "schema.sql")
    with current_app.open_resource(schema_path) as f:
        db.executescript(f.read().decode("utf-8"))

    seed_path = os.path.join(current_app.root_path, "seed_skills.sql")
    with current_app.open_resource(seed_path) as f:
        db.executescript(f.read().decode("utf-8"))

    # Ensure system user (id=0) exists for system messages (sender_id=0)
    _ensure_system_user(db)

    db.commit()


def _ensure_system_user(db):
    """Insert the system user (id=0) used for automated notifications."""
    db.execute(
        "INSERT OR IGNORE INTO users (id, github_id, github_handle, display_name, is_onboarded)"
        " VALUES (0, 0, '_system', 'Grid System', 1)"
    )


@click.command("init-db")
def init_db_command():
    """Clear existing data and create fresh tables."""
    init_db()
    click.echo("Initialized the database.")
