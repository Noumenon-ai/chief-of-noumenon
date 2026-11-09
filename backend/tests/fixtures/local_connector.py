"""Test-only connector with a provider backed by the fixture's loopback HTTP server."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'connector/server'))
import httpx
from app.providers.base import Action, Provider
from app.providers.registry import registry
from main import app


class FakeAction(Action):
    def __init__(self, name, operation):
        super().__init__('testapp.' + name, name, name, {'type': 'object', 'properties': {'text': {'type': 'string'}}, 'additionalProperties': False})
        self.operation = operation

    def to_dict(self):
        return {**super().to_dict(), 'operationType': self.operation}

    async def execute(self, input_data, credential, client):
        async with httpx.AsyncClient(trust_env=False) as http:
            result = await http.post(os.environ['FAKE_PROVIDER_URL'] + '/' + self.name,
                                     headers={'Authorization': 'Bearer ' + credential['apiKey']}, json=input_data)
            result.raise_for_status()
            return result.json()


class FakeProvider(Provider):
    def __init__(self):
        super().__init__('testapp', 'Test app', 'Productivity', ['api_key'])
        for name, operation in [('list_items', 'read'), ('create_item', 'write'), ('send_message', 'read'),
                                ('unknown', None), ('charge', 'write')]:
            self.register_action(FakeAction(name, operation))

    async def validate_credentials(self, credential, client):
        async with httpx.AsyncClient(trust_env=False) as http:
            result = await http.get(os.environ['FAKE_PROVIDER_URL'], headers={'Authorization': 'Bearer ' + credential['apiKey']})
        if result.status_code != 200:
            raise ValueError('Invalid fake credential')
        return result.json()


registry.register(FakeProvider())
if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=int(sys.argv[1]), access_log=False, log_level='error')
