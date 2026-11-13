import math
from app.models.schemas import RouteSafetyResult, CrimeIncident, ZoneResult


# Whitelist — articles matching any keyword below count toward the safety score.
# Tier 1: crimes specifically targeting women / children (highest weight).
# Tier 2: general violent street crime that affects everyone's safety.
# Excluded: road accidents, fraud, corruption, cybercrime, geopolitical news.
_WOMEN_CHILDREN_KEYWORDS = {
    # Crimes against women
    "rape", "gang rape", "sexual assault", "molestation",
    "sexual harassment", "eve teasing", "eve-teasing",
    "acid attack", "acid thrown", "dowry death", "dowry harassment",
    "domestic violence", "outrage modesty",
    "woman attacked", "women attacked", "girl attacked",
    "woman killed", "women killed", "girl killed",
    "woman abducted", "girl abducted", "woman kidnapped", "girl kidnapped",
    # Crimes against children
    "child abuse", "child sexual", "pocso", "child trafficking",
    "child rape", "minor rape", "child kidnap", "minor abduct",
    "child killed", "child murder", "child molest",
    # General violent street crime (Tier 2)
    "murder", "stabbing", "stabbed", "shot dead", "shooting",
    "robbery", "mugging", "snatching", "chain snatching",
    "kidnapping", "abduction", "abducted", "kidnapped",
    "assault", "attacked", "beaten", "lynched",
    "mob violence", "riot", "fired upon",
}

# Severity tiers — checked top-to-bottom; first match wins.
# Women/children crimes sit in critical/high.
# General violent crime sits in high/medium/low.
SEVERITY_KEYWORDS = {
    "critical": [
        "rape", "gang rape", "sexual assault", "molestation",
        "acid attack", "acid thrown", "dowry death",
        "child rape", "minor rape", "child killed", "child murder",
        "pocso",
    ],
    "high": [
        "sexual harassment", "eve teasing", "eve-teasing",
        "woman kidnapped", "girl kidnapped", "child kidnap", "minor abduct",
        "child trafficking", "child abuse", "child sexual",
        "woman attacked", "girl attacked", "women attacked",
        # General violent crime — high tier
        "murder", "shot dead", "stabbed", "lynched", "mob violence",
        "kidnapping", "abduction", "abducted", "kidnapped",
    ],
    "medium": [
        "domestic violence", "dowry harassment",
        "woman abducted", "girl abducted",
        "outrage modesty",
        "woman killed", "girl killed", "women killed",
        "child molest",
        # General violent crime — medium tier
        "shooting", "stabbing", "assault", "attacked", "beaten",
        "robbery", "mugging", "fired upon", "riot",
    ],
    "low": [
        "stalking",
        # General street crime — low tier
        "snatching", "chain snatching",
    ],
}

SEVERITY_PENALTY = {
    "critical": 35,   # Crimes against women / lethal violence
    "high": 22,       # Kidnapping / armed robbery / assault
    "medium": 10,     # Theft / burglary
    "low": 3,         # Low-level incidents
}


