package __PKG__;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    static final String EXTRA_HASH = "autopilot_hash";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        openFromWidget(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        openFromWidget(intent);
    }

    @Override
    public void onPause() {
        super.onPause();
        BugWidget.refreshAll(this);   // เผื่อเพิ่งจดหรือแก้บั๊ก ให้ตัวเลขบน widget ตามทัน
    }

    /** กดจาก widget: เปิดแท็บ 🐞 (#bugs) หรือฟอร์มจดบั๊ก (#newbug) */
    private void openFromWidget(Intent intent) {
        if (intent == null || getBridge() == null) return;
        final String hash = intent.getStringExtra(EXTRA_HASH);
        if (hash == null || !hash.matches("[a-z]+")) return;
        intent.removeExtra(EXTRA_HASH);
        final WebView wv = getBridge().getWebView();
        final String local = getBridge().getLocalUrl();
        wv.post(() -> {
            String cur = wv.getUrl();
            if (cur != null && !cur.startsWith(local)) wv.evaluateJavascript("location.hash='" + hash + "'", null);  // อยู่บนเว็บจริงแล้ว
            else wv.loadUrl(local + "/#" + hash);   // ยังเป็นตัวในเครื่อง: โหลดใหม่พร้อม hash (สคริปต์ redirect จะพา hash ไปด้วย)
        });
    }
}
