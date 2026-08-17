const express = require('express');
const auth = require('../middleware/auth');
const { getPublicRoutes } = require('../config/modelPriceCatalog');
const { getPointsSnapshot, sanitizeLedger } = require('../services/pointsService');

const router = express.Router();

router.get('/routes', (_req, res) => {
  res.json({ routes: getPublicRoutes() });
});

router.get('/account', auth, (req, res) => {
  res.json({
    unit: 'points',
    account: getPointsSnapshot(req.user),
    ledger: sanitizeLedger(req.user.pointsLedger),
  });
});

module.exports = router;
