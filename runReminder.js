require("dotenv").config();

const initializeReminders = require("./initializeRemainders");
const claimReminders = require("./reminderScheduler");
const { processReminders } = require("./reminderService");
const { recoverExpiredReminders } = require("./recoveryScheduler");

async function runSession(session) {
    const workerId = `worker-${session.toLowerCase()}-${Date.now()}`;

    console.log(`\nStarting ${session} reminder processing...`);

    let totalProcessed = 0;

    while (true) {
        // Claim one pending reminder
        const reminders = await claimReminders(session, workerId);

        // Stop when no pending reminders remain
        if (reminders.length === 0) {
            break;
        }

        // Process the claimed reminder
        await processReminders(reminders, workerId);

        totalProcessed += reminders.length;
    }

    console.log(
        `${session} processing completed. Total claimed: ${totalProcessed}`
    );
}

async function main() {
    console.log("Starting appointment reminder workflow...");

    // Step 1: Recover expired PROCESSING reminders
    await recoverExpiredReminders();

    // Step 2: Create missing reminder records
    await initializeReminders();

    // Step 3: Process Morning reminders
    await runSession("Morning");

    // Step 4: Process Evening reminders
    await runSession("Evening");

    console.log("\nAppointment reminder workflow completed.");
}

main()
    .catch((error) => {
        console.error("Reminder workflow failed:", error);
        process.exitCode = 1;
    });