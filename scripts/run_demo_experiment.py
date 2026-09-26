"""Run the deterministic demo experiment used by Chapter 3."""

import json
import httpx

API_URL = "http://127.0.0.1:8000"


def main() -> None:
    response = httpx.post(
        f"{API_URL}/api/scans",
        json={"target_url": f"{API_URL}/demo", "authorized": True},
        timeout=30,
    )
    response.raise_for_status()
    print(json.dumps(response.json(), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
