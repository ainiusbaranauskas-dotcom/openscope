#!/usr/bin/env python3
"""
FR24 Flight Data Calibration Tool for openScope

Processes FlightRadar24 arrival data to extract descent profiles and recommend
spawn pattern parameters for airport JSON files.

Usage:
    python3 fr24_calibration.py <fr24_data.json> [--airport-lat LAT] [--airport-lon LON]

Input format: FR24 JSON with "data" array containing flight objects with "events" arrays.
Each flight should have events: cruising, descent, airspace_transition, landed.

Output: Summary table of descent profiles and recommended spawn pattern values.
"""

import json
import math
import sys
from collections import defaultdict


# EYVI default position
DEFAULT_AIRPORT_LAT = 54.636944
DEFAULT_AIRPORT_LON = 25.287778


def haversine_nm(lat1, lon1, lat2, lon2):
    """Calculate distance in nautical miles between two lat/lon points."""
    R = 3440.065  # Earth radius in nm
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(a))


def bearing_deg(lat1, lon1, lat2, lon2):
    """Calculate bearing in degrees from point 1 to point 2."""
    lat1, lon1 = math.radians(lat1), math.radians(lon1)
    lat2, lon2 = math.radians(lat2), math.radians(lon2)
    dlon = lon2 - lon1
    x = math.sin(dlon) * math.cos(lat2)
    y = (math.cos(lat1) * math.sin(lat2) -
         math.sin(lat1) * math.cos(lat2) * math.cos(dlon))
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def bearing_to_direction(bearing):
    """Convert bearing to compass direction label."""
    dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    idx = round(bearing / 45) % 8
    return dirs[idx]


def parse_timestamp(ts):
    """Parse ISO timestamp to epoch seconds (simple parser, no dependencies)."""
    from datetime import datetime
    return datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp()


def process_flight(flight, airport_lat, airport_lon):
    """Extract descent profile data from a single flight's events."""
    events = flight.get('events', [])
    result = {
        'callsign': flight.get('callsign', 'UNKNOWN'),
        'origin': flight.get('orig_icao', ''),
        'destination': flight.get('dest_icao', ''),
    }

    cruising_event = None
    descent_event = None
    airspace_event = None
    landed_event = None

    for event in events:
        etype = event.get('type', '')
        if etype == 'cruising':
            cruising_event = event
        elif etype == 'descent':
            descent_event = event
        elif etype == 'airspace_transition':
            airspace_event = event
        elif etype == 'landed':
            landed_event = event

    if cruising_event:
        result['cruise_alt'] = cruising_event.get('alt', 0)
        result['cruise_speed'] = cruising_event.get('gspeed', 0)

    if descent_event:
        lat = descent_event.get('lat', 0)
        lon = descent_event.get('lon', 0)
        result['tod_alt'] = descent_event.get('alt', 0)
        result['tod_speed'] = descent_event.get('gspeed', 0)
        result['tod_distance_nm'] = haversine_nm(lat, lon, airport_lat, airport_lon)
        result['tod_bearing'] = bearing_deg(airport_lat, airport_lon, lat, lon)
        result['tod_direction'] = bearing_to_direction(result['tod_bearing'])

    if airspace_event:
        result['entry_alt'] = airspace_event.get('alt', 0)
        result['entry_speed'] = airspace_event.get('gspeed', 0)
        lat = airspace_event.get('lat', 0)
        lon = airspace_event.get('lon', 0)
        result['entry_distance_nm'] = haversine_nm(lat, lon, airport_lat, airport_lon)

    if landed_event:
        result['runway'] = landed_event.get('details', {}).get('landed_runway', '')

    # Compute descent rate if we have both cruise and landed timestamps
    if descent_event and landed_event:
        try:
            descent_ts = parse_timestamp(descent_event['timestamp'])
            landed_ts = parse_timestamp(landed_event['timestamp'])
            descent_duration_min = (landed_ts - descent_ts) / 60
            if descent_duration_min > 0:
                alt_lost = descent_event.get('alt', 0)
                result['avg_descent_rate_fpm'] = alt_lost / descent_duration_min
        except (KeyError, ValueError):
            pass

    return result


def classify_by_direction(flights):
    """Group flights by approach direction."""
    groups = defaultdict(list)
    for f in flights:
        direction = f.get('tod_direction', 'UNKNOWN')
        groups[direction].append(f)
    return groups


def compute_averages(flights):
    """Compute average values for a group of flights."""
    def avg(key):
        vals = [f[key] for f in flights if key in f and f[key]]
        return sum(vals) / len(vals) if vals else 0

    return {
        'count': len(flights),
        'avg_cruise_alt': round(avg('cruise_alt'), -2),
        'avg_tod_distance_nm': round(avg('tod_distance_nm'), 1),
        'avg_tod_alt': round(avg('tod_alt'), -2),
        'avg_tod_speed': round(avg('tod_speed')),
        'avg_entry_alt': round(avg('entry_alt'), -2),
        'avg_entry_speed': round(avg('entry_speed')),
        'avg_descent_rate_fpm': round(avg('avg_descent_rate_fpm')),
    }


