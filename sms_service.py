"""
FarmDirect Real SMS Service & Notification Dispatcher
Supports real SMS provider integrations (Fast2SMS, Twilio).
When no SMS provider is configured, transparently reports "NOT_CONFIGURED"
and never creates fake delivery records.
"""

import os
import urllib.request
import urllib.parse
import json
import base64
from datetime import datetime
from typing import Dict, Any, Optional, List

try:
    from backend.database import get_connection
except ModuleNotFoundError:
    from database import get_connection

def get_sms_service_status() -> Dict[str, Any]:
    fast2sms_key = os.getenv("FAST2SMS_API_KEY", "").strip()
    twilio_sid = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
    twilio_token = os.getenv("TWILIO_AUTH_TOKEN", "").strip()

    if fast2sms_key:
        return {
            "configured": True,
            "provider": "Fast2SMS (National Indian SMS Gateway)",
            "status_text": "Active (Real Gateway Configured)",
            "instructions": "Fast2SMS credentials detected."
        }
    elif twilio_sid and twilio_token:
        return {
            "configured": True,
            "provider": "Twilio SMS",
            "status_text": "Active (Twilio Configured)",
            "instructions": "Twilio credentials detected."
        }
    else:
        return {
            "configured": False,
            "provider": "None",
            "status_text": "SMS service not configured",
            "instructions": "To enable real SMS delivery, add FAST2SMS_API_KEY or (TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_PHONE_NUMBER) to .env."
        }

