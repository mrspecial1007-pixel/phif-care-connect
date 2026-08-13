# Simplify Multi-track Logic Implementation Plan

Update PHIF Tracker to enforce a maximum of 2 active tracks and simplify historical track logic.

## Technical Details

### 1. Database & Schema
- No schema changes required as `stream_id` already exists.
- Logic will primarily reside in `src/lib/dispensing.functions.ts`.

### 2. Implementation Steps

#### A. Update `recalculateTracks` logic
- **Historical Normalization**: All transactions before `2026-08-09` (historical cutoff) will be collapsed into a single "baseline" track.
- **Latest Baseline**: The baseline track will always be calculated from the latest non-cancelled transaction (Date + 28 days).
- **Live Multi-track**: Only transactions after the cutoff with a `stream_id` can form additional tracks.
- **2-Track Cap**: Ensure the `tracksToInsert` array never exceeds 2 elements. If more than 2 potential tracks exist, prioritize the baseline and the most recent live partial track.

#### B. Update `recordDispensing` server function
- **Validation**: Check if the patient already has 2 active tracks before allowing a new `Partial` or `Remaining` transaction that would create a 3rd stream.
- **Error Message**: Throw a specific error if a 3rd track is attempted: "لا يمكن إنشاء موعد صرف ثالث لهذا المستفيد. يجب إكمال أو معالجة أحد الموعدين الحاليين أولاً."

#### C. Frontend UI Updates
- **`PatientCard.tsx`**: 
    - Remove the "+X مواعيد أخرى" text.
    - Ensure it displays a maximum of 2 tracks.
    - Handle the case where no tracks exist by showing "لا يوجد موعد استحقاق".
- **`DispenseFlow.tsx`**: 
    - Ensure the track selection dialog only shows active tracks.
    - Display the new validation error message to the user when a 3rd track is blocked.

### 3. Verification Plan
- **Unit Test Simulation**: Create a temporary script to test track calculation for a patient with multiple historical and live transactions.
- **UI Check**: Verify that a patient with historical data now shows only 1 track.
- **Multi-track Test**: Record two partial dispensings in the UI and verify two tracks appear. Try a third and verify the error message appears.
