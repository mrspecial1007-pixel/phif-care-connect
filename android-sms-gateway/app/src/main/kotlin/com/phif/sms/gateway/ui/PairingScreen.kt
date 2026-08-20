package com.phif.sms.gateway.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.phif.sms.gateway.data.*
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import org.json.JSONObject

@Composable
fun PairingScreen(authManager: AuthManager, onPaired: () -> Unit) {
    var name by remember { mutableStateOf("") }
    var pairingCode by remember { mutableStateOf("") }
    var baseUrl by remember { mutableStateOf("https://") }
    var isLoading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = "إقران البوابة",
            fontSize = 24.sp,
            fontWeight = FontWeight.Bold
        )
        
        Spacer(modifier = Modifier.height(8.dp))
        
        Text(
            text = "أدخل بيانات الربط مع نظام PHIF",
            color = MaterialTheme.colorScheme.secondary
        )

        Spacer(modifier = Modifier.height(32.dp))

        OutlinedTextField(
            value = name,
            onValueChange = { name = it },
            label = { Text("اسم الجهاز (مثل: Redmi Pad)") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )

        Spacer(modifier = Modifier.height(16.dp))

        OutlinedTextField(
            value = pairingCode,
            onValueChange = { pairingCode = it.uppercase().trim() },
            label = { Text("رمز الإقران (6 رموز)") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )

        Spacer(modifier = Modifier.height(16.dp))

        OutlinedTextField(
            value = baseUrl,
            onValueChange = { baseUrl = it },
            label = { Text("رابط النظام (Base URL)") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )

        if (error != null) {
            Spacer(modifier = Modifier.height(16.dp))
            Text(text = error!!, color = MaterialTheme.colorScheme.error)
        }

        Spacer(modifier = Modifier.height(32.dp))

        Button(
            onClick = {
                isLoading = true
                error = null
                scope.launch {
                    try {
                        val retrofit = Retrofit.Builder()
                            .baseUrl(if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/")
                            .addConverterFactory(GsonConverterFactory.create())
                            .client(OkHttpClient.Builder().build())
                            .build()
                        
                        val api = retrofit.create(GatewayApi::class.java)
                        val response = api.registerDevice(RegisterRequest(name, pairingCode))
                        
                        if (response.isSuccessful) {
                            val data = response.body()!!
                            authManager.saveCredentials(data.deviceId, data.deviceToken, baseUrl)
                            onPaired()
                        } else {
                            val errorBody = response.errorBody()?.string()
                            val message = try {
                                JSONObject(errorBody ?: "").getString("error")
                            } catch (e: Exception) {
                                "فشل الإقران: ${response.code()}"
                            }
                            error = message
                        }
                    } catch (e: Exception) {
                        error = "خطأ في الاتصال: ${e.message}"
                    } finally {
                        isLoading = false
                    }
                }
            },
            modifier = Modifier.fillMaxWidth().height(56.dp),
            enabled = name.isNotBlank() && pairingCode.isNotBlank() && baseUrl.isNotBlank() && !isLoading
        ) {
            if (isLoading) {
                CircularProgressIndicator(color = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(24.dp))
            } else {
                Text("بدء الإقران")
            }
        }
    }
}