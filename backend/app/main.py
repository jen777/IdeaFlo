import os
import shutil
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy import create_engine, String, Text, Integer, ForeignKey, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker, Session, Mapped, mapped_column, relationship

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/ideaflo")
FILE_STORAGE_PATH = Path(os.getenv("FILE_STORAGE_PATH", "/data/docs"))

engine = create_engine(DATABASE_URL, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


class Idea(Base):
    __tablename__ = "ideas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    summary: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(64), default="new")
    current_state: Mapped[str] = mapped_column(Text, default="")
    future_steps: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    documents: Mapped[list["Document"]] = relationship("Document", back_populates="idea", cascade="all, delete-orphan")


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    idea_id: Mapped[int] = mapped_column(ForeignKey("ideas.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    filepath: Mapped[str] = mapped_column(String(512), nullable=False)
    content_type: Mapped[str] = mapped_column(String(255), default="application/octet-stream")
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    idea: Mapped[Idea] = relationship("Idea", back_populates="documents")


class IdeaIn(BaseModel):
    title: str
    summary: str = ""
    status: str = "new"
    current_state: str = ""
    future_steps: str = ""


class IdeaOut(IdeaIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    updated_at: datetime


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    idea_id: int
    filename: str
    content_type: str
    size_bytes: int
    uploaded_at: datetime


app = FastAPI(title="IdeaFlo API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.on_event("startup")
def startup_event():
    FILE_STORAGE_PATH.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/ideas", response_model=list[IdeaOut])
def list_ideas(db: Session = Depends(get_db)):
    return db.query(Idea).order_by(Idea.updated_at.desc()).all()


@app.post("/ideas", response_model=IdeaOut)
def create_idea(payload: IdeaIn, db: Session = Depends(get_db)):
    idea = Idea(**payload.model_dump())
    db.add(idea)
    db.commit()
    db.refresh(idea)
    return idea


@app.get("/ideas/{idea_id}", response_model=IdeaOut)
def get_idea(idea_id: int, db: Session = Depends(get_db)):
    idea = db.get(Idea, idea_id)
    if not idea:
        raise HTTPException(status_code=404, detail="Idea not found")
    return idea


@app.put("/ideas/{idea_id}", response_model=IdeaOut)
def update_idea(idea_id: int, payload: IdeaIn, db: Session = Depends(get_db)):
    idea = db.get(Idea, idea_id)
    if not idea:
        raise HTTPException(status_code=404, detail="Idea not found")

    for key, value in payload.model_dump().items():
        setattr(idea, key, value)
    idea.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(idea)
    return idea


@app.delete("/ideas/{idea_id}")
def delete_idea(idea_id: int, db: Session = Depends(get_db)):
    idea = db.get(Idea, idea_id)
    if not idea:
        raise HTTPException(status_code=404, detail="Idea not found")

    idea_dir = FILE_STORAGE_PATH / str(idea_id)
    if idea_dir.exists():
        shutil.rmtree(idea_dir, ignore_errors=True)

    db.delete(idea)
    db.commit()
    return {"deleted": True}


@app.get("/ideas/{idea_id}/documents", response_model=list[DocumentOut])
def list_documents(idea_id: int, db: Session = Depends(get_db)):
    idea = db.get(Idea, idea_id)
    if not idea:
        raise HTTPException(status_code=404, detail="Idea not found")
    return db.query(Document).filter(Document.idea_id == idea_id).order_by(Document.uploaded_at.desc()).all()


@app.post("/ideas/{idea_id}/documents", response_model=DocumentOut)
def upload_document(idea_id: int, uploaded_file: UploadFile = File(...), db: Session = Depends(get_db)):
    idea = db.get(Idea, idea_id)
    if not idea:
        raise HTTPException(status_code=404, detail="Idea not found")

    idea_dir = FILE_STORAGE_PATH / str(idea_id)
    idea_dir.mkdir(parents=True, exist_ok=True)

    suffix = Path(uploaded_file.filename or "file").suffix
    stored_filename = f"{uuid.uuid4().hex}{suffix}"
    file_path = idea_dir / stored_filename

    size = 0
    with file_path.open("wb") as out:
        while True:
            chunk = uploaded_file.file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            out.write(chunk)

    doc = Document(
        idea_id=idea_id,
        filename=uploaded_file.filename or "unnamed",
        stored_filename=stored_filename,
        filepath=str(file_path),
        content_type=uploaded_file.content_type or "application/octet-stream",
        size_bytes=size,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


@app.get("/ideas/{idea_id}/documents/{doc_id}/download")
def download_document(idea_id: int, doc_id: int, db: Session = Depends(get_db)):
    doc = db.get(Document, doc_id)
    if not doc or doc.idea_id != idea_id:
        raise HTTPException(status_code=404, detail="Document not found")

    path = Path(doc.filepath)
    if not path.exists():
        raise HTTPException(status_code=404, detail="File missing on disk")

    return FileResponse(path=str(path), media_type=doc.content_type, filename=doc.filename)


@app.delete("/ideas/{idea_id}/documents/{doc_id}")
def delete_document(idea_id: int, doc_id: int, db: Session = Depends(get_db)):
    doc = db.get(Document, doc_id)
    if not doc or doc.idea_id != idea_id:
        raise HTTPException(status_code=404, detail="Document not found")

    path = Path(doc.filepath)
    if path.exists():
        path.unlink()

    db.delete(doc)
    db.commit()
    return {"deleted": True}
