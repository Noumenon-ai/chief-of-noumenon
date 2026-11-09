"""Workspace tools and the same scoped MCP launches used by CLI engines."""
import asyncio
import json
import os
from pathlib import Path
import signal
import sys

from app.core import app_settings, turn_sandbox, engine_processes
from app.core.config import settings
from app.services.workspace_tool_worker import parts
from app.services.local_claude_stream import summarize_tool
from app.services.local_approval_broker import MAX_REVIEWABLE_INPUT_CHARS

MAX_RESULT = 24_000
from app.services.workspace_schema import FIELDS, definitions


def bounded(value):
    text = json.dumps(value, ensure_ascii=False)
    return json.dumps({'untrusted_tool_data': text[:MAX_RESULT], 'truncated': len(text) > MAX_RESULT}, ensure_ascii=False)


async def kill(proc):
    try:
        if os.name == 'posix':
            os.killpg(proc.pid, signal.SIGKILL)
        elif proc.returncode is None:
            proc.kill()
    except ProcessLookupError:
        pass
    await proc.communicate()
    engine_processes.forget(proc.pid)


class Tools:
    def __init__(self, ctx, sink, gate):
        self.ctx, self.sink, self.gate = ctx, sink, gate
        self.catalog = definitions() if ctx.agent_id is not None and ctx.workspace and app_settings.get('LOCAL_TOOLS_ENABLED') and not ctx.draft_only and not ctx.media_review_only else []
        if ctx.computer is not None:
            self.catalog = []
        self.clients = {}
        self.boxed = False
        self.checked = False
        self.require_sandbox = False

    async def __aenter__(self):
        try:
            for server in ('memory', 'team', 'composio', 'community', 'computer'):
                launch = self.ctx.computer.launch if server == 'computer' and self.ctx.computer is not None else getattr(self.ctx, server + '_launch', None)
                if launch is None:
                    continue
                client = McpClient(launch)
                self.clients[server] = client
                await client.start()
                tools = (await client.request('tools/list', {})).get('tools', [])
                if not isinstance(tools, list) or len(tools) > 256:
                    raise ValueError('MCP returned an invalid tool catalog.')
                for tool in tools:
                    name = f"mcp__{server}__{tool['name']}"
                    self.catalog.append({'type': 'function', 'function': {'name': name,
                        'description': tool.get('description', '')[:4000], 'parameters': tool['inputSchema']}})
            return self
        except BaseException:
            await self.__aexit__(None, None, None)
            raise

    async def __aexit__(self, *unused):
        for client in self.clients.values():
            await client.close()

    def validate(self, name, args):
        if name not in {t['function']['name'] for t in self.catalog}:
            raise ValueError(f'Unknown tool: {name}. No call was executed.')
        if not isinstance(args, dict) or len(json.dumps(args, ensure_ascii=False)) > MAX_REVIEWABLE_INPUT_CHARS:
            raise ValueError('Malformed or oversized tool arguments. No call was executed.')
        if name in FIELDS:
            if set(args) != set(FIELDS[name]) or any(not isinstance(v, str) for v in args.values()):
                raise ValueError(f'Malformed arguments for {name}. No call was executed.')
            if 'path' in args:
                parts(args['path'])
            if 'pattern' in args:
                parts(args['pattern'])

    async def call(self, identifier, name, args):
        self.validate(name, args)
        if self.ctx.aborted or self.sink.lost:
            raise asyncio.CancelledError
        tool = 'api__' + name if name in FIELDS else name
        handle = await self.gate.open(request_id=identifier, tool=tool, input=args,
                                      summary=summarize_tool(tool, args), kind='command' if name == 'shell' else 'tool')
        if handle is None:
            raise asyncio.CancelledError
        try:
            decision = await self.gate.decide(handle)
        except BaseException:
            await self.gate.cancel(identifier)
            raise
        if decision.kind != 'allow':
            return bounded({'error': decision.message or 'Tool denied. Nothing was executed.'})
        if self.ctx.aborted or self.sink.lost:
            raise asyncio.CancelledError
        if not await self.sink.emit('tool.started', {'name': tool, 'input': args, 'call_id': identifier, 'summary': name}):
            raise asyncio.CancelledError
        if name in FIELDS:
            result = await self.local(name, args)
        else:
            _, server, local_name = name.split('__', 2)
            if server == 'computer':
                from app.computers import grants
                grants.issue(self.ctx.computer.grants_dir, local_name, args)
            result = await self.clients[server].request('tools/call', {'name': local_name, 'arguments': args})
        await self.sink.emit('tool.completed', {'call_id': identifier, 'ok': not bool(result.get('error') or result.get('isError') or result.get('exit_code')), 'output': bounded(result)})
        return bounded(result)

    async def local(self, name, args):
        if self.ctx.approval_mode == 'plan' and name in ('write', 'edit', 'shell'):
            return {'error': 'Plan mode is read only. Nothing was executed.'}
        if not self.checked:
            self.checked = True
            try:
                result = await asyncio.to_thread(turn_sandbox.self_check)
                self.boxed = result['status'] == 'available'
            except turn_sandbox.SandboxUnavailable:
                self.boxed = False
        if self.require_sandbox and not self.boxed:
            return {'error': 'Workspace tools require the Linux turn sandbox. Nothing was executed.'}
        if name == 'shell' and not self.boxed and (not settings.API_UNSANDBOXED_SHELL or settings.TURN_SANDBOX_NETWORK_ENABLED):
            return {'error': 'Shell refused: the turn sandbox is unavailable. The owner must explicitly enable API_UNSANDBOXED_SHELL to use host shell.'}
        workspace = self.ctx.workspace
        if name in ('read', 'glob', 'grep'):
            key = 'path' if name == 'read' else 'pattern'
            if args[key].startswith('__notes__/') and self.ctx.agent_id is not None:
                from app.services.agent_memory import agent_home
                workspace = agent_home(self.ctx.agent_id)
                args = {**args, key: args[key].removeprefix('__notes__/')}
                parts(args[key])
        env = {'PATH': os.defpath, 'HOME': '/tmp/chief-workspace-home', 'LANG': 'C.UTF-8'}
        if name == 'shell':
            argv, payload = ['/bin/sh', '-c', args['command']], None
        else:
            argv = [sys.executable, '-I', str(Path(__file__).with_name('workspace_tool_worker.py'))]
            payload = json.dumps({'workspace': str(workspace), 'name': name, 'arguments': args}, ensure_ascii=False).encode()
        if self.boxed:
            argv = turn_sandbox.command(argv, cwd=workspace, env=engine_processes.mark(env),
                                        workspace_readonly=self.ctx.approval_mode == 'plan', tool_worker=True)
        proc = await asyncio.create_subprocess_exec(*argv, cwd=workspace, env=engine_processes.mark(env),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            start_new_session=True)
        engine_processes.record(proc.pid, argv[0])
        try:
            if payload:
                proc.stdin.write(payload)
                await proc.stdin.drain()
            proc.stdin.close()
            output = b''
            while len(output) <= MAX_RESULT:
                chunk = await proc.stdout.read(min(4096, MAX_RESULT + 1 - len(output)))
                if not chunk:
                    break
                output += chunk
            if len(output) > MAX_RESULT:
                return {'output': output[:MAX_RESULT].decode('utf-8', 'replace'), 'truncated': True}
            await proc.wait()
            return json.loads(output) if name != 'shell' and proc.returncode == 0 else {'output': output.decode('utf-8', 'replace'), 'exit_code': proc.returncode}
        finally:
            await kill(proc)


