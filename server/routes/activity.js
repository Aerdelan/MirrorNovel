const express = require('express');
const auth = require('../middleware/auth');
const Activity = require('../models/Activity');
const {
  ACTIVITY_CATALOG,
  METRIC_LABELS,
  ActivityClaimError,
  listActivitiesForUser,
  claimActivity,
} = require('../services/activityService');

const router = express.Router();

router.use(auth);

router.get('/catalog', (req, res) => {
  res.json({
    types: ACTIVITY_CATALOG,
    metrics: Object.entries(METRIC_LABELS).map(([value, label]) => ({ value, label })),
    difficulties: [
      { value: 'easy', label: '轻松' },
      { value: 'medium', label: '适中' },
      { value: 'hard', label: '挑战' },
      { value: 'custom', label: '自定义' },
    ],
  });
});

router.get('/', async (req, res) => {
  try {
    const activities = await listActivitiesForUser(req.user);
    res.json({ activities });
  } catch (error) {
    res.status(500).json({ message: '获取积分活动失败', error: error.message });
  }
});

router.post('/:id/claim', async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);
    if (!activity) return res.status(404).json({ message: '活动不存在' });
    const result = await claimActivity(activity, req.user);
    res.json(result);
  } catch (error) {
    if (error instanceof ActivityClaimError) {
      return res.status(error.status).json({ message: error.message, code: error.code });
    }
    res.status(500).json({ message: '领取活动积分失败', error: error.message });
  }
});

module.exports = router;
