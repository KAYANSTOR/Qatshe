package com.qatshi.pos;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

public class QatshiBackupWorker extends Worker {

    public static final String PREFS_NAME = "qatshi_backup_work_prefs";
    public static final String KEY_ORG_ID = "orgId";

    public QatshiBackupWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        String orgId = getInputData().getString(KEY_ORG_ID);
        if (orgId == null || orgId.trim().isEmpty()) {
            return Result.success();
        }

        SharedPreferences prefs = getApplicationContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

        SimpleDateFormat isoFormat = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        isoFormat.setTimeZone(TimeZone.getTimeZone("UTC"));
        String nowIso = isoFormat.format(new Date());

        prefs.edit()
            .putString("lastTriggerAt:" + orgId, nowIso)
            .putBoolean("pendingDue:" + orgId, true)
            .apply();

        return Result.success();
    }
}
