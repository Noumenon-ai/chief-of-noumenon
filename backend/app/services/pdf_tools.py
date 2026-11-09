"""Backend-only PDF runner: a scoped worker after the shared one-use gate."""
import asyncio
import json
import os
from pathlib import Path
import sys

from app.core import engine_processes, turn_sandbox
from app.services import pdf_contract as contract
from app.services.api_tools import kill


async def call(run, name, arguments):
    try:
        contract.validate(name, arguments)
    except Exception:
        return {'error': 'Invalid PDF arguments. Check the tool schema and use relative paths in this bot folder.'}
    if run.ctx.approval_mode == 'plan' and name in contract.WRITES:
        return {'error': 'Plan mode is read only; no PDF was written.'}
    if run.ctx.workspace is None or run.agent_id is None or run.ctx.aborted:
        return {'error': 'No active bot folder is available.'}
    return await process(run.ctx.workspace, name, arguments, run.ctx.approval_mode)


async def process(workspace, name, args, mode='ask'):
    env = engine_processes.mark({'PATH': os.defpath, 'HOME': str(Path.home()), 'LANG': 'C.UTF-8'})
    argv = [sys.executable, '-I', str(Path(__file__).with_name('pdf_worker.py'))]
    try:
        argv, _ = await asyncio.to_thread(turn_sandbox.prepare, argv, cwd=workspace, env=env,
                                          workspace_readonly=name in contract.READS or mode == 'plan')
    except turn_sandbox.SandboxUnavailable:
        return {'error': 'PDF processing refused: the configured turn sandbox is unavailable.'}
    payload = json.dumps(dict(workspace=str(workspace), name=name, args=args, mode=mode)).encode()
    proc = await asyncio.create_subprocess_exec(*argv, cwd=workspace, env=env,
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        start_new_session=True)
    engine_processes.record(proc.pid, argv[0])
    try:
        async with asyncio.timeout(contract.TIMEOUT):
            proc.stdin.write(payload)
            await proc.stdin.drain()
            proc.stdin.close()
            output = await proc.stdout.read(64001)
            if len(output) > 64000:
                return {'error': 'PDF result exceeded the processing limit.'}
            # read(n) can return early; drain to EOF without allowing unbounded output.
            while chunk := await proc.stdout.read(64001 - len(output)):
                output += chunk
                if len(output) > 64000:
                    return {'error': 'PDF result exceeded the processing limit.'}
            await proc.wait()
            if proc.returncode:
                return {'error': 'PDF processing exceeded its limits or could not complete. Check the new output before retrying.'}
            return json.loads(output)
    except TimeoutError:
        return {'error': 'PDF processing timed out. Check the new output before retrying.'}
    except (ValueError, BrokenPipeError):
        return {'error': 'PDF processing could not complete.'}
    finally:
        await kill(proc)
