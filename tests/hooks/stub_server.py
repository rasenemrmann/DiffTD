"""Stub of the TD reload endpoint: logs each POST body, one JSON per line.

Usage: stub_server.py <port> <log-file> [response-file]
If response-file exists its content is returned instead of the default empty report.
"""

import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

port, log_file = int(sys.argv[1]), sys.argv[2]
response_file = sys.argv[3] if len(sys.argv) > 3 else None
DEFAULT = '{"reloaded": [], "unchanged": [], "removed": [], "skippedNodes": [], "skippedParams": [], "backups": [], "errors": []}'


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode()
        with open(log_file, "a") as f:
            f.write(f"{self.path} {self.headers.get('Content-Type')} {body}\n")
        payload = DEFAULT
        if response_file and os.path.exists(response_file):
            payload = open(response_file).read()
        data = payload.encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


HTTPServer(("127.0.0.1", port), Handler).serve_forever()
