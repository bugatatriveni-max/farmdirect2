import os
import sys
from pathlib import Path

# Add workspace root and backend folder to sys.path
ROOT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = ROOT_DIR / "backend"

for _p in [str(ROOT_DIR), str(BACKEND_DIR)]:
    if os.path.exists(_p) and _p not in sys.path:
        sys.path.insert(0, _p)

from backend.main import app

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")
    uvicorn.run(app, host=host, port=port)
