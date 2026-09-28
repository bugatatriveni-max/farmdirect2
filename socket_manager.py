"""
Real-Time WebSocket Connection Manager for FarmDirect / RythuSeva
Provides bidirectional real-time push for notifications, queue updates, and live status.
"""

from typing import Dict, Set, Optional, Any
from fastapi import WebSocket

class WebSocketManager:
    def __init__(self):
        # Maps farmer_id (mobile or token) -> Set of active WebSocket connections
        self.farmer_connections: Dict[str, Set[WebSocket]] = {}
        # Set of active admin dashboard connections
        self.admin_connections: Set[WebSocket] = set()

    async def connect_farmer(self, client_id: str, websocket: WebSocket):
        await websocket.accept()
        cid = client_id.strip()
        if cid not in self.farmer_connections:
            self.farmer_connections[cid] = set()
        self.farmer_connections[cid].add(websocket)
        print(f"[WS] Farmer connected: {cid} (Total client conns: {len(self.farmer_connections[cid])})")

    def disconnect_farmer(self, client_id: str, websocket: WebSocket):
        cid = client_id.strip()
        if cid in self.farmer_connections:
            self.farmer_connections[cid].discard(websocket)
            if not self.farmer_connections[cid]:
                del self.farmer_connections[cid]
        print(f"[WS] Farmer disconnected: {cid}")

    async def connect_admin(self, websocket: WebSocket):
        await websocket.accept()
        self.admin_connections.add(websocket)
        print(f"[WS] Admin connected (Total admins: {len(self.admin_connections)})")

    def disconnect_admin(self, websocket: WebSocket):
        self.admin_connections.discard(websocket)
        print(f"[WS] Admin disconnected")

    async def send_farmer_notification(self, farmer_id: str, booking_id: str, payload: Dict[str, Any]):
        """
        Pushes a real-time event directly to the specific farmer's connected devices.
        Never leaks notifications across different farmers.
        """
        targets: Set[WebSocket] = set()
        keys_to_check = set()
        for k in (farmer_id, booking_id):
            if k:
                s = str(k).strip()
                keys_to_check.add(s)
                keys_to_check.add(s.upper())
                keys_to_check.add(s.lower())

        for conn_key, conns in self.farmer_connections.items():
            if conn_key in keys_to_check or conn_key.upper() in keys_to_check or conn_key.lower() in keys_to_check:
                targets.update(conns)

        # Also push to connected admins so they see real-time updates
        targets.update(self.admin_connections)

        dead_connections = []
        for ws in targets:
            try:
                await ws.send_json(payload)
            except Exception as e:
                dead_connections.append(ws)

        # Cleanup any dead sockets
        for dead in dead_connections:
            self.admin_connections.discard(dead)
            for cid in list(self.farmer_connections.keys()):
                self.farmer_connections[cid].discard(dead)

    async def broadcast_status_change(self, payload: Dict[str, Any]):
        """Broadcasts general booking/queue status change to all listeners."""
        all_sockets: Set[WebSocket] = set(self.admin_connections)
        for conns in self.farmer_connections.values():
            all_sockets.update(conns)

        for ws in list(all_sockets):
            try:
                await ws.send_json(payload)
            except Exception:
                pass

socket_manager = WebSocketManager()
