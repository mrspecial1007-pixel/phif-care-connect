package com.phif.sms.gateway.data

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.Header
import retrofit2.http.POST

interface GatewayApi {
    @POST("api/public/gateway/register")
    suspend fun registerDevice(@Body request: RegisterRequest): Response<RegisterResponse>

    @POST("api/public/gateway/jobs")
    suspend fun claimJobs(
        @Header("X-Gateway-ID") deviceId: String,
        @Header("X-Gateway-Token") deviceToken: String
    ): Response<ClaimResponse>

    @POST("api/public/gateway/status")
    suspend fun updateStatus(
        @Header("X-Gateway-ID") deviceId: String,
        @Header("X-Gateway-Token") deviceToken: String,
        @Body request: StatusUpdateRequest
    ): Response<StatusUpdateResponse>
}
