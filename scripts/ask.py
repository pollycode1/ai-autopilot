#!/usr/bin/env python3
"""ตอบคำถามที่ค้างอยู่ใน chat.json โดยให้ Claude อ่านข้อมูลงานใน repo (อ่านอย่างเดียว)"""
import json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
from tasklib import ROOT, now
import run  # ใช้ sync() และ LIMIT_RE

CHAT = ROOT / "chat.json"
CLAUDE = os.environ.get("CLAUDE_BIN", "claude")

def load_chat():
    try:
        return json.loads(CHAT.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"messages": []}

def save_chat(d):
    CHAT.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def repo_name():
    full = os.environ.get("GITHUB_REPOSITORY", "")
    if not full:
        url = subprocess.run(["git", "config", "--get", "remote.origin.url"], text=True, capture_output=True, cwd=ROOT).stdout.strip()
        full = url.split("github.com")[-1].lstrip(":/").removesuffix(".git")
    return full

def prompt_for(q, history):
    full = repo_name(); owner, _, name = full.partition("/")
    tasks = json.loads((ROOT / "tasks.json").read_text(encoding="utf-8"))["tasks"]
    scope = q.get("task")
    if scope:
        t = next((x for x in tasks if x["id"] == scope), None)
        where = (f'คำถามนี้เกี่ยวกับงาน id="{scope}" ({t["title"] if t else "?"}) '
                 f'ดูรายละเอียดงานใน tasks.json และผลงานในโฟลเดอร์ workspace/{scope}/')
    else:
        where = "คำถามนี้เป็นคำถามรวม เกี่ยวกับทุกงาน ดูภาพรวมจาก tasks.json และผลงานใน workspace/"
    hist = "\n".join(f'{"เจ้าของ" if m["by"] == "user" else "AI"}: {m["text"]}' for m in history[-10:])
    return f"""คุณคือผู้ช่วยตอบคำถามเกี่ยวกับงานที่ระบบ AI Autopilot ทำให้เจ้าของ
ข้อมูลอยู่ใน repo นี้: tasks.json (รายการงาน สถานะ แผน และบันทึกการทำงาน) และ workspace/<id งาน>/ (ไฟล์ผลงาน)
{where}

ความรู้เกี่ยวกับระบบ (ใช้ตอบได้เลย):
- งานที่เป็นแอป (มี workspace/<id>/index.html) ระบบสร้างไฟล์ APK ให้อัตโนมัติทุกครั้งที่มีการแก้ไข
  ดาวน์โหลดได้ที่ https://github.com/{full}/releases/download/apps/<id>.apk (รวมทุกแอป: https://github.com/{full}/releases/tag/apps)
- เปิดผ่านเว็บได้ที่ https://{owner}.github.io/{name}/workspace/<id>/
- ในแอปที่ติดตั้งจาก APK มีปุ่ม 🔧 มุมขวาล่าง ใส่ key (GitHub token) แล้วพิมพ์สิ่งที่อยากให้ AI อัปเดต AI จะทำให้ทันที
  และเมื่อออนไลน์ แอปจะเปิดเวอร์ชันล่าสุดเอง ถ้ามี APK ใหม่จะมีแถบแจ้งเตือนด้านบน
- สั่งให้ AI ทำงานเพิ่ม: เพิ่มงานใหม่ในแท็บ "งาน" หรือส่งข้อความถึง AI ในหน้างานนั้น แล้วกด "เริ่มทำงานตอนนี้" ในแท็บสถานะ

ให้อ่านไฟล์ที่เกี่ยวข้องก่อนตอบ ตอบจากข้อมูลจริงใน repo ถ้าไม่มีข้อมูลให้บอกตรงๆ
ตอบเป็นภาษาเดียวกับคำถาม กระชับ อ่านง่ายบนมือถือ ถ้าอ้างถึงไฟล์ให้บอก path
ห้ามแก้ไขไฟล์ใดๆ ถ้าเจ้าของอยากให้ทำงานเพิ่ม ให้แนะนำให้เพิ่มเป็นงานใหม่ หรือส่งข้อความถึง AI ในหน้างานนั้น

บทสนทนาก่อนหน้า:
{hist or "(ไม่มี)"}

คำถาม: {q["text"]}"""

def main():
    d = load_chat()
    pending = [m for m in d["messages"] if m.get("by") == "user" and m.get("status") == "pending"]
    if not pending:
        print("ไม่มีคำถามค้าง"); return 0
    for q in pending:
        history = [m for m in d["messages"] if m.get("time", "") < q.get("time", "") and m.get("task") == q.get("task")]
        print(f"❓ {q['text'][:80]}", flush=True)
        try:
            p = subprocess.run([CLAUDE, "-p", prompt_for(q, history), "--allowedTools", "Read,Grep,Glob,LS",
                                "--max-turns", "30"], text=True, capture_output=True, timeout=15 * 60, cwd=ROOT)
            out, code = (p.stdout or "").strip(), p.returncode
            err = (p.stderr or "") + out
        except subprocess.TimeoutExpired:
            out, code, err = "", 124, "timeout"
        d = load_chat()  # อ่านใหม่เผื่อมีคำถามเพิ่มระหว่างรอ
        cur = next(m for m in d["messages"] if m["id"] == q["id"])
        if code != 0 and run.LIMIT_RE.search(err):
            print("ติด limit — คำถามจะรอตอบภายหลัง")
            run.sync("ask: ติด limit"); return 0
        if code != 0 or not out:
            cur["status"] = "error"
            out = f"ขออภัย ตอบไม่สำเร็จ (exit {code}) ลองถามใหม่อีกครั้ง\n{err.strip()[-300:]}"
        else:
            cur["status"] = "answered"
        d["messages"].append({"id": q["id"] + "-a", "time": now(), "by": "ai", "task": q.get("task"),
                              "reply_to": q["id"], "text": out, "status": "answered"})
        save_chat(d)
        run.sync("ask: ตอบคำถาม")
    return 0

if __name__ == "__main__":
    sys.exit(main())
