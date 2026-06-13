import httpx

_BASE = "https://www.theaudiodb.com/api/v1/json/2"


async def get_artist_image(mbid: str) -> str | None:
    """Fetch artist thumbnail from TheAudioDB by MusicBrainz ID. Returns URL or None."""
    try:
        async with httpx.AsyncClient(timeout=6) as client:
            r = await client.get(f"{_BASE}/artist-mb.php", params={"i": mbid})
            r.raise_for_status()
            artists = (r.json() or {}).get("artists") or []
            if artists:
                a = artists[0]
                return a.get("strArtistThumb") or a.get("strArtistFanart") or None
    except Exception:
        pass
    return None
