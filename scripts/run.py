#!/usr/bin/env python3
"""ตัวรัน: ทำงานเฉพาะในช่วงเวลาที่ตั้งไว้, ทีละงาน, หยุดพักเมื่อติด limit แล้วบันทึกลง git"""
import json, os, re, subprocess, sys, time, datetime, pathlib
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.dirname(__file__))
from tasklib import ROOT, load, save, find, now, merge, merge_chat, project_of, project_name, valid_model, project_info, REPO_RE

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
GH_API = os.environ.get("GITHUB_API_URL", "https://api.github.com")
GH_HOST = os.environ.get("GIT_HOST_URL", "https://github.com")

def _read_secret(var):
    """อ่าน token จากไฟล์ (workflow เขียนไว้ให้) แล้วลบไฟล์ทันที — token จึงไม่อยู่ใน env หรือดิสก์ตอน AI ทำงาน"""
    path = os.environ.pop(var, "")
    if not path:
        return ""
    try:
        tok = pathlib.Path(path).read_text().strip()
        os.remove(path)
        return tok
    except OSError:
        return ""
REPO_TOKEN = _read_secret("GH_REPO_TOKEN_FILE")   # สำหรับ repo อื่นที่นำเข้ามา
ROOT_TOKEN = _read_secret("GH_TOKEN_FILE")        # สำหรับ push repo ai-autopilot เอง
GIT_TIMEOUT = 600
os.chdir(ROOT)

def git_env(token):
    """env ของ git ที่ส่ง token ทาง extraheader (ไม่โผล่ใน URL, log หรือ .git/config)"""
    import base64
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
    if token:
        auth = base64.b64encode(f"x-access-token:{token}".encode()).decode()
        env.update(GIT_CONFIG_COUNT="1", GIT_CONFIG_KEY_0=f"http.{GH_HOST}/.extraheader",
                   GIT_CONFIG_VALUE_0=f"AUTHORIZATION: basic {auth}")
    return env

def sh(*cmd, check=True):
    env = git_env(ROOT_TOKEN) if cmd and cmd[0] == "git" else None
    return subprocess.run(cmd, check=check, text=True, capture_output=True, env=env, timeout=GIT_TIMEOUT)

# ---------- โปรเจคที่เป็น GitHub repo ----------
def repo_dir(pid):
    return ROOT / "repos" / pid

def rgit(pid, *args, check=True, cwd=True):
    """รัน git กับ repo ของโปรเจค"""
    try:
        p = subprocess.run(["git", *args], cwd=repo_dir(pid) if cwd else ROOT, env=git_env(REPO_TOKEN),
                           text=True, capture_output=True, timeout=GIT_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"git {args[0]}: หมดเวลา ({GIT_TIMEOUT // 60} นาที)")
    if check and p.returncode != 0:
        raise RuntimeError(f"git {args[0]}: " + (p.stderr or p.stdout).replace(REPO_TOKEN or "\0", "***").strip()[-300:])
    return p

def branch_of(tid):
    return f"ai-autopilot/{tid}"

