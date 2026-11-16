#!/usr/bin/env python3
"""เครื่องมือให้ AI อัปเดตงานใน tasks.json

  python3 scripts/task.py show <id>
  python3 scripts/task.py status <id> <todo|planning|doing|testing|done|blocked>
  python3 scripts/task.py plan <id> "ขั้นที่ 1" "ขั้นที่ 2" ...   (ตั้งแผนใหม่ทั้งหมด)
  python3 scripts/task.py step <id> <ลำดับขั้น เริ่มที่ 1>         (ติ๊กว่าขั้นนั้นเสร็จ)
  python3 scripts/task.py log <id> "ข้อความ"
  python3 scripts/task.py projects                                (ดูรายชื่อโปรเจค)
  python3 scripts/task.py add "ชื่องาน" "รายละเอียด" --project <id โปรเจคเดิม>
  python3 scripts/task.py add "ชื่องาน" "รายละเอียด" --new-project "ชื่อโปรเจคใหม่"
"""
import sys, json
sys.path.insert(0, __import__("os").path.dirname(__file__))
from tasklib import load, save, find, now, STATUSES

def main(argv):
    if not argv or (len(argv) < 2 and argv[0] != "projects"):
        raise SystemExit(__doc__)
    if argv[0] == "projects":
        data = load()
        from tasklib import project_of, project_name
        ids = list(dict.fromkeys([p["id"] for p in data["projects"]] + [project_of(t) for t in data["tasks"] if not t.get("deleted")]))
        for i in ids:
            print(f"{i}\t{project_name(data, i)}")
        return
    cmd, tid, rest = argv[0], argv[1], argv[2:]
    data = load()
    if cmd == "add":
        project = None
        if "--project" in rest:
            k = rest.index("--project"); project = rest[k + 1]; del rest[k:k + 2]
        if "--new-project" in rest:
            import re as _re, time as _t
            k = rest.index("--new-project"); pname = rest[k + 1]; del rest[k:k + 2]
            import secrets as _s
            project = (_re.sub(r"[^a-z0-9]+", "-", pname.lower()).strip("-")[:20] or "p") + f"-{_s.token_hex(3)}"
            data["projects"].append({"id": project, "name": pname, "created": now()})
        import re, time
        slug = re.sub(r"[^a-z0-9]+", "-", tid.lower()).strip("-")[:24] or "task"
        import secrets
        nid = f"{slug}-{secrets.token_hex(3)}"
        if not project:
            project = nid
            data["projects"].append({"id": project, "name": tid, "created": now()})
        data["tasks"].append({"id": nid, "project": project, "title": tid, "detail": " ".join(rest), "status": "todo",
                              "plan": [], "log": [], "created": now(), "updated": now()})
        save(data); print(nid); return
    t = find(data, tid)
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
