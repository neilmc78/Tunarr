import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Artist, Album, Track, QualityProfile, TrackFile
from ..schemas import ArtistOut, ArtistIn, ArtistUpdate, ArtistLookup
from ..services import musicbrainz as mb
from ..services import tadb

router = APIRouter(prefix="/api/v3/artist", tags=["artist"])


@router.get("", response_model=list[ArtistOut])
def list_artists(db: Session = Depends(get_db)):
    artists = db.query(Artist).all()
    return [ArtistOut.from_orm_artist(a) for a in artists]


@router.get("/{artist_id}", response_model=ArtistOut)
def get_artist(artist_id: int, db: Session = Depends(get_db)):
    a = db.get(Artist, artist_id)
    if not a:
        raise HTTPException(404, "Artist not found")
    return ArtistOut.from_orm_artist(a)


@router.post("", response_model=ArtistOut, status_code=201)
async def add_artist(body: ArtistIn, db: Session = Depends(get_db)):
    # Exact MBID match — already added with real data
    existing = db.query(Artist).filter(Artist.musicbrainz_id == body.musicBrainzId).first()
    if existing:
        raise HTTPException(400, "Artist already added")

    try:
        mb_data = await mb.get_artist(body.musicBrainzId)
    except Exception as e:
        raise HTTPException(502, f"MusicBrainz lookup failed: {e}")

    qp_id = body.qualityProfileId
    if not qp_id:
        qp = db.query(QualityProfile).first()
        qp_id = qp.id if qp else None

    real_name = mb_data.get("artistName") or body.artistName

    # Check for a scan stub with the same name (has a random UUID as MBID)
    stub = db.query(Artist).filter(Artist.name.ilike(real_name)).first()

    # Fetch artist image from TheAudioDB (best-effort, non-blocking)
    tadb_url = await tadb.get_artist_image(body.musicBrainzId)
    mb_images = mb_data.get("images", [])
    if tadb_url and not any(i.get("remoteUrl") == tadb_url for i in mb_images):
        mb_images = [{"coverType": "poster", "remoteUrl": tadb_url}] + list(mb_images)

    if stub:
        # Merge: promote the stub to a fully enriched artist
        stub.musicbrainz_id   = body.musicBrainzId
        stub.name             = real_name
        stub.sort_name        = mb_data.get("sortName") or stub.sort_name
        stub.disambiguation   = mb_data.get("disambiguation", "")
        stub.overview         = mb_data.get("overview", "")
        stub.status           = mb_data.get("status", stub.status)
        stub.artist_type      = mb_data.get("artistType", "")
        stub.monitored        = body.monitored
        stub.album_folder     = body.albumFolder
        stub.root_folder_path = body.rootFolderPath or stub.root_folder_path
        stub.quality_profile_id = qp_id
        stub.images           = json.dumps(mb_images)
        stub.links            = json.dumps(mb_data.get("links", []))
        stub.genres           = json.dumps(mb_data.get("genres", []))
        artist = stub
    else:
        artist = Artist(
            musicbrainz_id=body.musicBrainzId,
            name=real_name,
            sort_name=mb_data.get("sortName") or body.artistName,
            disambiguation=mb_data.get("disambiguation", ""),
            overview=mb_data.get("overview", ""),
            status=mb_data.get("status", "active"),
            artist_type=mb_data.get("artistType", ""),
            monitored=body.monitored,
            album_folder=body.albumFolder,
            root_folder_path=body.rootFolderPath,
            quality_profile_id=qp_id,
            images=json.dumps(mb_images),
            links=json.dumps(mb_data.get("links", [])),
            genres=json.dumps(mb_data.get("genres", [])),
            tags=json.dumps([]),
        )
        db.add(artist)
        db.flush()

    # Merge albums: match by MBID first, then by title (for scan stubs)
    existing_by_mbid  = {al.musicbrainz_id: al for al in artist.albums}
    existing_by_title = {al.title.lower(): al  for al in artist.albums}

    add_all = body.addOptions.get("addType", "manual") == "automatic"

    for rg in mb_data.get("releaseGroups", []):
        real_mbid = rg["musicBrainzId"]
        title     = rg["title"]

        if real_mbid in existing_by_mbid:
            # Already has the correct MBID — just refresh metadata
            al = existing_by_mbid[real_mbid]
            al.album_type   = rg.get("albumType", al.album_type)
            al.release_date = rg.get("releaseDate", al.release_date)
            continue

        stub_al = existing_by_title.get(title.lower())
        if stub_al:
            # Scan stub found by title — give it the real MBID and update metadata
            stub_al.musicbrainz_id = real_mbid
            stub_al.album_type     = rg.get("albumType", stub_al.album_type)
            stub_al.release_date   = rg.get("releaseDate", stub_al.release_date)
            existing_by_mbid[real_mbid] = stub_al  # prevent duplicate on later iteration
        else:
            # Genuinely new album from MusicBrainz discography
            db.add(Album(
                musicbrainz_id=real_mbid,
                artist_id=artist.id,
                title=title,
                album_type=rg.get("albumType", "Album"),
                secondary_types=json.dumps(rg.get("secondaryTypes", [])),
                release_date=rg.get("releaseDate", ""),
                monitored=body.monitored and add_all,
                images=json.dumps([]),
                links=json.dumps([]),
                genres=json.dumps([]),
                labels=json.dumps([]),
            ))

    db.commit()
    db.refresh(artist)
    return ArtistOut.from_orm_artist(artist)


