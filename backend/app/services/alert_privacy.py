"""Conservative plain-text alert redaction, before truncation and transport."""
import re
import unicodedata
from app.services.agent_memory import redact_secrets


def redact_alert(value, limit=2000):
    if not isinstance(value, str):
        return 'Details unavailable'
    text = unicodedata.normalize('NFKC', value)
    text = ''.join(c for c in text if not unicodedata.category(c).startswith('C') or c in '\n\t')
    text, secrets = redact_secrets(text)
    if secrets:
        return 'Sensitive details withheld'
    text = re.sub(r'<[^>]*>', ' ', text)
    text = re.sub(r'(?:https?://|www\.)\S+|[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}', '[private link or address]', text)
    # Labelled alphanumeric security codes, including Hebrew. Keep the label.
    text = re.sub(r'((?:otp|code|passcode|one[- ]time (?:code|password)|verification code|קוד(?:\s+(?:אימות|חד[- ]פעמי))?)\s*(?:(?:is|הוא)\s*|[:#=-]\s*)?)([A-Z0-9][A-Z0-9 .-]{2,18}[A-Z0-9])',
                  lambda m: m[1] + '[code hidden]', text, flags=re.I)
    # Conservatively redact any 4+ digit run, including grouping, country prefixes,
    # Unicode digits, local phones, cards, SSNs and Israeli identity numbers.
    text = re.sub(r'(?<!\d)\+?\(?\d(?:[\s()./\-־–]*\d){3,20}\)?(?!\d)', '[number hidden]', text)
    return text.strip()[:limit] or 'Details unavailable'
