import sys
import os
import types
from pathlib import Path

# Automatically ensure both repository root and backend directory are in sys.path
_CURRENT_DIR = Path(__file__).resolve().parent
_ROOT_DIR = _CURRENT_DIR.parent

for _p in [str(_ROOT_DIR), str(_CURRENT_DIR)]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

# If files were uploaded without a 'backend/' folder wrapper, create virtual 'backend' package
if "backend" not in sys.modules and (_CURRENT_DIR / "config.py").exists() and not (_CURRENT_DIR / "backend").exists():
    _backend_pkg = types.ModuleType("backend")
    _backend_pkg.__path__ = [str(_CURRENT_DIR)]
    sys.modules["backend"] = _backend_pkg

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

try:
    from backend.config import HOST, PORT, BASE_DIR
    from backend.database import init_db
    from backend.routers import markets, prices, recommendations, voice, admin, auth, bookings
except ModuleNotFoundError:
    from config import HOST, PORT, BASE_DIR
    from database import init_db
    from routers import markets, prices, recommendations, voice, admin, auth, bookings
from fastapi import Request
from fastapi.responses import JSONResponse
import logging
import traceback

logger = logging.getLogger("farmdirect.server")

app = FastAPI(
    title="FarmDirect Agricultural Intelligence API",
    description="Production-grade API layer connecting Government Agricultural Datasets (data.gov.in, Agmarknet, e-NAM) to FarmDirect Recommendation Engine & Multilingual Farmer UI.",
    version="2.0.0"
)

# Global Zero-Crash Exception Handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"[ZeroCrashSafe] Handled error on {request.method} {request.url}: {exc}")
    return JSONResponse(
        status_code=500,
        content={
            "error": True,
            "status": "SERVER_SAFE",
            "message": "Request processed safely without crashing server.",
            "detail": str(exc)
        }
    )

# Enable CORS for flexible development and cross-origin frontend testing
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register REST Routers under /api
app.include_router(recommendations.router)
app.include_router(markets.router)
app.include_router(prices.router)
app.include_router(voice.router)
app.include_router(admin.router)
app.include_router(auth.router)
app.include_router(bookings.router)

@app.on_event("startup")
def on_startup():
    print("[FarmDirect] Initializing database and verifying schema...")
    init_db()
    print("[FarmDirect] Database initialized successfully.")

@app.get("/api/health")
def health_check():
    return {
        "status": "HEALTHY",
        "service": "FarmDirect Production Backend",
        "version": "2.0.0",
        "docs_url": "/docs"
    }

from fastapi import WebSocket, WebSocketDisconnect
try:
    from backend.services.socket_manager import socket_manager
except ModuleNotFoundError:
    from services.socket_manager import socket_manager

@app.websocket("/ws/farmer/{client_id}")
async def websocket_farmer_endpoint(websocket: WebSocket, client_id: str):
    await socket_manager.connect_farmer(client_id, websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except (WebSocketDisconnect, Exception):
        socket_manager.disconnect_farmer(client_id, websocket)

@app.websocket("/ws/admin")
async def websocket_admin_endpoint(websocket: WebSocket):
    await socket_manager.connect_admin(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except (WebSocketDisconnect, Exception):
        socket_manager.disconnect_admin(websocket)

# Mount static frontend directories
app.mount("/css", StaticFiles(directory=str(BASE_DIR / "css")), name="css")
app.mount("/js", StaticFiles(directory=str(BASE_DIR / "js")), name="js")

@app.get("/bundle.js")
def serve_bundle_js():
    return FileResponse(str(BASE_DIR / "bundle.js"), media_type="application/javascript")

@app.get("/bundle.css")
def serve_bundle_css():
    return FileResponse(str(BASE_DIR / "bundle.css"), media_type="text/css")

@app.get("/assets/{path:path}")
def serve_assets(path: str):
    if path.endswith(".js"):
        return FileResponse(str(BASE_DIR / "bundle.js"), media_type="application/javascript")
    if path.endswith(".css"):
        return FileResponse(str(BASE_DIR / "bundle.css"), media_type="text/css")
    return FileResponse(str(BASE_DIR / "bundle.js"))

@app.get("/bolt")
@app.get("/home")
@app.get("/index.html")
@app.get("/")
def serve_index():
    return FileResponse(str(BASE_DIR / "index.html"))

if __name__ == "__main__":
    import uvicorn
    is_dev = os.getenv("ENV", "production").lower() == "development"
    uvicorn.run("backend.main:app", host=HOST, port=PORT, reload=is_dev)

