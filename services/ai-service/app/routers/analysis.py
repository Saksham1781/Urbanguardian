import os
from fastapi import APIRouter
from app.models.schemas import AnalysisRequest, AnalysisResponse, RouteSafetyResult
from app.utils.news_fetcher import fetch_crime_news
from app.utils.safety_scorer import score_route_safety

router = APIRouter()


@router.post("/analyze", response_model=AnalysisResponse)
async def analyze_routes(request: AnalysisRequest):
    """
    Receives routes with key locations, fetches recent crime news
    for those locations, and returns time-weighted safety scores.
    """
    # Step 1: Collect all unique locations across all routes
    # Prefer routeAreas (reverse-geocoded neighborhoods) over raw keyLocation names
    all_locations = list({
        loc
        for route in request.routes
        for loc in (route.routeAreas if route.routeAreas else route.keyLocations.get("names", []))
    })
    news_by_location = await fetch_crime_news(all_locations)

    # Step 2: Score each route using only its own area news
    scored_routes = []
    for route in request.routes:
        route_search_locations = route.routeAreas if route.routeAreas else route.keyLocations.get("names", [])
        route_news = {}
        for loc in route_search_locations:
            if loc in news_by_location:
                route_news[loc] = news_by_location[loc]

        safety_result = score_route_safety(route, route_news)
        scored_routes.append(safety_result)

    # Step 3: Rank routes by safety score (highest = safest)
    scored_routes.sort(key=lambda r: r.safetyScore, reverse=True)

    # Assign ranks
    for i, route in enumerate(scored_routes):
        route.rank = i + 1

    return AnalysisResponse(
        rankedRoutes=scored_routes,
        totalAnalyzed=len(scored_routes),
        newsArticlesFound=sum(
            len(articles) for articles in news_by_location.values()
        ),
    )
