# Plan: SMS Experience Cleanup and Gateway Separation

Clean up SMS semantics and UI to distinguish between actual Gateway SMS operations and manual app handoffs.

## User Review Required

> [!IMPORTANT]
> - **Deletion Safety**: "Handoff" and `pending`/`failed` Gateway messages can be permanently deleted. `sent` and `delivered` messages will be **archived** (hidden) instead of deleted to preserve the audit trail.
> - **Foreign Keys**: Cascade behavior will be verified and handled server-side to prevent orphans.

## Proposed Changes

### Database & Backend
- **Audit Logging**: Ensure manual handoffs are logged to `communication_logs` with a specific action (`sms_handoff`).
- **Archiving Support**: Add `is_archived` boolean column to `sms_messages` table via migration.
- **Message Management**: Implement `deleteOrArchiveSmsMessage` server function:
    - Permanently delete `handoff`, `pending`, or `failed` messages.
    - Set `is_archived = true` for `sent` or `delivered` messages.
- **Status Filter**: Update `getSmsHistory` to exclude `handoff` and `is_archived` records by default.

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
- `deleteOrArchiveSmsMessage`: Validates pharmacy session, checks message status, and either deletes or archives the record.
- `getSmsHistory`: Add `includeHandoff` and `includeArchived` flags (default `false`).

### UI Components
- Update `PhoneSheet` to handle the dual-action logic.
- Update `SmsMessagesPage` with new filters and delete/archive functionality.
- Add `DeleteMessageDialog` component with Arabic text "هل تريد حذف هذه الرسالة من السجل؟". For archived messages, the button will be "إخفاء من السجل" or similar.

## Verification Plan

### Manual Verification
- Verify "Open Messages App" triggers external app and logs to communication history but NOT `sms_messages`.
- Verify "Send via Gateway" creates a `pending` record in `sms_messages`.
- Verify deleting a message removes it from the list and database.
- Verify status and date filters work correctly.
- Verify confirmation dialog text is correct in Arabic.
