from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Track, Album, Artist
from ..schemas import TrackOut

router = APIRouter(prefix="/api/v3/wanted", tags=["wanted"])


@router.get("/missing", response_model=dict)
def wanted_missing(
    page: int = Query(1, ge=1),
    pageSize: int = Query(25, ge=1, le=2000),
    q: str = Query("", description="Filter by track title, album, or artist"),
    db: Session = Depends(get_db),
):
    query_obj = db.query(Track).filter(Track.monitored == True, Track.has_file == False)
    if q:
        term = f"%{q.lower()}%"
        query_obj = (
            query_obj
            .outerjoin(Album, Track.album_id == Album.id)
            .outerjoin(Artist, Track.artist_id == Artist.id)
            .filter(
                func.lower(Track.title).like(term) |
                func.lower(Album.title).like(term) |
                func.lower(Artist.name).like(term)
            )
        )
    total = query_obj.count()
    items = (
        query_obj
        .order_by(Track.artist_id, Track.album_id, Track.absolute_track_number)
        .offset((page - 1) * pageSize)
        .limit(pageSize)
        .all()
    )
    records = [TrackOut.from_orm(t) for t in items]
    return {
        "page": page,
        "pageSize": pageSize,
        "totalRecords": total,
        "records": [r.model_dump() for r in records],
    }
