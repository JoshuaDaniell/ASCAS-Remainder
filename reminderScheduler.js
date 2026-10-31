const pool = require("./server");

const BATCH_SIZE = 1;
const LOCK_DURATION_MINUTES = 2;

async function claimReminders(session, workerId) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const result = await client.query(
            `
            WITH eligible_reminders AS (
                SELECT id
                FROM appointment_reminders
                WHERE appointment_date =
                    (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE
                  AND session = $1
                  AND reminder_status = 'PENDING'
                  AND (
                      locked_by IS NULL
                      OR lease_expires_at <= NOW()
                  )
                ORDER BY id
                LIMIT $2
                FOR UPDATE SKIP LOCKED
            )
            UPDATE appointment_reminders AS r
            SET reminder_status = 'PROCESSING',
                locked_by = $3,
                locked_at = NOW(),
                lease_expires_at =
                    NOW() + ($4 * INTERVAL '1 minute'),
                updated_at = NOW()
            FROM eligible_reminders AS e
            WHERE r.id = e.id
            RETURNING r.*;
            `,
            [
                session,
                BATCH_SIZE,
                workerId,
                LOCK_DURATION_MINUTES
            ]
        );

        await client.query("COMMIT");

        console.log(
            `Worker ${workerId} claimed ${result.rowCount} ${session} reminder(s).`
        );

        return result.rows;

    } catch (error) {
        await client.query("ROLLBACK");

        console.error(
            "Failed to claim reminders:",
            error.message
        );

        throw error;

    } finally {
        client.release();
    }
}

module.exports = claimReminders;