package com.phif.sms.gateway.data

import android.content.Context
import android.content.SharedPreferences

class IdempotencyManager(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences("idempotency_prefs", Context.MODE_PRIVATE)

    fun markProcessing(attemptId: String) {
        prefs.edit().putString(attemptId, "processing").apply()
    }

    fun markSent(attemptId: String) {
        prefs.edit().putString(attemptId, "sent").apply()
    }

    fun markDelivered(attemptId: String) {
        prefs.edit().putString(attemptId, "delivered").apply()
    }

    fun markFailed(attemptId: String) {
        prefs.edit().putString(attemptId, "failed").apply()
    }

    fun getStatus(attemptId: String): String? = prefs.getString(attemptId, null)

    fun isAlreadySent(attemptId: String): Boolean {
        val status = getStatus(attemptId)
        return status == "sent" || status == "delivered"
    }
    
    fun clear() {
        prefs.edit().clear().apply()
    }
}