def _dispatch_real_sms(mobile: str, message: str) -> Dict[str, Any]:
    fast2sms_key = os.getenv("FAST2SMS_API_KEY", "").strip()
    twilio_sid = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
    twilio_token = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
    twilio_from = os.getenv("TWILIO_PHONE_NUMBER", "").strip()

    # 1. Fast2SMS Provider (Indian DLT / Quick SMS)
    if fast2sms_key:
        try:
            url = "https://www.fast2sms.com/dev/bulkV2"
            clean_mobile = "".join(filter(str.isdigit, mobile))[-10:]
            payload = {
                "route": "q",
                "message": message,
                "language": "english",
                "flash": 0,
                "numbers": clean_mobile
            }
            req_data = urllib.parse.urlencode(payload).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=req_data,
                headers={
                    "authorization": fast2sms_key,
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=8) as resp:
                resp_data = json.loads(resp.read().decode("utf-8"))
                if resp_data.get("return"):
                    return {
                        "status": "DELIVERED",
                        "ref_id": resp_data.get("request_id", "F2SMS-OK"),
                        "note": "Delivered via Fast2SMS Indian Gateway"
                    }
                else:
                    return {
                        "status": "FAILED",
                        "ref_id": None,
                        "note": f"Fast2SMS error: {resp_data.get('message')}"
                    }
        except Exception as e:
            return {"status": "FAILED", "ref_id": None, "note": f"Fast2SMS request failed: {str(e)}"}

    # 2. Twilio Provider
    if twilio_sid and twilio_token and twilio_from:
        try:
            url = f"https://api.twilio.com/2010-04-01/Accounts/{twilio_sid}/Messages.json"
            clean_mobile = mobile if mobile.startswith("+") else f"+91{''.join(filter(str.isdigit, mobile))[-10:]}"
            data = urllib.parse.urlencode({
                "To": clean_mobile,
                "From": twilio_from,
                "Body": message
            }).encode("utf-8")
            auth_header = base64.b64encode(f"{twilio_sid}:{twilio_token}".encode("utf-8")).decode("ascii")
            req = urllib.request.Request(
                url,
                data=data,
                headers={"Authorization": f"Basic {auth_header}"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=8) as resp:
                resp_data = json.loads(resp.read().decode("utf-8"))
                return {
                    "status": "DELIVERED",
                    "ref_id": resp_data.get("sid"),
                    "note": f"Queued via Twilio (Status: {resp_data.get('status')})"
                }
        except Exception as e:
            return {"status": "FAILED", "ref_id": None, "note": f"Twilio request failed: {str(e)}"}

    # 3. Not configured: Strictly transparent
    return {
        "status": "NOT_CONFIGURED",
        "ref_id": None,
        "note": "SMS service not configured (Real API key required in .env: FAST2SMS_API_KEY / TWILIO_ACCOUNT_SID)"
    }

def send_sms(
    token: str,
    mobile: str,
    event_type: str,
    params: Optional[Dict[str, Any]] = None,
    lang: str = "te",
    custom_message: Optional[str] = None
) -> Dict[str, Any]:
    params = params or {}
    now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Format real messages per status
    if custom_message:
        message = custom_message
    else:
        if event_type in ("slot_confirmed", "slot_booked"):
            message = f"RYTHU Seva: Slot CONFIRMED for Token {token}. Shift: {params.get('slot_time', '')}. Expected turn time: {params.get('expected_time', '')}. Centre: {params.get('market_name', 'Procurement Centre')}."
        elif event_type in ("slot_rescheduled", "slot_delayed"):
            message = f"RYTHU Seva: Notice for Token {token}. Your procurement schedule has been updated. Revised expected arrival time: {params.get('expected_time', '')}, Shift: {params.get('slot_time', '')}. Reason: {params.get('reason', 'Schedule update')}."
        elif event_type == "slot_shifted":
            message = f"RYTHU Seva: Selected shift is full. You have been assigned to the next available shift: {params.get('slot_time', '')}. Token: {token}. Expected arrival time: {params.get('expected_time', '')}."
        elif event_type == "mandi_check_in":
            message = f"RYTHU Seva: Checked in at {params.get('market_name')}. Proceed with vehicle {params.get('vehicle_no', '')} to {params.get('gate_no', 'Bay A')}."
        elif event_type == "queue_position":
            message = f"RYTHU Seva: Token {token} is now in the queue. Current position: {params.get('queue_position', 1)}. Est wait: {params.get('est_wait_mins', 15)} mins."
        elif event_type == "procurement_processing":
            message = f"RYTHU Seva: Procurement process has started for Token {token} at {params.get('gate_no', 'Bay A')}."
        elif event_type == "procurement_completed":
            message = f"RYTHU Seva: Procurement COMPLETED for Token {token}. Net Weight: {params.get('net_weight_qtl')} Qtl. Total: ₹{params.get('total_amount')}. DBT initiated."
        elif event_type in ("booking_cancelled", "slot_cancelled"):
            message = f"RYTHU Seva: Your procurement slot {token} has been CANCELLED and capacity released."
        else:
            message = f"RYTHU Seva: Update for Token {token} - {params.get('status', 'Status updated')}."

    # Dispatch via real gateway if configured
    dispatch_result = _dispatch_real_sms(mobile, message)
    sms_status = dispatch_result["status"]
    provider_ref = dispatch_result.get("ref_id") or f"REF-{token[-4:]}"

    try:
        conn = get_connection()
        conn.execute("""
            INSERT INTO sms_logs (token, mobile, message, lang, event_type, sms_status, provider_ref_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?);
        """, (token, mobile, message, lang, event_type, sms_status, provider_ref, now_iso))
        conn.commit()
        conn.close()
    except Exception as e:
        print("[SMSService] Error recording sms_logs:", e)

    return {
        "success": sms_status == "DELIVERED",
        "status": sms_status,
        "is_configured": sms_status != "NOT_CONFIGURED",
        "carrier_note": dispatch_result["note"],
        "provider_ref_id": provider_ref,
        "token": token,
        "mobile": mobile,
        "message": message,
        "timestamp": now_iso
    }

def get_sms_logs(token: Optional[str] = None, mobile: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
    try:
        conn = get_connection()
        query = "SELECT * FROM sms_logs WHERE 1=1"
        params = []
        if token:
            query += " AND UPPER(token) = ?"
            params.append(token.strip().upper())
        if mobile:
            query += " AND mobile = ?"
            params.append(mobile.strip())
        query += " ORDER BY id DESC LIMIT ?"
        params.append(limit)

        rows = conn.execute(query, params).fetchall()
        conn.close()

        results = []
        for r in rows:
            results.append({
                "id": r["id"],
                "token": r["token"],
                "mobile": r["mobile"],
                "message": r["message"],
                "lang": r["lang"],
                "eventType": r["event_type"],
                "status": r["sms_status"],
                "providerRefId": r["provider_ref_id"],
                "createdAt": r["created_at"]
            })
        return results
    except Exception as e:
        print("[SMSService] Error reading logs:", e)
        return []
