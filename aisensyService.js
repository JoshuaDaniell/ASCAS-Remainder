require("dotenv").config();

const API_URL = process.env.AISENSY_API_URL;
const API_KEY = process.env.AISENSY_API_KEY;
const CAMPAIGN_NAME = process.env.AISENSY_CAMPAIGN_NAME;

async function sendAppointmentReminder(appointment) {

    // STEP 1: Validate configuration before making an API request.
    if (!API_URL || !API_KEY || !CAMPAIGN_NAME) {
        return {
            outcome: "not_sent",
            reason: "Missing AiSensy configuration in .env"
        };
    }

    // STEP 2: Validate the appointment's phone number.
    if (!appointment.phone_number) {
        return {
            outcome: "not_sent",
            reason: "Appointment has no phone number."
        };
    }

    // STEP 3: Normalize the Indian phone number.
    let phoneNumber = String(appointment.phone_number).trim();

    if (phoneNumber.startsWith("+")) {
        // Already contains a country code.
    } else if (phoneNumber.startsWith("91") && phoneNumber.length === 12) {
        phoneNumber = `+${phoneNumber}`;
    } else {
        phoneNumber = `+91${phoneNumber}`;
    }

    // STEP 4: Construct the request payload.
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

    let response;

    // STEP 5: Send the HTTP POST request to AiSensy.
    try {
        response = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(25000)
        });

    } catch (error) {

        // A network error or timeout does not prove
        // that AiSensy never received the request.
        return {
            outcome: "unknown",
            reason: error.message
        };
    }

    // STEP 6: Read the response returned by AiSensy.
    const responseText = await response.text();

    let result;

    try {
        result = JSON.parse(responseText);

    } catch {
        return {
            outcome: "unknown",
            reason: `Invalid AiSensy response. HTTP ${response.status}`
        };
    }

    // STEP 7: Handle an explicit API rejection.
    if (
        response.status >= 400 &&
        response.status < 500
    ) {
        return {
            outcome: "rejected",
            reason: `AiSensy rejected the request: ${responseText}`
        };
    }

    if (
        response.ok &&
        String(result.success).toLowerCase() === "false"
    ) {
        return {
            outcome: "rejected",
            reason: `AiSensy rejected the request: ${responseText}`
        };
    }

    // STEP 8: A server error or unexpected response is ambiguous.
    if (!response.ok) {
        return {
            outcome: "unknown",
            reason: `Unexpected AiSensy response. HTTP ${response.status}`
        };
    }

    // STEP 9: Confirm that AiSensy returned a message ID.
    if (
        String(result.success).toLowerCase() !== "true" ||
        !result.submitted_message_id
    ) {
        return {
            outcome: "unknown",
            reason: "AiSensy response did not confirm message submission."
        };
    }

    // STEP 10: Return confirmed acceptance.
    return {
        outcome: "accepted",
        messageId: result.submitted_message_id
    };
}

module.exports = { sendAppointmentReminder };