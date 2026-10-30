const pool = require("./server");

async function initializeReminders() {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const result = await client.query(`
            INSERT INTO appointment_reminders (
                appointment_id,
                session,
                appointment_date,
                reminder_status
            )
            SELECT
                a.appointment_id,
                a.session,
                a.appointment_date,
                'PENDING'
            FROM appointments a
            WHERE a.appointment_date = CURRENT_DATE
              AND a.session IN ('Morning', 'Evening')
            ON CONFLICT (appointment_id, appointment_date)
            DO NOTHING
            RETURNING id;
        `);

        await client.query("COMMIT");

        console.log(
            `Reminder initialization completed. ${result.rowCount} records created.`
        );

        return result.rowCount;

    } catch (error) {
        await client.query("ROLLBACK");

        console.error("Reminder initialization failed:", error.message);

        throw error;

    } finally {
        client.release();
    }
}

module.exports = initializeReminders;