"""Typed errors for deterministic decision-rule input validation."""


class DecisionRuleError(Exception):
    """Base class for decision-rule failures."""


class DecisionRuleInputError(DecisionRuleError):
    """Invalid or incomplete inputs before scoring can begin."""

    def __init__(self, field: str, message: str) -> None:
        self.field = field
        self.message = message
        super().__init__(message)
