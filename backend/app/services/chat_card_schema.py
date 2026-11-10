"""Credential-free conversation tool metadata for engine shims."""
TOOLS = ('ask_question', 'suggest_connect', 'offer_daily_brief', 'prepare_call')
CALL_RULE = ('Use prepare_call when the owner asks to call a business or person, for example to book a table or move an appointment. '
             'It only prepares a card: the owner opens their phone dialer, places the call himself using his own number, and talks. '
             'The bot never dials or talks on the call; no telephony service is used and no call data is sent. '
             'Never invent a phone number. Get it from the owner, his contacts or a web lookup, and state the source in purpose or details. '
             'Do not use short codes or emergency numbers; the owner dials those himself.')
QUESTION_RULE = 'Whenever you offer two to five options or need a yes or no, use the ask_question card tool instead of a plain list. Never use a question card as authorization or as a substitute for an approval.'
NOTE = (QUESTION_RULE + ' Use suggest_connect with a local catalog provider ID when an app is missing or the person asks to connect it. '
        'Suggestions grant nothing. Never request credentials in chat. offer_daily_brief offers an optional morning brief once. '
        + CALL_RULE + ' After showing a card, end your turn and wait. The person’s answer arrives as their next message. Without these tools ask in plain text.')


def definitions():
    def schema(properties, required):
        return {'type': 'object', 'properties': properties, 'required': required, 'additionalProperties': False}
    return [
        {'name': 'prepare_call', 'description': CALL_RULE + ' End this turn after the card.', 'inputSchema': schema({
            'phone_number': {'type': 'string', 'minLength': 1, 'maxLength': 64, 'description': '7 to 15 ASCII digits, optional leading +. Spaces, dashes, dots and parentheses are stripped. No extensions, pauses or dialing codes.'},
            'name': {'type': 'string', 'minLength': 1, 'maxLength': 80},
            'purpose': {'type': 'string', 'minLength': 1, 'maxLength': 200},
            'talking_points': {'type': 'array', 'minItems': 1, 'maxItems': 6, 'items': {'type': 'string', 'minLength': 1, 'maxLength': 160}},
            'details': {'type': 'string', 'maxLength': 300, 'description': 'Optional owner details to give and/or where the number came from.'},
        }, ['phone_number', 'name', 'purpose', 'talking_points'])},
        {'name': 'ask_question', 'description': QUESTION_RULE + ' Show clickable choices in chat. End this turn after the card.', 'inputSchema': schema({'question': {'type': 'string', 'minLength': 1, 'maxLength': 400}, 'options': {'type': 'array', 'minItems': 2, 'maxItems': 5, 'items': {'type': 'string', 'minLength': 1, 'maxLength': 200}}}, ['question', 'options'])},
        {'name': 'suggest_connect', 'description': 'Suggest connecting a local catalog app by provider ID, such as gmail or googlecalendar. Grants nothing; never include credentials. End this turn after the card.', 'inputSchema': schema({'provider': {'type': 'string', 'maxLength': 200}}, ['provider'])},
        {'name': 'offer_daily_brief', 'description': 'Offer a daily read-only brief at 8 in the person’s time zone, once when relevant after answering. Does not enable it. End this turn after the card.', 'inputSchema': schema({}, [])},
    ]

