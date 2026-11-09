from types import SimpleNamespace
import pytest
from app.services.shell_paths import outside
from app.services.tool_policy import automatic


@pytest.mark.parametrize('command,denied', [
    ('echo "/usr/bin /outside/private"', True),
    ('curl https://example.test/path;/outside/program', True),
    ('curl https://example.test/path', False), ('cat file:///other/file', True),
    ('ls README.md', False), ('cat /bots/own/README.md', False),
    ('cd /home/user/projects/app && ls -la && head -c 4000 README*', True),
    ('ls $HOME/files', True), ('ls ${HOME}/files', True),
    ('ls ~', True), ('ls ~/files', True), ('cat ../other/file', True),
    ('cat sub/../../other', True), ('cat sub/../README', False),
    ('cat "/bots/own/a file"', False), ('cat "/outside/a file"', True),
    ('echo "only mentioning /outside/file"', True), ('echo /bots/own-other/file', True),
    ('/usr/bin/printf ok > /dev/null', False), ('cat /usr/../etc/passwd', True),
    ('echo "../outside"', True), ('cat ./../outside', True),
])
def test_shell_refusal_only(command, denied):
    assert outside(command, '/bots/own') == denied
    run = SimpleNamespace(ctx=SimpleNamespace(workspace='/bots/own', computer=SimpleNamespace(guest_workspace='/bots/own'), team=None, draft_only=False))
    for tool in ('Bash', 'api__shell', 'mcp__computer__exec'):
        result = automatic(tool, 'ask', run, {'command': command})
        if denied:
            assert result == ('denied', 'shell_outside_workspace')
        else:
            assert result is None


def test_shell_paths_refuse_symlink_escape(tmp_path):
    root = tmp_path / 'own'; root.mkdir()
    other = tmp_path / 'other'; other.mkdir()
    (root / 'link').symlink_to(other, target_is_directory=True)
    assert outside(f'cat {root}/link/file', root)
