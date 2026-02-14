const express = require("express");

const router = express.Router();

const vaultService = require("../services/vaultService");


router.post("/create", (req, res) => {

    try {

        const { nominees, triggerTime } = req.body;

        if (!nominees || nominees.length !== 3) {

            return res.status(400).json({
                error: "Exactly 3 nominees required"
            });
        }

        const vaultId = vaultService.createVault(
            nominees,
            triggerTime
        );

        res.json({
            success: true,
            vaultId
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: "Vault creation failed"
        });
    }
});

module.exports = router;
