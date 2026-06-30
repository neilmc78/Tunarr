import asyncio
import logging
import os
import shlex
from pathlib import Path
from typing import Any
import yt_dlp

from ..config import settings

logger = logging.getLogger("tunarr.downloader")

QUALITY_TO_BITRATE = {
    1: "128", 2: "256", 3: "320",
    4: "256", 5: "320",
    6: "0", 7: "0",
    # ID 8 = Best Native — no transcoding, no bitrate cap
}

QUALITY_TO_FORMAT = {
    1: "mp3", 2: "mp3", 3: "mp3",
    4: "aac", 5: "aac",
    6: "flac", 7: "flac",
    # ID 8 = Best Native — handled separately
}

_KNOWN_EXTRA_ARGS = {
    "--cookies-from-browser": "cookiesfrombrowser",
    "--cookies":              "cookiefile",
    "--proxy":                "proxy",
    "--geo-bypass":           "geo_bypass",
    "--geo-bypass-country":   "geo_bypass_country",
}


def _parse_extra_args(extra_args: str) -> dict:
    """Convert a space-separated yt-dlp arg string into yt-dlp Python API opts."""
    if not extra_args or not extra_args.strip():
        return {}
    opts: dict = {}
    try:
        tokens = shlex.split(extra_args)
    except ValueError:
        logger.warning("Could not parse extra_args: %r", extra_args)
        return {}
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if tok == "--geo-bypass":
            opts["geo_bypass"] = True
            i += 1
        elif tok in _KNOWN_EXTRA_ARGS and i + 1 < len(tokens):
            key = _KNOWN_EXTRA_ARGS[tok]
            val = tokens[i + 1]
            if key == "cookiesfrombrowser":
                opts[key] = (val,)
            else:
                opts[key] = val
            i += 2
        else:
            logger.debug("Ignoring unrecognised extra arg token: %r", tok)
            i += 1
    return opts


async def search_youtube_music(query: str, limit: int = 5) -> list[dict]:
    search_query = f"ytsearch{limit}:{query}"
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "skip_download": True,
    }

    def _search():
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(search_query, download=False)
            entries = info.get("entries", []) if info else []
            results = []
            for e in entries:
                if not e:
                    continue
                duration_s = e.get("duration") or 0
                results.append({
                    "url": e.get("webpage_url") or e.get("url", ""),
                    "title": e.get("title", ""),
                    "channel": e.get("channel") or e.get("uploader", ""),
                    "duration": int(duration_s * 1000),
                    "viewCount": e.get("view_count", 0),
                    "thumbnailUrl": (e.get("thumbnails") or [{}])[-1].get("url", ""),
                    "videoId": e.get("id", ""),
                })
            return results

    return await asyncio.to_thread(_search)


class ProgressHook:
    def __init__(self, queue_id: int, progress_callback, loop):
        self.queue_id = queue_id
        self.callback = progress_callback
        self.loop = loop

    def __call__(self, d: dict):
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes", 0)
            progress = (downloaded / total * 100) if total else 0
            if self.callback:
                asyncio.run_coroutine_threadsafe(
                    self.callback(self.queue_id, progress, "downloading", total, downloaded),
                    self.loop,
                )
        elif d["status"] == "finished":
            if self.callback:
                asyncio.run_coroutine_threadsafe(
                    self.callback(self.queue_id, 100.0, "finished", 0, 0),
                    self.loop,
                )


async def download_track(
    url: str,
    output_template: str,
    quality_id: int = 3,
    extra_args: str = "",
    progress_callback=None,
    queue_id: int = 0,
) -> dict[str, Any]:
    native_mode = (quality_id == 8)

    if native_mode:
        # Prefer M4A (AAC/MP4 — universally Plex-compatible).
        # If only WebM is available, remux it to OGG/Opus — same audio, no
        # re-encoding, and OGG is supported by Plex and all major music players.
        postprocessors = [
            {"key": "FFmpegVideoRemuxer", "preferedformat": "ogg"},
            {"key": "FFmpegMetadata", "add_metadata": True},
        ]
        format_selector = "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio"
    else:
        audio_format = QUALITY_TO_FORMAT.get(quality_id, "mp3")
        audio_quality = QUALITY_TO_BITRATE.get(quality_id, "320")
        postprocessors = [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": audio_format,
            "preferredquality": audio_quality,
        }, {
            "key": "FFmpegMetadata",
            "add_metadata": True,
        }]
        format_selector = None  # let yt-dlp pick by default

    loop = asyncio.get_running_loop()
    hooks = []
    if progress_callback:
        hooks.append(ProgressHook(queue_id, progress_callback, loop))

    ydl_opts: dict[str, Any] = {
        "outtmpl": output_template,
        "postprocessors": postprocessors,
        "quiet": True,
        "no_warnings": True,
        "progress_hooks": hooks,
        "noplaylist": True,
    }
    if format_selector:
        ydl_opts["format"] = format_selector

    # Merge any extra yt-dlp args from the quality profile
    parsed_extra = _parse_extra_args(extra_args)
    if parsed_extra:
        logger.debug("Applying extra yt-dlp args: %s", parsed_extra)
        ydl_opts.update(parsed_extra)

    result: dict[str, Any] = {}

    if native_mode:
        ext_candidates = ["m4a", "ogg", "opus", "webm", "mp4"]
    else:
        audio_format = QUALITY_TO_FORMAT.get(quality_id, "mp3")
        ext_candidates = [audio_format, "mp3", "flac", "aac", "m4a", "opus", "webm"]

    def _download():
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            if info:
                for ext in ext_candidates:
                    candidate = output_template.replace("%(ext)s", ext)
                    if os.path.exists(candidate):
                        result["path"] = candidate
                        result["size"] = os.path.getsize(candidate)
                        break
                if "path" not in result:
                    # Fall back: try the extension yt-dlp says it produced
                    actual_ext = info.get("ext") or (ext_candidates[0] if ext_candidates else "mp3")
                    result["path"] = output_template.replace("%(ext)s", actual_ext)
                    result["size"] = 0
                result["title"] = info.get("title", "")
                result["duration"] = int((info.get("duration") or 0) * 1000)

    await asyncio.to_thread(_download)
    return result


def build_output_template(
    root_folder: str,
    artist_name: str,
    album_title: str,
    year: str,
    track_number: str,
    track_title: str,
) -> str:
    safe = lambda s: "".join(c for c in s if c not in r'\/:*?"<>|').strip()
    folder = Path(root_folder) / safe(artist_name) / f"{safe(album_title)} ({year[:4] if year else 'Unknown'})"
    folder.mkdir(parents=True, exist_ok=True)
    filename = f"{str(track_number).zfill(2)} - {safe(track_title)}.%(ext)s"
    return str(folder / filename)
