"""Owner-triggered build of the bundled desktop image, with bounded progress."""
import asyncio
from pathlib import Path

from app.computers import docker_cli
from app.computers.provider import ComputerError


class ImageBuild:
    def __init__(self):
        self.task = None
        self.status = "idle"
        self.output = ""

    def snapshot(self):
        return {"status": self.status, "output": self.output}

    def start(self, docker=None):
        if self.task is None or self.task.done():
            from app.core import host_exec
            host_exec.ensure_allowed("building the desktop image")
            executable = docker or docker_cli.docker_executable()
            if not executable:
                raise ComputerError("Install Docker Engine or Docker Desktop, then start Docker and retry.", "docker_missing")
            context = Path(__file__).resolve().parents[3] / "desktop-image"
            if not (context / "Dockerfile").is_file():
                raise ComputerError("The bundled desktop-image folder is missing. Reinstall Chief of Noumenon from the complete source package.", "image_missing")
            self.status, self.output = "building", "Building the bundled desktop image. The first build downloads dependencies.\n"
            self.task = asyncio.create_task(self.run(executable, context))
        return self.snapshot()

    async def run(self, executable, context):
        proc = None
        try:
            # No client-supplied image, context, options, command or shell.
            proc = await asyncio.create_subprocess_exec(
                str(executable), "build", "--progress=plain", "-t", docker_cli.DESKTOP_IMAGE, str(context),
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            )
            async with asyncio.timeout(1800):
                while chunk := await proc.stdout.read(4096):
                    self.output = (self.output + chunk.decode("utf-8", "replace"))[-8000:]
                code = await proc.wait()
            self.status = "succeeded" if code == 0 else "failed"
            self.output += f"\nBuild exited with code {code}."
        except (OSError, TimeoutError):
            self.status = "failed"
            self.output += "\nBuild failed or timed out. Check that Docker is installed and running, then retry."
        finally:
            if proc is not None and proc.returncode is None:
                proc.kill()
                await proc.wait()
