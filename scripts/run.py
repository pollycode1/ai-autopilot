#!/usr/bin/env python3
"""ตัวรัน: ทำงานเฉพาะในช่วงเวลาที่ตั้งไว้, ทีละงาน, หยุดพักเมื่อติด limit แล้วบันทึกลง git"""
import json, os, re, subprocess, sys, time, datetime, pathlib
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.dirname(__file__))
from tasklib import ROOT, load, save, find, now, merge, merge_chat, project_of, project_name

LIMIT_RE = re.compile(r"usage limit|session limit|weekly limit|rate[ _-]?limit|limit reached|hit your .{0,20}limit|\b429\b|overloaded|quota|credit balance|\bresets?\b|try again later", re.I)
MAX_WAIT_MIN = int(os.environ.get("MAX_LIMIT_WAIT_MINUTES", "120"))  # รอ limit รีเซ็ตในรอบเดียวกันได้นานสุดกี่นาที

def reset_time(text):
    """อ่านเวลาที่ limit จะรีเซ็ตจากข้อความของ Claude (คืนค่า datetime UTC หรือ None)"""
    m = re.search(r"\|(\d{10})\b", text)
    if m:
        return datetime.datetime.fromtimestamp(int(m.group(1)), datetime.timezone.utc)
    m = re.search(r"resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:\(([^)]+)\))?", text, re.I)
    if not m:
        return None
    h, mi, ap, tzname = int(m.group(1)), int(m.group(2) or 0), (m.group(3) or "").lower(), m.group(4) or "UTC"
    if ap == "pm" and h < 12: h += 12
    if ap == "am" and h == 12: h = 0
    try:
        tz = ZoneInfo(tzname.strip())
    except Exception:
        tz = datetime.timezone.utc
    now_ = datetime.datetime.now(tz)
    t = now_.replace(hour=h, minute=mi, second=0, microsecond=0)
    if t <= now_:
        t += datetime.timedelta(days=1)
    return t.astimezone(datetime.timezone.utc)
BUDGET_MIN = int(os.environ.get("RUN_BUDGET_MINUTES", "300"))   # เวลาสูงสุดต่อรอบ
SESSION_MIN = int(os.environ.get("SESSION_MINUTES", "45"))       # เวลาต่อการเรียก AI หนึ่งครั้ง
ONLY = os.environ.get("ONLY_TASK", "").strip()                  # ทำเฉพาะงานนี้ทันที (ปุ่ม ▶ ในหน้างาน)
ONLY_PROJECT = os.environ.get("ONLY_PROJECT", "").strip()        # ทำเฉพาะโปรเจคนี้ทันที (ปุ่ม ▶ ของโปรเจค)
FORCE = os.environ.get("FORCE_RUN", "").lower() in ("1", "true", "yes") or bool(ONLY) or bool(ONLY_PROJECT)
RUN_ID = os.environ.get("GITHUB_RUN_ID") or f"local-{os.getpid()}"
LOCK_MIN = 70  # งานที่ถูกล็อกโดยรอบอื่นเกินกี่นาทีถือว่าหลุดแล้ว
CLAUDE = os.environ.get("CLAUDE_BIN", "claude")
os.chdir(ROOT)

def sh(*cmd, check=True):
    return subprocess.run(cmd, check=check, text=True, capture_output=True)

def window_minutes_left(cfg, at=None):
    """คืนจำนวนนาทีที่เหลือในช่วงเวลาทำงานปัจจุบัน หรือ 0 ถ้าอยู่นอกช่วง (days: 0=อาทิตย์ ... 6=เสาร์)"""
    tz = ZoneInfo(cfg.get("timezone", "Asia/Bangkok"))
    at = at or datetime.datetime.now(tz)
    best = 0
    for w in cfg.get("windows", []):
        days = set(w.get("days", range(7)))
        sh_, sm = map(int, w["start"].split(":")); eh, em = map(int, w["end"].split(":"))
        for back in (0, 1):  # ช่วงที่เริ่มวันนี้ หรือเริ่มเมื่อวาน (ข้ามเที่ยงคืน)
            d = (at - datetime.timedelta(days=back)).date()
            if (d.isoweekday() % 7) not in days:
                continue
            s = datetime.datetime(d.year, d.month, d.day, sh_, sm, tzinfo=tz)
            e = datetime.datetime(d.year, d.month, d.day, eh, em, tzinfo=tz)
            if e <= s:
                e += datetime.timedelta(days=1)
            if s <= at < e:
                best = max(best, int((e - at).total_seconds() // 60))
    return best

MODEL_ERR_RE = re.compile(r"model.{0,40}(not found|not available|invalid|unsupported|does not exist|not supported|access)|"
                          r"(invalid|unknown|unsupported).{0,20}model|not_found_error", re.I)

def call_claude(prompt, minutes, model=""):
    """เรียก Claude Code หนึ่งครั้ง (model ว่าง = ใช้ค่าเริ่มต้นของ Claude Code)"""
    cmd = [CLAUDE, "-p", prompt, "--dangerously-skip-permissions", "--max-turns", os.environ.get("MAX_TURNS", "150")]
    if model:
        cmd += ["--model", model]
    try:
        p = subprocess.run(cmd, text=True, capture_output=True, timeout=minutes * 60)
        return (p.stdout or "") + (p.stderr or ""), p.returncode
    except subprocess.TimeoutExpired:
        return "timeout", 124

def locked_by_other(data, project):
    """โปรเจคนี้กำลังถูกรอบอื่นทำอยู่ไหม (กันสองรอบแก้ไฟล์เดียวกันพร้อมกัน)"""
    cutoff = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=LOCK_MIN)).isoformat(timespec="seconds").replace("+00:00", "Z")
    return any(project_of(t) == project and (t.get("lock") or {}).get("run") not in (None, RUN_ID)
               and (t.get("lock") or {}).get("at", "") > cutoff for t in data["tasks"])

