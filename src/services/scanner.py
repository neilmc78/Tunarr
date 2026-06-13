import json
import logging
import os
from pathlib import Path

logger = logging.getLogger("tunarr.scanner")

AUDIO_EXTENSIONS = {'.mp3', '.flac', '.m4a', '.ogg', '.opus', '.aac', '.wav'}


def _read_tags(filepath: str) -> dict:
    try:
        from mutagen import File  # type: ignore
        audio = File(filepath, easy=True)
        if audio is None:
            return {}

        tags = audio.tags or {}

        def _get(key, default=""):
            val = tags.get(key)
            if not val:
                return default
            return str(val[0]) if isinstance(val, list) else str(val)

        duration_ms = 0
        if hasattr(audio, 'info') and audio.info:
            duration_ms = int(getattr(audio.info, 'length', 0) * 1000)

        tn_raw = _get('tracknumber', '0').split('/')[0].strip()

        return {
            'artist':       _get('artist') or _get('albumartist', ''),
            'album':        _get('album', 'Unknown Album'),
            'title':        _get('title', Path(filepath).stem),
            'track_number': tn_raw,
            'date':         _get('date', ''),
            'mb_artist_id': _get('musicbrainz_artistid', ''),
            'mb_album_id':  _get('musicbrainz_albumid', ''),
            'mb_track_id':  _get('musicbrainz_trackid', ''),
            'duration':     duration_ms,
        }
    except Exception as exc:
        logger.warning("Tag read failed for %s: %s", filepath, exc)
        return {}


def _quality_for_ext(ext: str) -> tuple[int, str]:
    return {
        '.flac': (6, 'FLAC'),
        '.mp3':  (3, 'MP3-320'),
        '.m4a':  (5, 'AAC-320'),
        '.ogg':  (2, 'MP3-256'),
        '.opus': (2, 'MP3-256'),
        '.aac':  (4, 'AAC-256'),
        '.wav':  (6, 'FLAC'),
    }.get(ext, (0, 'Unknown'))


def scan_root_folder(root_path: str) -> dict:
    """Walk root_path, read audio tags, upsert DB records. Returns stats dict."""
    import uuid
    from ..database import SessionLocal
    from ..models import Artist, Album, Track, TrackFile

    stats = {'scanned': 0, 'imported': 0, 'skipped': 0, 'errors': 0}

    audio_files: list[str] = []
    for dirpath, _, filenames in os.walk(root_path):
        for fn in filenames:
            if Path(fn).suffix.lower() in AUDIO_EXTENSIONS:
                audio_files.append(os.path.join(dirpath, fn))

    logger.info("Scanner found %d audio files in %s", len(audio_files), root_path)

    for filepath in audio_files:
        stats['scanned'] += 1
        db = SessionLocal()
        try:
            if db.query(TrackFile).filter(TrackFile.path == filepath).first():
                stats['skipped'] += 1
                continue

            tags = _read_tags(filepath)
            artist_name = (tags.get('artist') or '').strip()
            album_title  = (tags.get('album')  or 'Unknown Album').strip()
            track_title  = (tags.get('title')  or Path(filepath).stem).strip()

            if not artist_name:
                logger.debug("No artist tag, skipping %s", filepath)
                stats['skipped'] += 1
                continue

            # ── Artist ──────────────────────────────────────────────────
            artist = db.query(Artist).filter(
                Artist.name.ilike(artist_name)
            ).first()
            if not artist:
                mb_aid = tags.get('mb_artist_id') or ''
                if not mb_aid or db.query(Artist).filter(Artist.musicbrainz_id == mb_aid).first():
                    mb_aid = str(uuid.uuid4())
                artist = Artist(
                    musicbrainz_id=mb_aid,
                    name=artist_name,
                    sort_name=artist_name,
                    root_folder_path=root_path,
                    monitored=True, album_folder=True,
                    images='[]', links='[]', genres='[]', tags='[]',
                )
                db.add(artist)
                db.flush()

            # ── Album ────────────────────────────────────────────────────
            album = db.query(Album).filter(
                Album.artist_id == artist.id,
                Album.title.ilike(album_title),
            ).first()
            if not album:
                mb_alid = tags.get('mb_album_id') or ''
                if not mb_alid or db.query(Album).filter(Album.musicbrainz_id == mb_alid).first():
                    mb_alid = str(uuid.uuid4())
                album = Album(
                    musicbrainz_id=mb_alid,
                    artist_id=artist.id,
                    title=album_title,
                    release_date=tags.get('date', ''),
                    album_type='Album',
                    monitored=True,
                    secondary_types='[]',
                    images='[]', links='[]', genres='[]', labels='[]',
                )
                db.add(album)
                db.flush()

            # ── Track ────────────────────────────────────────────────────
            track = db.query(Track).filter(
                Track.album_id == album.id,
                Track.title.ilike(track_title),
            ).first()
            if not track:
                mb_tid = tags.get('mb_track_id') or ''
                tn_str = tags.get('track_number', '0')
                try:
                    tn_int = int(tn_str)
                except (ValueError, TypeError):
                    tn_int = 0
                track = Track(
                    musicbrainz_id=mb_tid or str(uuid.uuid4()),
                    album_id=album.id,
                    artist_id=artist.id,
                    title=track_title,
                    track_number=tn_str,
                    absolute_track_number=tn_int,
                    disc_number=1,
                    duration=tags.get('duration', 0),
                    monitored=True,
                )
                db.add(track)
                db.flush()

            # ── TrackFile ────────────────────────────────────────────────
            ext = Path(filepath).suffix.lower()
            q_id, q_name = _quality_for_ext(ext)
            tf = TrackFile(
                track_id=track.id,
                artist_id=artist.id,
                album_id=album.id,
                path=filepath,
                relative_path=os.path.relpath(filepath, root_path),
                size=os.path.getsize(filepath),
                quality=json.dumps({'quality': {'id': q_id, 'name': q_name}}),
                media_info=json.dumps({}),
            )
            db.add(tf)
            db.flush()

            track.has_file = True
            track.track_file_id = tf.id

            db.commit()
            stats['imported'] += 1
            logger.debug("Imported %s", filepath)

        except Exception as exc:
            logger.error("Scan error on %s: %s", filepath, exc)
            try:
                db.rollback()
            except Exception:
                pass
            stats['errors'] += 1
        finally:
            db.close()

    logger.info("Scan complete: %s", stats)
    return stats
