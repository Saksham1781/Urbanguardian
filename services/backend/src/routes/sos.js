const express = require("express");
const { sendSOS } = require("../controllers/sosController");

const router = express.Router();

router.post("/", sendSOS);

module.exports = router;
