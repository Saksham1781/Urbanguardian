import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env FIRST — before any import that reads os.getenv at module level
_env_path = Path(__file__).resolve().parents[3] / ".env"
load_dotenv(dotenv_path=_env_path)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import analysis, zones

app = FastAPI(
    title="Urban Guardians AI Service",
    description="NLP-powered crime news analysis and route safety scoring",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analysis.router)
app.include_router(zones.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "urban-guardians-ai"}
