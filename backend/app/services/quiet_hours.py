"""Offline quiet windows, deliberately broad civil times, not religious rulings.

Fixed Hebrew calendar arithmetic uses the 19-year leap cycle and molad
postponements. Boundaries are 14:00 on the eve through 23:59 on the last day;
these are notification preferences, NOT candle-lighting or havdalah times.
"""
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo


def leap(year):
    return (7 * year + 1) % 19 < 7


def new_year(year):
    months = (235 * year - 234) // 19
    parts = 12084 + 13753 * months
    day = 29 * months + parts // 25920
    if (3 * (day + 1)) % 7 < 3:
        day += 1
    return day


def rosh_hashanah(year):
    current = new_year(year)
    delay = 2 if new_year(year + 1) - current == 356 else 1 if current - new_year(year - 1) == 382 else 0
    # Gregorian ordinal of Hebrew epoch, plus elapsed days and postponements.
    return date.fromordinal(-1373427 + current + delay)


def holidays(year, israel=False):
    start = rosh_hashanah(year)
    length = (rosh_hashanah(year + 1) - start).days
    # Tishrei, Cheshvan, Kislev, Tevet, Shevat, (Adar I), Adar.
    to_nisan = 30 + (30 if length % 10 == 5 else 29) + (29 if length % 10 == 3 else 30) + 29 + 30 + (30 if leap(year) else 0) + 29
    nisan = start + timedelta(days=to_nisan)
    offsets = [0, 1, 9, 14, 21] + ([] if israel else [15, 22])
    days = {start + timedelta(days=n) for n in offsets}
    days.update(nisan + timedelta(days=n) for n in ([14, 20, 64] if israel else [14, 15, 20, 21, 64, 65]))
    return days


def windows(options, now):
    if not options.get('quiet_enabled'):
        return []
    zone = ZoneInfo(options['timezone'])
    today = now.astimezone(zone).date()
    sacred = set()
    for year in range(today.year + 3759, today.year + 3762):
        sacred.update(holidays(year, options.get('israel', False)))
    for offset in range(-8, 9):
        day = today + timedelta(days=offset)
        if day.weekday() == 5:
            sacred.add(day)
    intervals = [(datetime.combine(day - timedelta(days=1), time(14), zone).astimezone(UTC),
                  datetime.combine(day + timedelta(days=1), time.min, zone).astimezone(UTC))
                 for day in sacred if abs((day - today).days) <= 8]
    merged = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return merged


def quiet_until(options, now):
    return next((end for start, end in windows(options, now) if start <= now < end), None)
