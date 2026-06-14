# Tunarr

**Individual music track download manager** — Sonarr for music tracks.

Lidarr manages music but deliberately only supports whole-album downloads.
Tunarr solves this by applying Sonarr's episode-level model to music:

| Sonarr | Tunarr |
|--------|--------|
| Series | Artist |
| Season | Album  |
| Episode | **Track** |

You can monitor individual tracks, search YouTube Music for them,
and download them as standalone files — just like grabbing a single
TV episode in Sonarr.

## Features

- **Authentication** — first user to register becomes admin; additional users get read-only access
- **Artist management** — add artists via MusicBrainz search; link imported artists to MusicBrainz to enrich metadata and fetch full discography
- **Album + track browser** — view full discographies with track-level status; collapses to a separate page on mobile
- **Per-track monitoring** — monitor specific tracks, not whole albums
- **Automatic search** — finds best YouTube Music match; throttled (5 concurrent) to avoid API caps
- **Two-phase queue** — tracks appear in queue immediately at "searching" status, YouTube lookup runs async
- **Manual grab** — search YouTube Music and pick the exact version you want
- **Download queue** — real-time progress for active downloads
- **File import** — automatic rename, tag writing (ID3/FLAC), library organisation
- **Scanner** — imports existing audio files from disk; prefers `albumartist` tag over track artist to avoid collaboration splits; falls back to folder structure `<root>/<Artist>/<Album>/` for untagged files
- **History** — full audit trail of every download event
- **Wanted** — searchable/filterable list of all monitored-but-missing tracks with pagination
- **Quality profiles** — MP3-128 through FLAC 24bit
- **Mobile responsive** — collapsible sidebar, adapted layouts and table columns for small screens
- **Sonarr-compatible API** — `/api/v3/` endpoint structure

## Quick Start

### Proxmox LXC (recommended)

Run this on your **Proxmox VE host** shell:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/neilmc78/Tunarr/main/install/tunarr-lxc.sh)
```

The script prompts for container settings (all have sensible defaults — press Enter to accept):

| Setting | Default |
|---------|---------|
| Container ID | next available |
| Hostname | `tunarr` |
| CPU cores | `2` |
| RAM | `1024 MB` |
| Disk | `8 GB` on `local-lvm` |
| Network | DHCP on `vmbr0` |
| Music path | `/mnt/music` (bind-mounted into CT) |

Creates an unprivileged Debian 12 LXC, installs ffmpeg + Python deps in a venv, and starts Tunarr as a systemd service on port **8686**.

**To update** (run inside the container):

```bash
bash /opt/tunarr/update.sh
```

### Docker Compose

```yaml
version: "3.8"
services:
  tunarr:
    build: .
    ports:
      - "8686:8686"
    volumes:
      - ./config:/config
      - /path/to/music:/music
    environment:
      - TUNARR_MUSIC_DIR=/music
    restart: unless-stopped
```

```bash
docker compose up -d
# Open http://localhost:8686
```

### Local (Python 3.11+)

```bash
pip install -r requirements.txt
# ffmpeg must be in PATH
uvicorn src.main:app --port 8686 --reload
```

## First Steps

1. **Open `http://<host>:8686`** — you'll be prompted to create the first admin account
2. **Settings → Add Root Folder** — set your music library path
3. **Artists → Add Artist** — search MusicBrainz, click Add
4. *(optional)* If you already have audio files on disk, **Settings → Scan Library** to import them
5. **Artist page → click an album** — expands the track list (navigates to a separate page on mobile)
6. **Toggle the monitor switch** per track (or per album)
7. Click **⬇** on any track to search YouTube Music and grab it
8. Watch **Queue** for download progress
9. **Wanted** shows everything monitored but not yet downloaded
10. For imported artists without MusicBrainz data, use **Link to MusicBrainz** on the artist page to enrich metadata and add the full discography

## Authentication

- First user to register → **admin** (full access)
- Subsequent users → **read-only** (can view everything, trigger searches and downloads, but cannot add/delete artists or change settings)
- Admin can manage users in **Settings → Users**
- Sessions use signed cookies (secret stored in `config/session.key`); place behind a reverse proxy with HTTPS for production use

## File Naming

```
{root_folder}/{Artist Name}/{Album Title (Year)}/{NN} - {Track Title}.mp3
```

## Architecture

```
MusicBrainz API  →  Artist/Album/Track metadata
TheAudioDB       →  Artist and album cover art
YouTube Music    →  Audio source (via yt-dlp)
yt-dlp           →  Download + audio extraction + tag embedding
ffmpeg           →  Audio conversion (required by yt-dlp)
SQLite (WAL)     →  Local database (in /config)
FastAPI          →  REST API + SPA frontend
Starlette        →  Session middleware (signed cookies)
bcrypt           →  Password hashing
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TUNARR_DATA_DIR` | `./config` | Database, session key, temp downloads |
| `TUNARR_MUSIC_DIR` | `./music` | Final music library location |
| `TUNARR_MAX_CONCURRENT_DOWNLOADS` | `3` | Parallel downloads |
| `TUNARR_PORT` | `8686` | HTTP port |

## API

All `/api/v3/` routes require authentication (session cookie). Write operations require admin role.

```
# Auth
GET  /api/v3/auth/status           check login state + whether any users exist
POST /api/v3/auth/register         create first admin, or add user (admin required after first)
POST /api/v3/auth/login            log in
POST /api/v3/auth/logout           log out
GET  /api/v3/auth/users            list users (admin)
DELETE /api/v3/auth/users/{id}     remove user (admin)

# Library
GET  /api/v3/artist                list artists
POST /api/v3/artist                add artist (MusicBrainz)
POST /api/v3/artist/{id}/link      link existing artist to MusicBrainz identity
GET  /api/v3/album?artistId=N      list albums for artist
GET  /api/v3/track?albumId=N       list tracks for album
PUT  /api/v3/track/{id}            update track (monitored)
PUT  /api/v3/track/monitor         bulk monitor/unmonitor tracks

# Actions
POST /api/v3/command               TrackSearch / AlbumSearch / ArtistSearch / RefreshArtist / ScanLibrary
GET  /api/v3/queue                 download queue
DELETE /api/v3/queue/{id}          remove queue item
POST /api/v3/queue/grab            manually grab a track by URL
GET  /api/v3/wanted/missing        missing monitored tracks (supports ?q= filter)
GET  /api/v3/history               download history
GET  /api/v3/search/track?query=   search YouTube Music
```

Full OpenAPI docs at `http://localhost:8686/docs` (must be logged in).
