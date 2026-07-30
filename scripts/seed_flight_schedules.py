import argparse
import csv
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq


DEFAULT_PARQUET_URL = (
    "https://github.com/MrAirspace/aircraft-flight-schedules/releases/download/"
    "aircraft_flight_schedules_2026_quarter2/2026_Q2_detailed_github.parquet"
)
DEFAULT_AIRPORTS_URL = "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat"
DEFAULT_AIRLINES_URL = "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat"
DEFAULT_BATCH_SIZE = 500
SCHEDULE_COLUMNS = [
    "AC_Type",
    "Airline",
    "Callsign",
    "Track_Origin_DateTime_UTC",
    "Track_Origin_ApplicableAirports",
    "Track_Destination_DateTime_UTC",
    "Track_Destination_ApplicableAirports",
    "Route_Validation_Based_on_Callsign",
]


def load_env_file(file_path=".env"):
    path = Path(file_path)
    if not path.exists():
        return

    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def normalize_code(value, length=None):
    code = re.sub(r"[^A-Z0-9]", "", str(value or "").upper())
    return code if length is None or len(code) == length else ""


def normalize_time(value):
    if value is None or pd.isna(value):
        return ""
    if hasattr(value, "strftime"):
        return value.strftime("%H:%M:%S")
    text = str(value)
    match = re.search(r"(\d{1,2}):(\d{2})(?::(\d{2}))?", text)
    if not match:
        return ""
    hours, minutes, seconds = match.groups(default="00")
    return f"{int(hours):02d}:{minutes}:{seconds}"


def downloadable_path(source, cache_dir):
    source = str(source)
    if not source.startswith(("http://", "https://")):
        return source

    cache = Path(cache_dir or tempfile.gettempdir())
    cache.mkdir(parents=True, exist_ok=True)
    target = cache / Path(urllib.parse.urlparse(source).path).name
    if target.exists() and target.stat().st_size:
        print(f"Using cached {target}")
        return str(target)

    print(f"Downloading {source}")
    with urllib.request.urlopen(source) as response, target.open("wb") as output:
        total = int(response.headers.get("content-length") or 0)
        received = 0
        next_report = time.monotonic()
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)
            received += len(chunk)
            if time.monotonic() >= next_report:
                if total:
                    print(f"  {received / 1024 / 1024:.0f} MB / {total / 1024 / 1024:.0f} MB")
                else:
                    print(f"  {received / 1024 / 1024:.0f} MB")
                next_report = time.monotonic() + 10
    return str(target)


def read_csv_url(url):
    with urllib.request.urlopen(url) as response:
        text = response.read().decode("utf-8", errors="replace").splitlines()
    return csv.reader(text)


def load_airports(source):
    rows = read_csv_url(source) if str(source).startswith(("http://", "https://")) else csv.reader(open(source, newline="", encoding="utf-8"))
    airports_by_icao = {}
    airports_payload = []

    for row in rows:
        if len(row) < 12:
            continue
        iata = normalize_code(row[4], 3)
        icao = normalize_code(row[5], 4)
        if not iata or not icao:
            continue
        payload = {
            "iata_code": iata,
            "icao_code": icao,
            "name": row[1],
            "city": row[2],
            "country": row[3],
            "latitude": float(row[6]) if row[6] else None,
            "longitude": float(row[7]) if row[7] else None,
            "timezone": row[11] if row[11] and row[11] != "\\N" else "UTC",
        }
        airports_by_icao[icao] = payload
        airports_payload.append(payload)

    print(f"Prepared {len(airports_payload)} airport metadata rows")
    return airports_by_icao, airports_payload


def load_airlines(source):
    rows = read_csv_url(source) if str(source).startswith(("http://", "https://")) else csv.reader(open(source, newline="", encoding="utf-8"))
    iata_by_icao = {}

    for row in rows:
        if len(row) < 6:
            continue
        iata = normalize_code(row[3])
        icao = normalize_code(row[4], 3)
        if icao and iata and 1 <= len(iata) <= 3:
            iata_by_icao[icao] = iata

    print(f"Prepared {len(iata_by_icao)} airline ICAO-to-IATA mappings")
    return iata_by_icao