def next_task(only=None):
    only = ONLY if only is None else only
    data = load()
    live = [t for t in data["tasks"] if not t.get("deleted") and t.get("status", "todo") not in ("done", "blocked")
            and (not only or t.get("id") == only) and (not ONLY_PROJECT or project_of(t) == ONLY_PROJECT)
            and not locked_by_other(data, project_of(t))]
    rank = {"testing": 0, "doing": 1, "planning": 2, "todo": 3}
    live.sort(key=lambda t: rank.get(t.get("status", "todo"), 3))
    return live[0] if live else None

def set_lock(tid, on):
    data = load(); t = find(data, tid)
    if on:
        t["lock"] = {"run": RUN_ID, "at": now()}
    else:
        t.pop("lock", None)
    save(data)

def release_locks():
    data = load(); changed = False
    for t in data["tasks"]:
        if (t.get("lock") or {}).get("run") == RUN_ID:
            t.pop("lock"); changed = True
    if changed:
        save(data)
    return changed

def add_log(tid, text):
    data = load(); t = find(data, tid)
    t.setdefault("log", []).append({"time": now(), "by": "system", "text": text})
    t["updated"] = now(); save(data)

def inject_helper():
    """ใส่ปุ่ม 🔧 (สั่ง AI อัปเดต) ให้ทุกแอปที่เปิดผ่านเว็บ"""
    url = sh("git", "config", "--get", "remote.origin.url", check=False).stdout.strip()
    full = os.environ.get("GITHUB_REPOSITORY") or re.sub(r"\.git$", "", re.sub(r".*github\.com[:/]", "", url))
    if "/" not in full:
        return
    owner, repo = full.split("/", 1)
    for page in (ROOT / "docs/workspace").glob("*/index.html"):
        h = page.read_text(encoding="utf-8")
        if "app-helper.js" in h:
            continue
        tag = f'<script src="../../app-helper.js" data-app="{page.parent.name}" data-owner="{owner}" data-repo="{repo}"></script>'
        h = h.replace("</body>", tag + "\n</body>") if "</body>" in h else h + tag
        page.write_text(h, encoding="utf-8")

