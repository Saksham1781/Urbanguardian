from pydantic import BaseModel
from typing import Any


class RouteInput(BaseModel):
    routeIndex: int
    summary: str
    distance: str
    duration: str
    keyLocations: dict[str, Any]
    routeAreas: list[str] = []


class AnalysisRequest(BaseModel):
    routes: list[RouteInput]
    locations: list[str]


class CrimeIncident(BaseModel):
    title: str
    description: str
    source: str
    publishedAt: str
    hoursAgo: float
    severity: str  # low, medium, high, critical
    location: str


class RouteSafetyResult(BaseModel):
    routeIndex: int
    summary: str
    safetyScore: float  # 0-100, higher = safer
    rank: int = 0
    riskLevel: str  # low, moderate, high, critical
    incidents: list[CrimeIncident]
    reasoning: str


class AnalysisResponse(BaseModel):
    rankedRoutes: list[RouteSafetyResult]
    totalAnalyzed: int
    newsArticlesFound: int


class ZoneRequest(BaseModel):
    locations: list[str]


class ZoneResult(BaseModel):
    location: str
    zone: str            # "red" | "yellow" | "green"
    score: float         # 40–90
    riskLevel: str       # "low" | "moderate" | "high" | "critical"
    topIncidents: list[CrimeIncident]
    summary: str
    articlesAnalyzed: int


class ZoneResponse(BaseModel):
    zones: list[ZoneResult]
    totalLocations: int