def score_route_safety(route, route_news: dict[str, list[dict]]) -> RouteSafetyResult:
    """
    Score a route's safety based on crime news along its path.

    Scoring logic:
    - Start at 100 (perfectly safe)
    - Deduct points for each crime incident found
    - Recent crimes penalize more heavily (time decay)
    - Severe crimes penalize more than minor ones
    - Floor at 0
    """
    score = 100.0
    incidents = []
    reasoning_parts = []

    total_articles = sum(len(arts) for arts in route_news.values())

    if total_articles == 0:
        return RouteSafetyResult(
            routeIndex=route.routeIndex,
            summary=route.summary,
            safetyScore=90.0,  # No news = max score (no data to penalise)
            riskLevel="low",
            incidents=[],
            reasoning="No recent crime reports found along this route. Limited data available.",
        )

    for location, articles in route_news.items():
        for article in articles:
            text = article.get("title", "") + " " + article.get("description", "")

            # Skip road accidents and institutional crime — not personal safety threats
            if _is_irrelevant(text):
                continue

            severity = _classify_severity(text)
            hours_ago = article.get("hoursAgo", 9999)

            # Time decay: recent crimes matter more
            # decay = 1.0 for 0 hours ago, ~0.1 for 30 days ago
            time_decay = math.exp(-0.003 * hours_ago)

            # Calculate penalty for this incident
            base_penalty = SEVERITY_PENALTY.get(severity, 5)
            penalty = base_penalty * time_decay

            score -= penalty

            incidents.append(CrimeIncident(
                title=article.get("title", "Unknown"),
                description=article.get("description", ""),
                source=article.get("source", "Unknown"),
                publishedAt=article.get("publishedAt", ""),
                hoursAgo=hours_ago,
                severity=severity,
                location=location,
            ))

            if time_decay > 0.5:  # Recent enough to mention
                reasoning_parts.append(
                    f"{severity.upper()} incident near {location} "
                    f"({hours_ago:.0f}h ago): {article.get('title', '')[:80]}"
                )

    # Clamp score between 40 (worst) and 90 (best)
    score = max(40.0, min(90.0, score))

    # Determine risk level
    if score >= 80:
        risk_level = "low"
    elif score >= 60:
        risk_level = "moderate"
    elif score >= 35:
        risk_level = "high"
    else:
        risk_level = "critical"

    reasoning = (
        f"Analyzed {total_articles} news articles across {len(route_news)} locations. "
        + " | ".join(reasoning_parts[:5])  # Top 5 most relevant incidents
        if reasoning_parts
        else f"Found {total_articles} articles but none were recent enough to significantly impact the score."
    )

    return RouteSafetyResult(
        routeIndex=route.routeIndex,
        summary=route.summary,
        safetyScore=round(score, 1),
        riskLevel=risk_level,
        incidents=incidents,
        reasoning=reasoning,
    )


def score_location_safety(location: str, articles: list[dict]) -> ZoneResult:
    """
    Score a single city/neighbourhood's safety from a list of crime articles.

    Zone scoring uses weighted crime count (no time decay) because neighbourhood
    safety is a long-term pattern, not a real-time signal. We compare localities
    against each other via normalize_zone_scores(), so the raw weighted count is
    what matters — higher count = more dangerous relative to neighbours.
    """
    if not articles:
        return ZoneResult(
            location=location,
            zone="yellow",
            score=55.0,
            riskLevel="moderate",
            topIncidents=[],
            summary="Insufficient data for precise classification",
            articlesAnalyzed=0,
        )

    # Severity weights for zone classification (no time decay)
    _ZONE_WEIGHT = {"critical": 4, "high": 3, "medium": 2, "low": 1}

    weighted_count = 0.0
    incidents: list[CrimeIncident] = []

    for article in articles:
        text = article.get("title", "") + " " + article.get("description", "")
        if _is_irrelevant(text):
            continue
        severity = _classify_severity(text)
        weighted_count += _ZONE_WEIGHT.get(severity, 1)
        hours_ago = article.get("hoursAgo", 9999)
        incidents.append(CrimeIncident(
            title=article.get("title", ""),
            description=article.get("description", ""),
            source=article.get("source", "Unknown"),
            publishedAt=article.get("publishedAt", ""),
            hoursAgo=hours_ago,
            severity=severity,
            location=location,
        ))

    # Store raw weighted crime count as score (will be normalized by normalize_zone_scores)
    # Higher weighted_count = more crime = lower final score after normalization
    raw_score = weighted_count

    # Standalone thresholds (before normalization): used only when scoring a single location
    if raw_score == 0:
        zone, risk_level, display_score = "green", "low", 90.0
    elif raw_score <= 20:
        zone, risk_level, display_score = "green", "low", 80.0
    elif raw_score <= 60:
        zone, risk_level, display_score = "yellow", "moderate", 60.0
    else:
        zone, risk_level, display_score = "red", "high", 45.0

    top_incidents = incidents[:3]
    summary = (
        f"Analyzed {len(articles)} articles. Found {len(incidents)} relevant crime incidents "
        f"(weighted severity score: {int(raw_score)})."
        if incidents
        else f"Analyzed {len(articles)} articles. No crime incidents matched criteria."
    )

    return ZoneResult(
        location=location,
        zone=zone,
        score=round(raw_score, 1),   # raw_score carried through for normalization
        riskLevel=risk_level,
        topIncidents=top_incidents,
        summary=summary,
        articlesAnalyzed=len(articles),
    )


