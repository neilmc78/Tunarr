import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Artist, ArtistRequest, User
from ..schemas import ArtistRequestIn, ArtistRequestOut, ArtistRequestUpdate

router = APIRouter(prefix="/api/v3/requests", tags=["requests"])


def _get_user(request: Request, db: Session) -> User | None:
    uid = request.session.get("user_id")
    return db.get(User, uid) if uid else None


@router.get("", response_model=list[ArtistRequestOut])
def list_requests(request: Request, db: Session = Depends(get_db)):
    user = _get_user(request, db)
    if not user:
        raise HTTPException(401, "Not authenticated")
    if user.role == "admin":
        reqs = db.query(ArtistRequest).order_by(ArtistRequest.created_at.desc()).all()
    else:
        reqs = (
            db.query(ArtistRequest)
            .filter(ArtistRequest.requested_by_id == user.id)
            .order_by(ArtistRequest.created_at.desc())
            .all()
        )
    return [ArtistRequestOut.from_orm_request(r) for r in reqs]


@router.get("/pending-count")
def pending_count(request: Request, db: Session = Depends(get_db)):
    user = _get_user(request, db)
    if not user:
        raise HTTPException(401, "Not authenticated")
    count = db.query(ArtistRequest).filter(ArtistRequest.status == "pending").count()
    return {"count": count}


@router.post("", response_model=ArtistRequestOut, status_code=201)
def create_request(body: ArtistRequestIn, request: Request, db: Session = Depends(get_db)):
    user = _get_user(request, db)
    if not user:
        raise HTTPException(401, "Not authenticated")

    if body.musicBrainzId:
        if db.query(Artist).filter(Artist.musicbrainz_id == body.musicBrainzId).first():
            raise HTTPException(400, "Artist is already in your library")
        existing = db.query(ArtistRequest).filter(
            ArtistRequest.mb_artist_id == body.musicBrainzId,
            ArtistRequest.status == "pending",
        ).first()
        if existing:
            raise HTTPException(400, "A request for this artist is already pending")

    req = ArtistRequest(
        mb_artist_id=body.musicBrainzId,
        artist_name=body.artistName,
        artist_type=body.artistType,
        disambiguation=body.disambiguation,
        images=json.dumps(body.images),
        requested_by_id=user.id,
        status="pending",
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    return ArtistRequestOut.from_orm_request(req)


@router.put("/{request_id}", response_model=ArtistRequestOut)
def update_request(
    request_id: int,
    body: ArtistRequestUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    user = _get_user(request, db)
    if not user or user.role != "admin":
        raise HTTPException(403, "Admin required")

    req = db.get(ArtistRequest, request_id)
    if not req:
        raise HTTPException(404, "Request not found")
    if body.status not in ("approved", "rejected"):
        raise HTTPException(400, "status must be 'approved' or 'rejected'")

    req.status = body.status
    req.reviewed_by_id = user.id
    req.reviewed_at = datetime.utcnow()
    db.commit()
    db.refresh(req)
    return ArtistRequestOut.from_orm_request(req)


@router.delete("/{request_id}", status_code=200)
def delete_request(request_id: int, request: Request, db: Session = Depends(get_db)):
    user = _get_user(request, db)
    if not user or user.role != "admin":
        raise HTTPException(403, "Admin required")

    req = db.get(ArtistRequest, request_id)
    if not req:
        raise HTTPException(404, "Request not found")
    db.delete(req)
    db.commit()
    return {}
