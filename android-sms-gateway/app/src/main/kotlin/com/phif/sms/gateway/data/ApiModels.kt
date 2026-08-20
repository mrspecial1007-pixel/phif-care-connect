package com.phif.sms.gateway.data

import com.google.gson.annotations.SerializedName

data class RegisterRequest(
    val name: String,
    @SerializedName("pairingCode") val pairingCode: String,
    @SerializedName("fcmToken") val fcmToken: String? = null
)

data class RegisterResponse(
    val deviceId: String,
    val deviceToken: String
)

data class ClaimRequest(
    val deviceId: String,
    val deviceToken: String
)

data class ClaimResponse(
    val jobs: List<SmsJob>
)

data class SmsJob(
    @SerializedName("message_id") val messageId: String,
    @SerializedName("phone_number") val phoneNumber: String,
    @SerializedName("message_body") val messageBody: String,
    @SerializedName("attempt_id") val attemptId: String
)

data class StatusUpdateRequest(
    val messageId: String,
    val attemptId: String,
    val status: String,
    val errorCode: String? = null,
    val errorMessage: String? = null,
    val simSlot: Int? = null
)

data class StatusUpdateResponse(
    val success: Boolean
)
