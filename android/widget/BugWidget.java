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

/** widget หน้าจอโฮมแบบ BugNote: จำนวนบั๊ก/ฟีเจอร์ค้าง, รายการล่าสุด, ปุ่ม + Bug / + ฟีเจอร์ */
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

    // synchronized: รีเฟรชซ้อนกันจะทำทีละรอบ รอบล่าสุดจึงเขียนทับเสมอ (ข้อมูลเก่าไม่ทับข้อมูลใหม่)
    static final int ROWS = 5;
    static final int[] ROW_IDS = {R.id.bw_r0, R.id.bw_r1, R.id.bw_r2, R.id.bw_r3, R.id.bw_r4};

    // synchronized: รีเฟรชซ้อนกันจะทำทีละรอบ รอบล่าสุดจึงเขียนทับเสมอ (ข้อมูลเก่าไม่ทับข้อมูลใหม่)
    static synchronized void update(Context c) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(c);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(c, BugWidget.class));
        if (ids == null || ids.length == 0) return;
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String cached = p.getString("data", null), at = p.getString("at", null);
        draw(c, mgr, ids, cached, at == null ? "กำลังโหลด…" : at);
        try {
            String data = summarize(new JSONObject(fetch()));
            at = new SimpleDateFormat("HH:mm", Locale.US).format(new Date());
            p.edit().putString("data", data).putString("at", at).apply();
            draw(c, mgr, ids, data, at);
        } catch (Exception e) {
            android.util.Log.w("BugWidget", "refresh failed", e);
            draw(c, mgr, ids, cached, at == null ? "ออฟไลน์" : "ออฟไลน์ " + at);
        }
    }

    /** สรุปจาก tasks.json: จำนวนบั๊ก/ฟีเจอร์ที่ยังไม่เสร็จ + รายการล่าสุด (บั๊กด่วนขึ้นก่อน) */
    static String summarize(JSONObject d) throws Exception {
        JSONObject names = new JSONObject();
        JSONArray ps = d.optJSONArray("projects");
        if (ps != null) for (int i = 0; i < ps.length(); i++) { JSONObject pr = ps.getJSONObject(i); names.put(pr.optString("id"), pr.optString("name", pr.optString("id"))); }
        JSONArray tasks = d.getJSONArray("tasks");
        java.util.List<JSONObject> open = new java.util.ArrayList<>();
        int bugs = 0, feats = 0;
        for (int i = 0; i < tasks.length(); i++) {
            JSONObject t = tasks.getJSONObject(i);
            if (t.optBoolean("deleted") || "done".equals(t.optString("status"))) continue;
            if ("bug".equals(t.optString("kind"))) bugs++; else feats++;
            open.add(t);
        }
        java.util.Collections.sort(open, (a, b) -> {
            int ha = "high".equals(a.optString("severity")) ? 0 : 1, hb = "high".equals(b.optString("severity")) ? 0 : 1;
            if (ha != hb) return ha - hb;
            return b.optString("updated").compareTo(a.optString("updated"));
        });
        JSONArray rows = new JSONArray();
        for (int i = 0; i < Math.min(ROWS, open.size()); i++) {
            JSONObject t = open.get(i);
            String pid = t.optString("project", ""); if (pid.isEmpty()) pid = t.optString("id");
            String proj = names.optString(pid, "");
            boolean bug = "bug".equals(t.optString("kind"));
            String icon = bug ? ("high".equals(t.optString("severity")) ? "🔴" : "🐞") : "✨";
            rows.put(new JSONObject().put("id", t.optString("id"))
                .put("text", icon + " " + t.optString("title") + (proj.isEmpty() ? "" : "  · " + proj)));
        }
        return new JSONObject().put("bugs", bugs).put("feats", feats).put("rows", rows).toString();
    }

    static String fetch() throws Exception {
        Exception last = null;
        for (String src : SOURCES) {
            HttpURLConnection h = null;
            try {
                h = (HttpURLConnection) new URL(src).openConnection();
                h.setConnectTimeout(4000); h.setReadTimeout(5000); h.setUseCaches(false);   // รวม 2 แหล่งไม่เกิน ~18 วิ อยู่ในเวลาที่ goAsync ให้
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

    static void draw(Context c, AppWidgetManager mgr, int[] ids, String data, String sub) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.bug_widget);
        JSONObject d = null;
        try { if (data != null) d = new JSONObject(data); } catch (Exception ignored) {}
        v.setTextViewText(R.id.bw_counts, d == null ? "🐞 –   ✨ –" : "🐞 " + d.optInt("bugs") + "   ✨ " + d.optInt("feats"));
        v.setTextViewText(R.id.bw_sub, sub);
        JSONArray rows = d == null ? new JSONArray() : d.optJSONArray("rows");
        if (rows == null) rows = new JSONArray();
        for (int i = 0; i < ROWS; i++) {
            JSONObject r = rows.optJSONObject(i);
            if (r == null) { v.setViewVisibility(ROW_IDS[i], android.view.View.GONE); continue; }
            v.setViewVisibility(ROW_IDS[i], android.view.View.VISIBLE);
            v.setTextViewText(ROW_IDS[i], r.optString("text"));
            v.setOnClickPendingIntent(ROW_IDS[i], open(c, "open-" + r.optString("id"), 10 + i));
        }
        v.setViewVisibility(R.id.bw_empty, d != null && rows.length() == 0 ? android.view.View.VISIBLE : android.view.View.GONE);
        v.setOnClickPendingIntent(R.id.bw_head, open(c, "bugs", 3));
        v.setOnClickPendingIntent(R.id.bw_add_bug, open(c, "newbug", 1));
        v.setOnClickPendingIntent(R.id.bw_add_feat, open(c, "newtask", 2));
        mgr.updateAppWidget(ids, v);
    }

    static PendingIntent open(Context c, String hash, int code) {
        Intent i = new Intent(c, MainActivity.class)
            .putExtra(MainActivity.EXTRA_HASH, hash)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
