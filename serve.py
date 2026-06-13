"""Static server for the Bank Charge Auditor with caching disabled,
so the browser always loads the latest code after an update."""
import http.server
import socketserver

PORT = 8765


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_POST(self):
        """Save a regression fixture extracted in the browser (local-only:
        lets every real statement become a permanent test case)."""
        import os
        import re

        m = re.match(r"^/fixtures/([\w\-.]+\.json)$", self.path)
        if not m:
            self.send_error(403)
            return
        os.makedirs(os.path.join("reference", "fixtures"), exist_ok=True)
        length = int(self.headers.get("Content-Length", 0))
        data = self.rfile.read(length)
        with open(os.path.join("reference", "fixtures", m.group(1)), "wb") as f:
            f.write(data)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")


class ReusableTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with ReusableTCPServer(("", PORT), NoCacheHandler) as httpd:
        print(f"Serving (no-cache) on http://localhost:{PORT}")
        httpd.serve_forever()
