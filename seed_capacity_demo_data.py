import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from datetime import datetime, date, timedelta
from backend.database import get_connection

STANDARD_SLOTS = [
    "06:30 AM - 08:00 AM",
    "08:00 AM - 09:30 AM",
    "09:30 AM - 11:00 AM",
    "11:00 AM - 12:30 PM",
    "01:30 PM - 03:00 PM"
]

def seed_capacities():
    conn = get_connection()
    now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    dates = [(date.today() + timedelta(days=i)).isoformat() for i in range(7)]
    markets = ["eluru_amc", "gnt_amc_mirchi", "wgl_enumamula", "knl_amc", "denduluru_amc"]

    for m in markets:
        for d in dates:
            for s in STANDARD_SLOTS:
                conn.execute("""
                INSERT OR IGNORE INTO slot_capacities (market_id, slot_date, slot_time, max_capacity, is_enabled, created_at)
                VALUES (?, ?, ?, 10, 1, ?);
                """, (m, d, s, now_iso))

    # Seed Demo Bookings across the week for all common market IDs
    demo_markets = ["eluru_amc", "elr_eluru_amc", "gnt_amc_mirchi"]
    market_name = "Denduluru Procurement Centre"

    names_full = [
        ("Rao Bahadur", "9848011001", "Denduluru", "Chilli", 35.0),
        ("Nageswara Rao", "9848011002", "Kovvur", "Paddy", 45.0),
        ("Subba Rao", "9848011003", "Denduluru", "Paddy", 50.0),
        ("Satyanarayana", "9848011004", "Bhimavaram", "Maize", 30.0),
        ("Appa Rao", "9848011005", "Denduluru", "Cotton", 40.0),
        ("Koteswara Rao", "9848011006", "Eluru Rural", "Chilli", 25.0),
        ("Venkat Reddy", "9848011007", "Denduluru", "Paddy", 60.0),
        ("Chandra Sekhar", "9848011008", "Tenali", "Turmeric", 35.0),
        ("Samba Siva Rao", "9848011009", "Denduluru", "Paddy", 40.0),
        ("Gopala Krishna", "9848011010", "Kovvur", "Cotton", 55.0),
    ]

    names_part = [
        ("Murali Mohan", "9848022001", "Denduluru", "Paddy", 40.0),
        ("Suresh Kumar", "9848022002", "Eluru Rural", "Chilli", 30.0),
        ("Venkatesh", "9848022003", "Kovvur", "Cotton", 45.0),
        ("Ramana Murthy", "9848022004", "Denduluru", "Turmeric", 25.0),
        ("Lakshmana Rao", "9848022005", "Bhimavaram", "Paddy", 50.0),
        ("Prasad Babu", "9848022006", "Denduluru", "Paddy", 35.0),
        ("Ramesh Babu", "9848022007", "Tenali", "Chilli", 20.0),
    ]

    for m in demo_markets:
        for d in dates:
            for s in STANDARD_SLOTS:
                conn.execute("""
                INSERT OR IGNORE INTO slot_capacities (market_id, slot_date, slot_time, max_capacity, is_enabled, created_at)
                VALUES (?, ?, ?, 10, 1, ?);
                """, (m, d, s, now_iso))

            # Clear old test data for clean demo
            conn.execute("DELETE FROM bookings WHERE market_id = ? AND slot_date = ? AND token LIKE 'AP-DEMO-%';", (m, d))

            # Seed 10 in 08:00 AM - 09:30 AM (FULL)
            for idx, (name, mob, vil, crop, qty) in enumerate(names_full, start=1):
                tok_num = 20 + idx
                token = f"AP-DEMO-{m[:3].upper()}-{d.replace('-', '')[4:]}-{tok_num:03d}"
                conn.execute("""
                INSERT OR REPLACE INTO bookings 
                (token, farmer_name, mobile, kisan_id, state, district, mandal, village, market_id, market_name, crop_id, crop_name, quantity_qtl, vehicle_type, vehicle_no, slot_date, slot_time, preferred_slot, assigned_slot, slot_position, is_shifted, shift_reason, expected_time, gate_no, status, token_number, queue_position, est_wait_mins, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'andhra_pradesh', 'west_godavari', 'Denduluru', ?, ?, ?, 'paddy', ?, ?, 'tractor', 'AP 37 BK 1234', ?, '08:00 AM - 09:30 AM', '08:00 AM - 09:30 AM', '08:00 AM - 09:30 AM', ?, 0, '', ?, 'Gate 1 (Main Bay)', 'booked', ?, ?, ?, ?, ?);
                """, (token, name, mob, f"KID-{mob[-4:]}", vil, m, market_name, crop, qty, d, idx, f"08:{idx*8:02d} AM", tok_num, idx, idx * 8, now_iso, now_iso))

            # Seed 7 in 09:30 AM - 11:00 AM (3 available)
            for idx, (name, mob, vil, crop, qty) in enumerate(names_part, start=1):
                tok_num = 30 + idx
                token = f"AP-DEMO-{m[:3].upper()}-{d.replace('-', '')[4:]}-{tok_num:03d}"
                conn.execute("""
                INSERT OR REPLACE INTO bookings 
                (token, farmer_name, mobile, kisan_id, state, district, mandal, village, market_id, market_name, crop_id, crop_name, quantity_qtl, vehicle_type, vehicle_no, slot_date, slot_time, preferred_slot, assigned_slot, slot_position, is_shifted, shift_reason, expected_time, gate_no, status, token_number, queue_position, est_wait_mins, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'andhra_pradesh', 'west_godavari', 'Denduluru', ?, ?, ?, 'paddy', ?, ?, 'tractor', 'AP 37 BK 5678', ?, '09:30 AM - 11:00 AM', '09:30 AM - 11:00 AM', '09:30 AM - 11:00 AM', ?, 0, '', ?, 'Gate 2 (Weighbridge Bay A)', 'booked', ?, ?, ?, ?, ?);
                """, (token, name, mob, f"KID-{mob[-4:]}", vil, m, market_name, crop, qty, d, idx, f"09:{30 + idx*8:02d} AM", tok_num, idx, idx * 8, now_iso, now_iso))

    conn.commit()
    conn.close()
    print("Seed capacities and SIH test bookings completed successfully!")

if __name__ == "__main__":
    seed_capacities()