@router.put("/{artist_id}", response_model=ArtistOut)
def update_artist(artist_id: int, body: ArtistUpdate, db: Session = Depends(get_db)):
    a = db.get(Artist, artist_id)
    if not a:
        raise HTTPException(404, "Artist not found")
    if body.monitored is not None:
        a.monitored = body.monitored
    if body.albumFolder is not None:
        a.album_folder = body.albumFolder
    if body.rootFolderPath is not None:
        a.root_folder_path = body.rootFolderPath
    if body.qualityProfileId is not None:
        a.quality_profile_id = body.qualityProfileId
    db.commit()
    db.refresh(a)
    return ArtistOut.from_orm_artist(a)


@router.delete("/{artist_id}", status_code=200)
def delete_artist(artist_id: int, deleteFiles: bool = False, db: Session = Depends(get_db)):
    a = db.get(Artist, artist_id)
    if not a:
        raise HTTPException(404, "Artist not found")
    if deleteFiles:
        import os
        for album in a.albums:
            for track in album.tracks:
                if track.track_file:
                    try:
                        os.remove(track.track_file.path)
                    except OSError:
                        pass
    # Remove TrackFile rows so the scanner can re-import these files later
    db.query(TrackFile).filter(TrackFile.artist_id == artist_id).delete()
    db.delete(a)
    db.commit()
    return {}


@router.get("/lookup/search", response_model=list[ArtistLookup])
async def lookup_artist(term: str, db: Session = Depends(get_db)):
    try:
        results = await mb.search_artists(term)
    except Exception as e:
        raise HTTPException(502, f"MusicBrainz search failed: {e}")
    return [ArtistLookup(**r) for r in results]


@router.get("/{artist_id}/image")
async def get_or_fetch_artist_image(artist_id: int, db: Session = Depends(get_db)):
    """Return cached image URL or fetch from TheAudioDB and cache it."""
    a = db.get(Artist, artist_id)
    if not a:
        raise HTTPException(404, "Artist not found")
    images = json.loads(a.images or "[]")
    existing = next((i for i in images if i.get("coverType") in ("poster", "cover")), None)
    if existing:
        return {"url": existing.get("remoteUrl")}
    url = await tadb.get_artist_image(a.musicbrainz_id)
    if not url:
        url = await tadb.get_artist_image_by_name(a.name)
    if url:
        images = [{"coverType": "poster", "remoteUrl": url}] + images
        a.images = json.dumps(images)
        db.commit()
    return {"url": url}
