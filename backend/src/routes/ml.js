import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { callML } from '../services/mlService.js';

const router = express.Router();
router.get('/status', async (req, res) => {
  try {
    res.json({ available: true, ...(await callML('/health')) });
  } catch {
    res.json({ available: false, detectorReady: false, rankerReady: false });
  }
});
router.post('/detect', authenticate, async (req, res, next) => {
  const { imageBase64, labels, threshold = 0.2 } = req.body;
  if (typeof imageBase64 !== 'string' || imageBase64.length === 0 || imageBase64.length > 7_000_000 ||
      !Number.isFinite(threshold) || threshold < 0 || threshold > 1 ||
      (labels !== undefined && (!Array.isArray(labels) || labels.length === 0 || labels.length > 30 ||
        labels.some(label => typeof label !== 'string' || !label.trim() || label.length > 100)))) {
    return res.status(400).json({ message: 'Provide a base64 room image, up to 30 labels and a threshold from 0 to 1' });
  }
  try {
    res.json(await callML('/detect', { imageBase64, labels, threshold }));
  } catch (error) {
    error.statusCode ||= 503;
    next(error);
  }
});
export default router;
