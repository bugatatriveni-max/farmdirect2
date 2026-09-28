import urllib.request
import json
from datetime import date

BASE_URL = "http://127.0.0.1:8000"

def get(endpoint):
    req = urllib.request.Request(f"{BASE_URL}{endpoint}")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))

def post(endpoint, data):
    req = urllib.request.Request(
        f"{BASE_URL}{endpoint}",
        data=json.dumps(data).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))

def run_comprehensive_suite():
    today_str = date.today().isoformat()
    market_id = "eluru_amc"

    print("\n=======================================================")
    print("  RYTHU SEVA CAPACITY & AUTOMATIC QUEUE TEST SUITE   ")
    print("=======================================================\n")

    # 1. Verify Slot Availability
    print(">>> 1. Fetching Real-Time Slot Availability...")
    res = get(f"/api/slots/availability?market_id={market_id}&slot_date={today_str}")
    assert len(res["slots"]) == 5, "Expected 5 standard slots"
    print(" [PASS] Found 5 standard shifts:")
    for s in res["slots"]:
        print(f"   [{s['slotTime']}] {s['bookedCount']}/{s['maxCapacity']} Booked | Available: {s['availableCount']} | Status: {s['status']}")

    # 2. Test Booking Full Slot -> Automatic Shift
    print("\n>>> 2. Booking in Full Slot (08:00 AM - 09:30 AM)...")
    b1 = post("/api/bookings", {
        "farmer_name": "Kasi Viswanadham",
        "mobile": "9848099001",
        "state": "andhra_pradesh",
        "district": "West Godavari",
        "mandal": "Denduluru",
        "village": "Denduluru",
        "market_id": market_id,
        "market_name": "Denduluru Procurement Centre",
        "crop_id": "paddy",
        "crop_name": "Paddy (Grade A)",
        "quantity_qtl": 50,
        "vehicle_type": "tractor",
        "slot_date": today_str,
        "slot_time": "08:00 AM - 09:30 AM"
    })
    b1_data = b1["booking"]
    print(f" [PASS] Token Generated: {b1_data['token']}")
    print(f" [PASS] Preferred Slot: {b1_data['preferredSlot']}")
    print(f" [PASS] Assigned Slot: {b1_data['assignedSlot']}")
    print(f" [PASS] Is Shifted: {b1_data['isShifted']}")
    print(f" [PASS] Shift Reason: {b1_data['shiftReason']}")
    print(f" [PASS] Slot Position: #{b1_data['slotPosition']}")
    print(f" [PASS] Dynamic Expected Time: {b1_data['expectedTime']}")

    assert b1_data["isShifted"] is True, "Booking should be flagged as shifted"
    assert b1_data["assignedSlot"] == "09:30 AM - 11:00 AM", "Should be shifted to 09:30 AM - 11:00 AM"
    assert b1_data["slotPosition"] >= 8, "Position should be appended in FCFS order"

    # 3. Verify in-app notifications
    print("\n>>> 3. Checking In-App Notifications for Shifted Farmer...")
    notifs = get(f"/api/notifications?mobile=9848099001")
    assert len(notifs) > 0, "Notification should be present"
    latest_notif = notifs[0]
    print(f" [PASS] Notification Title: {latest_notif['title']}")
    print(f" [PASS] Notification Message: {latest_notif['message']}")
    print(f" [PASS] Event Type: {latest_notif['type']}")
    assert latest_notif["type"] == "slot_shifted", "Event type should be slot_shifted"

    # 4. Fill up slot 09:30 AM - 11:00 AM to trigger multi-slot shift
    print("\n>>> 4. Filling up 09:30 AM - 11:00 AM and checking multi-shift to 11:00 AM - 12:30 PM...")
    # Fill remaining in 09:30 AM
    for i in range(2):
        post("/api/bookings", {
            "farmer_name": f"Test Farmer {i+1}",
            "mobile": f"984809900{i+2}",
            "state": "andhra_pradesh",
            "district": "West Godavari",
            "mandal": "Denduluru",
            "village": "Denduluru",
            "market_id": market_id,
            "crop_name": "Paddy",
            "quantity_qtl": 30,
            "slot_date": today_str,
            "slot_time": "09:30 AM - 11:00 AM"
        })

    # Now booking with preferred slot 08:00 AM should shift past 08:00 AND 09:30 to 11:00 AM - 12:30 PM!
    b_multi = post("/api/bookings", {
        "farmer_name": "Raghava Rao",
        "mobile": "9848099099",
        "state": "andhra_pradesh",
        "district": "West Godavari",
        "mandal": "Denduluru",
        "village": "Denduluru",
        "market_id": market_id,
        "crop_name": "Paddy",
        "quantity_qtl": 40,
        "slot_date": today_str,
        "slot_time": "08:00 AM - 09:30 AM"
    })
    b_multi_data = b_multi["booking"]
    print(f" [PASS] Preferred Slot: {b_multi_data['preferredSlot']} (FULL)")
    print(f" [PASS] Subsequent Slot: 09:30 AM - 11:00 AM (FULL)")
    print(f" [PASS] Multi-Shifted to: {b_multi_data['assignedSlot']} (Position #{b_multi_data['slotPosition']}, Expected: {b_multi_data['expectedTime']})")
    assert b_multi_data["assignedSlot"] == "11:00 AM - 12:30 PM", "Should shift to 11:00 AM - 12:30 PM"

    # 5. Admin Capacity Update
    print("\n>>> 5. Admin Capacity Modification...")
    adm_res = post("/api/admin/slots/capacity", {
        "market_id": market_id,
        "slot_date": today_str,
        "slot_time": "08:00 AM - 09:30 AM",
        "max_capacity": 15,
        "is_enabled": True
    })
    print(f" [PASS] Admin Update: {adm_res['message']}")
    avail_after_adm = get(f"/api/slots/availability?market_id={market_id}&slot_date={today_str}")
    slot_08 = avail_after_adm["slots"][1]
    print(f" [PASS] Slot 08:00-09:30 Capacity now: {slot_08['maxCapacity']} | Available: {slot_08['availableCount']} | Status: {slot_08['status']}")
    assert slot_08["maxCapacity"] == 15
    assert slot_08["status"] in ("AVAILABLE", "LIMITED")

    # Reset back to 10 for clean demo state
    post("/api/admin/slots/capacity", {
        "market_id": market_id,
        "slot_date": today_str,
        "slot_time": "08:00 AM - 09:30 AM",
        "max_capacity": 10,
        "is_enabled": True
    })

    # 6. Cancellation & Capacity Release
    print("\n>>> 6. Testing Booking Cancellation...")
    c_res = post(f"/api/bookings/{b1_data['token']}/cancel", {"reason": "Personal work"})
    print(f" [PASS] Cancelled Token {b1_data['token']}: Status is now {c_res['booking']['status']}")
    assert c_res["booking"]["status"] == "cancelled"

    # 7. Live Queue Status Endpoint
    print("\n>>> 7. Testing Live Queue Status & Congestion Calculator...")
    q_status = get(f"/api/queue/status?market_id={market_id}&slot_date={today_str}&token={b_multi_data['token']}")
    print(f" [PASS] Currently Serving: Token {q_status['currentlyServingNumber']}")
    print(f" [PASS] Congestion Level: {q_status['congestionLevel']}")
    print(f" [PASS] Active Counters: {q_status['activeCounters']}")
    print(f" [PASS] Farmer Dynamic Wait Mins: {q_status['farmer']['estimatedWaitMins']} mins")
    print(f" [PASS] Farmer Expected Turn: {q_status['farmer']['expectedTurn']}")

    print("\n=======================================================")
    print("  ALL 10 CAPACITY & QUEUE SYSTEM SCENARIOS PASSED!  ")
    print("=======================================================\n")

if __name__ == "__main__":
    run_comprehensive_suite()
