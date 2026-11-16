/* AI Autopilot helper — ใส่ให้ทุกแอปที่ AI สร้างโดยอัตโนมัติ
   1) ในไฟล์ APK: ถ้าออนไลน์ จะเปิดเวอร์ชันล่าสุดจากเว็บ (ออฟไลน์ใช้เวอร์ชันในเครื่อง)
   2) แจ้งเตือนเมื่อมีไฟล์ APK ใหม่
   3) ปุ่ม 🔧 : ใส่ key (GitHub token) แล้วสั่งให้ AI อัปเดตข้อมูล/แก้แอปนี้ได้จากในแอป */
(function () {
  const me = document.currentScript;
  const APP = me.dataset.app, OWNER = me.dataset.owner, REPO = me.dataset.repo;
  const BUILD = me.dataset.build || new URLSearchParams(location.search).get("apk") || sessionStorage.getItem("ap-build");
  const LOCAL = me.dataset.local === "1";
  const LIVE = `https://${OWNER}.github.io/${REPO}/workspace/${APP}/`;
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
  if (BUILD) try { sessionStorage.setItem("ap-build", BUILD); } catch {}

  // 1) เปิดเวอร์ชันล่าสุดจากเว็บ
  if (LOCAL && navigator.onLine && store.get("ap-live") !== "off") {
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 3500);
    fetch(LIVE + "index.html", { cache: "no-store", signal: ctl.signal })
      .then(r => { if (r.ok) location.replace(LIVE + "?apk=" + encodeURIComponent(BUILD || "")); })
      .catch(() => {});
  }

  const css = `#aph-btn{position:fixed;right:14px;bottom:14px;z-index:99999;width:46px;height:46px;border-radius:50%;border:0;background:#0284c7;color:#fff;font-size:22px;box-shadow:0 4px 14px rgba(0,0,0,.3);cursor:pointer}
#aph-panel{position:fixed;inset:auto 10px 70px 10px;max-width:420px;margin-left:auto;z-index:99999;background:#fff;color:#0f172a;border-radius:14px;padding:16px;box-shadow:0 8px 30px rgba(0,0,0,.35);font:15px/1.5 system-ui,sans-serif;display:none}
#aph-panel input,#aph-panel textarea{width:100%;box-sizing:border-box;padding:9px;border:1px solid #cbd5e1;border-radius:9px;font:inherit;margin:4px 0 10px}
#aph-panel textarea{min-height:80px}#aph-panel button{font:inherit;padding:8px 14px;border-radius:9px;border:1px solid #cbd5e1;background:#f1f5f9;cursor:pointer}
#aph-panel .p{background:#0284c7;color:#fff;border-color:#0284c7}#aph-panel small{color:#64748b;display:block}
#aph-bar{position:fixed;left:0;right:0;top:0;z-index:99999;background:#fbbf24;color:#0f172a;padding:10px 14px;font:14px system-ui,sans-serif;text-align:center}
#aph-bar a{color:#0f172a;font-weight:700}`;
  function ui() {
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    const b = document.createElement("button"); b.id = "aph-btn"; b.title = "สั่ง AI อัปเดตแอปนี้"; b.textContent = "🔧";
    const p = document.createElement("div"); p.id = "aph-panel";
    p.innerHTML = `<b>สั่ง AI อัปเดตแอปนี้</b><small>ใส่ key ครั้งเดียว แล้วพิมพ์สิ่งที่อยากให้อัปเดต AI จะทำให้บนคลาวด์ เสร็จแล้วปิด-เปิดแอปใหม่เพื่อดูเวอร์ชันล่าสุด</small>
      <label><small>Key (GitHub token ตัวเดียวกับแอป Autopilot)</small><input id="aph-key" type="password" placeholder="github_pat_…"></label>
      <label><small>อยากให้อัปเดตอะไร</small><textarea id="aph-msg" placeholder="เช่น อัปเดตข้อมูลผลตอบแทนล่าสุด / เพิ่มหุ้นปันผล / แก้หน้าคำนวณ"></textarea></label>
      <div style="display:flex;gap:8px;align-items:center"><button id="aph-close">ปิด</button><span style="flex:1"></span><button class="p" id="aph-send">ส่งให้ AI</button></div>
      <small id="aph-st" style="margin-top:8px"></small>`;
    document.body.append(b, p);
    const $ = s => p.querySelector(s);
    $("#aph-key").value = store.get("ap-key") || "";
    b.onclick = () => { p.style.display = p.style.display === "block" ? "none" : "block"; };
    $("#aph-close").onclick = () => { p.style.display = "none"; };
    $("#aph-send").onclick = async () => {
      const key = $("#aph-key").value.trim(), msg = $("#aph-msg").value.trim();
      if (!key || !msg) { $("#aph-st").textContent = "ใส่ key และข้อความก่อน"; return; }
      store.set("ap-key", key); $("#aph-send").disabled = true; $("#aph-st").textContent = "กำลังส่ง…";
      try { await requestUpdate(key, msg); $("#aph-msg").value = ""; $("#aph-st").textContent = "✅ ส่งแล้ว AI เริ่มทำงานภายในไม่กี่นาที (ดูความคืบหน้าในแอป Autopilot)"; }
      catch (e) { $("#aph-st").textContent = "❌ " + (e.status === 401 ? "key ไม่ถูกต้องหรือหมดอายุ" : e.status === 403 || e.status === 404 ? "key ไม่มีสิทธิ์เข้าถึง repo นี้" : e.message); }
      $("#aph-send").disabled = false;
    };
  }
  async function gh(key, path, opt = {}) {
    const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, { ...opt, cache: "no-store",
      headers: { Authorization: `Bearer ${key}`, Accept: "application/vnd.github+json" } });
    if (!r.ok) { const e = new Error("GitHub " + r.status); e.status = r.status; throw e; }
    return r.status === 204 ? null : r.json();
  }
  const b64e = s => { const b = new TextEncoder().encode(s); let r = ""; for (let i = 0; i < b.length; i += 0x8000) r += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(r); };
  const b64d = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), c => c.charCodeAt(0)));
  async function requestUpdate(key, msg) {
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    for (let i = 0; i < 4; i++) {
      const j = await gh(key, "/contents/tasks.json");
      const d = JSON.parse(b64d(j.content));
      const t = d.tasks.find(x => x.id === APP);
      if (!t) throw new Error("ไม่พบงานของแอปนี้ในระบบ");
      (t.log ||= []).push({ time: now, by: "user", text: "[ขอจากในแอป] " + msg });
      t.status = "doing"; t.updated = now;
      try {
        await gh(key, "/contents/tasks.json", { method: "PUT", body: JSON.stringify({ message: "app: ขออัปเดต " + APP, sha: j.sha,
          content: b64e(JSON.stringify(d, null, 2) + "\n") }) });
        break;
      } catch (e) { if (e.status !== 409 && e.status !== 422 || i === 3) throw e; await new Promise(r => setTimeout(r, 1000)); }
    }
    await gh(key, "/actions/workflows/autopilot.yml/dispatches", { method: "POST", body: JSON.stringify({ ref: "main", inputs: { force: true } }) });
  }
  // 2) แจ้งเตือน APK ใหม่ (เฉพาะตอนเปิดจากไฟล์ APK)
  function checkApk() {
    if (!BUILD) return;
    fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/apps`, { cache: "no-store" }).then(r => r.ok && r.json()).then(j => {
      const a = j && j.assets.find(x => x.name === APP + ".apk");
      if (!a || Math.floor(Date.parse(a.updated_at) / 60000) <= +BUILD + 10) return;
      const bar = document.createElement("div"); bar.id = "aph-bar";
      bar.innerHTML = `มีแอปเวอร์ชันใหม่ <a href="${a.browser_download_url}">ดาวน์โหลด APK</a> · <a href="#" id="aph-x">ภายหลัง</a>`;
      document.body.appendChild(bar); bar.querySelector("#aph-x").onclick = e => { e.preventDefault(); bar.remove(); };
    }).catch(() => {});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { ui(); checkApk(); }); else { ui(); checkApk(); }
})();
