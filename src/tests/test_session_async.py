"""
Tests for ward.session under threaded and asyncio concurrency.

Background:
    `ward.session` stores the current session ID in `threading.local()`.
    That isolates concurrent OS threads correctly, but **does not** isolate
    concurrent asyncio tasks running on the same event-loop thread — they
    share one `threading.local()` namespace.

    The auto-instrumentation wrappers in `ward.instrumentation.openai.openai`
    call `start_session()` whenever `get_current_session_id()` returns None,
    so two concurrent async LLM calls can cross-contaminate each other's
    session ID. The xfail tests below pin this behavior so it surfaces
    in CI and flips green automatically once the storage moves to
    `contextvars.ContextVar`.
"""

import asyncio
import sys
import threading
from pathlib import Path

import pytest

src_path = Path(__file__).parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

from ward.session import (  # noqa: E402
    SessionContext,
    end_session,
    generate_session_id,
    get_current_session_id,
    set_session_id,
    start_session,
)


@pytest.fixture(autouse=True)
def _clear_session_state():
    """Reset thread-local session state between tests so order doesn't matter."""
    end_session()
    yield
    end_session()


# ---------------------------------------------------------------------------
# Sanity / single-threaded behavior
# ---------------------------------------------------------------------------


class TestSessionBasics:
    def test_generate_session_id_format(self):
        sid = generate_session_id()
        assert sid.startswith("session_")
        # 8 char prefix + 16 hex chars
        assert len(sid) == len("session_") + 16

    def test_start_session_sets_and_returns(self):
        sid = start_session()
        assert sid == get_current_session_id()

    def test_end_session_clears(self):
        start_session()
        end_session()
        assert get_current_session_id() is None

    def test_session_context_restores_previous(self):
        outer = start_session()
        with SessionContext("inner-id") as inner:
            assert inner == "inner-id"
            assert get_current_session_id() == "inner-id"
        assert get_current_session_id() == outer

    def test_session_context_default_generates_id(self):
        with SessionContext() as sid:
            assert sid.startswith("session_")
            assert get_current_session_id() == sid


# ---------------------------------------------------------------------------
# Thread isolation (control case — should pass today)
# ---------------------------------------------------------------------------


class TestThreadIsolation:
    def test_threads_do_not_share_session(self):
        """Two OS threads set distinct session IDs and neither sees the other's.

        Validates that `threading.local()` is doing its job for the
        thread-vs-thread case. Async case is broken and tested below.
        """
        observations: dict[str, str | None] = {}
        barrier = threading.Barrier(2)

        def worker(name: str, sid: str):
            set_session_id(sid)
            barrier.wait()  # ensure both threads have set before either reads
            observations[name] = get_current_session_id()

        t1 = threading.Thread(target=worker, args=("a", "session_aaaa"))
        t2 = threading.Thread(target=worker, args=("b", "session_bbbb"))
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        assert observations["a"] == "session_aaaa"
        assert observations["b"] == "session_bbbb"

    def test_main_thread_session_invisible_to_worker(self):
        set_session_id("main-session")

        observed: dict[str, str | None] = {}

        def worker():
            observed["worker"] = get_current_session_id()

        t = threading.Thread(target=worker)
        t.start()
        t.join()

        assert observed["worker"] is None
        assert get_current_session_id() == "main-session"


# ---------------------------------------------------------------------------
# Asyncio isolation (BROKEN today — xfail until ContextVar migration)
# ---------------------------------------------------------------------------


@pytest.mark.xfail(
    reason=(
        "ward.session uses threading.local(), which does NOT isolate "
        "asyncio tasks on the same event-loop thread. Migrating to "
        "contextvars.ContextVar will fix this."
    ),
    strict=True,
)
async def test_concurrent_async_tasks_isolate_session_ids():
    """Two coroutines each open their own SessionContext and should observe
    only their own session ID after an await point.

    Today they share a single thread-local cell, so whichever task ran
    `__enter__` last wins — both observe the same ID.
    """
    seen: dict[str, str | None] = {}

    async def task(name: str, sid: str):
        with SessionContext(sid):
            # Yield control so the other coroutine runs and overwrites the
            # shared thread-local before we read it back.
            await asyncio.sleep(0)
            seen[name] = get_current_session_id()

    await asyncio.gather(
        task("a", "session_aaaa"),
        task("b", "session_bbbb"),
    )

    assert seen["a"] == "session_aaaa"
    assert seen["b"] == "session_bbbb"


@pytest.mark.xfail(
    reason=(
        "Concurrent async LLM calls without a parent session bleed IDs "
        "because start_session() writes to a shared thread-local."
    ),
    strict=True,
)
async def test_concurrent_async_start_session_does_not_bleed():
    """Mirrors what the OpenAI/Anthropic auto-instrumentation does: each
    call invokes start_session() if no session is set. Two concurrent
    calls should produce two distinct session IDs visible to their own
    coroutines after an await point."""
    seen: dict[str, str | None] = {}

    async def call(name: str):
        sid = start_session()
        await asyncio.sleep(0)
        # If isolation works, the value we read back equals the value we set.
        seen[name] = (sid, get_current_session_id())

    await asyncio.gather(call("a"), call("b"))

    a_set, a_read = seen["a"]
    b_set, b_read = seen["b"]
    assert a_set != b_set, "each task should get a unique session id"
    assert a_set == a_read, "task a must see its own session after await"
    assert b_set == b_read, "task b must see its own session after await"


# ---------------------------------------------------------------------------
# Asyncio behavior that is correct today (passes — keep as regression guard)
# ---------------------------------------------------------------------------


async def test_serial_async_session_context_works():
    """When coroutines run serially (not concurrently), thread-local is
    fine. Locks in the current behavior so a fix doesn't break this."""
    with SessionContext("session_first") as a:
        assert get_current_session_id() == a

    with SessionContext("session_second") as b:
        assert get_current_session_id() == b

    assert get_current_session_id() is None


async def test_set_session_id_visible_within_single_coroutine():
    """A single coroutine that sets and reads its session ID across an
    await boundary observes its own value (no contention)."""
    set_session_id("solo-session")
    await asyncio.sleep(0)
    assert get_current_session_id() == "solo-session"
