require("dotenv").config();

const initializeReminders = require("./initializeRemainders");
const claimReminders = require("./reminderScheduler");
const { processReminders } = require("./reminderService");

async function runSession(session) {
const workerId = `worker-${session.toLowerCase()}-${Date.now()}`;


const reminders = await claimReminders(session, workerId);

if (reminders.length === 0) {
    console.log(`No pending ${session} reminders.`);
    return;
}

await processReminders(reminders, workerId);


}

async function main() {
console.log("Starting appointment reminder workflow...");


// Step 1: Initialize missing reminders for today's appointments.
await initializeReminders();

// Step 2: Process each session.
await runSession("Morning");
await runSession("Evening");

console.log("Appointment reminder workflow completed.");


}

main().catch((error) => {
console.error("Reminder workflow failed:", error);
process.exitCode = 1;
});
