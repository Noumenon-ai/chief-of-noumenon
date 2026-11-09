"""Bound Gmail MIME before credential cleaning; never pass encoded parts or raw HTML."""
import base64
import binascii
from html.parser import HTMLParser
import re
from urllib.parse import urlsplit

MAX_BODY = 12000
MAX_PARTS = 100
MAX_MESSAGES = 30
HEADERS = frozenset(('from', 'to', 'subject', 'date', 'reply-to', 'message-id'))
FIELDS = ('id', 'threadId', 'snippet', 'internalDate', 'labelIds', 'historyId', 'sizeEstimate')


MAX_HTML = MAX_BODY * 10


class HTMLLimit(Exception):
    pass


class PlainHTML(HTMLParser):
    """Bounded, non-rendering text projection. Attributes never become body text."""
    VOID = frozenset(('area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'))
    BLOCK = frozenset(('p', 'div', 'br', 'li', 'tr', 'td', 'h1', 'h2', 'h3', 'hr', 'section'))

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.hidden = 0
        self.chunks = []
        self.size = 0
        self.text_size = 0

    def emit(self, text):
        text = text[:MAX_BODY - self.size]
        self.chunks.append(text)
        self.size += len(text)

    def handle_starttag(self, tag, attrs):
        if len(self.stack) >= 256:
            raise HTMLLimit
        attrs = dict(attrs)
        style = re.sub(r'\s+', '', attrs.get('style') or '').lower()
        hidden = tag in ('script', 'style', 'head', 'template') or 'hidden' in attrs or (attrs.get('aria-hidden') or '').lower() == 'true' or 'display:none' in style or 'visibility:hidden' in style
        host = ''
        if tag == 'a' and not self.hidden and not hidden:
            try:
                url = urlsplit(attrs.get('href') or '')
                if url.scheme in ('http', 'https') and url.hostname:
                    host = url.hostname[:253]
            except ValueError:
                pass
        if not self.hidden and not hidden and tag in self.BLOCK:
            self.emit(' ')
        if tag not in self.VOID:
            self.stack.append((tag, hidden, host, self.text_size))
            self.hidden += hidden

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        # A malformed close may end intervening elements, but never reveals
        # content that was suppressed while those elements were open.
        index = next((i for i in range(len(self.stack) - 1, -1, -1) if self.stack[i][0] == tag), None)
        if index is not None:
            for _, hidden, host, start in self.stack[index:]:
                self.hidden -= hidden
                if host and not self.hidden and self.text_size > start:
                    self.emit(' (' + host + ') ')
            del self.stack[index:]
        if not self.hidden and tag in self.BLOCK:
            self.emit(' ')

    def handle_data(self, data):
        if not self.hidden:
            # Data URLs have no readable mail content, even when printed as text.
            data = re.sub(r'data:[^\s<>]+', '', data, flags=re.I)
            self.text_size += len(data.strip())
            self.emit(data)


def html_text(text):
    parser = PlainHTML()
    truncated = len(text) > MAX_HTML
    try:
        parser.feed(text[:MAX_HTML])
        parser.close()
    except HTMLLimit:
        truncated = True
    return ' '.join(''.join(parser.chunks).split())[:MAX_BODY], truncated or parser.size >= MAX_BODY


def message(value):
    if not isinstance(value, dict):
        return {}
    result = {k: value[k] for k in FIELDS if k in value}
    payload = value.get('payload')
    texts, html, remaining, html_remaining, visited = [], [], MAX_BODY, MAX_HTML, 0

    def walk(part, depth=0):
        nonlocal remaining, html_remaining, visited
        if not isinstance(part, dict) or depth > 10 or visited >= MAX_PARTS or remaining <= 0:
            return
        visited += 1
        body = part.get('body') or {}
        if part.get('filename') or not isinstance(body, dict) or body.get('attachmentId'):
            return
        if part.get('mimeType') in ('text/plain', 'text/html'):
            is_plain = part.get('mimeType') == 'text/plain'
            limit = remaining if is_plain else html_remaining
            encoded = body.get('data')
            if isinstance(encoded, str):
                # Decode only a prefix aligned to base64 groups. No attachment
                # decoding and no full-body allocation, even for a giant part.
                encoded = encoded[:((limit * 4 + 2) // 3 + 4)]
                encoded = encoded[:len(encoded) - len(encoded) % 4] if len(encoded) % 4 == 1 else encoded
                try:
                    text = base64.urlsafe_b64decode(encoded + '=' * (-len(encoded) % 4)).decode('utf-8', 'replace')[:limit]
                except (ValueError, binascii.Error):
                    return
                if is_plain:
                    texts.append(text)
                    remaining -= len(text)
                else:
                    html.append(text)
                    html_remaining -= len(text)
        for child in (part.get('parts') or [])[:MAX_PARTS]:
            walk(child, depth + 1)

    if isinstance(payload, dict):
        headers = payload.get('headers') or []
        result['payload'] = {'headers': [
            {'name': h['name'][:100], 'value': str(h.get('value', ''))[:1000]}
            for h in headers[:100] if isinstance(h, dict) and isinstance(h.get('name'), str) and h['name'].lower() in HEADERS
        ]}
        walk(payload)
    html_truncated = False
    if not texts and html:
        text, html_truncated = html_text(' '.join(html))
        texts = [text]
        html_truncated = html_truncated or html_remaining == 0
        remaining = MAX_BODY - len(text)
    if texts:
        result['messageText'] = '\n'.join(texts)[:MAX_BODY]
        result['body_truncated'] = remaining == 0 or html_truncated or visited >= MAX_PARTS
    else:
        result['body_status'] = 'No readable body available; attachments omitted.'
    return result


def project(value, depth=0):
    if depth > 10:
        return '[bounded]'
    if isinstance(value, list):
        return [project(item, depth + 1) for item in value[:MAX_MESSAGES]]
    if not isinstance(value, dict):
        return value[:MAX_BODY] if isinstance(value, str) else value
    if 'payload' in value or 'snippet' in value or 'raw' in value:
        return message(value)
    # Preserve list/thread/draft wrappers and non-message Gmail metadata. All
    # nested messages still pass through the MIME projection above. Attachment
    # endpoints have a bare base64 data field, which is always discarded.
    return {key: project(item, depth + 1) for key, item in list(value.items())[:100]
            if key not in ('data', 'body', 'parts', 'html', 'messageText', 'attachments')}
