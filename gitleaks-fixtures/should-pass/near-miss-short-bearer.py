# Fixture: bearer payload below the 20-character entropy threshold. The
# `bearer-token-literal` rule requires `[A-Za-z0-9_\-\.]{20,}` so anything
# shorter is intentionally ignored — these are usually placeholders or
# truncated examples in docs, not real secrets.
SHORT_TOKEN_HEADER = {"Authorization": "Bearer abc123"}
TRIVIAL_BEARER = "Bearer xyz"
