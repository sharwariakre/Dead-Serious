require("dotenv").config();

const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({

    service: "gmail",

    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});


async function sendEmail(to, subject, message) {

    try {

        await transporter.sendMail({

            from: `"DeadSerious" <${process.env.EMAIL_USER}>`,

            to: to,

            subject: subject,

            text: message
        });

        console.log("Email sent to:", to);

    } catch (err) {

        console.error("Email failed:", err);
    }
}


module.exports = {
    sendEmail
};
