"""Wait until EXDA's backend answers on host:port (used by the launchers).

Usage: check_exda_backend.py HOST PORT [SECONDS]
Exit 0: EXDA answers.
Exit 1: nothing answers (the backend did not start, or stopped).
Exit 2: another program answers on that port (on a Mac often AirPlay Receiver).
"""
import json
import sys
import time
import urllib.error
import urllib.request


def main():
    host, port = sys.argv[1], sys.argv[2]
    seconds = float(sys.argv[3]) if len(sys.argv) > 3 else 30.0
    url = f"http://{host}:{port}/exda_health"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # never via a proxy
    deadline = time.time() + seconds
    other = ""
    while time.time() < deadline:
        try:
            with opener.open(url, timeout=2) as response:
                try:
                    data = json.loads(response.read().decode("utf-8") or "{}")
                except ValueError:
                    data = {}
                if isinstance(data, dict) and data.get("app") == "EXDA":
                    return 0
                other = f"HTTP {response.status}"
        except urllib.error.HTTPError as exc:
            other = f"HTTP {exc.code} {exc.headers.get('Server', '')}".strip()
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(0.5)
    if other:
        print(f"Another program answers on port {port} ({other}), not EXDA.")
        return 2
    return 1


if __name__ == "__main__":
    sys.exit(main())
