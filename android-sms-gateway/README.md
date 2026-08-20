# PHIF SMS Gateway - Native Android Application

This is the native Android implementation of the PHIF SMS Gateway. It allows an Android phone with a physical SIM card to act as a secure gateway for sending SMS messages queued by the PHIF Tracker application.

## Architecture

1.  **PHIF Tracker (Redmi Pad)**: Queues SMS messages via the backend.
2.  **PHIF Backend (Lovable Cloud)**: Stores messages in `sms_messages` and manages the Gateway API.
3.  **Android SMS Gateway**:
    *   Securely pairs with a pharmacy account.
    *   Claims pending jobs using an atomic claim/lease mechanism.
    *   Physically sends SMS via Android `SmsManager`.
    *   Reports status (Sent, Delivered, Failed) back to the backend.

## Features

*   **Native Kotlin/Android SDK**: High performance and reliability.
*   **Secure Storage**: Gateway credentials stored in Android Keystore (EncryptedSharedPreferences).
*   **Atomic Claim/Lease**: Prevents duplicate sends across multiple devices.
*   **Physical SMS Handling**: Supports multipart Unicode messages (Arabic).
*   **Delivery Tracking**: Uses Android PendingIntents for Sent and Delivered reports.
*   **Crash Safety**: Local idempotency tracking ensures messages aren't resent after a crash or disconnect.
*   **Diagnostic Logs**: Minimal local logs for troubleshooting (PII-free).
*   **Background Recovery**: Uses `WorkManager` to recover from connectivity loss or missed syncs.

## Prerequisites

*   Android Phone (Android 8.0+ / API 26+).
*   Physical SIM card with an active SMS plan.
*   Internet connection (Wi-Fi or Mobile Data).
*   Android Studio Ladybug (or newer) for building the APK.

## Build and Install

1.  **Copy the Project**: Copy the `android-sms-gateway/` folder to your computer.
2.  **Open in Android Studio**:
    *   File -> Open -> Select `android-sms-gateway` folder.
    *   Wait for Gradle Sync to complete.
3.  **SDK Setup**: Ensure Android SDK 34 is installed.
4.  **Build APK**:
    *   Build -> Build Bundle(s) / APK(s) -> Build APK(s).
5.  **Install**:
    *   Transfer the generated APK to your Android phone.
    *   Enable "Install from unknown sources" on the phone.
    *   Open and install the APK.

## Configuration (Pairing)

1.  Open the **PHIF SMS Gateway** app.
2.  Enter the **Base URL** of your PHIF Tracker deployment.
3.  Enter a **Name** for this gateway (e.g., "Pharmacy Main Phone").
4.  Press **بدء الإقران**.
5.  Grant the required **SMS Permissions** when prompted.

## Manual Sync

Press the **مزامنة الآن** (Sync Now) button to immediately check for pending messages and send them. The app will also periodically check for messages in the background.

## Security and Privacy

*   The Gateway only downloads the phone number and message body.
*   No patient records, medical history, or national IDs are stored on the Gateway device.
*   Local logs mask phone numbers for privacy.
*   The connection to the backend is secured via a device-specific hashed token.

## Troubleshooting

*   **Permission Denied**: Ensure `SEND_SMS` and `READ_PHONE_STATE` permissions are granted in App Settings.
*   **Connection Error**: Check internet connectivity and the Base URL.
*   **SMS Not Sending**: Verify the SIM card has sufficient balance and signal.
*   **Duplicate SMS**: The app includes local idempotency checks, but ensure only one physical device is paired to a pharmacy for the best experience.

---
*Developed for PHIF Tracker - Phase 2 Integration.*
