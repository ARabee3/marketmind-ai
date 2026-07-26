"""Versioned prompt identifiers for the Strategy Agent.

These versions are injected into system prompts and recorded in generation metadata
so every plan can be reproduced and reviewed.
"""

STRATEGY_GENERATE_PROMPT_VERSION = "strategy-generate-v1"
STRATEGY_REVISE_PROMPT_VERSION = "strategy-revise-v1"

# Tracks the external reference-pattern influence declared in issue #74.
# This is *not* a source of evidence; it only records that the prompt structure
# borrows organizational ideas from the marketingskills reference pack.
STRATEGY_REFERENCE_PATTERN_VERSION = "marketingskills-prompt-patterns-v1"
