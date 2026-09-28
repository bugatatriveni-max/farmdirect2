import sys
import os
import types
from pathlib import Path

# Setup paths
ROOT_DIR = Path(__file__).resolve().parent
for _p in [str(ROOT_DIR), str(ROOT_DIR / "backend")]:
    if os.path.exists(_p) and _p not in sys.path:
        sys.path.insert(0, _p)

# Create virtual package mapping if files are in root
if "backend" not in sys.modules:
    backend_pkg = types.ModuleType("backend")
    backend_pkg.__path__ = [str(ROOT_DIR / "backend" if (ROOT_DIR / "backend").exists() else ROOT_DIR)]
    sys.modules["backend"] = backend_pkg

# Import FastAPI and Routers
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
import logging

try:
    from backend.config import HOST, PORT, BASE_DIR
    from backend.database import init_db
    from backend.routers import markets, prices, recommendations, voice, admin, auth, bookings
except (ModuleNotFoundError, ImportError):
    import config
    import database
    import routers.markets as markets
    import routers.prices as prices
    import routers.recommendations as recommendations
    import routers.voice as voice
    import routers.admin as admin
    import routers.auth as auth
    import routers.bookings as bookings
    HOST, PORT, BASE_DIR = config.HOST, config.PORT, ROOT_DIR
    init_db = database.init_db

app = FastAPI(title="FarmDirect Agricultural Intelligence API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(recommendations.router)
app.include_router(markets.router)
app.include_router(prices.router)
app.include_router(voice.router)
app.include_router(admin.router)
app.include_router(auth.router)
app.include_router(bookings.router)

@app.on_event("startup")
def on_startup():
    try:
        init_db()
    except Exception as e:
        print(f"DB Startup notice: {e}")

@app.get("/api/health")
def health():
    return {"status": "HEALTHY", "version": "2.0.0"}

# Static Frontend Files
if (ROOT_DIR / "css").exists():
    app.mount("/css", StaticFiles(directory=str(ROOT_DIR / "css")), name="css")
if (ROOT_DIR / "js").exists():
    app.mount("/js", StaticFiles(directory=str(ROOT_DIR / "js")), name="js")

@app.get("/favicon.svg")
def serve_favicon():
    f = ROOT_DIR / "favicon.svg"
    return FileResponse(str(f), media_type="image/svg+xml") if f.exists() else JSONResponse({})

@app.get("/manifest.json")
def serve_manifest():
    f = ROOT_DIR / "manifest.json"
    return FileResponse(str(f), media_type="application/json") if f.exists() else JSONResponse({})

@app.get("/sw.js")
def serve_sw():
    f = ROOT_DIR / "sw.js"
    return FileResponse(str(f), media_type="application/javascript") if f.exists() else JSONResponse({})

@app.get("/bolt")
@app.get("/home")
@app.get("/index.html")
@app.get("/")
def serve_index():
    f = ROOT_DIR / "index.html"
    return FileResponse(str(f)) if f.exists() else JSONResponse({"message": "FarmDirect running"})

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")
    uvicorn.run(app, host=host, port=port)
