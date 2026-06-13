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


async def get_artist_image_by_name(name: str) -> str | None:
    """Fallback: fetch artist thumbnail by name (for scan stubs with fake MBIDs)."""
    try:
        async with httpx.AsyncClient(timeout=6) as client:
            r = await client.get(f"{_BASE}/search.php", params={"s": name})
            r.raise_for_status()
            artists = (r.json() or {}).get("artists") or []
            if artists:
                a = artists[0]
                return a.get("strArtistThumb") or a.get("strArtistFanart") or None
    except Exception:
        pass
    return None


async def get_album_image(artist_name: str, album_title: str) -> str | None:
    """Fetch album art thumbnail from TheAudioDB by artist + album name."""
    try:
        async with httpx.AsyncClient(timeout=6) as client:
            r = await client.get(f"{_BASE}/searchalbum.php", params={"s": artist_name, "a": album_title})
            r.raise_for_status()
            albums = (r.json() or {}).get("album") or []
            if albums:
                return albums[0].get("strAlbumThumb") or None
    except Exception:
        pass
    return None
