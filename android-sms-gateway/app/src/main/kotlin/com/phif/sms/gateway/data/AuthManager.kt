package com.phif.sms.gateway.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class AuthManager(context: Context) {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "gateway_auth_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    fun saveCredentials(deviceId: String, deviceToken: String, baseUrl: String) {
        prefs.edit().apply {
            putString("device_id", deviceId)
            putString("device_token", deviceToken)
            putString("base_url", baseUrl)
            apply()
        }
    }

    fun getDeviceId(): String? = prefs.getString("device_id", null)
    fun getDeviceToken(): String? = prefs.getString("device_token", null)
    fun getBaseUrl(): String? = prefs.getString("base_url", null)
    
    fun isPaired(): Boolean = getDeviceId() != null && getDeviceToken() != null

    fun clear() {
        prefs.edit().clear().apply()
    }
}
