"""A refusal-only preflight; this never grants permission to run a command."""
from pathlib import Path
import re
import shlex

REASON = 'Shell paths must stay in your own folder. Use your own folder or a connected app instead.'
SYSTEM = (Path('/usr'), Path('/bin'), Path('/sbin'), Path('/lib'), Path('/lib64'))
DEVICES = {'/dev/null', '/dev/zero', '/dev/random', '/dev/urandom', '/dev/stdin', '/dev/stdout', '/dev/stderr'}
PATH_PATTERN = re.compile(r"(?<![\w/])(?:~[^\s;|&<>\"'`)]*|/(?:[^\s;|&<>\"'`)]*)|(?:\./|\.\./)[^\s;|&<>\"'`)]*|\.\.(?=$|[\s;|&<>\"'`)]))")


def outside(command, workspace):
    if not isinstance(command, str):
        return False  # malformed inputs retain their existing validation/decision
    if re.search(r"\$(?:HOME\b|\{HOME\}|USERPROFILE\b|\{USERPROFILE\})", command):
        return True
    root = Path(workspace).resolve() if workspace is not None else None
    try:
        tokens = shlex.split(command, posix=True)
    except ValueError:
        # Unreadable commands never get a more permissive decision.
        return True
    candidates = []
    for token in tokens:
        # Web URLs are not filesystem paths; their existing approval and
        # network restrictions still apply. File URLs remain subject to refusal.
        token = re.sub(r"https?://[^\s\"'<>|;&`$()]+", "", token)
        if token.startswith(('/', '~', './', '../')) and not any(c in token for c in ';|&<>`()'):
            candidates.append(token)
            candidates.extend(m.group() for m in PATH_PATTERN.finditer(token) if m.start() > 0)
        else:
            candidates.extend(m.group() for m in PATH_PATTERN.finditer(token))
        # Also inspect parent segments embedded in a relative path.
        if '/' in token and '..' in token.split('/'):
            candidates.append(token.split('=', 1)[-1])
    for raw in candidates:
        if raw in DEVICES:
            continue
        if raw.startswith('~'):
            return True
        path = Path(raw)
        if not path.is_absolute() and root is None:
            return True
        try:
            path = (path if path.is_absolute() else root / path).resolve()
        except (OSError, RuntimeError, ValueError):
            return True
        if root is not None and (path == root or root in path.parents):
            continue
        if any(path == base.resolve() or base.resolve() in path.parents for base in SYSTEM):
            continue
        if str(path) in DEVICES:
            continue
        return True
    return False
