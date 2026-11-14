package com.qatshi.pos;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.ContactsContract;
import android.provider.Settings;
import android.telephony.ServiceState;
import android.telephony.SmsManager;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.telephony.TelephonyManager;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

@CapacitorPlugin(
    name = "QatshiSms",
    permissions = {
        @Permission(
            strings = {
                Manifest.permission.SEND_SMS,
                Manifest.permission.READ_PHONE_STATE
            },
            alias = "sms"
        )
    }
)
public class QatshiSmsPlugin extends Plugin {

    private static final long SEND_TIMEOUT_MS = 35000L;

    private boolean isSendSmsGranted() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.SEND_SMS)
            == PackageManager.PERMISSION_GRANTED;
    }

    private boolean isReadPhoneStateGranted() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_PHONE_STATE)
            == PackageManager.PERMISSION_GRANTED;
    }

    private boolean isAirplaneModeOn() {
        return Settings.Global.getInt(
            getContext().getContentResolver(),
            Settings.Global.AIRPLANE_MODE_ON,
            0
        ) != 0;
    }

    @SuppressLint("MissingPermission")
    private List<SubscriptionInfo> getActiveSubscriptionsSafely() {
        if (!isReadPhoneStateGranted()) {
            return new ArrayList<>();
        }
        try {
            SubscriptionManager subManager = (SubscriptionManager)
                getContext().getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE);
            if (subManager == null) return new ArrayList<>();
            List<SubscriptionInfo> list = subManager.getActiveSubscriptionInfoList();
            return list != null ? list : new ArrayList<>();
        } catch (SecurityException | RuntimeException e) {
            return new ArrayList<>();
        }
    }

    @SuppressLint("MissingPermission")
    private boolean hasCellularNetworkSignal(List<SubscriptionInfo> sims) {
        if (isAirplaneModeOn()) return false;
        try {
            TelephonyManager tm = (TelephonyManager)
                getContext().getSystemService(Context.TELEPHONY_SERVICE);
            if (tm == null) return false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && isReadPhoneStateGranted()) {
                ServiceState ss = tm.getServiceState();
                if (ss != null) {
                    return ss.getState() == ServiceState.STATE_IN_SERVICE;
                }
            }
            return tm.getSimState() == TelephonyManager.SIM_STATE_READY || !sims.isEmpty();
        } catch (SecurityException | RuntimeException e) {
            return !sims.isEmpty();
        }
    }

    @PluginMethod
    public void checkEnvironment(PluginCall call) {
        boolean sendSms = isSendSmsGranted();
        boolean readPhone = isReadPhoneStateGranted();
        boolean hasTelephony = getContext()
            .getPackageManager()
            .hasSystemFeature(PackageManager.FEATURE_TELEPHONY);
        boolean airplaneMode = isAirplaneModeOn();
        List<SubscriptionInfo> subs = getActiveSubscriptionsSafely();
        boolean hasSignal = hasTelephony && hasCellularNetworkSignal(subs);

        JSArray simsArray = new JSArray();
        for (SubscriptionInfo info : subs) {
            JSObject obj = new JSObject();
            obj.put("subscriptionId", info.getSubscriptionId());
            obj.put("slotIndex", info.getSimSlotIndex());
            obj.put("displayName", info.getDisplayName() != null ? info.getDisplayName().toString() : "SIM");
            obj.put("carrierName", info.getCarrierName() != null ? info.getCarrierName().toString() : "");
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && isReadPhoneStateGranted()) {
                    SubscriptionManager sm = (SubscriptionManager)
                        getContext().getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE);
                    if (sm != null) {
                        String phoneNum = sm.getPhoneNumber(info.getSubscriptionId());
                        if (phoneNum != null && !phoneNum.isEmpty()) {
                            obj.put("number", phoneNum);
                        }
                    }
                } else {
                    String legacyNum = info.getNumber();
                    if (legacyNum != null && !legacyNum.isEmpty()) {
                        obj.put("number", legacyNum);
                    }
                }
            } catch (SecurityException | RuntimeException ignored) {
                // Carrier SIMs do not always expose MSISDN on all devices
            }
            simsArray.put(obj);
        }

        JSObject ret = new JSObject();
        ret.put("sendSmsGranted", sendSms);
        ret.put("readPhoneStateGranted", readPhone);
        ret.put("hasTelephonyHardware", hasTelephony);
        ret.put("airplaneModeOn", airplaneMode);
        ret.put("hasCellularSignal", hasSignal);
        ret.put("sims", simsArray);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestSmsPermissions(PluginCall call) {
        if (getPermissionState("sms") == PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("sendSmsGranted", isSendSmsGranted());
            ret.put("readPhoneStateGranted", isReadPhoneStateGranted());
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("sms", call, "smsPermsCallback");
    }

    @PermissionCallback
    private void smsPermsCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("sendSmsGranted", isSendSmsGranted());
        ret.put("readPhoneStateGranted", isReadPhoneStateGranted());
        call.resolve(ret);
    }

    @PluginMethod
    public void pickContact(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI);
        startActivityForResult(call, intent, "handleContactPicked");
    }

    @ActivityCallback
    private void handleContactPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject ret = new JSObject();
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }

        Uri contactUri = result.getData().getData();
        if (contactUri == null) {
            JSObject ret = new JSObject();
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }

        String[] projection = new String[] {
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER
        };

        try (Cursor cursor = getContext().getContentResolver().query(contactUri, projection, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME);
                int numIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
                String name = nameIdx >= 0 ? cursor.getString(nameIdx) : "";
                String phone = numIdx >= 0 ? cursor.getString(numIdx) : "";
                JSObject ret = new JSObject();
                ret.put("cancelled", false);
                ret.put("name", name != null ? name : "");
                ret.put("phone", phone != null ? phone : "");
                call.resolve(ret);
                return;
            }
        } catch (Exception e) {
            call.reject("تعذر قراءة رقم الهاتف من جهة الاتصال: " + e.getMessage());
            return;
        }

        JSObject ret = new JSObject();
        ret.put("cancelled", true);
        call.resolve(ret);
    }

    private SmsManager resolveSmsManager(Integer subscriptionId) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            SmsManager base = getContext().getSystemService(SmsManager.class);
            if (base != null && subscriptionId != null && subscriptionId >= 0) {
                return base.createForSubscriptionId(subscriptionId);
            }
            if (base != null) return base;
        }
        if (subscriptionId != null && subscriptionId >= 0) {
            return SmsManager.getSmsManagerForSubscriptionId(subscriptionId);
        }
        return SmsManager.getDefault();
    }

    private String mapSmsErrorCode(int resultCode) {
        switch (resultCode) {
            case SmsManager.RESULT_ERROR_GENERIC_FAILURE:
                return "فشل عام من شبكة الاتصالات أو رصيد الشريحة";
            case SmsManager.RESULT_ERROR_NO_SERVICE:
                return "لا توجد خدمة تغطية خلوية";
            case SmsManager.RESULT_ERROR_NULL_PDU:
                return "بيانات الرسالة غير صالحة (NULL PDU)";
            case SmsManager.RESULT_ERROR_RADIO_OFF:
                return "وحدة الاتصال الخلوي متوقفة (وضع الطيران)";
            default:
                return "فشل الإرسال (رمز الخطأ: " + resultCode + ")";
        }
    }

    @PluginMethod
    public void sendDirectSms(PluginCall call) {
        final String messageId = call.getString("messageId", String.valueOf(System.currentTimeMillis()));
        final String phone = call.getString("phone");
        final String body = call.getString("body");
        final Integer subscriptionId = call.getInt("subscriptionId");

        if (!isSendSmsGranted()) {
            JSObject ret = new JSObject();
            ret.put("status", "failed");
            ret.put("errorReason", "لم يُمنح إذن SEND_SMS على الجهاز");
            call.resolve(ret);
            return;
        }

        if (isAirplaneModeOn()) {
            JSObject ret = new JSObject();
            ret.put("status", "failed");
            ret.put("errorReason", "وضع الطيران مفعّل على الهاتف");
            call.resolve(ret);
            return;
        }

        if (phone == null || phone.trim().isEmpty() || body == null || body.trim().isEmpty()) {
            JSObject ret = new JSObject();
            ret.put("status", "failed");
            ret.put("errorReason", "رقم الهاتف أو نص الرسالة فارغ");
            call.resolve(ret);
            return;
        }

        final SmsManager smsManager = resolveSmsManager(subscriptionId);
        Integer resolvedSlot = null;
        String resolvedCarrier = null;
        int effectiveSubId = subscriptionId != null
            ? subscriptionId
            : (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N
                ? SubscriptionManager.getDefaultSmsSubscriptionId()
                : smsManager.getSubscriptionId());

        for (SubscriptionInfo sub : getActiveSubscriptionsSafely()) {
            if (sub.getSubscriptionId() == effectiveSubId) {
                resolvedSlot = sub.getSimSlotIndex();
                resolvedCarrier = sub.getCarrierName() != null ? sub.getCarrierName().toString() : null;
                break;
            }
        }
        final Integer simSlotFinal = resolvedSlot;
        final String carrierFinal = resolvedCarrier;
        final int subIdFinal = effectiveSubId;

        final ArrayList<String> parts = smsManager.divideMessage(body);
        final int totalParts = Math.max(1, parts.size());

        final String sentAction = getContext().getPackageName() + ".QATSHI_SMS_SENT." + messageId;
        final String deliveredAction = getContext().getPackageName() + ".QATSHI_SMS_DELIVERED." + messageId;

        final AtomicBoolean finished = new AtomicBoolean(false);
        final AtomicInteger completedParts = new AtomicInteger(0);
        final AtomicInteger failedParts = new AtomicInteger(0);
        final AtomicInteger deliveredParts = new AtomicInteger(0);
        final StringBuilder lastError = new StringBuilder();
        final Handler timeoutHandler = new Handler(Looper.getMainLooper());

        final BroadcastReceiver sentReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                int code = getResultCode();
                if (code != Activity.RESULT_OK) {
                    failedParts.incrementAndGet();
                    if (lastError.length() == 0) {
                        lastError.append(mapSmsErrorCode(code));
                    }
                }

                if (completedParts.incrementAndGet() >= totalParts && finished.compareAndSet(false, true)) {
                    timeoutHandler.removeCallbacksAndMessages(null);
                    try {
                        getContext().unregisterReceiver(this);
                    } catch (IllegalArgumentException ignored) {}

                    JSObject ret = new JSObject();
                    ret.put("simSlot", simSlotFinal);
                    ret.put("subscriptionId", subIdFinal);
                    if (carrierFinal != null) ret.put("carrierName", carrierFinal);
                    ret.put("partsCount", totalParts);

                    if (failedParts.get() == 0) {
                        ret.put("status", "sent_to_network");
                    } else {
                        ret.put("status", "failed");
                        ret.put("errorReason", lastError.toString());
                    }
                    call.resolve(ret);
                }
            }
        };

        final BroadcastReceiver deliveredReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (getResultCode() == Activity.RESULT_OK && deliveredParts.incrementAndGet() >= totalParts) {
                    JSObject evt = new JSObject();
                    evt.put("messageId", messageId);
                    evt.put("status", "delivered");
                    notifyListeners("smsDeliveryStatus", evt);
                    try {
                        getContext().unregisterReceiver(this);
                    } catch (IllegalArgumentException ignored) {}
                } else if (getResultCode() != Activity.RESULT_OK) {
                    try {
                        getContext().unregisterReceiver(this);
                    } catch (IllegalArgumentException ignored) {}
                }
            }
        };

        ContextCompat.registerReceiver(
            getContext(),
            sentReceiver,
            new IntentFilter(sentAction),
            ContextCompat.RECEIVER_NOT_EXPORTED
        );
        ContextCompat.registerReceiver(
            getContext(),
            deliveredReceiver,
            new IntentFilter(deliveredAction),
            ContextCompat.RECEIVER_NOT_EXPORTED
        );

        timeoutHandler.postDelayed(() -> {
            if (finished.compareAndSet(false, true)) {
                try {
                    getContext().unregisterReceiver(sentReceiver);
                } catch (IllegalArgumentException ignored) {}
                JSObject ret = new JSObject();
                ret.put("status", "unknown");
                ret.put("simSlot", simSlotFinal);
                ret.put("subscriptionId", subIdFinal);
                if (carrierFinal != null) ret.put("carrierName", carrierFinal);
                ret.put("partsCount", totalParts);
                ret.put("errorReason", "انتهت مهلة انتظار تأكيد شبكة الاتصالات — تحقق من تطبيق الرسائل قبل إعادة المحاولة");
                call.resolve(ret);
            }
        }, SEND_TIMEOUT_MS);

        try {
            ArrayList<PendingIntent> sentIntents = new ArrayList<>();
            ArrayList<PendingIntent> deliveredIntents = new ArrayList<>();
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

            for (int i = 0; i < totalParts; i++) {
                Intent sIntent = new Intent(sentAction);
                sIntent.setPackage(getContext().getPackageName());
                sentIntents.add(PendingIntent.getBroadcast(getContext(), i, sIntent, flags));

                Intent dIntent = new Intent(deliveredAction);
                dIntent.setPackage(getContext().getPackageName());
                deliveredIntents.add(PendingIntent.getBroadcast(getContext(), i + 1000, dIntent, flags));
            }

            if (totalParts == 1) {
                smsManager.sendTextMessage(
                    phone.trim(),
                    null,
                    parts.get(0),
                    sentIntents.get(0),
                    deliveredIntents.get(0)
                );
            } else {
                smsManager.sendMultipartTextMessage(
                    phone.trim(),
                    null,
                    parts,
                    sentIntents,
                    deliveredIntents
                );
            }
        } catch (SecurityException | RuntimeException e) {
            if (finished.compareAndSet(false, true)) {
                timeoutHandler.removeCallbacksAndMessages(null);
                try {
                    getContext().unregisterReceiver(sentReceiver);
                } catch (IllegalArgumentException ignored) {}
                try {
                    getContext().unregisterReceiver(deliveredReceiver);
                } catch (IllegalArgumentException ignored) {}
                JSObject ret = new JSObject();
                ret.put("status", "failed");
                ret.put("partsCount", totalParts);
                ret.put("errorReason", "تعذر إرسال الرسالة عبر SmsManager: " + e.getMessage());
                call.resolve(ret);
            }
        }
    }
}
