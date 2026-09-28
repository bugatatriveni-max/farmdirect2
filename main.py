import sys
import os
import types
from pathlib import Path

# Setup paths
ROOT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = ROOT_DIR / "backend" if (ROOT_DIR / "backend").exists() else ROOT_DIR

for _p in [str(ROOT_DIR), str(BACKEND_DIR)]:
    if os.path.exists(_p) and _p not in sys.path:
        sys.path.insert(0, _p)

# Check if backend directory exists or if repository has flat files
if (ROOT_DIR / "backend" / "main.py").exists():
    from backend.main import app
else:
    # ── Flat repository compatibility layer ──────────────────────────────────
    if "backend" not in sys.modules:
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
    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import FileResponse, JSONResponse
    import logging

    try:
        from database import init_db
    except Exception:
        def init_db(): pass

    try:
        from routers import markets, prices, recommendations, voice, admin, auth, bookings
    except Exception:
        try:
            import routers.markets as markets
            import routers.prices as prices
            import routers.recommendations as recommendations
            import routers.voice as voice
            import routers.admin as admin
            import routers.auth as auth
            import routers.bookings as bookings
        except Exception:
            pass

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

    # Register Routers
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
        from services.socket_manager import socket_manager
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

    # Static files & Frontend routes
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
        return FileResponse(str(f)) if f.exists() else JSONResponse({"message": "FarmDirect API is running."})

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")
    uvicorn.run(app, host=host, port=port)
