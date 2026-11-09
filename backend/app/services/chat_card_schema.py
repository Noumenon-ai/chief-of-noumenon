"""Credential-free conversation tool metadata for engine shims."""
TOOLS = ('ask_question', 'suggest_connect', 'offer_daily_brief')
QUESTION_RULE = 'Whenever you offer two to five options or need a yes or no, use the ask_question card tool instead of a plain list. Never use a question card as authorization or as a substitute for an approval.'
NOTE = (QUESTION_RULE + ' Use suggest_connect with a local catalog provider ID when an app is missing or the person asks to connect it. '
        'Suggestions grant nothing. Never request credentials in chat. offer_daily_brief offers an optional morning brief once. '
        'After showing a card, end your turn and wait. The person’s answer arrives as their next message. Without these tools ask in plain text.')


def definitions():
    def schema(properties, required):
        return {'type': 'object', 'properties': properties, 'required': required, 'additionalProperties': False}
    return [
        {'name': 'ask_question', 'description': QUESTION_RULE + ' Show clickable choices in chat. End this turn after the card.', 'inputSchema': schema({'question': {'type': 'string', 'minLength': 1, 'maxLength': 400}, 'options': {'type': 'array', 'minItems': 2, 'maxItems': 5, 'items': {'type': 'string', 'minLength': 1, 'maxLength': 200}}}, ['question', 'options'])},
        {'name': 'suggest_connect', 'description': 'Suggest connecting a local catalog app by provider ID, such as gmail or googlecalendar. Grants nothing; never include credentials. End this turn after the card.', 'inputSchema': schema({'provider': {'type': 'string', 'maxLength': 200}}, ['provider'])},
        {'name': 'offer_daily_brief', 'description': 'Offer a daily read-only brief at 8 in the person’s time zone, once when relevant after answering. Does not enable it. End this turn after the card.', 'inputSchema': schema({}, [])},
    ]

