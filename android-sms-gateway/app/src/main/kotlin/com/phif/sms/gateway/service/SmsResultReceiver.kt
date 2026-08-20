package com.phif.sms.gateway.service

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.SmsManager
import android.util.Log

class SmsResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val attemptId = intent.getStringExtra("attemptId") ?: return
        val messageId = intent.getStringExtra("messageId") ?: return
        val action = intent.action ?: return

        when (action) {
            "SMS_SENT" -> {
                val status = when (resultCode) {
                    Activity.RESULT_OK -> "sent"
                    else -> "failed"
                }
                val errorCode = if (status == "failed") "RESULT_CODE_$resultCode" else null
                
                // We'll use a WorkManager task to report this back to the backend
                // to ensure delivery even if the app is closed.
                SmsWorker.enqueueStatusUpdate(context, messageId, attemptId, status, errorCode)
            }
            "SMS_DELIVERED" -> {
                SmsWorker.enqueueStatusUpdate(context, messageId, attemptId, "delivered")
            }
        }
    }
}
