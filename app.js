
require("dotenv").config();

const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (req, res) => {
    res.status(200).json({
        message: "Appointment Reminder Server is running"
    });
});

// AiSensy webhook test endpoint
app.post("/webhooks/aisensy", (req, res) => {
    console.log("AiSensy webhook received:");
    console.log(JSON.stringify(req.body, null, 2));

    res.status(200).json({
        received: true
    });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

