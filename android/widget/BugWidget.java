package __PKG__;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** widget หน้าจอโฮม: จำนวนบั๊กที่ยังไม่แก้ + ปุ่มจดบั๊กใหม่ */
public class BugWidget extends AppWidgetProvider {
    static final String OWNER = "__OWNER__", REPO = "__REPO__";
    static final String[] SOURCES = {
        "https://api.github.com/repos/" + OWNER + "/" + REPO + "/contents/tasks.json",
        "https://raw.githubusercontent.com/" + OWNER + "/" + REPO + "/main/tasks.json",
    };
    static final String PREFS = "bug_widget";

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        final PendingResult r = goAsync();
        final Context c = ctx.getApplicationContext();
        new Thread(() -> { try { update(c); } finally { r.finish(); } }).start();
    }

    /** เรียกจากแอปตอนออกจากหน้าจอ (เผื่อเพิ่งจดบั๊ก) */
    static void refreshAll(Context ctx) {
        final Context c = ctx.getApplicationContext();
        new Thread(() -> update(c)).start();
    }

    static void update(Context c) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(c);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(c, BugWidget.class));
        if (ids == null || ids.length == 0) return;
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        draw(c, mgr, ids, p.getInt("open", -1), p.getInt("high", 0), "กำลังโหลด…");
        try {
            JSONArray tasks = new JSONObject(fetch()).getJSONArray("tasks");
            int open = 0, high = 0;
            for (int i = 0; i < tasks.length(); i++) {
                JSONObject t = tasks.getJSONObject(i);
                if (!"bug".equals(t.optString("kind")) || t.optBoolean("deleted") || "done".equals(t.optString("status"))) continue;
                open++;
                if ("high".equals(t.optString("severity"))) high++;
            }
            String at = new SimpleDateFormat("HH:mm", Locale.US).format(new Date());
            p.edit().putInt("open", open).putInt("high", high).putString("at", at).apply();
            draw(c, mgr, ids, open, high, "อัปเดต " + at);
        } catch (Exception e) {
            String at = p.getString("at", null);
            draw(c, mgr, ids, p.getInt("open", -1), p.getInt("high", 0), at == null ? "ออฟไลน์" : "ออฟไลน์ · ล่าสุด " + at);
        }
    }

    static String fetch() throws Exception {
        Exception last = null;
        for (String src : SOURCES) {
            HttpURLConnection h = null;
            try {
                h = (HttpURLConnection) new URL(src).openConnection();
                h.setConnectTimeout(10000); h.setReadTimeout(15000); h.setUseCaches(false);
                h.setRequestProperty("Accept", "application/vnd.github.raw");
                h.setRequestProperty("User-Agent", "ai-autopilot-widget");
                if (h.getResponseCode() != 200) throw new Exception("HTTP " + h.getResponseCode());
                InputStream in = h.getInputStream();
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[8192]; int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                return out.toString("UTF-8");
            } catch (Exception e) { last = e; }
            finally { if (h != null) h.disconnect(); }
        }
        throw last;
    }

    static void draw(Context c, AppWidgetManager mgr, int[] ids, int open, int high, String sub) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.bug_widget);
        v.setTextViewText(R.id.bw_count, open < 0 ? "–" : String.valueOf(open));
        v.setTextViewText(R.id.bw_high, high > 0 ? "🔴 ด่วน " + high : "");
        v.setTextViewText(R.id.bw_sub, sub);
        v.setOnClickPendingIntent(R.id.bw_add, open(c, "newbug", 1));
        v.setOnClickPendingIntent(R.id.bw_info, open(c, "bugs", 2));
        mgr.updateAppWidget(ids, v);
    }

    static PendingIntent open(Context c, String hash, int code) {
        Intent i = new Intent(c, MainActivity.class)
            .putExtra(MainActivity.EXTRA_HASH, hash)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
