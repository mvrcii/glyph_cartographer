from pydantic import BaseModel
from typing import List

# ───────────── PYDANTIC MODELS (for API validation) ─────────────
class Tile(BaseModel):
    x: int
    y: int


class InferenceRequest(BaseModel):
    tiles: List[Tile]
    model_name: str  # This will be the full path like "checkpoints/kind-breeze-64.../best.ckpt"
    patch_size: int | None = None
    stride: int | None = None
    use_tta: bool | None = None
    use_oai: bool | None = None
    oai_model_name: str # This is the openai model name like "gpt-4.1"


class TilePrediction(BaseModel):
    x: int
    y: int
    prob_png_b64: str

class OAITilePrediction(BaseModel):
    x: int
    y: int
    prob: float
    label: str
    description: str | None = None


class InferenceResponse(BaseModel):
    message: str
    predictions: List[TilePrediction]
    oai_predictions: List[OAITilePrediction]
