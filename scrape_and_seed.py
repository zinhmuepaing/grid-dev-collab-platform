#!/usr/bin/env python3
"""
Scrape Unstop hackathon pages via their public API and seed the Grid SQLite database.
Reads hackathonList.txt, fetches each hackathon's data from the Unstop API,
downloads banner images locally, and inserts everything into grid.db.
"""

import json
import os
import re
import sqlite3
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

# ── paths ──────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent
HACKATHON_LIST = BASE_DIR / "hackathonList.txt"
DB_PATH = BASE_DIR / "grid.db"
IMG_DIR = BASE_DIR / "static" / "img" / "events"
IMG_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/html, */*",
    "Accept-Language": "en-US,en;q=0.9",
}

TIMEOUT = 10  # seconds


def extract_id_from_url(url: str) -> str | None:
    """Extract the numeric ID from an Unstop URL like .../hackathons/name-1663385"""
    match = re.search(r"-(\d{5,})$", urlparse(url).path.rstrip("/"))
    return match.group(1) if match else None


def slug_from_url(url: str) -> str:
    """Derive a filesystem-safe slug from an Unstop URL."""
    path = urlparse(url).path.rstrip("/")
    last = path.split("/")[-1]
    slug = re.sub(r"-\d{5,}$", "", last)
    return slug or "hackathon"


def html_to_text(html_str: str) -> str:
    """Convert HTML description to clean plain text."""
    if not html_str:
        return ""
    soup = BeautifulSoup(html_str, "html.parser")
    text = soup.get_text(separator=" ", strip=True)
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    # Truncate to reasonable length for DB description
    if len(text) > 2000:
        text = text[:1997] + "..."
    return text


def download_image(image_url: str, slug: str) -> str | None:
    """Download image and return local path, or None on failure."""
    if not image_url:
        return None
    try:
        parsed = urlparse(image_url)
        ext = Path(parsed.path).suffix.lower()
        if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
            ext = ".png"
        filename = f"{slug}{ext}"
        local_path = IMG_DIR / filename

        resp = requests.get(image_url, headers=HEADERS, timeout=TIMEOUT, stream=True)
        resp.raise_for_status()
        with open(local_path, "wb") as f:
            for chunk in resp.iter_content(8192):
                f.write(chunk)
        print(f"    -> Image saved: {filename}")
        return f"/static/img/events/{filename}"
    except Exception as e:
        print(f"    -> Image download failed: {e}")
        return None


def scrape_hackathon(title: str, url: str) -> dict:
    """Fetch hackathon data from Unstop API and return a dict of fields."""
    result = {
        "title": title,
        "url": url,
        "description": "",
        "organizer": None,
        "start_date": None,
        "end_date": None,
        "registration_deadline": None,
        "location": None,
        "tags": "[]",
        "image_url": None,
    }

    comp_id = extract_id_from_url(url)
    if not comp_id:
        print(f"    !! Could not extract ID from URL")
        return result

    api_url = f"https://unstop.com/api/public/competition/{comp_id}"

    try:
        resp = requests.get(api_url, headers=HEADERS, timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()

        comp = data.get("data", {}).get("competition", {})
        if not comp:
            print(f"    !! No competition data in API response")
            return result

        # Title (prefer API title)
        result["title"] = comp.get("title") or title

        # Description - convert HTML details to plain text
        details_html = comp.get("details", "")
        description = html_to_text(details_html)
        if not description:
            # Fallback to meta description
            meta = comp.get("meta_info", {})
            description = meta.get("description", "")
        result["description"] = description

        # Dates
        start = comp.get("start_date")
        end = comp.get("end_date")
        if start:
            result["start_date"] = start[:10]  # YYYY-MM-DD
        if end:
            result["end_date"] = end[:10]

        # Registration deadline
        regn = comp.get("regnRequirements", {})
        end_regn = regn.get("end_regn_dt")
        if end_regn:
            result["registration_deadline"] = end_regn[:10]

        # Location
        addr = comp.get("address_with_country_logo", {})
        if addr:
            city = addr.get("city")
            state = addr.get("state")
            institution = addr.get("address")
            if city and state:
                result["location"] = f"{city}, {state}"
            elif city:
                result["location"] = city
            elif institution:
                result["location"] = institution
        region = comp.get("region", "")
        if region == "online" and not result["location"]:
            result["location"] = "Online"
        elif region == "offline" and not result["location"]:
            result["location"] = "Offline"

        # Organizer
        org = comp.get("organisation", {})
        if org and org.get("name"):
            result["organizer"] = org["name"]

        # Tags - combine skills and work functions
        tags = []
        for skill in comp.get("skills", []):
            name = skill.get("skill_name") or skill.get("skill")
            if name:
                tags.append(name)
        for wf in comp.get("workfunction", []):
            name = wf.get("name")
            if name:
                tags.append(name)
        # Add subtype as tag
        subtype = comp.get("subtype", "")
        if subtype:
            tags.append(subtype.replace("_", " ").title())
        result["tags"] = json.dumps(tags[:15])

        # Image - try banner, then meta sharable image
        image_url = None
        banner = comp.get("banner_mobile", {})
        if banner and banner.get("image_url"):
            image_url = banner["image_url"]
        if not image_url:
            meta = comp.get("meta_info", {})
            image_url = meta.get("sharable_image_url")
        if not image_url:
            seo = comp.get("seo_details", [])
            if seo:
                image_url = seo[0].get("sharable_image_url")

        slug = slug_from_url(url)
        local_img = download_image(image_url, slug)
        result["image_url"] = local_img

    except Exception as e:
        print(f"    !! API fetch failed: {e}")

    return result


def main():
    # Load hackathon list
    with open(HACKATHON_LIST, "r", encoding="utf-8") as f:
        hackathons = json.load(f)

    print(f"Loaded {len(hackathons)} hackathons from {HACKATHON_LIST.name}")
    print(f"Database: {DB_PATH}")
    print(f"Image dir: {IMG_DIR}\n")

    # Scrape all hackathons
    records = []
    for i, h in enumerate(hackathons, 1):
        title = h["title"]
        url = h["link"]
        print(f"[{i:2d}/{len(hackathons)}] Scraping: {title}")
        record = scrape_hackathon(title, url)
        records.append(record)
        # Small delay to be polite
        if i < len(hackathons):
            time.sleep(0.5)

    # Insert into database
    print(f"\n{'='*60}")
    print("Inserting into database...")

    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()

    # Clear existing events
    cur.execute("DELETE FROM events")
    deleted = cur.rowcount
    print(f"  Cleared {deleted} existing event(s)")

    # Insert all records
    inserted = 0
    for r in records:
        try:
            cur.execute(
                """INSERT OR IGNORE INTO events
                   (title, url, description, organizer,
                    start_date, end_date, registration_deadline,
                    location, tags, image_url, source_site, is_active)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unstop', 1)""",
                (
                    r["title"],
                    r["url"],
                    r["description"],
                    r["organizer"],
                    r["start_date"],
                    r["end_date"],
                    r["registration_deadline"],
                    r["location"],
                    r["tags"],
                    r["image_url"],
                ),
            )
            if cur.rowcount > 0:
                inserted += 1
        except Exception as e:
            print(f"  !! Insert failed for {r['title']}: {e}")

    conn.commit()
    print(f"  Inserted {inserted} event(s)")

    # Verify
    cur.execute("SELECT COUNT(*) FROM events")
    total = cur.fetchone()[0]
    print(f"  Total events in DB: {total}")

    # Show summary
    print(f"\n{'='*60}")
    print("Summary of scraped data:\n")
    cur.execute(
        "SELECT title, organizer, start_date, end_date, registration_deadline, location, tags, image_url "
        "FROM events ORDER BY id"
    )
    for row in cur.fetchall():
        title, org, start, end, deadline, loc, tags, img = row
        print(f"  {title}")
        print(f"    Organizer:  {org or 'N/A'}")
        print(f"    Dates:      {start or '?'} to {end or '?'}")
        print(f"    Deadline:   {deadline or 'N/A'}")
        print(f"    Location:   {loc or 'N/A'}")
        print(f"    Tags:       {tags}")
        print(f"    Image:      {img or 'N/A'}")
        print()

    conn.close()
    print("Done!")


if __name__ == "__main__":
    main()
