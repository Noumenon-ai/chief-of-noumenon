"""Bounded bilingual one-shot parser. Unknown or conflicting times ask, never guess."""
import re
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

TRIGGER = re.compile(r'^(?:remind me|set (?:a )?reminder|תזכיר לי|תזכירי לי|הזכר לי)\s+', re.I)
DAYS = {'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3, 'friday': 4, 'saturday': 5, 'sunday': 6,
        'יום ראשון': 6, 'יום שני': 0, 'יום שלישי': 1, 'יום רביעי': 2, 'יום חמישי': 3, 'יום שישי': 4, 'שבת': 5}
DAY = r'(?:today|tomorrow|היום|מחר|(?:next\s+)?' + '|'.join(DAYS) + r'|\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{4})'
CLOCK = r'(?:\d{1,2}:\d{2}(?:\s*[ap]m)?|\d{1,2}\s*[ap]m|noon|midnight|morning|evening|בבוקר|בערב|צהריים)'
RELATIVE = r'(?:in\s+\d+\s+(?:minutes?|hours?)|בעוד\s+(?:\d+\s+(?:דקות|שעות)|שעה|שעתיים|דקה))'
SCHEDULE = re.compile(rf'^(?:{RELATIVE}|(?:(?:on\s+|ב)?{DAY}\s+)?(?:(?:at|בשעה)\s+|ב[-־]?)?{CLOCK})', re.I)


def parse(text, timezone, now=None):
    hebrew = bool(re.search('[א-ת]', text))
    question = 'באיזה תאריך ושעה להזכיר לך?' if hebrew else 'What date and time should I remind you?'
    unclear = {'question': question}
    if not isinstance(text, str) or not 1 <= len(text) <= 2000:
        return unclear
    raw = TRIGGER.sub('', text.strip()).strip()
    # Both "tomorrow at 9 to call" and "to call tomorrow at 9" are supported.
    if raw.lower().startswith('to '):
        split = re.search(rf'\s+((?:on\s+)?{DAY}|{RELATIVE}|at\s+)', raw, re.I)
        if not split:
            return unclear
        body, schedule = raw[3:split.start()].strip(), raw[split.start():].strip()
        matched = SCHEDULE.fullmatch(schedule)
    else:
        matched = SCHEDULE.match(raw)
        if not matched:
            return unclear
        schedule = matched.group().strip()
        body = raw[matched.end():].strip()
        body = re.sub(r'^[\s:,\-\u2013]*(?:to\s+)?', '', body, flags=re.I)
    if not matched or not body or re.match(r'^(?:at\b|on\b|morning\b|evening\b|בשעה\b|בבוקר\b|בערב\b|\d)', body):
        return unclear
    zone = ZoneInfo(timezone)
    instant = (now or datetime.now(UTC)).astimezone(zone)
    lowered = schedule.lower()
    if re.fullmatch(RELATIVE, lowered):
        numbers = re.search(r'\d+', lowered)
        amount = int(numbers.group()) if numbers else (2 if 'שעתיים' in lowered else 1)
        if not 1 <= amount <= 525600:
            return unclear
        hours = 'hour' in lowered or any(word in lowered for word in ('שעות', 'שעה', 'שעתיים'))
        due = instant.astimezone(UTC) + timedelta(minutes=amount * (60 if hours else 1))
    else:
        day = instant.date()
        explicit_day = re.search(DAY, lowered)
        if explicit_day:
            value = explicit_day.group().removeprefix('next ')
            if value in ('tomorrow', 'מחר'):
                day += timedelta(days=1)
            elif value in DAYS:
                day += timedelta(days=(DAYS[value] - day.weekday()) % 7 or 7)
            elif re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
                try: day = date.fromisoformat(value)
                except ValueError: return unclear
            elif '/' in value:
                # Slash dates are locale-ambiguous unless the day exceeds 12.
                d, m, y = map(int, value.split('/'))
                if d <= 12: return unclear
                try: day = date(y, m, d)
                except ValueError: return unclear
            lowered = lowered[:explicit_day.start()] + lowered[explicit_day.end():]
        token = re.search(CLOCK, lowered, re.I)
        if not token:
            return unclear
        value = token.group().lower()
        periods = {'morning': (9, 0), 'בבוקר': (9, 0), 'evening': (18, 0), 'בערב': (18, 0),
                   'noon': (12, 0), 'צהריים': (12, 0), 'midnight': (0, 0)}
        if value in periods:
            hour, minute = periods[value]
        else:
            match = re.fullmatch(r'(\d{1,2})(?::(\d{2}))?\s*([ap]m)?', value)
            hour, minute = int(match[1]), int(match[2] or 0)
            if match[3]:
                if not 1 <= hour <= 12: return unclear
                hour = hour % 12 + (12 if match[3] == 'pm' else 0)
            if hour > 23 or minute > 59: return unclear
        local = datetime.combine(day, time(hour, minute), zone)
        # Gaps and folds require a person choice instead of silently shifting.
        if local.utcoffset() != local.replace(fold=1).utcoffset(): return unclear
        due = local.astimezone(UTC)
        if due <= instant.astimezone(UTC): return unclear
    return {'body': body, 'due_at': due.isoformat(), 'timezone': timezone,
            'time_label': due.astimezone(zone).strftime('%Y-%m-%d %H:%M') + ' ' + timezone}
