"""
FarmDirect — Bookings & Live Queue Management Router
Provides:
  POST  /api/bookings              — Create a new slot booking with capacity check & auto-shift
  GET   /api/bookings              — List all bookings (optional query filters)
  GET   /api/bookings/{token}      — Lookup booking by token (for Status Tracker)
  PATCH /api/bookings/{token}/status — Update procurement stage
  GET   /api/queue/status          — Live queue board metrics
  POST  /api/queue/advance         — Advance current serving token (Admin/Operator)
  GET   /api/slots/availability    — Live capacity & booked counts for all 5 shifts
  POST  /api/admin/slots/capacity  — Admin capacity config per shift
  POST  /api/bookings/{token}/cancel — Cancel booking and release slot capacity immediately
"""

import json
import random
import re
from datetime import datetime, date
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.database import get_connection
try:
    from backend.services.sms_service import send_sms, get_sms_logs
except ModuleNotFoundError:
    from services.sms_service import send_sms, get_sms_logs

router = APIRouter(prefix="/api", tags=["Slot Booking & Live Queue"])

# ============================================================================
# EXACT 5 STANDARD PROCUREMENT SHIFTS (Max 10 farmers per shift = 50 daily max)
# STABLE SHIFT IDs: early-morning, morning, afternoon, evening, night
# ============================================================================
STANDARD_PROCUREMENT_SLOTS = [
    {
        "id": "early-morning",
        "shift": "Shift 1",
        "name": "Early Morning",
        "time": "05:00 AM - 08:00 AM",
        "timeDisplay": "05:00 AM – 08:00 AM",
        "label": "Shift 1: Early Morning (05:00 AM – 08:00 AM)",
        "startTime": "05:00",
        "endTime": "08:00",
        "start_mins": 5 * 60,
        "end_mins": 8 * 60,
        "capacity": 10
    },
    {
        "id": "morning",
        "shift": "Shift 2",
        "name": "Morning",
        "time": "08:00 AM - 12:00 PM",
        "timeDisplay": "08:00 AM – 12:00 PM",
        "label": "Shift 2: Morning (08:00 AM – 12:00 PM)",
        "startTime": "08:00",
        "endTime": "12:00",
        "start_mins": 8 * 60,
        "end_mins": 12 * 60,
        "capacity": 10
    },
    {
        "id": "afternoon",
        "shift": "Shift 3",
        "name": "Afternoon",
        "time": "12:00 PM - 04:00 PM",
        "timeDisplay": "12:00 PM – 04:00 PM",
        "label": "Shift 3: Afternoon (12:00 PM – 04:00 PM)",
        "startTime": "12:00",
        "endTime": "16:00",
        "start_mins": 12 * 60,
        "end_mins": 16 * 60,
        "capacity": 10
    },
    {
        "id": "evening",
        "shift": "Shift 4",
        "name": "Evening",
        "time": "04:00 PM - 08:00 PM",
        "timeDisplay": "04:00 PM – 08:00 PM",
        "label": "Shift 4: Evening (04:00 PM – 08:00 PM)",
        "startTime": "16:00",
        "endTime": "20:00",
        "start_mins": 16 * 60,
        "end_mins": 20 * 60,
        "capacity": 10
    },
    {
        "id": "night",
        "shift": "Shift 5",
        "name": "Night",
        "time": "08:00 PM - 11:00 PM",
        "timeDisplay": "08:00 PM – 11:00 PM",
        "label": "Shift 5: Night (08:00 PM – 11:00 PM)",
        "startTime": "20:00",
        "endTime": "23:00",
        "start_mins": 20 * 60,
        "end_mins": 23 * 60,
        "capacity": 10
    }
]

def _get_shift_info(slot_str: str) -> dict:
    """
    Normalizes any slot/shift identifier, time, or label into canonical shift dictionary.
    """
    if not slot_str:
        return STANDARD_PROCUREMENT_SLOTS[0]
    
    s = str(slot_str).strip().lower().replace("–", "-").replace("—", "-")
    
    # 1. Exact match by stable ID
    for item in STANDARD_PROCUREMENT_SLOTS:
        if item["id"].lower() == s:
            return item
            
    # 2. Exact match by time, timeDisplay, label, or name
    for item in STANDARD_PROCUREMENT_SLOTS:
        if (item["time"].lower() == s or 
            item["timeDisplay"].lower() == s or 
            item["label"].lower() == s or
            item["name"].lower() == s):
            return item

    # 3. Match by keywords / shifts
    if "early" in s or "early-morning" in s or "shift 1" in s or "shift1" in s or "05:00" in s or "5:00" in s or "06:30" in s or "6:30" in s:
        return STANDARD_PROCUREMENT_SLOTS[0]
    if "afternoon" in s or "shift 3" in s or "shift3" in s or "12:00" in s or "01:00" in s or "1:00" in s or "02:00" in s or "2:00" in s or "03:00" in s or "3:00" in s:
        return STANDARD_PROCUREMENT_SLOTS[2]
    if "evening" in s or "shift 4" in s or "shift4" in s or "04:00" in s or "4:00" in s or "16:00" in s or "05:00 pm" in s or "5:00 pm" in s or "06:00 pm" in s or "6:00 pm" in s or "07:00 pm" in s:
        return STANDARD_PROCUREMENT_SLOTS[3]
    if "night" in s or "shift 5" in s or "shift5" in s or "08:00 pm" in s or "8:00 pm" in s or "20:00" in s or "21:00" in s or "22:00" in s or "11:00" in s or "23:00" in s:
        return STANDARD_PROCUREMENT_SLOTS[4]
    if "morning" in s or "shift 2" in s or "shift2" in s or "08:00" in s or "8:00" in s or "09:" in s or "9:" in s or "10:" in s or "11:" in s:
        return STANDARD_PROCUREMENT_SLOTS[1]

    return STANDARD_PROCUREMENT_SLOTS[0]

