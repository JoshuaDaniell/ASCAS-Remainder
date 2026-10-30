
const pool = require("./server");
const aisensyService = require("./aisensyService");

const MAX_RETRIES = 3;

async function processReminders(reminders, workerId) {
    for (const reminder of reminders) {
        try {
            // Fetch appointment details from PostgreSQL.
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

            if (appointmentResult.rowCount === 0) {
                await markFailed(reminder.id, workerId);
                continue;
            }

            const appointment = appointmentResult.rows[0];

            // Send the reminder through AiSensy.
            const response =
                await aisensyService.sendAppointmentReminder(appointment);

            if (!response.accepted || !response.messageId) {
                throw new Error(
                    "AiSensy did not confirm acceptance with a message ID."
                );
            }

            // Record successful submission.
            const updateResult = await pool.query(
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
                [response.messageId, reminder.id, workerId]
            );

            if (updateResult.rowCount === 0) {
                console.error(
                    `Reminder ${reminder.id}: status was not updated.`
                );
                continue;
            }

            console.log(
                `Reminder ${reminder.id} marked DONE. ` +
                `AiSensy message ID: ${response.messageId}`
            );

        } catch (error) {
            console.error(
                `Reminder ${reminder.id} processing failed:`,
                error.message
            );

            await handleFailure(reminder, workerId);
        }
    }
}

async function handleFailure(reminder, workerId) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const result = await client.query(
            `
            UPDATE appointment_reminders
            SET retry_count = retry_count + 1,
                reminder_status = CASE
                    WHEN retry_count + 1 >= $1 THEN 'FAILED'
                    ELSE 'PENDING'
                END,
                locked_by = NULL,
                locked_at = NULL,
                lease_expires_at = NULL,
                updated_at = NOW()
            WHERE id = $2
              AND reminder_status = 'PROCESSING'
              AND locked_by = $3
            RETURNING reminder_status, retry_count
            `,
            [MAX_RETRIES, reminder.id, workerId]
        );

        await client.query("COMMIT");

        if (result.rowCount > 0) {
            console.log(
                `Reminder ${reminder.id}: ` +
                `${result.rows[0].reminder_status}, ` +
                `attempts: ${result.rows[0].retry_count}`
            );
        }

    } catch (error) {
        await client.query("ROLLBACK");

        console.error(
            "Failed to update reminder status:",
            error.message
        );

        throw error;

    } finally {
        client.release();
    }
}

async function markFailed(reminderId, workerId) {
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
        `Reminder ${reminderId} failed: appointment record not found.`
    );
}

module.exports = { processReminders };

