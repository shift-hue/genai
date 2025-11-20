from __future__ import annotations

from io import StringIO
from pathlib import Path
from typing import List

import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config_loader import CONFIG_DIR, Settings, Taxonomy, load_settings, load_taxonomy, project_paths
from .feedback import record_correction
from .inference import PredictionResult, batch_inference, predict_with_confidence


app = FastAPI(title="AI Financial Transaction Categorization MVP")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


paths = project_paths()
ui_dir: Path = paths["ui"]
if ui_dir.exists():
    app.mount("/ui", StaticFiles(directory=str(ui_dir), html=True), name="ui")


class PredictRequest(BaseModel):
    description: str


class PredictResponse(BaseModel):
    description: str
    predicted_category_id: str
    predicted_category_name: str
    confidence: float
    is_low_confidence: bool
    is_unknown: bool
    explanation: dict


class CorrectionRequest(BaseModel):
    description: str
    predicted_category_id: str
    corrected_category_id: str


@app.get("/", response_class=HTMLResponse)
async def root() -> str:
    return "<html><body><a href='/ui/index.html'>Open UI</a></body></html>"


@app.post("/predict", response_model=PredictResponse)
async def predict(req: PredictRequest) -> PredictResponse:
    result: PredictionResult = predict_with_confidence(req.description)
    return PredictResponse(
        description=result.description,
        predicted_category_id=result.predicted_category_id,
        predicted_category_name=result.predicted_category_name,
        confidence=result.confidence,
        is_low_confidence=result.is_low_confidence,
        is_unknown=result.is_unknown,
        explanation={
            "top_neighbors": [
                {
                    "description": n.description,
                    "category_id": n.category_id,
                    "similarity": n.similarity,
                }
                for n in result.explanation.top_neighbors
            ],
            "keyword_matches": result.explanation.keyword_matches,
            "rationale": result.explanation.rationale,
        },
    )


@app.post("/predict_batch")
async def predict_batch(file: UploadFile = File(...)) -> List[PredictResponse]:
    if not file.filename.endswith(".csv"):
        raise HTTPException(400, "Only CSV files are supported")

    content = await file.read()
    df = pd.read_csv(StringIO(content.decode("utf-8")))
    if "description" not in df.columns:
        raise HTTPException(400, "CSV must contain a 'description' column")

    descriptions = df["description"].astype(str).tolist()
    results = batch_inference(descriptions)
    return [
        PredictResponse(
            description=r.description,
            predicted_category_id=r.predicted_category_id,
            predicted_category_name=r.predicted_category_name,
            confidence=r.confidence,
            is_low_confidence=r.is_low_confidence,
            is_unknown=r.is_unknown,
            explanation={
                "top_neighbors": [
                    {
                        "description": n.description,
                        "category_id": n.category_id,
                        "similarity": n.similarity,
                    }
                    for n in r.explanation.top_neighbors
                ],
                "keyword_matches": r.explanation.keyword_matches,
                "rationale": r.explanation.rationale,
            },
        )
        for r in results
    ]


@app.get("/taxonomy", response_model=Taxonomy)
async def get_taxonomy() -> Taxonomy:
    return load_taxonomy()


@app.post("/upload_taxonomy")
async def upload_taxonomy(file: UploadFile = File(...)) -> dict:
    if not file.filename.endswith(".json"):
        raise HTTPException(400, "Only JSON files are supported")
    content = await file.read()
    target = CONFIG_DIR / "taxonomy.json"
    target.write_bytes(content)
    return {"status": "ok"}


@app.post("/corrections")
async def submit_correction(req: CorrectionRequest) -> dict:
    record_correction(
        description=req.description,
        predicted_category_id=req.predicted_category_id,
        corrected_category_id=req.corrected_category_id,
        metadata={},
    )
    return {"status": "recorded"}


@app.get("/config", response_model=Settings)
async def get_settings() -> Settings:
    return load_settings()


@app.get("/evaluation/confusion-matrix")
async def get_confusion_matrix() -> FileResponse:
    eval_dir: Path = paths["evaluation"]
    path = eval_dir / "confusion_matrix.png"
    if not path.exists():
        raise HTTPException(404, "Confusion matrix not found. Run evaluation first.")
    return FileResponse(str(path))


# To run the API:
# uvicorn mvp.src.api:app --reload
