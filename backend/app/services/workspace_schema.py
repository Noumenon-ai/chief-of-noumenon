"""Tool metadata only; safe to import inside credential-free MCP shims."""
FIELDS = {
    'read': ('path',), 'write': ('path', 'content'),
    'edit': ('path', 'old_text', 'new_text'), 'glob': ('pattern',),
    'grep': ('text', 'pattern'), 'shell': ('command',),
}


def definitions():
    return [{'type': 'function', 'function': {
        'name': name, 'description': ('Run a shell command in the agent workspace. For notes and file inspection use read, glob or grep instead; shell still requires approval. Paths outside your own folder, including home and parent escapes even in strings, are refused. Use your own folder or a connected app instead.' if name == 'shell' else
                                     f'{name.title()} workspace files, including MEMORY.md and memory/ notes in your own folder. Paths must be relative; symlinks are refused.'),
        'parameters': {'type': 'object', 'properties': {key: {'type': 'string'} for key in fields},
                       'required': list(fields), 'additionalProperties': False},
    }} for name, fields in FIELDS.items()]

