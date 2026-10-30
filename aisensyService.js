
require("dotenv").config();

const API_URL = process.env.AISENSY_API_URL;
const API_KEY = process.env.AISENSY_API_KEY;
const CAMPAIGN_NAME = process.env.AISENSY_CAMPAIGN_NAME;

async function sendAppointmentReminder(appointment) {
    if (!API_URL || !API_KEY || !CAMPAIGN_NAME) {
        throw new Error("Missing AiSensy configuration in .env");
    }

    if (!appointment.phone_number) {
        throw new Error("Appointment has no phone number.");
    }

    // Normalize the Indian phone number.
    let phoneNumber = String(appointment.phone_number).trim();

    if (phoneNumber.startsWith("+")) {
        // Already contains a country code.
    } else if (phoneNumber.startsWith("91") && phoneNumber.length === 12) {
        phoneNumber = `+${phoneNumber}`;
    } else {
        phoneNumber = `+91${phoneNumber}`;
    }

    const payload = {
        apiKey: API_KEY,
        campaignName: CAMPAIGN_NAME,
        destination: phoneNumber,
        userName: appointment.patient_name,
        templateParams: [
            appointment.patient_name,
            appointment.doctor_name,
            String(appointment.appointment_time).slice(0, 5),
            appointment.branch
        ]
    };

    const response = await fetch(API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    const responseText = await response.text();

    let result;

    try {
        result = JSON.parse(responseText);
    } catch {
        throw new Error(
            `AiSensy returned an invalid response. HTTP ${response.status}`
        );
    }

    if (
        !response.ok ||
        String(result.success).toLowerCase() !== "true"
    ) {
        throw new Error(
            `AiSensy request failed: ${responseText}`
        );
    }

    if (!result.submitted_message_id) {
        throw new Error(
            "AiSensy returned no submitted message ID."
        );
    }

    return {
        accepted: true,
        messageId: result.submitted_message_id
    };
}

module.exports = { sendAppointmentReminder };

