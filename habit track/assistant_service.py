from typing import Protocol


class AssistantProvider(Protocol):
    def respond(self, message: str) -> str:
        """Return a short, supportive response to a habit-building question."""


class LocalAssistantProvider:
    def respond(self, message: str) -> str:
        lowered = message.lower()
        if any(word in lowered for word in ("struggle", "hard", "miss", "fail", "stuck", "urge", "craving")):
            return (
                "I’m sorry this feels difficult. You don’t have to fix everything at once. "
                "Try making the next step very small: pause for a minute, move to a place that feels safer, "
                "or reach out to someone you trust. A difficult day doesn’t erase your effort."
            )
        if any(word in lowered for word in ("routine", "schedule", "plan")):
            return (
                "Try a simple routine that leaves room to breathe: choose one small morning habit, "
                "one focused activity, and one wind-down step. Attach each to something you already do, "
                "and start with a version that takes five minutes or less."
            )
        return (
            "Start with one specific action you can do in two minutes, connect it to a routine you already have, "
            "and make it easy to restart after a missed day. What would feel like a kind, realistic first step?"
        )


def generate_reply(message: str, provider: AssistantProvider | None = None) -> str:
    return (provider or LocalAssistantProvider()).respond(message)
