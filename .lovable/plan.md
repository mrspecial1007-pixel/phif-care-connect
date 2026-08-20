# Plan: SMS Experience Cleanup and Gateway Separation

Clean up SMS semantics and UI to distinguish between actual Gateway SMS operations and manual app handoffs.

## User Review Required

> [!IMPORTANT]
> - Deleting an SMS message will also delete all associated sending attempts (physical tracking).
> - "Handoff" records will no longer be created in the `sms_messages` table for manual "Open Messages App" actions.

## Proposed Changes

### Database & Backend
- **Audit Logging**: Ensure manual handoffs are logged to `communication_logs` with a specific action (`sms_handoff`).
- **SMS Deletion**: Implement a server function `deleteSmsMessage` to safely remove `sms_messages` and their cascaded `sms_send_attempts`.
- **Status Filter**: Update `getSmsHistory` to exclude `handoff` status by default.

### Frontend - SMS Logic
- **PhoneSheet.tsx**:
    - Split SMS action into two distinct paths: "Send via Gateway" and "Open Messages App".
    - "Open Messages App" will only log to `communication_logs` and trigger the `sms:` URI.
    - "Send via Gateway" will use the existing `sendSmsRequest` (creating an `sms_messages` record with `pending` status).
    - Add a character counter and segment estimator for the Gateway path.

### Frontend - Messages UI
- **Messages Dashboard**:
    - Add filters for Status (Pending, Sending, Sent, Delivered, Failed) and Date.
    - Hide `handoff` records from the main list.
    - Add a delete action for individual messages with a confirmation dialog in Arabic.
    - Improve message details display (SIM used, failure reasons).

## Technical Details

### Server Functions
- `deleteSmsMessage`: Validates pharmacy session and deletes from `sms_messages`.
- `getSmsHistory`: Add `includeHandoff` boolean (default `false`) and date filtering.

### UI Components
- Update `PhoneSheet` to handle the dual-action logic.
- Update `SmsMessagesPage` with new filters and delete functionality.
- Add `DeleteMessageDialog` component.

## Verification Plan

### Manual Verification
- Verify "Open Messages App" triggers external app and logs to communication history but NOT `sms_messages`.
- Verify "Send via Gateway" creates a `pending` record in `sms_messages`.
- Verify deleting a message removes it from the list and database.
- Verify status and date filters work correctly.
- Verify confirmation dialog text is correct in Arabic.
