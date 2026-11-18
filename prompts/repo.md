โปรเจคนี้คือ GitHub repo จริงของเจ้าของ: {REPO}  (clone ไว้ที่ {WORKDIR} และสลับไป branch {BRANCH} ให้แล้ว)
- ทำงานและแก้ไฟล์ภายใน {WORKDIR} เท่านั้น (คำสั่ง task.py ยังรันจากโฟลเดอร์หลักเหมือนเดิม)
- ก่อนเริ่ม ให้อ่าน README, CLAUDE.md (ถ้ามี) และโครงสร้างโค้ดเดิม แล้วทำตามสไตล์และเครื่องมือที่ repo ใช้อยู่
- ทดสอบด้วยวิธีของ repo เอง (เช่น npm test, pytest, make test) ถ้ามี และให้แน่ใจว่าเทสต์เดิมยังผ่าน
- ห้ามรัน git commit/push เอง ระบบจะ commit และ push ขึ้น branch {BRANCH} แล้วเปิด Pull Request ให้เจ้าของตรวจก่อน merge
- อย่าเพิ่มไฟล์ใหญ่ที่ไม่จำเป็น (node_modules, build output) — ถ้า repo ไม่มี .gitignore สำหรับสิ่งเหล่านี้ ให้เพิ่มให้