def _normalize_slot(slot_str: str) -> str:
    return _get_shift_info(slot_str)["time"]

def _calc_expected_time(slot_time: str, position_in_slot: int, avg_mins: int = 15, bays: int = 1) -> str:
    s_info = _get_shift_info(slot_time)
    start_mins = s_info["start_mins"]
    wait_offset = max(0, int(((position_in_slot - 1) * avg_mins) / max(1, bays)))
    total_mins = start_mins + wait_offset
    hours = (total_mins // 60) % 24
    mins = total_mins % 60
    period = "AM" if hours < 12 else "PM"
    disp_hours = hours if hours <= 12 else hours - 12
    if disp_hours == 0:
        disp_hours = 12
    return f"{disp_hours:02d}:{mins:02d} {period}"

class BookingCreateRequest(BaseModel):
    farmer_name: Optional[str] = Field(None, alias="farmerName")
    name: Optional[str] = None
    farmerName: Optional[str] = None
    mobile: Optional[str] = None
    kisan_id: Optional[str] = Field(None, alias="kisanId")
    aadhaar: Optional[str] = None
    state: Optional[str] = "andhra_pradesh"
    district: Optional[str] = "eluru"
    mandal: Optional[str] = ""
    village: Optional[str] = "Denduluru"
    token_number: Optional[int] = Field(None, alias="tokenNumber")
    market_id: Optional[str] = Field("eluru_amc", alias="marketId")
    market_name: Optional[str] = Field("Government Agricultural Market Yard", alias="marketName")
    crop: Optional[str] = None
    crop_id: Optional[str] = Field(None, alias="cropId")
    crop_name: Optional[str] = Field(None, alias="cropName")
    quantity: Optional[float] = None
    quantity_qtl: Optional[float] = Field(None, alias="quantityQtl")
    vehicle_type: Optional[str] = Field("minitruck", alias="vehicleType")
    vehicle_no: Optional[str] = Field(None, alias="vehicleNo")
    vehicle_number: Optional[str] = Field(None, alias="vehicleNumber")
    slot_date: Optional[str] = Field(None, alias="slotDate")
    arrival_date: Optional[str] = Field(None, alias="arrivalDate")
    slot_time: Optional[str] = Field(None, alias="slotTime")
    shift_id: Optional[str] = Field(None, alias="shiftId")
    requested_shift_id: Optional[str] = Field(None, alias="requestedShiftId")
    token: Optional[str] = None
    gate_no: Optional[str] = Field(None, alias="gateNo")
    lang: Optional[str] = "te"

    class Config:
        populate_by_name = True

class StatusUpdateRequest(BaseModel):
    status: str
    quality_grade: Optional[str] = None
    moisture_percent: Optional[float] = None
    net_weight_qtl: Optional[float] = None
    rate_per_qtl: Optional[float] = None
    total_amount: Optional[float] = None
    dbt_status: Optional[str] = None

class RescheduleRequest(BaseModel):
    new_slot_time: Optional[str] = Field(None, alias="newSlotTime")
    new_expected_time: Optional[str] = Field(None, alias="newExpectedTime")
    delay_minutes: Optional[int] = Field(None, alias="delayMinutes")
    reason: Optional[str] = "Admin schedule adjustment"
    change_type: Optional[str] = Field("delayed", alias="changeType")
    class Config:
        populate_by_name = True

def _add_minutes_to_time_str(time_str: str, minutes_to_add: int) -> str:
    match = re.search(r"(\d{1,2}):(\d{2})\s*(AM|PM)", time_str, re.IGNORECASE)
    if not match:
        return time_str
    h, m, p = int(match.group(1)), int(match.group(2)), match.group(3).upper()
    if p == "PM" and h < 12:
        h += 12
    elif p == "AM" and h == 12:
        h = 0
    total = (h * 60 + m + minutes_to_add) % (24 * 60)
    new_h = total // 60
    new_m = total % 60
    new_p = "AM" if new_h < 12 else "PM"
    disp_h = new_h if new_h <= 12 else new_h - 12
    if disp_h == 0:
        disp_h = 12
    return f"{disp_h:02d}:{new_m:02d} {new_p}"

def _format_booking_row(r) -> dict:
    raw_pref = r["preferred_slot"] if ("preferred_slot" in r.keys() and r["preferred_slot"]) else r["slot_time"]
    raw_asgn = (r["shift_id"] if ("shift_id" in r.keys() and r["shift_id"]) else
                (r["assigned_slot"] if ("assigned_slot" in r.keys() and r["assigned_slot"]) else r["slot_time"]))
    
    pref_info = _get_shift_info(raw_pref)
    asgn_info = _get_shift_info(raw_asgn)
    
    slot_pos = int(r["slot_position"]) if ("slot_position" in r.keys() and r["slot_position"]) else 1
    rem_in_shift = max(0, 10 - slot_pos)
    is_cancelled = (r["status"] or "").lower() in ("cancelled", "canceled")
    booking_status = "CANCELLED" if is_cancelled else "CONFIRMED"
    veh_no = r["vehicle_no"] if ("vehicle_no" in r.keys() and r["vehicle_no"]) else ""

    return {
        "token": r["token"],
        "farmerName": r["farmer_name"],
        "mobile": r["mobile"],
        "kisanId": r["kisan_id"] or "",
        "state": r["state"],
        "district": r["district"],
        "mandal": r["mandal"] or "",
        "village": (r["village"] if ("village" in r.keys() and r["village"]) else (r["mandal"] or "Denduluru")),
        "marketId": r["market_id"],
        "marketName": r["market_name"],
        "cropId": r["crop_id"],
        "cropName": r["crop_name"],
        "quantityQtl": float(r["quantity_qtl"] or 0),
        "quantity": float(r["quantity_qtl"] or 0),
        "vehicleType": r["vehicle_type"],
        "vehicleNo": veh_no,
        "vehicleNumber": veh_no,
        "slotDate": r["slot_date"],
        "arrivalDate": r["slot_date"],
        "slotTime": asgn_info["time"],
        "shiftId": asgn_info["id"],
        "shiftName": asgn_info["name"],
        "preferredShiftId": pref_info["id"],
        "assignedShiftId": asgn_info["id"],
        "preferredShift": pref_info["shift"],
        "assignedShift": asgn_info["shift"],
        "preferredShiftLabel": pref_info["label"],
        "assignedShiftLabel": asgn_info["label"],
        "gateNo": r["gate_no"] or "Gate 1 (Main Bay)",
        "status": r["status"] or "booked",
        "bookingStatus": booking_status,
        "queuePosition": int(r["queue_position"] or 0),
        "farmersAhead": int(r["queue_position"] or 0),
        "estWaitMins": int(r["est_wait_mins"] or 15),
        "slotPosition": slot_pos,
        "remainingInShift": rem_in_shift,
        "shiftCapacity": f"{min(10, slot_pos)}/10",
        "isShifted": bool(r["is_shifted"]) if ("is_shifted" in r.keys() and r["is_shifted"]) else False,
        "shiftReason": (r["shift_reason"] if ("shift_reason" in r.keys() and r["shift_reason"]) else ""),
        "expectedTime": (r["expected_time"] if ("expected_time" in r.keys() and r["expected_time"]) else asgn_info["time"]),
        "scheduleStatus": (r["schedule_status"] if ("schedule_status" in r.keys() and r["schedule_status"]) else "ON_TIME"),
        "scheduleNote": (r["schedule_note"] if ("schedule_note" in r.keys() and r["schedule_note"]) else ""),
        "waitingPosition": int(r["waiting_position"]) if ("waiting_position" in r.keys() and r["waiting_position"]) else 0,
        "tokenNumber": int(r["token_number"]) if ("token_number" in r.keys() and r["token_number"]) else None,
        "createdAt": r["created_at"],
        "updatedAt": r["updated_at"]
    }

@router.get("/bookings")
def list_bookings(
    mobile: Optional[str] = None,
    market_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50
):
    try:
        conn = get_connection()
        query = "SELECT * FROM bookings WHERE 1=1"
        params = []
        if mobile:
            query += " AND mobile = ?"
            params.append(mobile)
        if market_id:
            query += " AND market_id = ?"
            params.append(market_id)
        if status:
            query += " AND status = ?"
            params.append(status)
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        rows = conn.execute(query, params).fetchall()
        conn.close()
        return [_format_booking_row(r) for r in rows]
    except Exception as e:
        return []

@router.post("/bookings")
async def create_booking(req: BookingCreateRequest):
    """
    Capacity-based slot booking with strict 10-farmer shift limit and automatic forward-only shift allocation.
    Uses SQLite immediate transaction locking to guarantee atomic concurrency safety.
    """
    # 1. Comprehensive Backend Validation
    f_name = (req.farmer_name or req.name or req.farmerName or "").strip()
    if not f_name or len(f_name) < 2:
        raise HTTPException(status_code=400, detail="Farmer name is required (minimum 2 characters).")

    clean_mobile = "".join(filter(str.isdigit, req.mobile or ""))
    if len(clean_mobile) < 10:
        raise HTTPException(status_code=400, detail="Valid 10-digit mobile number is required.")
    mobile_10 = clean_mobile[-10:]

    crop_name = (req.crop_name or req.crop or req.crop_id or "").strip()
    if not crop_name:
        raise HTTPException(status_code=400, detail="Crop selection is required.")

    qty = req.quantity_qtl if req.quantity_qtl is not None else req.quantity
    if qty is None or qty <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be greater than 0 quintals.")

    slot_date = (req.slot_date or req.arrival_date or "").strip()
    if not slot_date:
        raise HTTPException(status_code=400, detail="Arrival date is required.")

    market_id = (req.market_id or "eluru_amc").strip()
    market_name = req.market_name or "Government Agricultural Market Yard"
    vehicle_no = (req.vehicle_no or req.vehicle_number or f"AP 07 TR {random.randint(1000, 9999)}").strip()
    vehicle_type = req.vehicle_type or "minitruck"
    k_id = req.kisan_id or req.aadhaar or f"KS-{mobile_10[-4:]}"
    village = req.village or req.mandal or "Denduluru"
    crop_id = req.crop_id or crop_name.lower().replace(" ", "_")

    # Determine requested shift
    raw_shift_input = req.shift_id or req.requested_shift_id or req.slot_time or "early-morning"
    pref_shift_info = _get_shift_info(raw_shift_input)

    conn = get_connection()
    try:
        # Atomic lock in SQLite to protect against race conditions
        conn.isolation_level = None
        conn.execute("BEGIN IMMEDIATE")

        now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # 2. Duplicate Check: Prevent multiple active bookings for same farmer, date, and market
        dup_row = conn.execute("""
            SELECT token, shift_id, assigned_slot, slot_time, expected_time FROM bookings
            WHERE market_id = ? AND slot_date = ? 
            AND (mobile = ? OR mobile LIKE ?)
            AND status NOT IN ('cancelled', 'CANCELLED');
        """, (market_id, slot_date, req.mobile, f"%{mobile_10}")).fetchone()

        if dup_row and not (req.token and req.token.upper() == dup_row["token"].upper()):
            conn.execute("ROLLBACK")
            conn.close()
            raise HTTPException(
                status_code=400,
                detail=f"Duplicate booking: You already have an active booking (Token: {dup_row['token']}) for this centre on {slot_date}. Please cancel your existing booking before booking another slot."
            )

        # 3. Queue configuration
        q_cfg = conn.execute("""
            SELECT active_counters, avg_processing_mins FROM queue_status WHERE market_id = ?;
        """, (market_id,)).fetchone()
        active_bays = max(1, int(q_cfg["active_counters"])) if q_cfg and q_cfg["active_counters"] else 1
        avg_mins = max(1, int(q_cfg["avg_processing_mins"])) if q_cfg and q_cfg["avg_processing_mins"] else 10

        # 4. Count confirmed active bookings for all 5 standard shifts on this date
        shift_states = []
        total_day_booked = 0
        total_day_capacity = 0

        for s_item in STANDARD_PROCUREMENT_SLOTS:
            s_id = s_item["id"]
            s_time = s_item["time"]

            cap_row = conn.execute("""
                SELECT max_capacity, is_enabled FROM slot_capacities 
                WHERE market_id = ? AND slot_date = ? AND (slot_time = ? OR slot_time = ?);
            """, (market_id, slot_date, s_id, s_time)).fetchone()

            max_cap = int(cap_row["max_capacity"]) if cap_row else 10
            is_enabled = bool(cap_row["is_enabled"]) if cap_row else True

            # Count confirmed bookings in this shift (strictly excluding cancelled)
            b_count = conn.execute("""
                SELECT COUNT(*) FROM bookings 
                WHERE market_id = ? AND slot_date = ? 
                AND (
                    shift_id = ?
                    OR assigned_slot = ?
                    OR assigned_slot = ?
                    OR assigned_slot = ?
                    OR slot_time = ?
                    OR slot_time = ?
                )
                AND status NOT IN ('cancelled', 'CANCELLED');
            """, (market_id, slot_date, s_id, s_id, s_item["label"], s_time, s_time, s_id)).fetchone()[0]

            avail_count = max(0, max_cap - b_count)
            total_day_booked += b_count
            total_day_capacity += max_cap

            shift_states.append({
                "id": s_id,
                "shift": s_item["shift"],
                "name": s_item["name"],
                "time": s_time,
                "label": s_item["label"],
                "startTime": s_item["startTime"],
                "endTime": s_item["endTime"],
                "max_capacity": max_cap,
                "booked": b_count,
                "available": avail_count,
                "is_enabled": is_enabled
            })

        # 5. Check if all 5 shifts are full
        all_full = all(s["available"] <= 0 or not s["is_enabled"] for s in shift_states)
        if all_full or total_day_booked >= total_day_capacity:
            conn.execute("ROLLBACK")
            conn.close()
            raise HTTPException(
                status_code=400,
                detail=f"All shifts for {slot_date} are completely full (50/50 farmers booked). Please select another date."
            )

        # 6. Find preferred shift index in the list
        pref_idx = 0
        for i, s in enumerate(shift_states):
            if s["id"] == pref_shift_info["id"] or s["time"] == pref_shift_info["time"]:
                pref_idx = i
                break

        preferred_shift_state = shift_states[pref_idx]
        assigned_shift_state = None
        is_shifted = False
        shift_reason = ""

        # 7. Check if preferred shift has space (< 10 farmers)
        if preferred_shift_state["available"] > 0 and preferred_shift_state["is_enabled"]:
            assigned_shift_state = preferred_shift_state
            is_shifted = False
            shift_reason = ""
        else:
            # AUTOMATIC NEXT-SHIFT ASSIGNMENT: FORWARD ONLY!
            # The order is: Early Morning -> Morning -> Afternoon -> Evening -> Night.
            # Never move a farmer to an earlier shift.
            for cand_idx in range(pref_idx + 1, len(shift_states)):
                cand = shift_states[cand_idx]
                if cand["available"] > 0 and cand["is_enabled"]:
                    assigned_shift_state = cand
                    is_shifted = True
                    break

            if not assigned_shift_state:
                conn.execute("ROLLBACK")
                conn.close()
                raise HTTPException(
                    status_code=400,
                    detail=f"{preferred_shift_state['name']} is full, and all subsequent shifts for {slot_date} are also full. Please select another date or an earlier available shift."
                )

            shift_reason = f"{preferred_shift_state['name']} is full. You have been automatically assigned to the {assigned_shift_state['name']} shift."

        # 8. Calculate position in allocated shift and expected procurement time
        slot_position = assigned_shift_state["booked"] + 1
        expected_time = _calc_expected_time(assigned_shift_state["time"], slot_position, avg_mins=avg_mins, bays=active_bays)
        est_wait_mins = max(5, int(((slot_position - 1) * avg_mins) / active_bays))

        # 9. Generate sequential token number
        max_tok_row = conn.execute(
            "SELECT COALESCE(MAX(token_number), 20) FROM bookings WHERE market_id = ? AND slot_date = ?;",
            (market_id, slot_date)
        ).fetchone()
        next_tok_num = (max_tok_row[0] + 1) if (req.token_number is None or req.token_number <= 0) else req.token_number

        token = req.token
        if not token:
            state_pfx = "AP" if req.state == "andhra_pradesh" else ("TG" if req.state == "telangana" else "IN")
            dist_pfx = (req.district[:3] if req.district else "ELU").upper()
            token = f"{state_pfx}-{dist_pfx}-2026-{next_tok_num:04d}"

        gate = req.gate_no or f"Gate {1 + (hash(token) % 3)} (Weighbridge Bay A)"

        # Count total active farmers ahead in this market today
        ahead_count = conn.execute("""
            SELECT COUNT(*) FROM bookings 
            WHERE market_id = ? AND slot_date = ? 
            AND status NOT IN ('completed', 'COMPLETED', 'paid', 'PAID', 'cancelled', 'CANCELLED');
        """, (market_id, slot_date)).fetchone()[0]

        # 10. Atomic Insert into Database
        conn.execute("""
            INSERT OR REPLACE INTO bookings (
                token, farmer_name, mobile, kisan_id, state, district, mandal, village, token_number,
                market_id, market_name, crop_id, crop_name, quantity_qtl,
                vehicle_type, vehicle_no, slot_date, slot_time, shift_id, gate_no,
                preferred_slot, assigned_slot, slot_position, is_shifted, shift_reason, expected_time, waiting_position,
                status, queue_position, est_wait_mins, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """, (
            token, f_name, req.mobile, k_id, req.state or "andhra_pradesh", req.district or "eluru", req.mandal or "", village, next_tok_num,
            market_id, market_name, crop_id, crop_name, qty,
            vehicle_type, vehicle_no, slot_date, assigned_shift_state["time"], assigned_shift_state["id"], gate,
            preferred_shift_state["id"], assigned_shift_state["id"], slot_position, 1 if is_shifted else 0, shift_reason, expected_time, 0,
            "booked", ahead_count, est_wait_mins, now_iso, now_iso
        ))

        # 11. Notifications
        if is_shifted:
            title = f"🔔 Shift Updated — {assigned_shift_state['name']}"
            if req.lang == "te":
                message = f"రైతుసేవ: మీరు కోరిన {preferred_shift_state['name']} నిండింది. మీరు తదుపరి షిఫ్ట్ {assigned_shift_state['name']} ({assigned_shift_state['time']}) కు కేటాయించబడ్డారు. తేదీ: {slot_date}, టోకెన్: #{next_tok_num} ({token}), అంచనా సమయం: {expected_time}."
            else:
                message = f"{preferred_shift_state['name']} is full. You have been assigned to {assigned_shift_state['name']} ({assigned_shift_state['time']}). Date: {slot_date}, Token: #{next_tok_num} ({token}), Expected Arrival: {expected_time}."
            event_type = "slot_shifted"
        else:
            title = f"🔔 Slot Confirmed — {assigned_shift_state['name']}"
            if req.lang == "te":
                message = f"రైతుసేవ: మీ స్లాట్ ఖరారైంది! షిఫ్ట్: {assigned_shift_state['name']} ({assigned_shift_state['time']}), తేదీ: {slot_date}, టోకెన్: #{next_tok_num} ({token}), అంచనా సమయం: {expected_time}."
            else:
                message = f"Slot Confirmed! Your slot is confirmed for {assigned_shift_state['name']} ({assigned_shift_state['time']}) on {slot_date}. Token: #{next_tok_num} ({token}), Expected Arrival: {expected_time}."
            event_type = "slot_booked"

        conn.execute("""
            INSERT INTO in_app_notifications (token, mobile, title, message, type, lang, is_read, is_cleared, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?);
        """, (token, req.mobile, title, message, event_type, req.lang or "te", now_iso))

        conn.execute("""
            INSERT INTO notifications (farmer_id, booking_id, title, message, type, created_at, read_status, sms_status)
            VALUES (?, ?, ?, ?, ?, ?, 0, 'DELIVERED');
        """, (req.mobile, token, title, message, event_type, now_iso))

        conn.execute("COMMIT")

        row = conn.execute("SELECT * FROM bookings WHERE token = ?;", (token,)).fetchone()
        conn.close()

        # 12. Send SMS Event
        try:
            send_sms(
                token=token,
                mobile=req.mobile,
                event_type=event_type,
                params={
                    "farmer_name": f_name,
                    "market_name": market_name,
                    "crop_name": crop_name,
                    "gate_no": gate,
                    "slot_date": slot_date,
                    "slot_time": assigned_shift_state["label"],
                    "slot_position": slot_position,
                    "expected_time": expected_time,
                    "shift_reason": shift_reason
                },
                lang=getattr(req, "lang", "te") or "te"
            )
        except Exception:
            pass

        # 13. WebSocket Broadcast
        try:
            from backend.services.socket_manager import socket_manager
            await socket_manager.broadcast_status_change({
                "type": "SLOT_AVAILABILITY_CHANGED",
                "marketId": market_id,
                "slotDate": slot_date,
                "shiftId": assigned_shift_state["id"],
                "assignedShift": assigned_shift_state["name"],
                "token": token
            })
        except Exception:
            pass

        return {
            "status": "SUCCESS",
            "token": token,
            "message": shift_reason if is_shifted else "Slot booked successfully.",
            "isShifted": is_shifted,
            "shiftReason": shift_reason,
            "booking": _format_booking_row(row) if row else {"token": token}
        }

    except HTTPException:
        raise
    except Exception as e:
        try:
            conn.execute("ROLLBACK")
            conn.close()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Booking failed: {str(e)}")

@router.get("/slots/availability")
def get_slot_availability(
    market_id: Optional[str] = "eluru_amc",
    slot_date: Optional[str] = None,
    date: Optional[str] = None
):
    """
    Returns real-time 5-shift capacity breakdown and booked counts for a procurement centre and date.
    Strictly calculates capacity from actual confirmed bookings in SQLite database.
    """
    try:
        conn = get_connection()
        s_date = slot_date or date or datetime.now().strftime("%Y-%m-%d")
        m_id = market_id or "eluru_amc"

        results = []
        total_booked = 0
        total_capacity = 0

        for slot_info in STANDARD_PROCUREMENT_SLOTS:
            s_id = slot_info["id"]
            s_time = slot_info["time"]
            s_name = slot_info["name"]
            s_shift = slot_info["shift"]
            s_label = slot_info["label"]

            # Query capacity config
            cap_row = conn.execute("""
                SELECT max_capacity, is_enabled FROM slot_capacities 
                WHERE market_id = ? AND slot_date = ? AND (slot_time = ? OR slot_time = ?);
            """, (m_id, s_date, s_id, s_time)).fetchone()

            max_cap = int(cap_row[0]) if cap_row else 10
            is_enabled = bool(cap_row[1]) if cap_row else True

            # Count active confirmed bookings in this shift
            booked_rows = conn.execute("""
                SELECT token, farmer_name, village, status, slot_position, expected_time, is_shifted, shift_reason 
                FROM bookings 
                WHERE market_id = ? AND slot_date = ? 
                AND (
                    shift_id = ?
                    OR assigned_slot = ?
                    OR assigned_slot = ?
                    OR assigned_slot = ?
                    OR slot_time = ?
                    OR slot_time = ?
                )
                AND status NOT IN ('cancelled', 'CANCELLED')
                ORDER BY slot_position ASC;
            """, (m_id, s_date, s_id, s_id, s_label, s_time, s_time, s_id)).fetchall()

            booked_count = len(booked_rows)
            available_count = max(0, max_cap - booked_count)
            total_booked += booked_count
            total_capacity += max_cap

            if not is_enabled:
                status = "DISABLED"
                status_color = "gray"
                status_text = "🔒 Disabled"
            elif available_count == 0:
                status = "FULL"
                status_color = "red"
                status_text = "🔴 Full (10/10)"
            elif available_count <= 3:
                status = "FEW_LEFT"
                status_color = "amber"
                status_text = f"🟠 Few slots remaining ({available_count} left)"
            else:
                status = "AVAILABLE"
                status_color = "green"
                status_text = f"🟢 Available ({available_count} slots)"

            results.append({
                "id": s_id,
                "name": s_name,
                "shift": s_shift,
                "startTime": slot_info["startTime"],
                "endTime": slot_info["endTime"],
                "slotTime": s_time,
                "timeDisplay": slot_info["timeDisplay"],
                "label": s_label,
                "capacity": max_cap,
                "maxCapacity": max_cap,
                "booked": booked_count,
                "bookedCount": booked_count,
                "remaining": available_count,
                "availableCount": available_count,
                "remainingSlots": available_count,
                "isFull": (available_count <= 0),
                "status": status,
                "statusColor": status_color,
                "statusText": status_text,
                "isEnabled": is_enabled,
                "capacityDisplay": f"{booked_count}/{max_cap}",
                "farmers": [
                    {
                        "token": r["token"],
                        "name": r["farmer_name"],
                        "village": r["village"] or "Denduluru",
                        "status": r["status"],
                        "position": r["slot_position"] or 1,
                        "expectedTime": r["expected_time"] or "",
                        "isShifted": bool(r["is_shifted"]) if "is_shifted" in r.keys() else False,
                        "shiftReason": r["shift_reason"] or ""
                    } for r in booked_rows
                ]
            })

        total_available = max(0, total_capacity - total_booked)
        conn.close()

        return {
            "date": s_date,
            "slotDate": s_date,
            "marketId": m_id,
            "totalCapacity": total_capacity,
            "totalBooked": total_booked,
            "totalAvailable": total_available,
            "allFull": (total_available <= 0),
            "shifts": results,
            "slots": results
        }
    except Exception as e:
        print("[SlotAvailability] error:", e)
        return {
            "date": slot_date or date or "",
            "slotDate": slot_date or date or "",
            "marketId": market_id,
            "totalCapacity": 50,
            "totalBooked": 0,
            "totalAvailable": 50,
            "allFull": False,
            "shifts": [],
            "slots": []
        }

@router.post("/admin/slots/capacity")
def update_slot_capacity(payload: dict):
    """
    Admin endpoint to configure maximum capacity and toggle slot availability.
    """
    try:
        conn = get_connection()
        m_id = payload.get("market_id") or payload.get("marketId") or "eluru_amc"
        s_date = payload.get("slot_date") or payload.get("slotDate")
        raw_time = payload.get("slot_time") or payload.get("slotTime") or payload.get("shift_id") or payload.get("shiftId")
        s_info = _get_shift_info(raw_time)
        max_cap = int(payload.get("max_capacity") or payload.get("maxCapacity") or 10)
        is_enabled = 1 if payload.get("is_enabled", True) else 0
        now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        conn.execute("""
            INSERT INTO slot_capacities (market_id, slot_date, slot_time, max_capacity, is_enabled, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(market_id, slot_date, slot_time) DO UPDATE SET
                max_capacity = excluded.max_capacity,
                is_enabled = excluded.is_enabled;
        """, (m_id, s_date, s_info["id"], max_cap, is_enabled, now_iso))
        conn.commit()
        conn.close()
        return {"status": "SUCCESS", "message": f"Capacity updated to {max_cap} for {s_info['name']}."}
    except Exception as e:
        return {"status": "ERROR", "message": str(e)}

@router.delete("/bookings/{token}")
@router.post("/bookings/{token}/cancel")
async def cancel_booking(token: str, payload: dict = None):
    """
    Cancels a confirmed booking and immediately releases that capacity.
    """
    clean_token = token.strip()
    reason = (payload or {}).get("reason", "Farmer requested cancellation")
    conn = get_connection()
    row = conn.execute("SELECT * FROM bookings WHERE UPPER(token) = ?;", (clean_token.upper(),)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Booking not found.")

    if (row["status"] or "").lower() in ("cancelled", "canceled"):
        conn.close()
        raise HTTPException(status_code=400, detail="Booking is already cancelled.")

    now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn.execute(
        "UPDATE bookings SET status = 'cancelled', updated_at = ? WHERE UPPER(token) = ?;",
        (now_iso, clean_token.upper())
    )
    conn.commit()

    updated = conn.execute("SELECT * FROM bookings WHERE UPPER(token) = ?;", (clean_token.upper(),)).fetchone()
    conn.close()

    try:
        from backend.services.socket_manager import socket_manager
        await socket_manager.broadcast_status_change({
            "type": "SLOT_AVAILABILITY_CHANGED",
            "marketId": row["market_id"],
            "slotDate": row["slot_date"],
            "cancelledToken": clean_token
        })
    except Exception:
        pass

    return {
        "status": "SUCCESS",
        "message": "Booking cancelled successfully. Slot capacity has been released.",
        "booking": _format_booking_row(updated)
    }

@router.get("/bookings/{token}")
def get_booking_by_token(token: str):
    conn = get_connection()
    clean_token = token.strip().upper()
    row = conn.execute("SELECT * FROM bookings WHERE UPPER(token) = ?;", (clean_token,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail=f"Booking token '{token}' not found.")
    return _format_booking_row(row)

@router.patch("/bookings/{token}/status")
async def update_booking_status(token: str, req: StatusUpdateRequest):
    conn = get_connection()
    now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    clean_token = token.strip().upper()

    row = conn.execute("SELECT * FROM bookings WHERE UPPER(token) = ?;", (clean_token,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Booking token '{token}' not found.")

    update_fields = ["status = ?", "updated_at = ?"]
    params = [req.status, now_iso]

    if req.quality_grade is not None:
        update_fields.append("quality_grade = ?")
        params.append(req.quality_grade)
    if req.moisture_percent is not None:
        update_fields.append("moisture_percent = ?")
        params.append(req.moisture_percent)
    if req.net_weight_qtl is not None:
        update_fields.append("net_weight_qtl = ?")
        params.append(req.net_weight_qtl)
    if req.rate_per_qtl is not None:
        update_fields.append("rate_per_qtl = ?")
        params.append(req.rate_per_qtl)
    if req.total_amount is not None:
        update_fields.append("total_amount = ?")
        params.append(req.total_amount)
    if req.dbt_status is not None:
        update_fields.append("dbt_status = ?")
        params.append(req.dbt_status)

    params.append(clean_token)
    query = f"UPDATE bookings SET {', '.join(update_fields)} WHERE UPPER(token) = ?;"
    conn.execute(query, params)
    conn.commit()

    updated = conn.execute("SELECT * FROM bookings WHERE UPPER(token) = ?;", (clean_token,)).fetchone()
    conn.close()
    return {"status": "SUCCESS", "booking": _format_booking_row(updated)}

@router.post("/bookings/{token}/reschedule")
async def reschedule_booking(token: str, req: RescheduleRequest):
    clean_token = token.strip().upper()
    conn = get_connection()
    row = conn.execute("SELECT * FROM bookings WHERE UPPER(token) = ?;", (clean_token,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Booking token '{token}' not found.")

    now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    current_expected = row["expected_time"] or row["slot_time"] or "08:00 AM"
    current_slot = row["assigned_slot"] or row["slot_time"] or STANDARD_PROCUREMENT_SLOTS[0]["label"]
    
    new_expected = req.new_expected_time
    if not new_expected and req.delay_minutes:
        new_expected = _add_minutes_to_time_str(current_expected, req.delay_minutes)
    
    new_slot_label = current_slot
    new_slot_time = row["slot_time"]
    new_shift_id = row["shift_id"] or "early-morning"
    if req.new_slot_time:
        s_info = _get_shift_info(req.new_slot_time)
        new_slot_label = s_info["label"]
        new_slot_time = s_info["time"]
        new_shift_id = s_info["id"]
        if not new_expected:
            new_expected = s_info["time"].split(" - ")[0]

    if not new_expected:
        new_expected = current_expected

    change_type = (req.change_type or "delayed").lower()
    schedule_status = "DELAYED" if "delay" in change_type else ("RESCHEDULED" if "resched" in change_type else "UPDATED")
    reason = req.reason or ("Operational delay at centre" if schedule_status == "DELAYED" else "Schedule updated by administrator")

    conn.execute("""
        UPDATE bookings 
        SET expected_time = ?, assigned_slot = ?, slot_time = ?, shift_id = ?, schedule_status = ?, schedule_note = ?, updated_at = ?
        WHERE UPPER(token) = ?;
    """, (new_expected, new_slot_label, new_slot_time, new_shift_id, schedule_status, reason, now_iso, clean_token))

    farmer_name = row["farmer_name"]
    title = f"⚠️ Schedule Update: {schedule_status.title()} — Token #{row['token_number'] or clean_token}"
    final_msg = f"Notice for Token {clean_token}: Your procurement schedule has been updated. Revised expected arrival time: {new_expected}, Shift: {new_slot_label}. Reason: {reason}."

    conn.execute("""
        INSERT INTO in_app_notifications (token, mobile, title, message, type, lang, is_read, is_cleared, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?);
    """, (clean_token, row["mobile"], title, final_msg, "slot_rescheduled", "te", now_iso))

    conn.execute("""
        INSERT INTO notifications (farmer_id, booking_id, title, message, type, created_at, read_status, sms_status)
        VALUES (?, ?, ?, ?, ?, ?, 0, 'DELIVERED');
    """, (row["mobile"], clean_token, title, final_msg, "slot_rescheduled", now_iso))

    conn.commit()

    updated = conn.execute("SELECT * FROM bookings WHERE UPPER(token) = ?;", (clean_token,)).fetchone()
    conn.close()

    try:
        send_sms(
            token=clean_token,
            mobile=row["mobile"],
            event_type="slot_rescheduled",
            params={
                "farmer_name": farmer_name,
                "expected_time": new_expected,
                "slot_time": new_slot_label,
                "reason": reason
            },
            lang="te"
        )
    except Exception:
        pass

    try:
        from backend.services.socket_manager import socket_manager
        await socket_manager.broadcast_status_change({
            "type": "SLOT_SCHEDULE_CHANGED",
            "token": clean_token,
            "newExpectedTime": new_expected,
            "assignedSlot": new_slot_label,
            "shiftId": new_shift_id,
            "scheduleStatus": schedule_status,
            "scheduleNote": reason,
            "marketId": row["market_id"],
            "slotDate": row["slot_date"]
        })
    except Exception:
        pass

    return {
        "status": "SUCCESS",
        "message": f"Farmer schedule updated successfully. New expected time: {new_expected}.",
        "booking": _format_booking_row(updated)
    }

@router.get("/queue/status")
def get_queue_status(market_id: Optional[str] = "eluru_amc"):
    conn = get_connection()
    row = conn.execute("SELECT * FROM queue_status WHERE market_id = ? ORDER BY id DESC LIMIT 1;", (market_id,)).fetchone()
    if not row:
        row = conn.execute("SELECT * FROM queue_status ORDER BY id DESC LIMIT 1;").fetchone()

    today_str = date.today().isoformat()
    active_b = conn.execute("""
        SELECT * FROM bookings 
        WHERE market_id = ? AND slot_date = ? AND status NOT IN ('completed', 'COMPLETED', 'cancelled', 'CANCELLED')
        ORDER BY created_at ASC LIMIT 10;
    """, (market_id, today_str)).fetchall()
    conn.close()

    if not row:
        return {
            "currentlyServingToken": "AP-ELU-2026-0038",
            "servingNumber": 38,
            "avgWaitMins": 18,
            "waitingVehiclesCount": 2,
            "operatingStatus": "OPEN",
            "activeBookings": []
        }

    operating_status = row["centre_status"] if ("centre_status" in row.keys() and row["centre_status"]) else "OPEN"
    serving_token = row["currently_serving_token"] if ("currently_serving_token" in row.keys() and row["currently_serving_token"]) else "AP-ELU-2026-0038"
    serving_num = int(row["serving_number"]) if ("serving_number" in row.keys() and row["serving_number"]) else 38
    avg_wait = int(row["avg_wait_mins"]) if ("avg_wait_mins" in row.keys() and row["avg_wait_mins"]) else 18

    return {
        "currentlyServingToken": serving_token,
        "servingNumber": serving_num,
        "avgWaitMins": avg_wait,
        "waitingVehiclesCount": len(active_b),
        "operatingStatus": operating_status,
        "activeBookings": [_format_booking_row(b) for b in active_b]
    }

@router.post("/queue/advance")
async def advance_queue(market_id: str = "eluru_amc"):
    conn = get_connection()
    now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    row = conn.execute("SELECT * FROM queue_status WHERE market_id = ? ORDER BY id DESC LIMIT 1;", (market_id,)).fetchone()
    current_num = int(row["serving_number"] or 38) if row else 38
    next_num = current_num + 1
    next_token = f"AP-ELU-2026-{next_num:04d}"

    conn.execute("""
        UPDATE queue_status 
        SET currently_serving_token = ?, serving_number = ?, updated_at = ?
        WHERE market_id = ?;
    """, (next_token, next_num, now_iso, market_id))
    conn.commit()
    conn.close()
    return {"status": "SUCCESS", "servingToken": next_token, "servingNumber": next_num}

@router.post("/queue/pause")
async def pause_queue(market_id: str = "eluru_amc"):
    conn = get_connection()
    now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn.execute("UPDATE queue_status SET operating_status = 'PAUSED', updated_at = ? WHERE market_id = ?;", (now_iso, market_id))
    conn.commit()
    conn.close()
    return {"status": "SUCCESS", "operatingStatus": "PAUSED"}

@router.post("/queue/config")
async def update_queue_config(payload: dict):
    conn = get_connection()
    m_id = payload.get("market_id", "eluru_amc")
    counters = int(payload.get("active_counters", 2))
    avg_m = int(payload.get("avg_processing_mins", 6))
    now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn.execute("""
        UPDATE queue_status 
        SET active_counters = ?, avg_processing_mins = ?, updated_at = ?
        WHERE market_id = ?;
    """, (counters, avg_m, now_iso, m_id))
    conn.commit()
    conn.close()
    return {"status": "SUCCESS", "activeCounters": counters, "avgProcessingMins": avg_m}

@router.get("/notifications")
def get_notifications(token: Optional[str] = None, mobile: Optional[str] = None, limit: int = 30):
    try:
        conn = get_connection()
        query = "SELECT * FROM in_app_notifications WHERE 1=1"
        params = []
        if token:
            query += " AND (token = ? OR token IS NULL)"
            params.append(token)
        if mobile:
            query += " AND (mobile = ? OR mobile IS NULL)"
            params.append(mobile)
        query += " ORDER BY created_at DESC, id DESC LIMIT ?"
        params.append(limit)
        rows = conn.execute(query, params).fetchall()
        conn.close()
        return [
            {
                "id": r["id"],
                "token": r["token"],
                "mobile": r["mobile"],
                "title": r["title"],
                "message": r["message"],
                "type": r["type"],
                "lang": r["lang"],
                "isRead": bool(r["is_read"]),
                "createdAt": str(r["created_at"])
            } for r in rows
        ]
    except Exception:
        return []

@router.post("/notifications/mark-all-read")
def mark_all_notifications_read():
    try:
        conn = get_connection()
        conn.execute("UPDATE in_app_notifications SET is_read = 1;")
        conn.commit()
        conn.close()
        return {"status": "SUCCESS"}
    except Exception as e:
        return {"status": "ERROR", "message": str(e)}

@router.get("/sms/logs")
def get_sms_logs_endpoint(token: Optional[str] = None, limit: int = 30):
    try:
        return get_sms_logs(token=token, limit=limit)
    except Exception:
        return []

@router.get("/sms/service-status")
def get_sms_service_status():
    return {
        "status": "DEVELOPMENT_SIMULATION",
        "description": "In-app notifications and SMS logs are recorded. Set SMS gateway credentials in .env for external carrier dispatch."
    }
