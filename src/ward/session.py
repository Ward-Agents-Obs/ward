"""
Session tracking for Ward SDK.

Generates and manages session IDs to group related traces into conversations.
"""

import uuid
import threading
from typing import Optional

# Thread-local storage for session ID
_local = threading.local()


def get_current_session_id() -> Optional[str]:
    """Get the current session ID from thread-local storage."""
    return getattr(_local, 'session_id', None)


def set_session_id(session_id: Optional[str]) -> None:
    """Set the session ID in thread-local storage."""
    _local.session_id = session_id


def generate_session_id() -> str:
    """Generate a new session ID."""
    return f"session_{uuid.uuid4().hex[:16]}"


def start_session() -> str:
    """Start a new session and return its ID."""
    session_id = generate_session_id()
    set_session_id(session_id)
    return session_id


def end_session() -> None:
    """Clear the current session ID."""
    set_session_id(None)


class SessionContext:
    """Context manager for session tracking."""

    def __init__(self, session_id: Optional[str] = None):
        self.session_id = session_id or generate_session_id()
        self.previous_session_id = None

    def __enter__(self):
        self.previous_session_id = get_current_session_id()
        set_session_id(self.session_id)
        return self.session_id

    def __exit__(self, exc_type, exc_val, exc_tb):
        set_session_id(self.previous_session_id)