package com.phif.sms.gateway.service

import android.content.Context
import android.telephony.SubscriptionInfo
import android.telephony.SubscriptionManager
import com.phif.sms.gateway.data.AuthManager

data class SimInfo(
    val subscriptionId: Int,
    val displayName: String,
    val slotIndex: Int,
    val number: String? = null
)

class SimManager(private val context: Context) {
    private val authManager = AuthManager(context)
    private val subscriptionManager = context.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as SubscriptionManager

    fun getActiveSims(): List<SimInfo> {
        return try {
            subscriptionManager.activeSubscriptionInfoList?.map { info ->
                SimInfo(
                    subscriptionId = info.subscriptionId,
                    displayName = info.displayName.toString(),
                    slotIndex = info.simSlotIndex,
                    number = info.number
                )
            } ?: emptyList()
        } catch (e: SecurityException) {
            emptyList()
        }
    }

    fun getDefaultSimSubscriptionId(): Int? {
        val sims = getActiveSims()
        if (sims.isEmpty()) return null
        
        val savedId = authManager.getDefaultSimId()
        if (savedId != -1 && sims.any { it.subscriptionId == savedId }) {
            return savedId
        }
        
        return sims.first().subscriptionId
    }

    fun setDefaultSim(subscriptionId: Int) {
        authManager.setDefaultSimId(subscriptionId)
    }
}
