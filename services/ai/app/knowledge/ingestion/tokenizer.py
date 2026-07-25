"""Token counting for knowledge chunking.

Production embeddings default to text-embedding-3-large, which uses the
cl100k_base tokenizer. We use the same tokenizer for chunk sizing so that
chunk boundaries align with what the embedding model actually sees.
"""

import tiktoken


def get_tokenizer() -> tiktoken.Encoding:
    """Return the tokenizer used for chunk sizing."""
    return tiktoken.get_encoding("cl100k_base")


def count_tokens(text: str) -> int:
    """Return the number of tokens in the text."""
    if not text:
        return 0
    tokenizer = get_tokenizer()
    return len(tokenizer.encode(text))
