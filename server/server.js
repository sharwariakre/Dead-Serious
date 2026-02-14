require("dotenv").config();

const express = require("express");
const cors = require("cors");

const vaultRoutes = require("./routes/vault");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/vault", vaultRoutes);

app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

const PORT = 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
