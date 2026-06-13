import asyncio
import json
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db, SessionLocal
from ..models import Artist, Album, Track, DownloadQueue, History
from ..schemas import CommandIn, CommandOut
from ..services.downloader import search_youtube_music
from ..download_manager import _run_download, _active_downloads

router = APIRouter(prefix="/api/v3/command", tags=["command"])

_command_store: dict[int, dict] = {}
_cmd_counter = 0
_search_semaphore: asyncio.Semaphore | None = None


def _get_search_semaphore() -> asyncio.Semaphore:
    global _search_semaphore
    if _search_semaphore is None:
        _search_semaphore = asyncio.Semaphore(5)
    return _search_semaphore


def _new_command(name: str) -> dict:
    global _cmd_counter
    _cmd_counter += 1
    cmd = {
        "id": _cmd_counter,
        "name": name,
        "status": "queued",
        "queued": datetime.now(timezone.utc).isoformat(),
        "started": None,
        "ended": None,
        "message": "",
    }
    _command_store[_cmd_counter] = cmd
    return cmd


def _get_missing_track_ids(db: Session, track_ids: list[int] | None = None,
                            album_id: int | None = None, artist_id: int | None = None) -> list[int]:
    q = db.query(Track).filter(Track.monitored == True, Track.has_file == False)
    if track_ids is not None:
        q = q.filter(Track.id.in_(track_ids))
    if album_id is not None:
        q = q.filter(Track.album_id == album_id)
    if artist_id is not None:
        q = q.filter(Track.artist_id == artist_id)
    return [t.id for t in q.all()]


def _pre_enqueue_tracks(db: Session, track_ids: list[int]) -> list[int]:
    """Create placeholder queue items for all tracks immediately. Returns list of queue IDs."""
    queue_ids = []
    for track_id in track_ids:
        track = db.get(Track, track_id)
        if not track or track.has_file:
            continue
        artist = db.get(Artist, track.artist_id)
        if not artist:
            continue
        album = db.get(Album, track.album_id)

        item = DownloadQueue(
            track_id=track_id,
            album_id=track.album_id,
            artist_id=track.artist_id,
            download_id=str(uuid.uuid4()),
            title=f"{artist.name} - {track.title}",
            status="searching",
            protocol="ytdlp",
            source_url="",
        )
        db.add(item)
        db.flush()  # populate item.id
        queue_ids.append(item.id)

    db.commit()
    return queue_ids


async def _search_and_start(queue_id: int):
    """Find the best YouTube match for a pre-created queue item and kick off download."""
    async with _get_search_semaphore():
        db: Session = SessionLocal()
        try:
            item = db.get(DownloadQueue, queue_id)
            if not item or item.status != "searching":
                return

            track = db.get(Track, item.track_id) if item.track_id else None
            if not track:
                item.status = "failed"
                item.error_message = "Track not found"
                db.commit()
                return

            album = db.get(Album, track.album_id)
            artist = db.get(Artist, track.artist_id)
            if not artist:
                item.status = "failed"
                item.error_message = "Artist not found"
                db.commit()
                return

            query = f"{artist.name} - {track.title}"
            if album:
                query += f" {album.title}"

            results = await search_youtube_music(query, limit=3)
            if not results:
                item.status = "failed"
                item.error_message = "No YouTube results found"
                db.commit()
                return

            best = results[0]
            expected_ms = track.duration or 0
            if expected_ms > 0:
                for r in results:
                    if abs((r.get("duration") or 0) - expected_ms) < abs((best.get("duration") or 0) - expected_ms):
                        best = r

            item.source_url = best["url"]
            item.status = "queued"
            db.add(History(
                track_id=item.track_id,
                album_id=item.album_id,
                artist_id=item.artist_id,
                source_title=item.title,
                quality=json.dumps({"quality": {"id": 0, "name": "Unknown"}}),
                event_type="grabbed",
                data=json.dumps({"protocol": "ytdlp", "url": best["url"]}),
            ))
            db.commit()
        finally:
            db.close()

        task = asyncio.create_task(_run_download(queue_id))
        _active_downloads[queue_id] = task


