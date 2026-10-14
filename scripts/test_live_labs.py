"""Run live scans against the local Docker labs; retain reports, not credentials."""
import json
import argparse
import secrets
from pathlib import Path

import httpx


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lab", choices=("all", "juice-shop", "webgoat"), default="all")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    with httpx.Client(timeout=240, follow_redirects=True) as client:
        username, password = "sentinel" + secrets.token_hex(3), "A" + secrets.token_hex(3) + "!"
        registration = client.post("http://127.0.0.1:8082/WebGoat/register.mvc", data={
            "username": username, "password": password, "matchingPassword": password, "agree": "agree",
        })
        registration.raise_for_status()
        if "start.mvc" not in str(registration.url):
            raise RuntimeError("WebGoat lab account registration failed")
        for name, target, login in (
            ("juice-shop", "http://127.0.0.1:3000/", None),
            ("webgoat", "http://127.0.0.1:8082/WebGoat", {
                "login_url": "http://127.0.0.1:8082/WebGoat/login", "username": username, "password": password,
            }),
        ):
            if args.lab not in ("all", name):
                continue
            response = client.post("http://127.0.0.1:8000/api/scans", json={"target_url": target, "authorized": True, "login": login})
            if response.is_error:
                raise RuntimeError(f"{name} scan failed: HTTP {response.status_code}: {response.json().get('detail', 'unknown error')}")
            response.raise_for_status()
            result = response.json()
            (root / f"test-{name}-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps({"lab": name, "scan_id": result["scan_id"], "duration_ms": result["duration_ms"], "findings": result["findings"], "browser_errors": [p.get("lab_browser_error") for p in result["pages"] if p.get("lab_browser_error")]}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