def recommend_spawn_values(avgs):
    """Generate recommended spawn pattern values from averages."""
    entry_alt = avgs['avg_entry_alt']
    entry_speed = avgs['avg_entry_speed']

    # Recommend spawn altitude range: entry alt +/- 2000ft, rounded to 1000
    alt_low = max(round((entry_alt - 2000) / 1000) * 1000, 10000)
    alt_high = round((entry_alt + 4000) / 1000) * 1000

    # Recommend spawn speed: entry speed rounded to nearest 10
    speed = max(round(entry_speed / 10) * 10, 250)

    # Compute descent factor: avg_descent_rate / typical_max_descent_rate
    # Assume typical jet max descent rate is ~3000 fpm
    descent_factor = min(avgs['avg_descent_rate_fpm'] / 3000, 1.0) if avgs['avg_descent_rate_fpm'] > 0 else 0.7

    return {
        'altitude': [alt_low, alt_high],
        'speed': speed,
        'descent_factor': round(descent_factor, 2),
    }


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    input_file = sys.argv[1]
    airport_lat = DEFAULT_AIRPORT_LAT
    airport_lon = DEFAULT_AIRPORT_LON

    # Parse optional airport position args
    for i, arg in enumerate(sys.argv):
        if arg == '--airport-lat' and i + 1 < len(sys.argv):
            airport_lat = float(sys.argv[i + 1])
        elif arg == '--airport-lon' and i + 1 < len(sys.argv):
            airport_lon = float(sys.argv[i + 1])

    with open(input_file) as f:
        raw = json.load(f)

    flights_data = raw.get('data', raw) if isinstance(raw, dict) else raw
    if not isinstance(flights_data, list):
        flights_data = [flights_data]

    print(f"Processing {len(flights_data)} flights...")
    print(f"Airport: {airport_lat}, {airport_lon}\n")

    processed = []
    for flight in flights_data:
        result = process_flight(flight, airport_lat, airport_lon)
        if 'tod_distance_nm' in result:
            processed.append(result)

    if not processed:
        print("No flights with descent data found.")
        sys.exit(1)

    # Per-flight detail
    print(f"{'Callsign':<10} {'Origin':<6} {'CruiseAlt':>9} {'TOD Dist':>9} {'TOD Alt':>8} "
          f"{'TOD Spd':>8} {'EntryAlt':>9} {'EntrySpd':>9} {'DescRate':>9} {'Dir':<4}")
    print("-" * 100)

    for f in processed:
        print(f"{f.get('callsign',''):10s} {f.get('origin',''):6s} "
              f"{f.get('cruise_alt', 0):>9.0f} {f.get('tod_distance_nm', 0):>8.1f}nm "
              f"{f.get('tod_alt', 0):>8.0f} {f.get('tod_speed', 0):>8.0f} "
              f"{f.get('entry_alt', 0):>9.0f} {f.get('entry_speed', 0):>9.0f} "
              f"{f.get('avg_descent_rate_fpm', 0):>8.0f}fpm {f.get('tod_direction', ''):4s}")

    # Group by direction
    groups = classify_by_direction(processed)

    print(f"\n{'='*80}")
    print("SUMMARY BY APPROACH DIRECTION")
    print(f"{'='*80}\n")

    print(f"{'Direction':<10} {'Count':>6} {'AvgCruise':>10} {'AvgTODdist':>11} {'AvgEntryAlt':>12} "
          f"{'AvgEntrySpd':>12} {'AvgDescRate':>12}")
    print("-" * 80)

    all_recommendations = {}
    for direction in sorted(groups.keys()):
        flights = groups[direction]
        avgs = compute_averages(flights)
        recs = recommend_spawn_values(avgs)
        all_recommendations[direction] = recs

        print(f"{direction:<10} {avgs['count']:>6} {avgs['avg_cruise_alt']:>10.0f} "
              f"{avgs['avg_tod_distance_nm']:>10.1f}nm {avgs['avg_entry_alt']:>12.0f} "
              f"{avgs['avg_entry_speed']:>12.0f} {avgs['avg_descent_rate_fpm']:>11.0f}fpm")

    print(f"\n{'='*80}")
    print("RECOMMENDED SPAWN PATTERN VALUES")
    print(f"{'='*80}\n")

    for direction, recs in sorted(all_recommendations.items()):
        print(f"  {direction}:")
        print(f"    altitude: {recs['altitude']}")
        print(f"    speed: {recs['speed']}")
        print(f"    descent_factor: {recs['descent_factor']}")
        print()

    # Overall descent factor recommendation
    all_rates = [f['avg_descent_rate_fpm'] for f in processed if f.get('avg_descent_rate_fpm', 0) > 0]
    if all_rates:
        overall_rate = sum(all_rates) / len(all_rates)
        overall_factor = min(overall_rate / 3000, 1.0)
        print(f"Overall avg descent rate: {overall_rate:.0f} fpm")
        print(f"Recommended TYPICAL_DESCENT_FACTOR: {overall_factor:.2f}")
        print(f"  (current default: 0.70)")


if __name__ == '__main__':
    main()