def gh_api(path, method="GET", body=None):
    import urllib.request
    req = urllib.request.Request(GH_API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {REPO_TOKEN}", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"null")

def prepare_repo(proj, tid):
    """clone repo ของโปรเจค แล้วสลับไป branch ของงานนี้ (ทำต่อจากรอบก่อนถ้ามี) คืนค่า (branch งาน, branch หลัก)"""
    pid, full = proj["id"], proj["repo"]
    info = gh_api(f"/repos/{full}")                      # อ่าน branch หลักปัจจุบัน (เผื่อเปลี่ยนชื่อหลังนำเข้า)
    base = info.get("default_branch") or proj.get("branch") or "main"
    d = repo_dir(pid)
    if not (d / ".git").is_dir():
        d.parent.mkdir(exist_ok=True)
        rgit(pid, "clone", "-q", f"{GH_HOST}/{full}.git", str(d), cwd=False)
        rgit(pid, "config", "user.name", "ai-autopilot")
        rgit(pid, "config", "user.email", "ai-autopilot@users.noreply.github.com")
    rgit(pid, "fetch", "-q", "origin")
    if rgit(pid, "rev-parse", "--verify", "-q", f"origin/{base}", check=False).returncode != 0:
        raise RuntimeError(f"repo ยังว่างหรือไม่มี branch หลัก '{base}' — เพิ่มไฟล์แรก (เช่น README) ใน GitHub ก่อน แล้วสั่งงานนี้ใหม่")
    br = branch_of(tid)
    if rgit(pid, "rev-parse", "--verify", "-q", f"origin/{br}", check=False).returncode == 0:
        rgit(pid, "checkout", "-q", "-B", br, f"origin/{br}")
    else:
        rgit(pid, "checkout", "-q", "-B", br, f"origin/{base}")
    return br, base

def push_repo(proj, task, br, base):
    """commit งานใน repo ของโปรเจค, push ไป branch ของงาน แล้วเปิด PR (ถ้ายังไม่มี PR ที่เปิดอยู่)"""
    pid, tid, full = proj["id"], task["id"], proj["repo"]
    rgit(pid, "add", "-A")
    if rgit(pid, "diff", "--cached", "--quiet", check=False).returncode != 0:
        rgit(pid, "commit", "-q", "-m", f"ai-autopilot: {task.get('title', tid)[:60]}")
    for attempt in range(3):                            # ถ้ามีรอบอื่น push มาก่อน ให้ rebase แล้วลองใหม่
        if rgit(pid, "push", "-q", "origin", f"HEAD:refs/heads/{br}", check=False).returncode == 0:
            break
        rgit(pid, "fetch", "-q", "origin")
        if rgit(pid, "rebase", "-q", f"origin/{br}", check=False).returncode != 0:
            rgit(pid, "rebase", "--abort", check=False)
            raise RuntimeError(f"push ไป {br} ไม่ได้: มีการแก้ไขชนกันที่ต้องรวมเอง")
    else:
        raise RuntimeError(f"push ไป {br} ไม่สำเร็จ")
    if task.get("pr"):
        m = re.search(r"/pull/(\d+)", task["pr"])
        if m and gh_api(f"/repos/{full}/pulls/{m.group(1)}").get("state") == "open":
            return None                                  # PR เดิมยังเปิดอยู่ commit ใหม่จะขึ้นใน PR นั้นเอง
    ahead = rgit(pid, "rev-list", "--count", f"origin/{base}..HEAD").stdout.strip()
    if ahead == "0":
        return None                                      # ยังไม่มีอะไรเปลี่ยน ไม่ต้องเปิด PR
    owner = full.split("/")[0]
    found = gh_api(f"/repos/{full}/pulls?state=open&head={owner}:{br}")
    if found:
        return found[0]["html_url"]
    body = (task.get("detail") or "") + f"\n\n---\nสร้างโดย AI Autopilot จากงาน `{tid}`"
    return gh_api(f"/repos/{full}/pulls", "POST", {"title": task.get("title", tid)[:120], "head": br, "base": base, "body": body.strip()})["html_url"]

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
    if model and valid_model(model):   # รับเฉพาะชื่อโมเดลที่อนุญาต กันค่าแปลกๆ ถูกตีความเป็น option อื่น
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
    sev = {"high": 0, "normal": 1, "low": 2}   # บั๊กด่วนมาก่อนงานอื่นที่สถานะเดียวกัน
    live.sort(key=lambda t: (rank.get(t.get("status", "todo"), 3),
                             sev.get(t.get("severity"), 1) if t.get("kind") == "bug" else 1.5))
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
        task = find(load(), tid)  # โหลดใหม่หลังซิงก์ เผื่อผู้ใช้เพิ่งเปลี่ยนโมเดล/รายละเอียด
        minutes = int(min(SESSION_MIN, left - 2))
        print(f"▶ ทำงาน {tid}: {task.get('title')} ({minutes} นาที)", flush=True)
        pid = project_of(task)
        proj = project_info(load(), pid)
        repo_br = repo_base = None
        if proj.get("repo"):
            err = None
            if not REPO_RE.match(proj["repo"]):
                err = f"ชื่อ repo '{proj['repo'][:60]}' ไม่ถูกต้อง"
            elif not REPO_TOKEN:
                err = ("ยังไม่ได้ใส่ GH_REPO_TOKEN — ไปที่ GitHub repo ai-autopilot → Settings → Secrets and variables → Actions "
                       "→ New repository secret ชื่อ GH_REPO_TOKEN ใส่ token ที่เข้าถึง repo นี้ได้ (Contents + Pull requests: Read and write)")
            else:
                try:
                    repo_br, repo_base = prepare_repo(proj, tid)
                except Exception as e:
                    err = f"เปิด repo {proj['repo']} ไม่ได้: {e}"
            if err:
                data = load(); t = find(data, tid); t["status"] = "blocked"; t["updated"] = now()
                t.setdefault("log", []).append({"time": now(), "by": "system", "text": "⚠️ " + err})
                save(data); sync("autopilot: repo ไม่พร้อม"); continue
        workdir = f"repos/{pid}/" if repo_br else f"workspace/{pid}/"
        note = (ROOT / ("prompts/repo.md" if repo_br else "prompts/app.md")).read_text(encoding="utf-8").strip()
        prompt = (ROOT / "prompts/agent.md").read_text(encoding="utf-8").replace("{PROJECT_NOTE}", note) \
            .replace("{WORKDIR}", workdir).replace("{REPO}", proj.get("repo", "")).replace("{BRANCH}", repo_br or "") \
            .replace("{TASK_ID}", tid).replace("{MINUTES}", str(minutes)) \
            .replace("{PROJECT}", pid).replace("{PROJECT_NAME}", project_name(load(), pid))
        if task.get("kind") == "bug":
            sevname = {"high": "ด่วน", "low": "เล็กน้อย"}.get(task.get("severity"), "ปกติ")
            prompt += "\n" + (ROOT / "prompts/bug.md").read_text(encoding="utf-8").replace("{SEVERITY}", sevname)
        model = (task.get("model") or cfg.get("default_model") or "").strip()
        if not valid_model(model):
            add_log(tid, f"⚠️ ชื่อโมเดล '{model[:40]}' ไม่ถูกต้อง — ใช้โมเดลค่าเริ่มต้นแทน"); model = ""
        t0 = time.time()
        print(f"   โมเดล: {model or 'ค่าเริ่มต้นของ Claude Code'}", flush=True)
        out, code = call_claude(prompt, minutes, model)
        if code != 0 and model and MODEL_ERR_RE.search(out) and not LIMIT_RE.search(out):
            add_log(tid, f"⚠️ ใช้โมเดล {model} ไม่ได้ (แพ็กเกจอาจไม่รองรับ) — เปลี่ยนไปใช้โมเดลค่าเริ่มต้นแทน")
            remain = int(minutes - (time.time() - t0) / 60)
            if remain >= 3:
                out, code = call_claude(prompt, remain, "")
            else:
                out, code = "timeout", 124
        print(out[-3000:], flush=True)
        if repo_br:
            try:
                url = push_repo(proj, find(load(), tid), repo_br, repo_base)
                if url:
                    data = load(); t = find(data, tid); t["pr"] = url; t["updated"] = now()
                    t.setdefault("log", []).append({"time": now(), "by": "system", "text": f"🔀 เปิด Pull Request ใน {proj['repo']} แล้ว: {url}"})
                    save(data)
            except Exception as e:
                # เผยแพร่ไม่สำเร็จ: อย่าปล่อยให้งานค้างเป็น "เสร็จแล้ว" เพื่อให้รอบหน้าทำ/ส่งงานนี้ใหม่
                data = load(); t = find(data, tid)
                if t.get("status") == "done":
                    t["status"] = "testing"
                t["updated"] = now()
                t.setdefault("log", []).append({"time": now(), "by": "system",
                    "text": f"⚠️ บันทึกงานลง {proj['repo']} ไม่สำเร็จ จะลองใหม่รอบหน้า: {str(e).replace(REPO_TOKEN or chr(0), '***')[:300]}"})
                save(data)
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
