package com.phif.sms.gateway.data

import android.content.Context
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import java.io.File
import java.util.*

data class LocalLogEntry(
    val timestamp: Long = System.currentTimeMillis(),
    val action: String,
    val maskedPhone: String,
    val attemptIdShort: String,
    val sim: String,
    val result: String,
    val errorMessage: String? = null
)

class LocalLogManager(private val context: Context) {
    private val logFile = File(context.filesDir, "gateway_logs.json")
    private val gson = Gson()

    fun addLog(action: String, phone: String, attemptId: String, sim: String, result: String, error: String? = null) {
        val entry = LocalLogEntry(
            action = action,
            maskedPhone = maskPhone(phone),
            attemptIdShort = if (attemptId.length > 8) attemptId.substring(0, 8) else attemptId,
            sim = sim,
            result = result,
            errorMessage = error
        )
        val logs = getLogs().toMutableList()
        logs.add(0, entry)
        if (logs.size > 100) logs.removeAt(logs.size - 1)
        logFile.writeText(gson.toJson(logs))
    }

    fun getLogs(): List<LocalLogEntry> {
        if (!logFile.exists()) return emptyList()
        return try {
            val type = object : TypeToken<List<LocalLogEntry>>() {}.type
            gson.fromJson(logFile.readText(), type)
        } catch (e: Exception) {
            emptyList()
        }
    }

    private fun maskPhone(phone: String): String {
        return if (phone.length > 7) {
            phone.substring(0, 4) + "****" + phone.substring(phone.length - 3)
        } else {
            "****"
        }
    }
}
