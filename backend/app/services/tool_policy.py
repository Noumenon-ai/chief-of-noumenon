"""Every automatic tool decision passes through the durable approval gate."""
from app.computers import policy as computers
from app import composio_generic
from app.services import composio_policy
from app.team import policy as teams


def automatic(tool, mode, run, arguments):
    if tool in ("Bash", "api__shell", "mcp__bot_files__shell", computers.COMPUTER_EXEC_TOOL):
        from app.services.shell_paths import outside
        workspace = (getattr(getattr(run.ctx, "computer", None), "guest_workspace", None)
                     if tool == computers.COMPUTER_EXEC_TOOL else getattr(run.ctx, "workspace", None))
        if outside(arguments.get("command"), workspace):
            return "denied", "shell_outside_workspace"
    if getattr(run.ctx, "media_review_only", False):
        return "denied", "media_review_only"
    if getattr(run.ctx, "draft_only", False) and not tool.startswith(composio_policy.PREFIX):
        return "denied", "draft_only_run"
    if tool.startswith('mcp__memory__'):
        # Read-only search of the agent's own history (memory_bridge.py).
        return ('allowed', 'memory_read') if tool in ('mcp__memory__session_search', 'mcp__memory__session_read') else ('denied', 'unknown_memory_tool')
    if tool.startswith('mcp__team__'):
        from app.services import chat_cards
        name = tool.removeprefix('mcp__team__')
        if name in chat_cards.TOOLS:
            if not getattr(run.ctx, 'chat_cards_allowed', False):
                return 'denied', 'outside_origin'
            try:
                chat_cards.validate(name, arguments)
            except Exception:
                return 'denied', 'invalid_chat_card'
            return 'allowed', 'chat_suggestion'
        return teams.automatic(tool, mode, run.ctx.team, arguments)
    if tool.startswith('mcp__community__'):
        # Marketplace tools have unknown effects. They are never automatically
        # allowed, and plan mode cannot execute them even if a card is answered.
        if tool.removeprefix('mcp__community__') not in getattr(run.ctx, 'community_tools', []):
            return 'denied', 'marketplace_tool_not_granted'
        return ('denied', 'plan_mode') if mode == 'plan' else None
    if tool in ("mcp__composio__apps_search", "mcp__composio__apps_run"):
        # Async connector inspection in ThreadApprovalGate; fail closed elsewhere.
        return "denied", "connector_requires_inspection"
    if tool.startswith(composio_policy.PREFIX):
        # Connected apps (composio_bridge.py): decided here, never by a saved command rule.
        grants = getattr(run, "routine_grants", None)
        if grants is not None:
            name = tool.removeprefix(composio_policy.PREFIX)
            from app import composio_tools
            found = composio_tools.BY_NAME.get(name)
            if name not in grants or found is None:
                return "denied", "routine_action_not_granted"
            if found.kind == "write":
                if name not in composio_tools.ROUTINE_WRITE_TOOLS or not composio_tools.allows((run.ctx.composio_apps or {}).get(found.app), "write"):
                    return "denied", "routine_write_not_granted"
                if mode == "plan":
                    return "denied", "plan_mode"
                return "allowed", "routine_write_grant"
        decision = composio_policy.automatic(tool, mode, run.ctx.composio_apps, arguments,
            getattr(run.ctx, "composio_first_use_hit", False),
            uninterrupted=getattr(run, "uninterrupted_access", False))
        if tool == composio_policy.PREFIX + composio_generic.RUN:
            # A generic call decided without a card is remembered, so the bridge checks it again before it runs.
            key, calls = composio_generic.call_key(arguments), getattr(run.ctx, "composio_auto_calls", None)
            if calls is not None:
                if decision is not None and decision[0] == "allowed":
                    calls.add(key)
                else:
                    calls.discard(key)
        return decision
    if tool.startswith('api__'):
        name = tool.removeprefix('api__')
        if name in ('read', 'glob', 'grep'):
            # Execution still opens each component with O_NOFOLLOW beneath the
            # pinned workspace. This decision grants no additional filesystem access.
            from app.services.workspace_tool_worker import parts
            try:
                parts(arguments['path'] if name == 'read' else arguments.get('pattern', '*'))
            except (ValueError, KeyError, TypeError):
                return 'denied', 'outside_workspace'
            return 'allowed', 'workspace_read'
        if name not in ('write', 'edit', 'shell'):
            return 'denied', 'unknown_workspace_tool'
        if mode == 'plan':
            return 'denied', 'plan_mode'
        if mode == 'accept_edits' and name in ('write', 'edit'):
            return 'allowed', 'accept_edits'
        return None
    # Screen grants are turn scoped and are never persisted as command rules.
    if tool in computers.SCREEN_INPUT or tool in computers.SCREEN_READ:
        return computers.automatic(tool, mode, screen_granted=getattr(run, "screen_granted", False))
    return computers.automatic(tool, mode)
