from fastapi import APIRouter
from app.models.schemas import ZoneRequest, ZoneResponse
from app.utils.news_fetcher import fetch_crime_news
from app.utils.safety_scorer import score_location_safety, normalize_zone_scores

router = APIRouter()


@router.post("/zones", response_model=ZoneResponse)
async def classify_zones(request: ZoneRequest):
    """
    Classify each location into a Red / Yellow / Green crime zone.
    Uses DuckDuckGo web search for crime data.
    Scores are normalized relative to the batch for fair neighbourhood comparison.
    """
    locations = [loc.strip() for loc in request.locations if loc.strip()]
    if not locations:
        return ZoneResponse(zones=[], totalLocations=0)

    news_by_location = await fetch_crime_news(locations)

    zones = []
    for location in locations:
        articles = news_by_location.get(location, [])
        zone_result = score_location_safety(location, articles)
        zones.append(zone_result)

    # Normalize scores relative to the group so neighbourhoods are compared fairly
    zones = normalize_zone_scores(zones)

    return ZoneResponse(zones=zones, totalLocations=len(zones))
