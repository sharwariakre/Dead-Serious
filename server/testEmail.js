const { sendEmail } = require("./utils/email");

const nominees = [
    "testEmail@gmail.com"
];

async function test() {

    for (const email of nominees) {

        await sendEmail(
            email,
            "DeadSerious Test",
            "This is a test email from DeadSerious."
        );
    }
}

test();
