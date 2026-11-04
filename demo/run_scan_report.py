# -*- coding: utf-8 -*-
"""Demo bao ve - Cach 1: chay ca he thong Sentinel va mo bao cao tu dong.

Yeu cau da bat san:
    docker compose up -d juice-shop webgoat      # lab (3000, 8082)
    uvicorn app.main:app --reload                # Sentinel API o cong 8000

Cach chay:
    python demo/run_scan_report.py                       # quet Juice Shop (mac dinh)
    python demo/run_scan_report.py http://127.0.0.1:8082/WebGoat/start.mvc
    python demo/run_scan_report.py http://localhost:8081/

Script goi API /api/scans cua chinh he thong, lay scan_id, roi mo bao cao
tieng Viet /api/scans/{id}/report.vi.html trong trinh duyet.
"""
import sys
import webbrowser
import httpx

SENTINEL = "http://localhost:8000"
TARGET = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"


def juice_auth(client):
    """Dang ky + dang nhap Juice Shop de lay token (cho kich ban BOLA)."""
    import uuid
    email = f"demo-{uuid.uuid4().hex[:8]}@local.lab"
    pw = "Demo12345!"
    try:
        client.post(TARGET.rstrip("/") + "/api/Users",
                    json={"email": email, "password": pw, "passwordRepeat": pw,
                          "securityQuestion": {"id": 1}, "securityAnswer": "x"}, timeout=20)
        r = client.post(TARGET.rstrip("/") + "/rest/user/login",
                        json={"email": email, "password": pw}, timeout=20)
        token = r.json().get("authentication", {}).get("token")
        if token:
            return {"Authorization": f"Bearer {token}"}
    except Exception:
        pass
    return {}


def main():
    print(f">> Muc tieu: {TARGET}")
    with httpx.Client() as client:
        headers = juice_auth(client) if ":3000" in TARGET else {}
        payload = {"target_url": TARGET, "authorized": True,
                   "session_headers": headers, "comparison_session_headers": headers}
        print(">> Dang goi he thong quet (POST /api/scans)...")
        try:
            r = client.post(SENTINEL + "/api/scans", json=payload, timeout=300)
        except httpx.ConnectError:
            print("LOI: chua chay Sentinel. Hay chay: uvicorn app.main:app --reload")
            return
        if r.status_code != 200:
            print("LOI", r.status_code, r.text[:300]); return
        data = r.json()
        scan_id = data["scan_id"]
        findings = data["findings"]
        print(f">> Xong. scan_id = {scan_id}")
        print(f">> So phat hien that: {len(findings)}")
        for f in findings:
            print("   - %-28s | %-6s | %s" % (f["category"], f.get("severity", ""), f.get("url", "")[:60]))
        report = f"{SENTINEL}/api/scans/{scan_id}/report.vi.html"
        print(f">> Mo bao cao tieng Viet: {report}")
        webbrowser.open(report)


if __name__ == "__main__":
    main()
