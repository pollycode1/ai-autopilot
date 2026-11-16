#!/usr/bin/env bash
# สร้าง APK จากเว็บแอป (Capacitor)  ใช้: build_apk.sh <id> <โฟลเดอร์เว็บ> <ชื่อแอป> <ไฟล์ apk ปลายทาง>
set -euo pipefail
ID="$1"; WEB="$(cd "$2" && pwd)"; NAME="$3"; OUT="$(realpath -m "$4")"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="com.autopilot.$(echo "$ID" | tr -cd 'a-zA-Z0-9' | tr 'A-Z' 'a-z' | sed 's/^\([0-9]\)/a\1/')"
B="$(mktemp -d)"; cd "$B"
npm init -y >/dev/null
npm install --silent @capacitor/core@6 @capacitor/cli@6 @capacitor/android@6 >/dev/null
mkdir www && cp -r "$WEB"/. www/
rm -rf www/workspace www/node_modules
[ -f www/index.html ] || { echo "ไม่มี index.html ใน $WEB"; exit 1; }
npx cap init "$NAME" "$PKG" --web-dir www >/dev/null
npx cap add android >/dev/null
# ไอคอน: ถ้าเว็บแอปมี icon-512.png / icon.png ให้ใช้เป็นไอคอนแอป
ICON=""; for f in icon-512.png icon.png; do [ -f "www/$f" ] && ICON="www/$f" && break; done
if [ -n "$ICON" ]; then
  for d in android/app/src/main/res/mipmap-*; do
    for n in ic_launcher.png ic_launcher_round.png ic_launcher_foreground.png; do [ -f "$d/$n" ] && cp "$ICON" "$d/$n"; done
  done
  rm -f android/app/src/main/res/mipmap-anydpi-v26/ic_launcher*.xml
fi
# ใช้ key เดิมทุกครั้ง เพื่อให้ติดตั้งทับ (อัปเดต) ได้
mkdir -p ~/.android && cp "$ROOT/android/debug.keystore" ~/.android/debug.keystore
# เลขเวอร์ชันเพิ่มขึ้นทุกครั้งที่ build
sed -i "s/versionCode 1$/versionCode $(( $(date +%s) / 60 ))/" android/app/build.gradle
(cd android && ./gradlew -q assembleDebug)
mkdir -p "$(dirname "$OUT")" && cp android/app/build/outputs/apk/debug/app-debug.apk "$OUT"
echo "✅ $OUT"
