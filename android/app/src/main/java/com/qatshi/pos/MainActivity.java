package com.qatshi.pos;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(QatshiSmsPlugin.class);
        registerPlugin(QatshiBackupPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
