const pool = require("./server");
const aisensyService = require("./aisensyService");

const MAX_RETRIES = 3;


// STEP 1: Process the reminders claimed by the scheduler.
async function processReminders(reminders, workerId) {

    for (const reminder of reminders) {

        try {

            // STEP 2: Fetch the corresponding appointment.
            const appointmentResult = await pool.query(
                `
                SELECT
                    appointment_id,
                    patient_name,
                    phone_number,
                    appointment_date,
                    appointment_time,
                    doctor_name,
                    branch,
                    session
                FROM appointments
                WHERE appointment_id = $1
                  AND appointment_date = $2
                `,
                [reminder.appointment_id, reminder.appointment_date]
            );


            // STEP 3: Check whether the appointment exists.
            if (appointmentResult.rowCount === 0) {

                await markFailed(
                    reminder.id,
                    workerId,
                    "Appointment record not found."
                );

                continue;
            }

            const appointment = appointmentResult.rows[0];


            // STEP 4: Record that the external request is about to begin.
            const startResult = await pool.query(
                `
                UPDATE appointment_reminders
                SET send_started_at = NOW(),
                    updated_at = NOW()
                WHERE id = $1
                  AND reminder_status = 'PROCESSING'
                  AND locked_by = $2
                RETURNING id
                `,
                [reminder.id, workerId]
            );


            if (startResult.rowCount === 0) {
                console.log(
                    `Reminder ${reminder.id}: Worker no longer owns this reminder.`
                );

                continue;
            }


            // STEP 5: Send the request to AiSensy.
            // Important: Do not put the database update below
            // inside a catch that treats it as an API failure.
            const response =
                await aisensyService.sendAppointmentReminder(appointment);


            // STEP 6: Handle confirmed acceptance.
            if (response.outcome === "accepted") {

                await markDone(
                    reminder.id,
                    workerId,
                    response.messageId
                );

                continue;
            }


            // STEP 7: Handle an explicit rejection.
            if (response.outcome === "rejected") {

                await handleFailure(
                    reminder.id,
                    workerId,
                    response.reason
                );

                continue;
            }


            // STEP 8: Handle an uncertain submission.
            if (response.outcome === "unknown") {

                await markSubmissionUnknown(
                    reminder.id,
                    workerId,
                    response.reason
                );

                continue;
            }


            // STEP 9: Handle a request that was never sent.
            if (response.outcome === "not_sent") {

                await markFailed(
                    reminder.id,
                    workerId,
                    response.reason
                );

                continue;
            }


            // Unexpected outcome: do not retry automatically.
            await markSubmissionUnknown(
                reminder.id,
                workerId,
                "Unexpected AiSensy response outcome."
            );

        } catch (error) {

            console.error(
                `Reminder ${reminder.id} processing error:`,
                error.message
            );

            // Deliberately do not reset this reminder to PENDING.
            //
            // If send_started_at is populated, recovery will classify
            // it as SUBMISSION_UNKNOWN.
            //
            // If send_started_at is NULL, recovery can safely
            // return it to PENDING.
        }
    }
}


// STEP 10: Mark a successfully accepted submission as DONE.
async function markDone(reminderId, workerId, messageId) {

    const result = await pool.query(
        `
        UPDATE appointment_reminders
        SET reminder_status = 'DONE',
            aisensy_message_id = $1,
            locked_by = NULL,
            locked_at = NULL,
            lease_expires_at = NULL,
            updated_at = NOW()
        WHERE id = $2
          AND reminder_status = 'PROCESSING'
          AND locked_by = $3
        RETURNING id
        `,
        [messageId, reminderId, workerId]
    );


    if (result.rowCount === 0) {

        throw new Error(
            `Could not mark reminder ${reminderId} as DONE.`
        );
    }


    console.log(
        `Reminder ${reminderId} marked DONE. Message ID: ${messageId}`
    );
}


// STEP 11: Handle definite API rejection and retry.
async function handleFailure(reminderId, workerId, reason) {

    const result = await pool.query(
        `
        UPDATE appointment_reminders
        SET retry_count = retry_count + 1,

            reminder_status = CASE
                WHEN retry_count + 1 >= $1 THEN 'FAILED'
                ELSE 'PENDING'
            END,

            send_started_at = NULL,
            locked_by = NULL,
            locked_at = NULL,
            lease_expires_at = NULL,
            updated_at = NOW()

        WHERE id = $2
          AND reminder_status = 'PROCESSING'
          AND locked_by = $3

        RETURNING reminder_status, retry_count
        `,
        [MAX_RETRIES, reminderId, workerId]
    );


    if (result.rowCount > 0) {

        console.log(
            `Reminder ${reminderId}: ` +
            `${result.rows[0].reminder_status}, ` +
            `attempts: ${result.rows[0].retry_count}. ` +
            `Reason: ${reason}`
        );
    }
}


// STEP 12: Mark an uncertain submission.
async function markSubmissionUnknown(reminderId, workerId, reason) {

    const result = await pool.query(
        `
        UPDATE appointment_reminders
        SET reminder_status = 'SUBMISSION_UNKNOWN',
            locked_by = NULL,
            locked_at = NULL,
            lease_expires_at = NULL,
            updated_at = NOW()
        WHERE id = $1
          AND reminder_status = 'PROCESSING'
          AND locked_by = $2
        RETURNING id
        `,
        [reminderId, workerId]
    );


    if (result.rowCount > 0) {

        console.error(
            `Reminder ${reminderId} requires investigation. ` +
            `Submission outcome unknown: ${reason}`
        );
    }
}


// STEP 13: Mark a reminder as permanently failed.
async function markFailed(reminderId, workerId, reason) {

    await pool.query(
        `
        UPDATE appointment_reminders
        SET reminder_status = 'FAILED',
            locked_by = NULL,
            locked_at = NULL,
            lease_expires_at = NULL,
            updated_at = NOW()
        WHERE id = $1
          AND reminder_status = 'PROCESSING'
          AND locked_by = $2
        `,
        [reminderId, workerId]
    );


    console.error(
        `Reminder ${reminderId} marked FAILED: ${reason}`
    );
}


module.exports = {
    processReminders
};