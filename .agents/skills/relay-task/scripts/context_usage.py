"""Print the latest context-window sample for this Codex thread."""

import json
import os
import sys
from pathlib import Path
from uuid import UUID


def reverse_lines(stream):
    """Read newest lines first, including when the writer has a partial last line."""
    position = stream.seek(0, os.SEEK_END)
    suffix = b""
    while position:
        size = min(position, 65536)
        position -= size
        stream.seek(position)
        parts = (stream.read(size) + suffix).split(b"\n")
        suffix = parts[0]
        yield from reversed(parts[1:])
    if suffix:
        yield suffix


def current_sample():
    thread_id = str(UUID(os.environ["CODEX_THREAD_ID"]))
    root = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex") / "sessions"
    matches = list(root.rglob(f"rollout-*-{thread_id}.jsonl"))
    if len(matches) != 1:
        raise ValueError(f"Expected one rollout for this thread, found {len(matches)}")
    with matches[0].open("rb") as stream:
        for line in reverse_lines(stream):
            if b'"token_count"' not in line:
                continue
            try:
                event = json.loads(line)
                payload = event["payload"]
                if event["type"] != "event_msg" or payload["type"] != "token_count":
                    continue
                info = payload["info"]
                used = info["last_token_usage"]["total_tokens"]
                window = info["model_context_window"]
                if type(used) is int and used >= 0 and type(window) is int and window > 0:
                    return dict(timestamp=event["timestamp"], used=used, window=window,
                                percent=round(100 * used / window, 2))
            except (KeyError, TypeError, ValueError, UnicodeDecodeError):
                continue
    raise ValueError("No valid token_count sample in this thread's rollout")


if __name__ == "__main__":
    try:
        print(json.dumps(current_sample()))
    except (OSError, KeyError, ValueError) as error:
        sys.exit(f"Context sample unavailable: {error}")
