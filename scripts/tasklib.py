"""อ่าน/เขียน tasks.json และรวมข้อมูลเมื่อแก้พร้อมกันหลายเครื่อง"""
import json, datetime, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
TASKS = ROOT / "tasks.json"
STATUSES = ["todo", "planning", "doing", "testing", "done", "blocked"]

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

def load(path=TASKS):
    try:
        data = json.loads(pathlib.Path(path).read_text(encoding="utf-8") or "{}")
    except FileNotFoundError:
        data = {}
    data.setdefault("tasks", [])
    return data

def save(data, path=TASKS):
    pathlib.Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def find(data, tid):
    for t in data["tasks"]:
        if t.get("id") == tid:
            return t
    raise SystemExit(f"ไม่พบงาน id={tid}")

def merge(a, b):
    """รวม tasks.json สองฉบับ: งานไหนแก้ล่าสุดชนะ ส่วน log รวมกันไม่ให้หาย"""
    out, order = {}, []
    for src in (a, b):
        for t in src.get("tasks", []):
            tid = t.get("id")
            if tid not in out:
                out[tid] = t; order.append(tid); continue
            cur = out[tid]
            logs = {(l.get("time"), l.get("text")): l for l in cur.get("log", []) + t.get("log", [])}
            win = t if t.get("updated", "") > cur.get("updated", "") else cur
            win = dict(win)
            win["log"] = sorted(logs.values(), key=lambda l: l.get("time", ""))
            if cur.get("deleted") or t.get("deleted"):
                win["deleted"] = True
            out[tid] = win
    return {"tasks": [out[i] for i in order]}

def merge_chat(a, b):
    """รวม chat.json สองฉบับ: ข้อความรวมกันตาม id ถ้าซ้ำ เอาฉบับที่ตอบแล้ว"""
    out = {}
    for src in (a, b):
        for m in src.get("messages", []):
            cur = out.get(m.get("id"))
            if cur is None or (cur.get("status") == "pending" and m.get("status") != "pending"):
                out[m.get("id")] = m
    return {"messages": sorted(out.values(), key=lambda m: m.get("time", ""))}
