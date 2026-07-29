#!/usr/bin/env python3
"""Development server. Plain http.server caches aggressively enough that an
edited index.html or lib/*.js can keep being served from the browser cache —
which looks exactly like a change that didn't work. This one says no-store."""

import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    print(f"serving {sys.argv[0]}'s directory on http://127.0.0.1:{port} (no-store)")
    HTTPServer(("127.0.0.1", port), NoCache).serve_forever()
