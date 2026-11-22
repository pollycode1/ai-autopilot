"""อ่าน/เขียน tasks.json และรวมข้อมูลเมื่อแก้พร้อมกันหลายเครื่อง"""
import json, datetime, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
TASKS = ROOT / "tasks.json"
MODEL_RE = __import__("re").compile(r"^(sonnet|opus|haiku|claude-[a-z0-9][a-z0-9.\-]*)$")

def valid_model(m):
    """โมเดลที่อนุญาต: sonnet / opus / haiku หรือชื่อเต็ม claude-… (ว่าง = ค่าเริ่มต้น)"""
    return not m or bool(MODEL_RE.match(m))

STATUSES = ["todo", "planning", "doing", "testing", "done", "blocked"]

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

def load(path=TASKS):
    try:
        data = json.loads(pathlib.Path(path).read_text(encoding="utf-8") or "{}")
    except FileNotFoundError:
        data = {}
    data.setdefault("tasks", [])
    data.setdefault("projects", [])
    return data

def project_of(t):
    """โปรเจคของงาน (งานเก่าที่ไม่มีโปรเจค ใช้ id งานเป็นโปรเจค)"""
    return t.get("project") or t.get("id")

def project_name(data, pid):
    for p in data.get("projects", []):
        if p.get("id") == pid:
            return p.get("name") or pid
    t = next((x for x in data["tasks"] if x.get("id") == pid), None)
    return (t or {}).get("title", pid)

def project_info(data, pid):
    """ข้อมูลโปรเจค (dict) — โปรเจคที่นำเข้าจาก GitHub จะมี "repo": "owner/name" """
    return next((p for p in data.get("projects", []) if p.get("id") == pid), {}) or {}

REPO_RE = __import__("re").compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")

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
            logs = {(l.get("time"), l.get("text"), tuple(l.get("images") or ())): l for l in cur.get("log", []) + t.get("log", [])}
            win = t if t.get("updated", "") > cur.get("updated", "") else cur
            win = dict(win)
            win["log"] = sorted(logs.values(), key=lambda l: l.get("time", ""))
            # โมเดลที่ผู้ใช้เลือก: ใช้ค่าที่เปลี่ยนล่าสุด (model_at) ไม่ให้การอัปเดตสถานะของตัวรันเขียนทับ
            mt = max((cur, t), key=lambda x: x.get("model_at", ""))
            if "model" in mt or "model_at" in mt:
                win["model"] = mt.get("model", ""); win["model_at"] = mt.get("model_at", "")
            if cur.get("deleted") or t.get("deleted"):
                win["deleted"] = True
            out[tid] = win
    projects = {}
    for src in (a, b):
        for p in src.get("projects", []):
            projects.setdefault(p.get("id"), p)
    return {"projects": list(projects.values()), "tasks": [out[i] for i in order]}

def merge_chat(a, b):
    """รวม chat.json สองฉบับ: ข้อความรวมกันตาม id ถ้าซ้ำ เอาฉบับที่ตอบแล้ว"""
    out = {}
    for src in (a, b):
        for m in src.get("messages", []):
            cur = out.get(m.get("id"))
            if cur is None or (cur.get("status") == "pending" and m.get("status") != "pending"):
                out[m.get("id")] = m
    return {"messages": sorted(out.values(), key=lambda m: m.get("time", ""))}
