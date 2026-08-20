package com.phif.sms.gateway

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.*
import com.phif.sms.gateway.data.AuthManager
import com.phif.sms.gateway.data.LocalLogManager
import com.phif.sms.gateway.ui.MainScreen
import com.phif.sms.gateway.ui.PairingScreen
import com.phif.sms.gateway.ui.PHIFSMSGatewayTheme

class MainActivity : ComponentActivity() {
    
    private lateinit var authManager: AuthManager
    private lateinit var logManager: LocalLogManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        
        authManager = AuthManager(this)
        logManager = LocalLogManager(this)

        setContent {
            PHIFSMSGatewayTheme {
                var isPaired by remember { mutableStateOf(authManager.isPaired()) }

                if (isPaired) {
                    MainScreen(
                        authManager = authManager,
                        logManager = logManager,
                        onUnpair = { isPaired = false }
                    )
                } else {
                    PairingScreen(
                        authManager = authManager,
                        onPaired = { isPaired = true }
                    )
                }
            }
        }
    }
}
