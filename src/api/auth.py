import bcrypt as _bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User

router = APIRouter(prefix="/api/v3/auth", tags=["auth"])


# ── helpers ───────────────────────────────────────────────────────────────────

def _hash(pw: str) -> str:
    return _bcrypt.hashpw(pw.encode(), _bcrypt.gensalt()).decode()

def _verify(pw: str, hashed: str) -> bool:
    try:
        return _bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False

def _current_user(request: Request, db: Session) -> User | None:
    uid = request.session.get("user_id")
    return db.get(User, uid) if uid else None

def require_admin(request: Request, db: Session = Depends(get_db)) -> User:
    user = _current_user(request, db)
    if not user:
        raise HTTPException(401, "Not authenticated")
    if user.role != "admin":
        raise HTTPException(403, "Admin required")
    return user


# ── schemas ───────────────────────────────────────────────────────────────────

class LoginIn(BaseModel):
    username: str
    password: str

class RegisterIn(BaseModel):
    username: str
    password: str


# ── routes ────────────────────────────────────────────────────────────────────

@router.get("/status")
def auth_status(request: Request, db: Session = Depends(get_db)):
    initialized = db.query(User).count() > 0
    user = _current_user(request, db)
    return {
        "initialized": initialized,
        "authenticated": user is not None,
        "username": user.username if user else None,
        "role": user.role if user else None,
    }


@router.post("/register", status_code=201)
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    user_count = db.query(User).count()
    if user_count > 0:
        # After first setup, only an admin can add more users
        caller = _current_user(request, db)
        if not caller or caller.role != "admin":
            raise HTTPException(403, "Admin required to add users")

    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(400, "Username already taken")

    role = "admin" if user_count == 0 else "user"
    user = User(username=body.username, password_hash=_hash(body.password), role=role)
    db.add(user)
    db.commit()
    db.refresh(user)
    # Log the first admin in immediately
    if role == "admin":
        request.session["user_id"] = user.id
    return {"id": user.id, "username": user.username, "role": user.role}


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == body.username).first()
    if not user or not _verify(body.password, user.password_hash):
        raise HTTPException(401, "Invalid username or password")
    request.session["user_id"] = user.id
    return {"id": user.id, "username": user.username, "role": user.role}


@router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return {}


@router.get("/me")
def me(request: Request, db: Session = Depends(get_db)):
    user = _current_user(request, db)
    if not user:
        raise HTTPException(401, "Not authenticated")
    return {"id": user.id, "username": user.username, "role": user.role}


# ── user management (admin only) ──────────────────────────────────────────────

@router.get("/users")
def list_users(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    return [{"id": u.id, "username": u.username, "role": u.role} for u in db.query(User).all()]


@router.delete("/users/{user_id}", status_code=200)
def delete_user(user_id: int, request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    if user_id == admin.id:
        raise HTTPException(400, "Cannot delete your own account")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    db.delete(user)
    db.commit()
    return {}
