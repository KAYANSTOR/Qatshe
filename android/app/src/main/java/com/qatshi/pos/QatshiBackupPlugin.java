package com.qatshi.pos;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkInfo;
import androidx.work.WorkManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Calendar;
import java.util.List;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "QatshiBackup")
public class QatshiBackupPlugin extends Plugin {

    private String uniqueWorkName(String orgId) {
        return "qatshi-daily-backup-" + orgId;
    }

    @PluginMethod
    public void scheduleDailyBackup(PluginCall call) {
        String orgId = call.getString("orgId", "");
        int intervalHours = Math.max(12, call.getInt("intervalHours", 24));
        int preferredHour = Math.max(0, Math.min(23, call.getInt("preferredHour", 23)));

        if (orgId == null || orgId.trim().isEmpty()) {
            call.reject("orgId is required");
            return;
        }

        Calendar now = Calendar.getInstance();
        Calendar nextRun = Calendar.getInstance();
        nextRun.set(Calendar.HOUR_OF_DAY, preferredHour);
        nextRun.set(Calendar.MINUTE, 0);
        nextRun.set(Calendar.SECOND, 0);
        if (!nextRun.after(now)) {
            nextRun.add(Calendar.DAY_OF_MONTH, 1);
        }
        long initialDelayMinutes = Math.max(1L, (nextRun.getTimeInMillis() - now.getTimeInMillis()) / 60000L);

        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .setRequiresBatteryNotLow(true)
            .build();

        Data input = new Data.Builder()
            .putString(QatshiBackupWorker.KEY_ORG_ID, orgId)
            .build();

        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
            QatshiBackupWorker.class,
            intervalHours,
            TimeUnit.HOURS
        )
            .setInitialDelay(initialDelayMinutes, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .setInputData(input)
            .build();

        WorkManager.getInstance(getContext()).enqueueUniquePeriodicWork(
            uniqueWorkName(orgId),
            ExistingPeriodicWorkPolicy.UPDATE,
            request
        );

        JSObject out = new JSObject();
        out.put("scheduled", true);
        out.put("workState", "ENQUEUED");
        call.resolve(out);
    }

    @PluginMethod
    public void cancelDailyBackup(PluginCall call) {
        String orgId = call.getString("orgId", "");
        if (orgId != null && !orgId.trim().isEmpty()) {
            WorkManager.getInstance(getContext()).cancelUniqueWork(uniqueWorkName(orgId));
        }
        JSObject out = new JSObject();
        out.put("cancelled", true);
        call.resolve(out);
    }

    @PluginMethod
    public void getWorkStatus(PluginCall call) {
        String orgId = call.getString("orgId", "");
        SharedPreferences prefs = getContext().getSharedPreferences(
            QatshiBackupWorker.PREFS_NAME,
            Context.MODE_PRIVATE
        );

        boolean scheduled = false;
        String workState = "NONE";
        try {
            List<WorkInfo> infos = WorkManager.getInstance(getContext())
                .getWorkInfosForUniqueWork(uniqueWorkName(orgId))
                .get();
            if (infos != null && !infos.isEmpty()) {
                WorkInfo info = infos.get(0);
                workState = info.getState().name();
                scheduled = !info.getState().isFinished();
            }
        } catch (Exception ignored) {
            workState = "NONE";
        }

        JSObject out = new JSObject();
        out.put("scheduled", scheduled);
        out.put("workState", workState);
        out.put("lastNativeTriggerAt", prefs.getString("lastTriggerAt:" + orgId, ""));
        out.put("pendingDueFromNative", prefs.getBoolean("pendingDue:" + orgId, false));
        call.resolve(out);
    }

    @PluginMethod
    public void acknowledgeNativeTrigger(PluginCall call) {
        String orgId = call.getString("orgId", "");
        SharedPreferences prefs = getContext().getSharedPreferences(
            QatshiBackupWorker.PREFS_NAME,
            Context.MODE_PRIVATE
        );
        prefs.edit().putBoolean("pendingDue:" + orgId, false).apply();
        JSObject out = new JSObject();
        out.put("acknowledged", true);
        call.resolve(out);
    }
}
