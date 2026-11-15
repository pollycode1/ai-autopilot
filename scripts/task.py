#!/usr/bin/env python3
"""เครื่องมือให้ AI อัปเดตงานใน tasks.json

  python3 scripts/task.py show <id>
  python3 scripts/task.py status <id> <todo|planning|doing|testing|done|blocked>
  python3 scripts/task.py plan <id> "ขั้นที่ 1" "ขั้นที่ 2" ...   (ตั้งแผนใหม่ทั้งหมด)
  python3 scripts/task.py step <id> <ลำดับขั้น เริ่มที่ 1>         (ติ๊กว่าขั้นนั้นเสร็จ)
  python3 scripts/task.py log <id> "ข้อความ"
"""
import sys, json
sys.path.insert(0, __import__("os").path.dirname(__file__))
from tasklib import load, save, find, now, STATUSES

def main(argv):
    if len(argv) < 2:
        raise SystemExit(__doc__)
    cmd, tid, rest = argv[0], argv[1], argv[2:]
    data = load(); t = find(data, tid)
    if cmd == "show":
        print(json.dumps(t, ensure_ascii=False, indent=2)); return
    if cmd == "status":
        if not rest or rest[0] not in STATUSES:
            raise SystemExit("สถานะต้องเป็น: " + ", ".join(STATUSES))
        t["status"] = rest[0]
    elif cmd == "plan":
        if not rest: raise SystemExit("ต้องใส่อย่างน้อย 1 ขั้น")
        t["plan"] = [{"text": s, "done": False} for s in rest]
    elif cmd == "step":
        i = int(rest[0]) - 1
        t["plan"][i]["done"] = True
    elif cmd == "log":
        t.setdefault("log", []).append({"time": now(), "by": "ai", "text": " ".join(rest)})
    else:
        raise SystemExit(__doc__)
    t["updated"] = now()
    save(data)
    print("ok")

if __name__ == "__main__":
    main(sys.argv[1:])