async def _run_command(cmd: dict, body: CommandIn):
    cmd["status"] = "started"
    cmd["started"] = datetime.now(timezone.utc).isoformat()

    try:
        name = body.name

        if name in ("TrackSearch", "AlbumSearch", "ArtistSearch"):
            db: Session = SessionLocal()
            try:
                track_ids = _get_missing_track_ids(
                    db,
                    track_ids=body.trackIds if name == "TrackSearch" else None,
                    album_id=body.albumId  if name == "AlbumSearch"  else None,
                    artist_id=body.artistId if name == "ArtistSearch" else None,
                )
                queue_ids = _pre_enqueue_tracks(db, track_ids)
            finally:
                db.close()

            tasks = [_search_and_start(qid) for qid in queue_ids]
            await asyncio.gather(*tasks, return_exceptions=True)
            cmd["message"] = f"Queued {len(queue_ids)} tracks"

        elif name == "RefreshArtist":
            if not body.artistId:
                raise ValueError("artistId required for RefreshArtist")
            import json as _json
            from ..services import musicbrainz as mb_svc

            db: Session = SessionLocal()
            try:
                artist = db.get(Artist, body.artistId)
                if not artist:
                    raise ValueError(f"Artist {body.artistId} not found")

                mb_data = await mb_svc.get_artist(artist.musicbrainz_id)
                artist.name      = mb_data.get("artistName", artist.name)
                artist.sort_name = mb_data.get("sortName", artist.sort_name)
                artist.status    = mb_data.get("status", artist.status)
                artist.overview  = mb_data.get("overview", artist.overview)
                artist.images    = _json.dumps(mb_data.get("images", []))
                artist.links     = _json.dumps(mb_data.get("links", []))
                artist.genres    = _json.dumps(mb_data.get("genres", []))

                existing_by_mbid  = {al.musicbrainz_id: al for al in artist.albums}
                existing_by_title = {al.title.lower(): al  for al in artist.albums}

                for rg in mb_data.get("releaseGroups", []):
                    real_mbid = rg["musicBrainzId"]
                    title     = rg["title"]

                    if real_mbid in existing_by_mbid:
                        continue

                    stub = existing_by_title.get(title.lower())
                    if stub:
                        stub.musicbrainz_id = real_mbid
                        stub.album_type     = rg.get("albumType", stub.album_type)
                        stub.release_date   = rg.get("releaseDate", stub.release_date)
                        existing_by_mbid[real_mbid] = stub
                    else:
                        db.add(Album(
                            musicbrainz_id=real_mbid,
                            artist_id=artist.id,
                            title=title,
                            album_type=rg.get("albumType", "Album"),
                            secondary_types=_json.dumps(rg.get("secondaryTypes", [])),
                            release_date=rg.get("releaseDate", ""),
                            monitored=artist.monitored,
                            images=_json.dumps([]),
                            links=_json.dumps([]),
                            genres=_json.dumps([]),
                            labels=_json.dumps([]),
                        ))

                db.commit()
                cmd["message"] = f"Refreshed {artist.name}"
            finally:
                db.close()

        elif name == "ScanLibrary":
            from ..models import RootFolder
            from ..services.scanner import scan_root_folder

            db: Session = SessionLocal()
            try:
                paths = [f.path for f in db.query(RootFolder).all()]
            finally:
                db.close()

            if not paths:
                cmd["message"] = "No root folders configured — add one in Settings first"
            else:
                total = {'scanned': 0, 'imported': 0, 'skipped': 0, 'errors': 0}
                for path in paths:
                    stats = await asyncio.to_thread(scan_root_folder, path)
                    for k in total:
                        total[k] += stats[k]
                cmd["message"] = (
                    f"Scanned {total['scanned']} files: "
                    f"{total['imported']} imported, "
                    f"{total['skipped']} already present, "
                    f"{total['errors']} errors"
                )

        else:
            cmd["message"] = f"Unknown command: {name}"

        cmd["status"] = "completed"
    except Exception as exc:
        cmd["status"] = "failed"
        cmd["message"] = str(exc)
    finally:
        cmd["ended"] = datetime.now(timezone.utc).isoformat()


@router.post("", response_model=CommandOut, status_code=201)
async def send_command(body: CommandIn, background_tasks: BackgroundTasks):
    cmd = _new_command(body.name)
    background_tasks.add_task(_run_command, cmd, body)
    return CommandOut(**cmd)


@router.get("/{command_id}", response_model=CommandOut)
def get_command(command_id: int):
    cmd = _command_store.get(command_id)
    if not cmd:
        raise HTTPException(404, "Command not found")
    return CommandOut(**cmd)


@router.get("", response_model=list[CommandOut])
def list_commands():
    return [CommandOut(**c) for c in _command_store.values()]
