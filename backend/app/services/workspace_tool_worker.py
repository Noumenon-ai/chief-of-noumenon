"""Trusted file operations, also used inside the turn sandbox.

Open every component relative to an already-open directory with O_NOFOLLOW.
Neither a symlink swap nor a traversal can redirect an operation outside it.
"""
import fnmatch
import json
import os
from pathlib import PurePosixPath
import stat
import sys

LIMIT = 24_000


def parts(value):
    if not isinstance(value, str) or not value or '\\' in value or '\0' in value:
        raise ValueError('Use a relative workspace path.')
    path = PurePosixPath(value)
    if path.is_absolute() or '..' in path.parts:
        raise ValueError('Path must stay inside the agent workspace.')
    return path.parts


def open_file(root, path, flags):
    names = parts(path)
    if not names:
        raise ValueError('Choose a file.')
    parent = os.dup(root)
    try:
        for name in names[:-1]:
            if flags & os.O_CREAT:
                try:
                    os.mkdir(name, 0o700, dir_fd=parent)
                except FileExistsError:
                    pass
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            os.close(parent)
            parent = child
        fd = os.open(names[-1], flags | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=parent)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            os.close(fd)
            raise ValueError('Only regular, unlinked workspace files are allowed.')
        return fd
    finally:
        os.close(parent)


def execute(workspace, name, args):
    if not hasattr(os, 'O_NOFOLLOW') or os.open not in os.supports_dir_fd:
        raise ValueError('Secure file tools are unavailable on this platform.')
    root = os.open(workspace, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        if name in ('read', 'write', 'edit'):
            flags = os.O_RDONLY if name == 'read' else os.O_RDWR | (os.O_CREAT if name == 'write' else 0)
            fd = open_file(root, args['path'], flags)
            with os.fdopen(fd, 'rb' if name == 'read' else 'r+b') as file:
                if name == 'read':
                    data = file.read(LIMIT + 1)
                    return {'text': data[:LIMIT].decode('utf-8', 'replace'), 'truncated': len(data) > LIMIT}
                content = args.get('content')
                if name == 'edit':
                    data = file.read(1_000_001)
                    if len(data) > 1_000_000:
                        raise ValueError('File is too large to edit.')
                    content = data.decode('utf-8')
                    old = args['old_text']
                    if not old or content.count(old) != 1:
                        raise ValueError('old_text must match exactly once.')
                    content = content.replace(old, args['new_text'], 1)
                file.seek(0)
                file.write(content.encode('utf-8'))
                file.truncate()
                return {'written': args['path']}
        pattern = args.get('pattern', '*')
        parts(pattern)
        result, scanned, size = [], 0, 0
        # fwalk uses directory descriptors and does not follow symlinks.
        for folder, dirs, files, parent in os.fwalk('.', dir_fd=root, follow_symlinks=False):
            dirs[:] = sorted(dirs)[:200]
            for filename in sorted(files):
                scanned += 1
                if scanned > 10000 or size >= LIMIT or len(result) >= 200:
                    return {'matches': result, 'truncated': True}
                relative = (folder[2:] + '/' if folder != '.' else '') + filename
                if not (fnmatch.fnmatchcase(relative, pattern) or (pattern.startswith('**/') and fnmatch.fnmatchcase(relative, pattern[3:]))):
                    continue
                try:
                    fd = open_file(root, relative, os.O_RDONLY)
                    with os.fdopen(fd, 'rb') as file:
                        if name == 'glob':
                            result.append(relative)
                            size += len(relative)
                        else:
                            for number, line in enumerate(file.read(LIMIT).decode('utf-8', 'replace').splitlines(), 1):
                                if args['text'] in line:
                                    hit = {'path': relative, 'line': number, 'text': line[:1000]}
                                    result.append(hit)
                                    size += len(json.dumps(hit))
                                    if size >= LIMIT or len(result) >= 200:
                                        return {'matches': result, 'truncated': True}
                except OSError:
                    continue
        return {'matches': result, 'truncated': False}
    finally:
        os.close(root)


if __name__ == '__main__':
    try:
        request = json.loads(sys.stdin.buffer.read(256_001))
        result = execute(request['workspace'], request['name'], request['arguments'])
    except (OSError, ValueError, KeyError, TypeError) as exc:
        result = {'error': f'File tool refused: {exc}'}
    print(json.dumps(result))
