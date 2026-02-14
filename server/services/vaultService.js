const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const STORAGE_PATH = path.join(__dirname, "..", "storage", "vaults");

function createVault(nominees, triggerTime) {

    const vaultId = uuidv4();

    const vaultPath = path.join(STORAGE_PATH, vaultId);

    fs.mkdirSync(vaultPath, { recursive: true });

    const metadata = {
        vaultId,
        nominees,
        triggerTime,
        createdAt: Date.now(),
        files: []
    };

    fs.writeFileSync(
        path.join(vaultPath, "metadata.json"),
        JSON.stringify(metadata, null, 2)
    );

    return vaultId;
}

module.exports = {
    createVault
};