def normalize_zone_scores(zones: list[ZoneResult]) -> list[ZoneResult]:
    """
    Normalize zone scores relative to each other within the batch.

    score stored in ZoneResult is the raw weighted crime count (higher = worse).
    We invert it here: lowest crime count -> display score 90 (green),
    highest crime count -> display score 40 (red).

    Locations with no data (articlesAnalyzed == 0) stay at 55 (yellow, neutral).
    """
    scored = [z for z in zones if z.articlesAnalyzed > 0]
    if len(scored) < 2:
        # Single location — convert raw score to display score directly
        result = []
        for z in zones:
            if z.articlesAnalyzed == 0:
                result.append(z)
                continue
            # Standalone: raw score 0->90, 20->80, 60->60, 100+->40
            raw = z.score
            display = max(40.0, min(90.0, 90.0 - raw * 0.5))
            display = round(display, 1)
            zone = "green" if display >= 70 else "yellow" if display >= 55 else "red"
            risk = "low" if zone == "green" else "moderate" if zone == "yellow" else "high"
            result.append(ZoneResult(
                location=z.location, zone=zone, score=display, riskLevel=risk,
                topIncidents=z.topIncidents, summary=z.summary, articlesAnalyzed=z.articlesAnalyzed,
            ))
        return result

    min_raw = min(z.score for z in scored)
    max_raw = max(z.score for z in scored)

    if max_raw == min_raw:
        # All neighbourhoods have identical crime density — map all to middle (yellow)
        result = []
        for z in zones:
            if z.articlesAnalyzed == 0:
                result.append(z)
                continue
            result.append(ZoneResult(
                location=z.location, zone="yellow", score=65.0, riskLevel="moderate",
                topIncidents=z.topIncidents, summary=z.summary, articlesAnalyzed=z.articlesAnalyzed,
            ))
        return result

    normalized: list[ZoneResult] = []
    for z in zones:
        if z.articlesAnalyzed == 0:
            normalized.append(z)
            continue

        # Invert: more crime (high raw) -> lower display score
        # Map [min_raw, max_raw] -> [90, 40]  (inverted range)
        ratio = (z.score - min_raw) / (max_raw - min_raw)
        display = round(90.0 - ratio * 50.0, 1)

        if display >= 70:
            zone, risk_level = "green", "low"
        elif display >= 55:
            zone, risk_level = "yellow", "moderate"
        else:
            zone, risk_level = "red", "high"

        normalized.append(ZoneResult(
            location=z.location,
            zone=zone,
            score=display,
            riskLevel=risk_level,
            topIncidents=z.topIncidents,
            summary=z.summary,
            articlesAnalyzed=z.articlesAnalyzed,
        ))

    return normalized


def _is_irrelevant(text: str) -> bool:
    """Return True unless the article is specifically about a crime against women or children."""
    text_lower = text.lower()
    return not any(kw in text_lower for kw in _WOMEN_CHILDREN_KEYWORDS)


def _classify_severity(text: str) -> str:
    """
    Classify severity of a women/children crime — checked top-to-bottom so
    the most serious category always wins when multiple keywords appear.
    """
    text_lower = text.lower()
    for severity, keywords in SEVERITY_KEYWORDS.items():
        if any(kw in text_lower for kw in keywords):
            return severity
    return "low"
