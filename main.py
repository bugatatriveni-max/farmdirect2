import sys
import os
import types
from pathlib import Path

# Setup paths
ROOT_DIR = Path(__file__).resolve().parent

for _p in [
    ROOT_DIR,
    ROOT_DIR / "backend",
    ROOT_DIR / "routers",
    ROOT_DIR / "backend" / "routers",
    ROOT_DIR / "services",
    ROOT_DIR / "backend" / "services"
]:
    if _p.exists() and str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

# Create virtual 'backend' package mapping if files are flat in root
if "backend" not in sys.modules and not (ROOT_DIR / "backend").exists():
    _backend_pkg = types.ModuleType("backend")
    _backend_pkg.__path__ = [str(ROOT_DIR)]
    sys.modules["backend"] = _backend_pkg
    
    try:
        import config as _cfg
        sys.modules["backend.config"] = _cfg
    except Exception:
        pass
        
    try:
        import database as _db
        sys.modules["backend.database"] = _db
    except Exception:
        pass
        
    try:
        import models as _models
        sys.modules["backend.models"] = _models
    except Exception:
        pass

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
import logging

try:
    from backend.database import init_db
except Exception:
    try:
        from database import init_db
    except Exception:
        def init_db(): pass

try:
    from backend.routers import markets, prices, recommendations, voice, admin, auth, bookings
except Exception:
    try:
        from routers import markets, prices, recommendations, voice, admin, auth, bookings
    except Exception:
        import markets
        import prices
        import recommendations
        import voice
        import admin
        import auth
        import bookings

logger = logging.getLogger("farmdirect.server")

app = FastAPI(
    title="FarmDirect Agricultural Intelligence API",
    description="Production API layer for FarmDirect Recommendation Engine & Multilingual Farmer UI.",
    version="2.0.0"
)

# Zero-Crash Global Error Handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"[ZeroCrashSafe] Handled error on {request.method} {request.url}: {exc}")
    return JSONResponse(
        status_code=500,
        content={"error": True, "status": "SERVER_SAFE", "message": "Handled gracefully.", "detail": str(exc)}
    )

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register REST Routers
try: app.include_router(recommendations.router)
except Exception: pass
try: app.include_router(markets.router)
except Exception: pass
try: app.include_router(prices.router)
except Exception: pass
try: app.include_router(voice.router)
except Exception: pass
try: app.include_router(admin.router)
except Exception: pass
try: app.include_router(auth.router)
except Exception: pass
try: app.include_router(bookings.router)
except Exception: pass

@app.on_event("startup")
def on_startup():
    try:
        init_db()
        print("[FarmDirect] Database initialized successfully.")
    except Exception as e:
        print(f"[FarmDirect] Startup notice: {e}")

@app.get("/api/health")
def health_check():
    return {"status": "HEALTHY", "service": "FarmDirect Production Backend", "version": "2.0.0"}

# WebSockets
try:
    from backend.services.socket_manager import socket_manager
except Exception:
    try:
        from services.socket_manager import socket_manager
    except Exception:
        try:
            from socket_manager import socket_manager
        except Exception:
            socket_manager = None

@app.websocket("/ws/farmer/{client_id}")
async def ws_farmer(websocket: WebSocket, client_id: str):
    if socket_manager:
        await socket_manager.connect_farmer(client_id, websocket)
        try:
            while True:
                data = await websocket.receive_text()
                if data == "ping":
                    await websocket.send_text("pong")
        except (WebSocketDisconnect, Exception):
            socket_manager.disconnect_farmer(client_id, websocket)

@app.websocket("/ws/admin")
async def ws_admin(websocket: WebSocket):
    if socket_manager:
        await socket_manager.connect_admin(websocket)
        try:
            while True:
                data = await websocket.receive_text()
                if data == "ping":
                    await websocket.send_text("pong")
        except (WebSocketDisconnect, Exception):
            socket_manager.disconnect_admin(websocket)

# ─────────────────────────────────────────────────────────────────────────────
# Universal Static & Asset File Resolver (Finds files whether in subfolder or root)
# ─────────────────────────────────────────────────────────────────────────────
def resolve_file(filename: str):
    name = Path(filename).name
    candidates = [
        ROOT_DIR / filename,
        ROOT_DIR / name,
        ROOT_DIR / "css" / name,
        ROOT_DIR / "js" / name,
        ROOT_DIR / "backend" / name,
        ROOT_DIR / "backend" / "css" / name,
        ROOT_DIR / "backend" / "js" / name,
    ]
    for c in candidates:
        if c.is_file():
            return c
    return None

@app.get("/css/{file_name:path}")
def serve_css(file_name: str):
    f = resolve_file(f"css/{file_name}") or resolve_file(file_name)
    if f:
        return FileResponse(str(f), media_type="text/css")
    return JSONResponse(status_code=404, content={"error": f"CSS {file_name} not found"})

@app.get("/js/{file_name:path}")
def serve_js(file_name: str):
    f = resolve_file(f"js/{file_name}") or resolve_file(file_name)
    if f:
        return FileResponse(str(f), media_type="application/javascript")
    return JSONResponse(status_code=404, content={"error": f"JS {file_name} not found"})

@app.get("/favicon.svg")
def serve_favicon():
    f = resolve_file("favicon.svg")
    return FileResponse(str(f), media_type="image/svg+xml") if f else JSONResponse({})

@app.get("/manifest.json")
def serve_manifest():
    f = resolve_file("manifest.json")
    return FileResponse(str(f), media_type="application/json") if f else JSONResponse({})

@app.get("/sw.js")
def serve_sw():
    f = resolve_file("sw.js")
    return FileResponse(str(f), media_type="application/javascript") if f else JSONResponse({})

# Direct JS module imports (e.g. /data.js, /i18n.js, /queue.js, /voice.js, /styles.css)
@app.get("/{file_name}.js")
def serve_root_js(file_name: str):
    f = resolve_file(f"{file_name}.js")
    if f:
        return FileResponse(str(f), media_type="application/javascript")
    return JSONResponse(status_code=404, content={"error": f"{file_name}.js not found"})

@app.get("/{file_name}.css")
def serve_root_css(file_name: str):
    f = resolve_file(f"{file_name}.css")
    if f:
        return FileResponse(str(f), media_type="text/css")
    return JSONResponse(status_code=404, content={"error": f"{file_name}.css not found"})

@app.get("/bolt")
@app.get("/home")
@app.get("/index.html")
@app.get("/")
def serve_index():
    f = resolve_file("index.html")
    return FileResponse(str(f)) if f else JSONResponse({"message": "FarmDirect API is running."})

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")
    uvicorn.run(app, host=host, port=port)