class McpClient:
    def __init__(self, launch):
        self.launch, self.proc, self.serial = launch, None, 0

    async def start(self):
        self.proc = await asyncio.create_subprocess_exec(self.launch.command, *self.launch.args,
            env=engine_processes.mark({'PATH': os.defpath, **self.launch.env}), stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            limit=1_000_000, start_new_session=True)
        engine_processes.record(self.proc.pid, self.launch.command)
        await self.request('initialize', {'protocolVersion': '2025-06-18', 'capabilities': {},
                                         'clientInfo': {'name': 'chief-api-engine', 'version': '1'}})
        self.proc.stdin.write(b'{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
        await self.proc.stdin.drain()

    async def request(self, method, params):
        self.serial += 1
        self.proc.stdin.write((json.dumps({'jsonrpc': '2.0', 'id': self.serial, 'method': method, 'params': params}) + '\n').encode())
        await self.proc.stdin.drain()
        while True:
            line = await self.proc.stdout.readline()
            if not line:
                raise ValueError('The scoped MCP server stopped.')
            message = json.loads(line)
            if message.get('id') == self.serial:
                if 'error' in message:
                    raise ValueError('The scoped MCP server refused the request.')
                return message['result']

    async def close(self):
        if self.proc:
            await kill(self.proc)
