const pool = require("./server");

async function recoverExpiredReminders() {


const client = await pool.connect();

try {

    // STEP 1: Start a database transaction.
    await client.query("BEGIN");

    // STEP 2: Find reminders whose processing lease has expired.
    const result = await client.query(`

        WITH expired_reminders AS (

            SELECT id
            FROM appointment_reminders

            WHERE reminder_status = 'PROCESSING'
              AND lease_expires_at <= NOW()

            ORDER BY lease_expires_at

            LIMIT 100

            FOR UPDATE SKIP LOCKED
        )

        UPDATE appointment_reminders AS r

        SET reminder_status = CASE

                WHEN r.send_started_at IS NULL
                    THEN 'PENDING'

                ELSE 'SUBMISSION_UNKNOWN'

            END,

            locked_by = NULL,
            locked_at = NULL,
            lease_expires_at = NULL,

            updated_at = NOW()

        FROM expired_reminders AS e

        WHERE r.id = e.id

        RETURNING
            r.id,
            r.reminder_status,
            r.send_started_at;

    `);

    // STEP 3: Commit the changes.
    await client.query("COMMIT");

    // STEP 4: Display recovery information.
    let pendingCount = 0;
    let unknownCount = 0;

    for (const reminder of result.rows) {

        if (reminder.reminder_status === "PENDING") {
            pendingCount++;
        }

        if (reminder.reminder_status === "SUBMISSION_UNKNOWN") {
            unknownCount++;
        }

    }

    console.log("Recovery scheduler completed.");
    console.log(`Returned to PENDING: ${pendingCount}`);
    console.log(`Moved to SUBMISSION_UNKNOWN: ${unknownCount}`);

    return {
        pendingCount,
        unknownCount
    };

} catch (error) {

    await client.query("ROLLBACK");

    console.error(
        "Recovery scheduler failed:",
        error.message
    );

    throw error;

} finally {

    // STEP 5: Release the PostgreSQL connection.
    client.release();

}


}

module.exports = {
recoverExpiredReminders
};
