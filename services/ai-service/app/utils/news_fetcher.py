"""
Crime news fetcher — uses Google News RSS search.

Google News RSS is free, requires no API key, returns real publication dates,
and covers all major Indian news sources (TOI, HT, NDTV, India Today, etc.).
DuckDuckGo and Bing both block headless browsers; Google News RSS is the
reliable alternative that achieves the same goal.
"""

import asyncio
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime


# ── Crime keywords ─────────────────────────────────────────────────────────

_CRIME_KEYWORDS_SET = {
    "rape", "gang rape", "sexual assault", "molestation", "sexual harassment",
    "eve teasing", "eve-teasing",
    "acid attack", "acid thrown", "dowry death", "dowry harassment",
    "domestic violence", "outrage modesty",
    "woman attacked", "women attacked", "girl attacked",
    "woman killed", "women killed", "girl killed",
    "woman abducted", "girl abducted", "woman kidnapped", "girl kidnapped",
    "child abuse", "child sexual", "pocso", "child trafficking",
    "child rape", "minor rape", "child kidnap", "minor abduct",
    "child killed", "child murder", "child molest",
    "murder", "stabbing", "stabbed", "shot dead", "shooting",
    "robbery", "mugging", "snatching", "chain snatching",
    "kidnapping", "abduction", "abducted", "kidnapped",
    "assault", "attacked", "beaten", "lynched",
    "mob violence", "riot", "fired upon",
    "crime", "criminal", "arrested", "arrested for",
    "police", "accused", "suspect",
}

_GNEWS_BASE = "https://news.google.com/rss/search"


# ── Helpers ────────────────────────────────────────────────────────────────

def _city_of(location: str) -> str:
    """
    Extract the parent city/area from a location string.

    "Lajpat Nagar, Delhi" -> "Delhi"
    "Lajpat Nagar I"      -> "Lajpat Nagar"  (strips trailing roman/number suffix)
    "Lajpat Nagar"        -> "Lajpat Nagar"  (no change, already city-level)
    """
    parts = [p.strip() for p in location.split(",")]
    if len(parts) >= 2:
        return parts[-1]
    # Strip trailing Roman numeral or digit suffix so sub-localities fall back
    # to the parent area: "Lajpat Nagar IV" -> "Lajpat Nagar"
    base = re.sub(r"\s+[IVXivx\d]+$", "", parts[0]).strip()
    return base if base and base.lower() != parts[0].lower() else parts[0]


def _hours_ago(pub_date_str: str) -> float:
    """Parse RFC-2822 date from RSS and return hours since publication."""
    if not pub_date_str:
        return 168.0  # default: 1 week
    try:
        pub = parsedate_to_datetime(pub_date_str)
        delta = datetime.now(timezone.utc) - pub
        return max(0.0, round(delta.total_seconds() / 3600, 1))
    except Exception:
        return 168.0


def _passes_keyword_filter(article: dict) -> bool:
    # Google News RSS descriptions are HTML markup (<ol><li><a>…</a></li></ol>),
    # not article text. Rely on the title which is always a real headline.
    title = article.get("title", "").lower()
    # Strip any HTML from description as a bonus signal
    raw_desc = article.get("description", "")
    desc = re.sub(r"<[^>]+>", " ", raw_desc).lower()
    text = title + " " + desc
    return any(kw in text for kw in _CRIME_KEYWORDS_SET)


# ── Google News RSS fetcher ────────────────────────────────────────────────

def _fetch_gnews_rss_sync(location: str) -> list[dict]:
    """
    Fetch Google News RSS for a location + crime query.
    Runs synchronously; wrap in asyncio.to_thread for async callers.
    """
    # Keep query short — Google News RSS treats extra keywords as AND filters,
    # which drastically reduces results. "{location} crime" returns the most
    # relevant, location-specific articles.
    loc_clean = " ".join(location.replace(",", " ").split())
    query = f"{loc_clean} crime"
    params = urllib.parse.urlencode({
        "q": query,
        "hl": "en-IN",
        "gl": "IN",
        "ceid": "IN:en",
    })
    url = f"{_GNEWS_BASE}?{params}"

    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "UrbanGuardians/1.0"},
        )
        with urllib.request.urlopen(req, timeout=12) as resp:
            xml_bytes = resp.read()

        root = ET.fromstring(xml_bytes.decode("utf-8"))
        items = root.findall(".//item")

        articles: list[dict] = []
        for item in items:
            title = item.findtext("title", "").strip()
            link = item.findtext("link", "").strip()
            pub_date = item.findtext("pubDate", "").strip()
            source_el = item.find("source")
            source = source_el.text.strip() if source_el is not None and source_el.text else "Unknown"
            # Google News RSS wraps description in CDATA
            description = item.findtext("description", "").strip()

            articles.append({
                "title": title,
                "description": description,
                "source": source,
                "publishedAt": pub_date,
                "hoursAgo": _hours_ago(pub_date),
                "url": link,
            })

        print(f"[GNewsRSS] '{location}' -> {len(articles)} raw articles")
        return articles

    except Exception as e:
        print(f"[GNewsRSS] Error for '{location}': {e}")
        return []


# ── Main entry point ───────────────────────────────────────────────────────

async def fetch_crime_news(locations: list[str]) -> dict[str, list[dict]]:
    """
    Fetch crime news for each location via Google News RSS.

    Falls back to city-only search if a location returns 0 filtered results.
    Requests are staggered by 0.5s to be polite to Google's servers.
    """
    result: dict[str, list[dict]] = {}

    for i, location in enumerate(locations):
        if i > 0:
            await asyncio.sleep(0.5)

        raw = await asyncio.to_thread(_fetch_gnews_rss_sync, location)
        filtered = [a for a in raw if _passes_keyword_filter(a)]

        # City-only fallback if no results
        if not filtered:
            city = _city_of(location)
            if city.lower() != location.lower():
                print(f"[GNewsRSS] Fallback to city '{city}' for '{location}'")
                await asyncio.sleep(0.5)
                raw2 = await asyncio.to_thread(_fetch_gnews_rss_sync, city)
                filtered = [a for a in raw2 if _passes_keyword_filter(a)]

        result[location] = filtered
        print(f"[GNewsRSS] '{location}' -> {len(filtered)} filtered articles")

    total = sum(len(v) for v in result.values())
    print(f"[GNewsRSS] Total: {total} articles across {len(locations)} location(s)")
    return result
