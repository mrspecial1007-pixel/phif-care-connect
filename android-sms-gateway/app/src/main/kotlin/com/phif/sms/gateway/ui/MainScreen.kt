package com.phif.sms.gateway.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.phif.sms.gateway.data.AuthManager
import com.phif.sms.gateway.data.LocalLogManager
import com.phif.sms.gateway.service.SmsWorker

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(authManager: AuthManager, logManager: LocalLogManager, onUnpair: () -> Unit) {
    val context = LocalContext.current
    var showLogs by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("بوابة PHIF SMS", fontWeight = FontWeight.Bold) },
                actions = {
                    IconButton(onClick = { showLogs = !showLogs }) {
                        Icon(Icons.Default.Info, contentDescription = "Logs")
                    }
                    IconButton(onClick = { 
                        authManager.clear()
                        onUnpair()
                    }) {
                        Icon(Icons.Default.Settings, contentDescription = "Settings")
                    }
                }
            )
        }
    ) { padding ->
        if (showLogs) {
            Box(modifier = Modifier.padding(padding)) {
                LogScreen(logManager)
            }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                StatusCard(authManager)
                
                Spacer(modifier = Modifier.height(32.dp))
                
                Button(
                    onClick = { SmsWorker.enqueueSync(context) },
                    modifier = Modifier.fillMaxWidth().height(64.dp),
                    shape = MaterialTheme.shapes.large
                ) {
                    Text("مزامنة الآن", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                }
                
                Spacer(modifier = Modifier.height(16.dp))
                
                Text(
                    text = "سيقوم الجهاز بسحب الرسائل المعلقة وإرسالها فوراً",
                    color = MaterialTheme.colorScheme.secondary,
                    fontSize = 12.sp
                )
            }
        }
    }
}

@Composable
fun StatusCard(authManager: AuthManager) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(12.dp)
                        .clip(CircleShape)
                        .background(Color(0xFF10B981))
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text("حالة الاتصال: متصل", fontWeight = FontWeight.Bold)
            }
            
            Spacer(modifier = Modifier.height(16.dp))
            
            StatusItem("الجهاز", "Redmi Pad (Gateway)")
            StatusItem("المعرف", authManager.getDeviceId()?.substring(0, 8) ?: "N/A")
            StatusItem("النظام", authManager.getBaseUrl() ?: "N/A")
            StatusItem("صلاحية SMS", "مفعلة")
        }
    }
}

@Composable
fun StatusItem(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(text = label, color = MaterialTheme.colorScheme.secondary)
        Text(text = value, fontWeight = FontWeight.Medium)
    }
}