def first_airport_iata(value, airports_by_icao):
    tokens = re.findall(r"[A-Z]{4}", str(value or "").upper())
    for token in tokens:
        airport = airports_by_icao.get(token)
        if airport:
            return airport["iata_code"]
    return ""


def route_from_validation(value):
    tokens = re.findall(r"[A-Z]{4}", str(value or "").upper())
    return (tokens[0], tokens[-1]) if len(tokens) >= 2 else ("", "")


def flight_number_from_row(row, iata_by_icao):
    callsign = normalize_code(row.get("Callsign"))
    airline_icao = normalize_code(row.get("Airline"), 3)
    carrier_iata = iata_by_icao.get(airline_icao, "")
    digits = "".join(re.findall(r"\d+", callsign))
    if carrier_iata and digits:
        return f"{carrier_iata}{digits[:6]}", carrier_iata, digits[:6]

    match = re.match(r"^([A-Z]{3}|[A-Z0-9]{2})(\d{1,6})", callsign)
    if not match:
        return "", "", ""
    return callsign, match.group(1), match.group(2)


def schedule_batches(source, cache_dir, row_limit=None, parquet_batch_size=100_000):
    path = downloadable_path(source, cache_dir)
    print(f"Reading schedule columns from {path}", flush=True)
    parquet_file = pq.ParquetFile(path)
    available = set(parquet_file.schema.names)
    columns = [column for column in SCHEDULE_COLUMNS if column in available]
    missing = [column for column in SCHEDULE_COLUMNS if column not in available]
    if missing:
        raise RuntimeError(f"Schedule parquet is missing expected columns: {', '.join(missing)}")

    remaining = row_limit
    for batch in parquet_file.iter_batches(batch_size=parquet_batch_size, columns=columns):
        frame = batch.to_pandas()
        if remaining:
            frame = frame.head(remaining)
            remaining -= len(frame)
        yield frame
        if remaining == 0:
            break


def choose_mode(counter):
    if not counter:
        return None
    return sorted(counter.items(), key=lambda item: (-item[1], item[0]))[0][0]


def add_schedule_record(aggregates, row, airports_by_icao, iata_by_icao):
        flight_number, carrier_code, flight_digit = flight_number_from_row(row, iata_by_icao)
        if not flight_number:
            return False

        validation_origin, validation_destination = route_from_validation(row.get("Route_Validation_Based_on_Callsign"))
        origin_iata = first_airport_iata(validation_origin, airports_by_icao) or first_airport_iata(
            row.get("Track_Origin_ApplicableAirports"),
            airports_by_icao,
        )
        destination_iata = first_airport_iata(validation_destination, airports_by_icao) or first_airport_iata(
            row.get("Track_Destination_ApplicableAirports"),
            airports_by_icao,
        )
        if not origin_iata or not destination_iata or origin_iata == destination_iata:
            return False

        std_utc = normalize_time(row.get("Track_Origin_DateTime_UTC"))
        sta_utc = normalize_time(row.get("Track_Destination_DateTime_UTC"))
        if not std_utc or not sta_utc:
            return False

        key = (flight_number[:10], origin_iata, destination_iata)
        aggregate = aggregates.setdefault(
            key,
            {
                "carrier_code": carrier_code[:3],
                "flight_digit": flight_digit[:6],
                "std_utc": {},
                "sta_utc": {},
                "aircraft_type": {},
            },
        )
        aggregate["std_utc"][std_utc] = aggregate["std_utc"].get(std_utc, 0) + 1
        aggregate["sta_utc"][sta_utc] = aggregate["sta_utc"].get(sta_utc, 0) + 1
        aircraft_type = normalize_code(row.get("AC_Type"))[:10]
        if aircraft_type:
            aggregate["aircraft_type"][aircraft_type] = aggregate["aircraft_type"].get(aircraft_type, 0) + 1
        return True


def finalize_schedule_records(aggregates):
    records = []
    for (flight_number, origin_iata, destination_iata), aggregate in aggregates.items():
        records.append(
            {
                "flight_number": flight_number,
                "carrier_code": aggregate["carrier_code"],
                "flight_digit": aggregate["flight_digit"],
                "origin_iata": origin_iata,
                "destination_iata": destination_iata,
                "std_utc": choose_mode(aggregate["std_utc"]),
                "sta_utc": choose_mode(aggregate["sta_utc"]),
                "aircraft_type": choose_mode(aggregate["aircraft_type"]),
                "days_of_operation": "1234567",
                "source": "open_dataset",
                "confidence_score": 0.35,
                "schedule_time_reliable": False,
                "schedule_notes": "ADS-B-derived route profile from MrAirspace; timetable times require verification.",
            }
        )
    return records


