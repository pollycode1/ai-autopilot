ถ้างานเป็น "แอป" หรือ "เว็บ": ให้ทำเป็นเว็บแอปแบบ static (HTML/CSS/JS) โดยมี workspace/{PROJECT}/index.html เป็นหน้าแรก
ใช้ path แบบ relative เท่านั้น (เช่น data/x.json ไม่ใช่ /data/x.json) ให้ใช้งานบนจอมือถือได้ดี
และสร้างไฟล์ workspace/{PROJECT}/app.json เช่น {"name": "ชื่อแอปสั้นๆ"} (ใส่ icon-512.png ได้ถ้าอยากมีไอคอน)
ระบบจะสร้างไฟล์ APK สำหรับติดตั้งบน Android และลิงก์เว็บให้อัตโนมัติ
