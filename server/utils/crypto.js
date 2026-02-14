const crypto = require("crypto");

function generateKey() {
    return crypto.randomBytes(32); // AES-256 key
}

function encrypt(buffer, key) {

    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv(
        "aes-256-gcm",
        key,
        iv
    );

    const encrypted = Buffer.concat([
        cipher.update(buffer),
        cipher.final()
    ]);

    const authTag = cipher.getAuthTag();

    return {
        encrypted,
        iv,
        authTag
    };
}

function decrypt(encrypted, key, iv, authTag) {

    const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        iv
    );

    decipher.setAuthTag(authTag);

    return Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
    ]);
}

module.exports = {
    generateKey,
    encrypt,
    decrypt
};
