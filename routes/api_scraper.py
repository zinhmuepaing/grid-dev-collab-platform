"""
Blueprint: Apify scraper integration — webhook receiver and manual trigger.

Routes:
    POST /webhook — Receive Apify webhook, fetch dataset, upsert events
    POST /trigger — Manually trigger an Apify actor run

Exports:
    api_scraper_bp — Blueprint instance (registered in app.py with prefix /api/scraper)
"""

import json
import logging
import re
from urllib.parse import quote

import requests as http_requests
from dateutil import parser as dateutil_parser
from flask import Blueprint, current_app, g, jsonify, request

from db import get_db
from routes.auth import login_required

logger = logging.getLogger(__name__)

api_scraper_bp = Blueprint("api_scraper", __name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_HTML_TAG_RE = re.compile(r"<[^>]+>")


def _strip_html(text):
    """Remove HTML tags from a string."""
    if not text:
        return ""
    return _HTML_TAG_RE.sub("", text).strip()


def _normalize_date(value):
    """Parse a date string into ISO format, or return None on failure."""
    if not value:
        return None
    try:
        dt = dateutil_parser.parse(str(value))
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    except (ValueError, TypeError, OverflowError):
        return None


def _validate_url(value):
    """Return the URL if it looks valid, otherwise None."""
    if not value or not isinstance(value, str):
        return None
    value = value.strip()
    if value.startswith(("http://", "https://")):
        return value
    return None


def _normalize_tags(value):
    """Normalize tags into a JSON array string."""
    if isinstance(value, list):
        return json.dumps([str(t).strip() for t in value if t])
    if isinstance(value, str):
        value = value.strip()
        # Try parsing as JSON array first
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return json.dumps([str(t).strip() for t in parsed if t])
        except (json.JSONDecodeError, TypeError):
            pass
        # Treat as comma-separated
        return json.dumps([t.strip() for t in value.split(",") if t.strip()])
    return "[]"


def _clean_item(item):
    """Clean and validate a single scraped event item.

    Returns a dict ready for DB insertion, or None if the item is invalid.
    """
    url = _validate_url(item.get("url") or item.get("link"))
    title = (item.get("title") or "").strip()

    if not url or not title:
        return None

    description = _strip_html(item.get("description") or item.get("rawText") or "")
    if len(description) > 1000:
        description = description[:1000]

    return {
        "title": title,
        "url": url,
        "description": description,
        "organizer": (item.get("organizer") or "").strip() or None,
        "start_date": _normalize_date(item.get("start_date") or item.get("startDate")),
        "end_date": _normalize_date(item.get("end_date") or item.get("endDate")),
        "registration_deadline": _normalize_date(
            item.get("registration_deadline") or item.get("registrationDeadline")
        ),
        "location": (item.get("location") or "").strip() or None,
        "tags": _normalize_tags(item.get("tags")),
        "image_url": _validate_url(item.get("image_url") or item.get("imageUrl")),
        "source_site": (item.get("source_site") or item.get("sourceSite") or "unstop").strip(),
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@api_scraper_bp.route("/webhook", methods=["POST"])
def webhook():
    """Receive an Apify webhook, fetch dataset items, and upsert events."""

    # --- Validate webhook secret ---
    expected_secret = current_app.config.get("APIFY_WEBHOOK_SECRET", "")
    received_secret = request.headers.get("X-Apify-Webhook-Secret", "")

    if not expected_secret or received_secret != expected_secret:
        return jsonify({"error": "Unauthorized"}), 401

    # --- Extract dataset ID from payload ---
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"error": "Invalid JSON payload"}), 400

    resource = payload.get("resource", {})
    dataset_id = resource.get("defaultDatasetId")

    if not dataset_id:
        return jsonify({"error": "Missing defaultDatasetId in payload"}), 400

    # --- Fetch dataset items from Apify ---
    apify_token = current_app.config.get("APIFY_API_TOKEN", "")
    if not apify_token:
        logger.error("APIFY_API_TOKEN is not configured")
        return jsonify({"error": "Scraper not configured"}), 500

    dataset_url = (
        f"https://api.apify.com/v2/datasets/{dataset_id}/items"
        f"?token={apify_token}&format=json&clean=true"
    )

    try:
        resp = http_requests.get(dataset_url, timeout=30)
        resp.raise_for_status()
        items = resp.json()
    except http_requests.RequestException as exc:
        logger.error("Failed to fetch Apify dataset %s: %s", dataset_id, exc)
        return jsonify({"error": "Failed to fetch dataset from Apify"}), 502
    except (ValueError, TypeError) as exc:
        logger.error("Invalid JSON from Apify dataset %s: %s", dataset_id, exc)
        return jsonify({"error": "Invalid response from Apify"}), 502

    if not isinstance(items, list):
        return jsonify({"error": "Expected array of items from Apify"}), 502

    # --- Upsert each item into events table ---
    db = get_db()
    ingested = 0

    for raw_item in items:
        try:
            cleaned = _clean_item(raw_item)
            if cleaned is None:
                continue

            db.execute(
                """
                INSERT INTO events (title, url, description, organizer, start_date,
                                    end_date, registration_deadline, location, tags,
                                    image_url, source_site)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(url) DO UPDATE SET
                    title = excluded.title,
                    description = excluded.description,
                    start_date = excluded.start_date,
                    end_date = excluded.end_date,
                    registration_deadline = excluded.registration_deadline,
                    tags = excluded.tags,
                    image_url = excluded.image_url,
                    updated_at = datetime('now')
                """,
                (
                    cleaned["title"],
                    cleaned["url"],
                    cleaned["description"],
                    cleaned["organizer"],
                    cleaned["start_date"],
                    cleaned["end_date"],
                    cleaned["registration_deadline"],
                    cleaned["location"],
                    cleaned["tags"],
                    cleaned["image_url"],
                    cleaned["source_site"],
                ),
            )
            ingested += 1
        except Exception as exc:
            logger.error("Failed to upsert event item (url=%s): %s", raw_item.get("url"), exc)
            continue

    # --- Mark past events inactive ---
    try:
        db.execute(
            "UPDATE events SET is_active = 0 WHERE end_date IS NOT NULL AND end_date < date('now', '-1 day')"
        )
    except Exception as exc:
        logger.error("Failed to deactivate past events: %s", exc)

    db.commit()

    return jsonify({"ok": True, "ingested": ingested})


@api_scraper_bp.route("/trigger", methods=["POST"])
@login_required
def trigger():
    """Manually trigger an Apify actor run."""
    apify_token = current_app.config.get("APIFY_API_TOKEN", "")
    actor_id = current_app.config.get("APIFY_ACTOR_ID", "")

    if not apify_token or not actor_id:
        logger.error("APIFY_API_TOKEN or APIFY_ACTOR_ID is not configured")
        return jsonify({"error": "Scraper not configured"}), 500

    run_url = f"https://api.apify.com/v2/acts/{quote(actor_id, safe='')}/runs?token={apify_token}"

    try:
        resp = http_requests.post(run_url, timeout=10)
        resp.raise_for_status()
        run_data = resp.json()
    except http_requests.RequestException as exc:
        logger.error("Failed to trigger Apify actor %s: %s", actor_id, exc)
        return jsonify({"error": "Failed to trigger scraper run"}), 502
    except (ValueError, TypeError) as exc:
        logger.error("Invalid JSON from Apify run response: %s", exc)
        return jsonify({"error": "Invalid response from Apify"}), 502

    run_id = run_data.get("data", {}).get("id", "unknown")

    return jsonify({"run_id": run_id})