def supabase_request(path, method="GET", body=None, prefer=None):
    base_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base_url or not service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")

    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        base_url.rstrip("/") + path,
        method=method,
        data=data,
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            **({"Prefer": prefer} if prefer else {}),
        },
    )
    try:
        with urllib.request.urlopen(request) as response:
            text = response.read().decode("utf-8")
            return json.loads(text) if text else None
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase {method} {path} failed: {error.code} {detail}") from error


def chunks(values, size):
    for index in range(0, len(values), size):
        yield values[index:index + size]


def load_verified_schedule_keys():
    rows = supabase_request(
        "/rest/v1/flight_schedules"
        "?source=in.(manual_verified,gds,airline_site,flightinfo)"
        "&select=flight_number,origin_iata,destination_iata",
    ) or []
    keys = {
        (row["flight_number"], row["origin_iata"], row["destination_iata"])
        for row in rows
    }
    print(f"Loaded {len(keys)} verified schedule keys to protect from open-data reseeds", flush=True)
    return keys


def without_protected_routes(rows, protected_keys):
    if not protected_keys:
        return rows
    return [
        row for row in rows
        if (row["flight_number"], row["origin_iata"], row["destination_iata"]) not in protected_keys
    ]


def upsert_table(table, rows, conflict, batch_size):
    if not rows:
        return
    total = len(rows)
    for index, batch in enumerate(chunks(rows, batch_size), start=1):
        supabase_request(
            f"/rest/v1/{table}?on_conflict={urllib.parse.quote(conflict)}",
            method="POST",
            body=batch,
            prefer="resolution=merge-duplicates,return=minimal",
        )
        print(f"Upserted {min(index * batch_size, total)} / {total} rows into {table}", flush=True)


def main():
    parser = argparse.ArgumentParser(description="Seed FlyForSure flight schedules into Supabase.")
    parser.add_argument("--env", default=".env")
    parser.add_argument("--schedules", default=os.getenv("FLIGHT_SCHEDULES_PARQUET", DEFAULT_PARQUET_URL))
    parser.add_argument("--airports", default=os.getenv("OPENFLIGHTS_AIRPORTS_URL", DEFAULT_AIRPORTS_URL))
    parser.add_argument("--airlines", default=os.getenv("OPENFLIGHTS_AIRLINES_URL", DEFAULT_AIRLINES_URL))
    parser.add_argument("--cache-dir", default=os.getenv("FLIGHT_SCHEDULE_CACHE_DIR", "output/flight-schedules-cache"))
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--parquet-batch-size", type=int, default=100_000)
    parser.add_argument("--limit", type=int, default=0, help="Read only the first N parquet rows for a dry run.")
    parser.add_argument("--skip-airports", action="store_true")
    args = parser.parse_args()

    load_env_file(args.env)
    airports_by_icao, airports_payload = load_airports(args.airports)
    iata_by_icao = load_airlines(args.airlines)
    if not args.skip_airports:
        upsert_table("airports", airports_payload, "iata_code", args.batch_size)

    aggregates = {}
    processed = 0
    accepted = 0
    for frame in schedule_batches(args.schedules, args.cache_dir, args.limit or None, args.parquet_batch_size):
        processed += len(frame)
        for row in frame.to_dict("records"):
            if add_schedule_record(aggregates, row, airports_by_icao, iata_by_icao):
                accepted += 1
        print(
            f"Processed {processed} source rows; accepted {accepted}; unique routes {len(aggregates)}",
            flush=True,
        )

    schedules = without_protected_routes(finalize_schedule_records(aggregates), load_verified_schedule_keys())
    print(f"Prepared {len(schedules)} unique open-dataset flight schedule rows", flush=True)
    upsert_table("flight_schedules", schedules, "flight_number,origin_iata,destination_iata", args.batch_size)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(error, file=sys.stderr)
        raise
