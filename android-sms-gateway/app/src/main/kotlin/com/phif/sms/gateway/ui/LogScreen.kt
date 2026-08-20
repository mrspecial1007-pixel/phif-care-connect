package com.phif.sms.gateway.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.phif.sms.gateway.data.LocalLogEntry
import com.phif.sms.gateway.data.LocalLogManager
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun LogScreen(logManager: LocalLogManager) {
    val logs = remember { logManager.getLogs() }
    val dateFormat = remember { SimpleDateFormat("HH:mm:ss", Locale.getDefault()) }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text(
            text = "سجل العمليات المحلي",
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(bottom = 16.dp)
        )

        LazyColumn(modifier = Modifier.fillMaxSize()) {
            items(logs) { entry ->
                LogEntryItem(entry, dateFormat)
                Divider(modifier = Modifier.padding(vertical = 8.dp))
            }
        }
    }
}

@Composable
fun LogEntryItem(entry: LocalLogEntry, dateFormat: SimpleDateFormat) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = dateFormat.format(Date(entry.timestamp)),
                color = Color.Gray,
                fontSize = 12.sp
            )
            Text(
                text = entry.action,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary
            )
        }
        
        Spacer(modifier = Modifier.height(4.dp))
        
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(text = entry.maskedPhone)
            Text(
                text = entry.result,
                color = if (entry.result == "Failed") Color.Red else Color(0xFF059669)
            )
        }
        
        if (entry.errorMessage != null) {
            Text(
                text = entry.errorMessage,
                color = Color.Red,
                fontSize = 12.sp,
                modifier = Modifier.padding(top = 4.dp)
            )
        }
    }
}
