const express = require("express");
const router = express.Router();

router.post('/login', (req, res) => {
    res.json({success: true});
})

router.post('/users', (req, res) => {
    res.json({success: true});
})

module.exports = router;