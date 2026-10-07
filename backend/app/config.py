import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parents[2] / "data"))
DB_PATH = DATA_DIR / "manabox_cuber.sqlite3"
IMAGES_DIR = DATA_DIR / "images"
STATIC_DIR = Path(os.environ.get("STATIC_DIR", Path(__file__).resolve().parents[2] / "frontend" / "dist"))

SCRYFALL_API = "https://api.scryfall.com"
SCRYFALL_DELAY = float(os.environ.get("SCRYFALL_DELAY", "0.2"))
USER_AGENT = "ManaBoxCuber/0.1 (personal collection browser)"

# Used by the frontend to convert USD prices when a card has no EUR price.
USD_TO_EUR = float(os.environ.get("USD_TO_EUR", "0.92"))