def sync(msg):
    """commit แล้ว push; ถ้า tasks.json ชนกับที่แก้จากแอป ให้รวมข้อมูลอัตโนมัติ"""
    # คัดลอกผลงานไปไว้ใน docs/ เพื่อให้เปิดดูผ่านเว็บได้ (GitHub Pages)
    if (ROOT / "workspace").is_dir():
        import shutil
        shutil.copytree(ROOT / "workspace", ROOT / "docs/workspace", dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns("node_modules", ".venv", "__pycache__", ".git"))
        inject_helper()
    sh("git", "add", "-A")
    if sh("git", "diff", "--cached", "--quiet", check=False).returncode != 0:
        sh("git", "commit", "-q", "-m", msg)
    branch = sh("git", "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
    for attempt in range(5):
        sh("git", "fetch", "-q", "origin", branch)
        r = sh("git", "rebase", f"origin/{branch}", check=False)
        while r.returncode != 0:
            conflicted = sh("git", "diff", "--name-only", "--diff-filter=U").stdout.split()
            mergers = {"tasks.json": merge, "chat.json": merge_chat}
            if not conflicted or any(f not in mergers for f in conflicted):
                sh("git", "rebase", "--abort", check=False)
                raise SystemExit(f"รวมไฟล์ไม่ได้: {conflicted}")
            for f in conflicted:
                ours = json.loads(sh("git", "show", f":2:{f}").stdout)
                theirs = json.loads(sh("git", "show", f":3:{f}").stdout)
                save(mergers[f](ours, theirs), ROOT / f)
                sh("git", "add", f)
            r = subprocess.run(["git", "-c", "core.editor=true", "rebase", "--continue"], text=True, capture_output=True)
        if sh("git", "push", "-q", "origin", f"HEAD:{branch}", check=False).returncode == 0:
            return
        time.sleep(5 * (attempt + 1))
    raise SystemExit("push ไม่สำเร็จ")

def main():
    try:
        return work()
    finally:
        try:
            if release_locks():
                sync("autopilot: ปลดล็อกงาน")
        except BaseException as e:
            print("ปลดล็อกไม่สำเร็จ:", e)

def work():
    start = time.time()
    cfg = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
    if not cfg.get("enabled", True) and not FORCE:
        print("ระบบถูกปิดไว้ในแอป"); return 0
    tried = {}
    while True:
        used = (time.time() - start) / 60
        left = BUDGET_MIN - used
        if not FORCE:
            left = min(left, window_minutes_left(cfg))
        if left < 5:
            print("อยู่นอกช่วงเวลาทำงาน หรือหมดเวลารอบนี้"); return 0
        task = next_task()
        if not task:
            print("✅ ไม่มีงานค้าง"); return 0
        tid = task["id"]
        tried[tid] = tried.get(tid, 0) + 1
        if tried[tid] > 3:
            add_log(tid, "รอบนี้ทำงานนี้ไป 3 ครั้งแล้วยังไม่เสร็จ จะลองใหม่ในรอบถัดไป")
            sync(f"autopilot: พักงาน {tid}"); return 0
        set_lock(tid, True)
        sync(f"autopilot: เริ่ม {task.get('title', tid)[:40]}")
        minutes = int(min(SESSION_MIN, left - 2))
        print(f"▶ ทำงาน {tid}: {task.get('title')} ({minutes} นาที)", flush=True)
        prompt = (ROOT / "prompts/agent.md").read_text(encoding="utf-8") \
            .replace("{TASK_ID}", tid).replace("{MINUTES}", str(minutes)) \
            .replace("{PROJECT}", project_of(task)).replace("{PROJECT_NAME}", project_name(load(), project_of(task)))
        model = (task.get("model") or cfg.get("default_model") or "").strip()
        print(f"   โมเดล: {model or 'ค่าเริ่มต้นของ Claude Code'}", flush=True)
        out, code = call_claude(prompt, minutes, model)
        if code != 0 and model and MODEL_ERR_RE.search(out) and not LIMIT_RE.search(out):
            add_log(tid, f"⚠️ ใช้โมเดล {model} ไม่ได้ (แพ็กเกจอาจไม่รองรับ) — เปลี่ยนไปใช้โมเดลค่าเริ่มต้นแทน")
            out, code = call_claude(prompt, minutes, "")
        print(out[-3000:], flush=True)
        if code != 0 and LIMIT_RE.search(out):
            line = next((l for l in out.splitlines() if LIMIT_RE.search(l)), "")[:200]
            rt = reset_time(out)
            wait = (rt - datetime.datetime.now(datetime.timezone.utc)).total_seconds() / 60 + 2 if rt else None
            budget_left = BUDGET_MIN - (time.time() - start) / 60
            win_left = budget_left if FORCE else min(budget_left, window_minutes_left(cfg))
            if wait is not None and 0 < wait <= MAX_WAIT_MIN and wait + 10 < win_left:
                local = rt.astimezone(ZoneInfo(cfg.get("timezone", "Asia/Bangkok"))).strftime("%H:%M")
                add_log(tid, f"⏸ ติด limit ของ Claude — รอให้รีเซ็ตตอน {local} แล้วจะทำต่อทันที ({line})")
                sync("autopilot: รอ limit รีเซ็ต")
                time.sleep(wait * 60)
                tried[tid] -= 1
                continue
            add_log(tid, f"⏸ ติด limit ของ Claude — พักไว้ก่อน แล้วจะทำต่ออัตโนมัติในรอบถัดไปหลัง limit รีเซ็ต ({line})")
            sync("autopilot: พักเพราะติด limit"); return 0
        if code == 124:
            add_log(tid, "⌛ หมดเวลาของรอบย่อย — จะทำต่อจากเดิม")
        elif code != 0:
            add_log(tid, f"⚠️ เกิดข้อผิดพลาด (exit {code}): {out.strip()[-300:]}")
            sync("autopilot: error"); return 1
        sync(f"autopilot: {task.get('title', tid)[:50]}")

if __name__ == "__main__":
    sys.exit(main())
