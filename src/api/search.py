from fastapi import APIRouter, HTTPException, Query
from ..services.downloader import search_youtube_music

router = APIRouter(prefix="/api/v3/search", tags=["search"])


@router.get("/track")
async def search_tracks(
    query: str = Query(..., min_length=2),
    limit: int = Query(5, ge=1, le=20),
):
    try:
        results = await search_youtube_music(query, limit=limit)
        return results
    except Exception as e:
        raise HTTPException(502, f"YouTube search failed: {e}")
