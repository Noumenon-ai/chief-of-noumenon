"""Credential-free shim: cannot execute shell or file operations itself."""
import argparse
import json
import sys

from app.composio_mcp_server import Server as Mailbox
from app.services.workspace_schema import definitions


class Server(Mailbox):
    def __init__(self, mailbox, chat_cards=False):
        super().__init__(mailbox, {})
        self.tools = [{'name': t['function']['name'], 'description': t['function']['description'],
                       'inputSchema': t['function']['parameters']} for t in definitions()]
        if chat_cards:
            from app.services.chat_card_schema import definitions as cards
            self.tools.extend(cards())
        self.names = {tool['name'] for tool in self.tools}

    def handle(self, message):
        if message.get('id') is not None and message.get('method') == 'tools/call':
            params = message.get('params') or {}
            result = self.call(params.get('name'), params.get('arguments') or {})
            if 'content' not in result:
                result = {'isError': True, 'content': [{'type': 'text', 'text': 'Workspace request failed.'}]}
            return {'jsonrpc': '2.0', 'id': message['id'], 'result': result}
        return super().handle(message)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mailbox', required=True)
    parser.add_argument('--chat-cards', action='store_true')
    args = parser.parse_args()
    server = Server(args.mailbox, args.chat_cards)
    for line in sys.stdin:
        try:
            result = server.handle(json.loads(line))
            if result is not None:
                print(json.dumps(result), flush=True)
        except (ValueError, OSError, TypeError):
            continue


if __name__ == '__main__':
    main()
