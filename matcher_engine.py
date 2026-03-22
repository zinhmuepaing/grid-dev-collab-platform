"""
Grid Matching Engine — Pure functions for teammate compatibility scoring.

No Flask dependency. All functions take a database connection as a parameter.
"""

WEIGHT_AVAILABILITY = 0.45
WEIGHT_SKILL = 0.55


def availability_overlap(user_a_id, user_b_id, db):
    """Returns float [0.0, 1.0] -- Jaccard similarity of availability grids."""
    overlap = db.execute("""
        SELECT COUNT(*) FROM availability a
        INNER JOIN availability b
            ON a.day_of_week = b.day_of_week AND a.hour_block = b.hour_block
        WHERE a.user_id = ? AND b.user_id = ?
    """, (user_a_id, user_b_id)).fetchone()[0]

    a_count = db.execute(
        "SELECT COUNT(*) FROM availability WHERE user_id = ?", (user_a_id,)
    ).fetchone()[0]
    b_count = db.execute(
        "SELECT COUNT(*) FROM availability WHERE user_id = ?", (user_b_id,)
    ).fetchone()[0]

    if a_count == 0 or b_count == 0:
        return 0.0

    union = a_count + b_count - overlap
    return overlap / union  # Jaccard index


def skill_complementarity(a_skills, b_skills):
    """
    Returns float [0.0, 1.0].
    Rewards B having skills that A lacks (complementary) more than shared skills.
    """
    if not b_skills:
        return 0.0

    a_set = set(a_skills)
    b_set = set(b_skills)

    complement = b_set - a_set   # Skills B has that A doesn't
    shared = a_set & b_set       # Skills they both have

    raw = len(complement) * 1.0 + len(shared) * 0.3
    normalized = raw / len(b_set)
    return min(normalized, 1.0)


def get_user_skill_ids(user_id, db):
    """Return a list of skill IDs for a user."""
    rows = db.execute(
        "SELECT skill_id FROM user_skills WHERE user_id = ?", (user_id,)
    ).fetchall()
    return [row[0] for row in rows]


def get_user_profile(user_id, db):
    """Return a dict with basic user profile info and their skills."""
    user = db.execute(
        "SELECT id, github_handle, email, auth_provider, display_name, avatar_url, bio FROM users WHERE id = ?",
        (user_id,)
    ).fetchone()

    if user is None:
        return None

    skills = db.execute("""
        SELECT s.id, s.name, us.level
        FROM user_skills us
        JOIN skills s ON us.skill_id = s.id
        WHERE us.user_id = ?
    """, (user_id,)).fetchall()

    return {
        "id": user["id"],
        "github_handle": user["github_handle"],
        "email": user["email"],
        "auth_provider": user["auth_provider"],
        "display_name": user["display_name"],
        "avatar_url": user["avatar_url"],
        "bio": user["bio"],
        "skills": [{"id": s["id"], "name": s["name"], "level": s["level"]} for s in skills],
    }


def match_score(user_a_id, user_b_id, db):
    """Returns dict with overlap_score, skill_score, final_score (all [0,1])."""
    overlap = availability_overlap(user_a_id, user_b_id, db)

    a_skills = get_user_skill_ids(user_a_id, db)
    b_skills = get_user_skill_ids(user_b_id, db)
    skill = skill_complementarity(a_skills, b_skills)

    final = WEIGHT_AVAILABILITY * overlap + WEIGHT_SKILL * skill

    return {
        "overlap_score": round(overlap, 3),
        "skill_score": round(skill, 3),
        "final_score": round(final, 3),
    }


def rank_for_event(current_user_id, event_id, db, limit=20):
    """Event-first: rank all users interested in an event against current user."""
    candidates = db.execute(
        "SELECT user_id FROM event_interests WHERE event_id = ? AND user_id != ?",
        (event_id, current_user_id)
    ).fetchall()

    results = []
    for row in candidates:
        scores = match_score(current_user_id, row["user_id"], db)
        user = get_user_profile(row["user_id"], db)
        results.append({"user": user, **scores})

    results.sort(key=lambda r: r["final_score"], reverse=True)
    return results[:limit]


def rank_by_skills(current_user_id, skill_names, db, limit=20):
    """Teammate-first: find users with given skills, rank by match score."""
    placeholders = ",".join("?" * len(skill_names))
    candidates = db.execute(f"""
        SELECT DISTINCT us.user_id FROM user_skills us
        JOIN skills s ON us.skill_id = s.id
        WHERE s.name IN ({placeholders}) AND us.user_id != ?
    """, (*skill_names, current_user_id)).fetchall()

    results = []
    for row in candidates:
        scores = match_score(current_user_id, row["user_id"], db)
        results.append({"user": get_user_profile(row["user_id"], db), **scores})

    results.sort(key=lambda r: r["final_score"], reverse=True)
    return results[:limit]
