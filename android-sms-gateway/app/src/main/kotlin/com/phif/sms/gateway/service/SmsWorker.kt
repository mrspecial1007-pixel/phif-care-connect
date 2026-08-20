package com.phif.sms.gateway.service

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.telephony.SmsManager
import android.telephony.SubscriptionManager
import androidx.work.*
import com.phif.sms.gateway.data.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

class SmsWorker(context: Context, workerParams: WorkerParameters) : CoroutineWorker(context, workerParams) {

    private val authManager = AuthManager(context)
    private val idempotencyManager = IdempotencyManager(context)
    private val logManager = LocalLogManager(context)

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val type = inputData.getString("type") ?: "sync"
        
        if (type == "status_update") {
            return@withContext reportStatus()
        }

        return@withContext performSync()
    }

    private suspend fun performSync(): Result {
        val deviceId = authManager.getDeviceId() ?: return Result.failure()
        val deviceToken = authManager.getDeviceToken() ?: return Result.failure()
        val baseUrl = authManager.getBaseUrl() ?: return Result.failure()

        val api = createApi(baseUrl)

        try {
            val response = api.claimJobs(deviceId, deviceToken)
            if (!response.isSuccessful) return Result.retry()

            val jobs = response.body()?.jobs ?: return Result.success()

            for (job in jobs) {
                processJob(job, api, deviceId, deviceToken)
            }

            return Result.success()
        } catch (e: Exception) {
            return Result.retry()
        }
    }

    private suspend fun processJob(job: SmsJob, api: GatewayApi, deviceId: String, deviceToken: String) {
        // Idempotency check
        if (idempotencyManager.isAlreadySent(job.attemptId)) {
            // Already handled, just notify backend again to be safe
            val status = idempotencyManager.getStatus(job.attemptId) ?: "sent"
            api.updateStatus(deviceId, deviceToken, StatusUpdateRequest(job.messageId, job.attemptId, status))
            return
        }

        idempotencyManager.markProcessing(job.attemptId)
        
        val smsManager = getSmsManager()
        val sentIntent = PendingIntent.getBroadcast(
            applicationContext, 
            job.attemptId.hashCode(),
            Intent("SMS_SENT").apply {
                setPackage(applicationContext.packageName)
                putExtra("attemptId", job.attemptId)
                putExtra("messageId", job.messageId)
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val deliveredIntent = PendingIntent.getBroadcast(
            applicationContext,
            job.attemptId.hashCode(),
            Intent("SMS_DELIVERED").apply {
                setPackage(applicationContext.packageName)
                putExtra("attemptId", job.attemptId)
                putExtra("messageId", job.messageId)
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        try {
            val parts = smsManager.divideMessage(job.messageBody)
            if (parts.size > 1) {
                val sentIntents = ArrayList<PendingIntent>().apply { repeat(parts.size) { add(sentIntent) } }
                val deliveredIntents = ArrayList<PendingIntent>().apply { repeat(parts.size) { add(deliveredIntent) } }
                smsManager.sendMultipartTextMessage(job.phoneNumber, null, parts, sentIntents, deliveredIntents)
            } else {
                smsManager.sendTextMessage(job.phoneNumber, null, job.messageBody, sentIntent, deliveredIntent)
            }
            
            logManager.addLog("SEND", job.phoneNumber, job.attemptId, "Default", "Triggered")
        } catch (e: Exception) {
            idempotencyManager.markFailed(job.attemptId)
            logManager.addLog("SEND", job.phoneNumber, job.attemptId, "Default", "Failed", e.message)
            api.updateStatus(deviceId, deviceToken, StatusUpdateRequest(job.messageId, job.attemptId, "failed", errorMessage = e.message))
        }
    }

    private suspend fun reportStatus(): Result {
        val messageId = inputData.getString("messageId") ?: return Result.failure()
        val attemptId = inputData.getString("attemptId") ?: return Result.failure()
        val status = inputData.getString("status") ?: return Result.failure()
        val errorCode = inputData.getString("errorCode")
        
        val deviceId = authManager.getDeviceId() ?: return Result.failure()
        val deviceToken = authManager.getDeviceToken() ?: return Result.failure()
        val baseUrl = authManager.getBaseUrl() ?: return Result.failure()

        if (status == "sent") idempotencyManager.markSent(attemptId)
        if (status == "delivered") idempotencyManager.markDelivered(attemptId)
        if (status == "failed") idempotencyManager.markFailed(attemptId)

        val api = createApi(baseUrl)
        try {
            api.updateStatus(deviceId, deviceToken, StatusUpdateRequest(messageId, attemptId, status, errorCode))
            return Result.success()
        } catch (e: Exception) {
            return Result.retry()
        }
    }

    private fun getSmsManager(): SmsManager {
        // Placeholder for SIM selection logic
        return applicationContext.getSystemService(SmsManager::class.java)
    }

    private fun createApi(baseUrl: String): GatewayApi {
        val logging = HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BODY }
        val client = OkHttpClient.Builder()
            .addInterceptor(logging)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()

        return Retrofit.Builder()
            .baseUrl(if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/")
            .addConverterFactory(GsonConverterFactory.create())
            .client(client)
            .build()
            .create(GatewayApi::class.java)
    }

    companion object {
        fun enqueueSync(context: Context) {
            val workRequest = OneTimeWorkRequestBuilder<SmsWorker>()
                .setInputData(workDataOf("type" to "sync"))
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork("sms_sync", ExistingWorkPolicy.KEEP, workRequest)
        }

        fun enqueueStatusUpdate(context: Context, messageId: String, attemptId: String, status: String, errorCode: String? = null) {
            val workRequest = OneTimeWorkRequestBuilder<SmsWorker>()
                .setInputData(workDataOf(
                    "type" to "status_update",
                    "messageId" to messageId,
                    "attemptId" to attemptId,
                    "status" to status,
                    "errorCode" to errorCode
                ))
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(context).enqueue(workRequest)
        }
    }
}
