from app.services.codex_adapter import effort_names


def test_names_and_objects_both_become_plain_names():
    assert effort_names(["low", "high"]) == ("low", "high")
    assert effort_names([{"reasoningEffort": "low", "description": "Fast"}, {"reasoning_effort": "high"}]) == ("low", "high")


def test_unusable_entries_are_dropped():
    assert effort_names([{"description": "no name"}, 3, None, ""]) == ()
    assert effort_names(None) == ()
    assert effort_names("low") == ()
