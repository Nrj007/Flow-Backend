import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { AppError } from '../../middleware/errorHandler.js';
import {
  createNotification,
  listNotifications,
  markAllRead,
  markNotificationRead,
} from './notification.repository.js';
import { initSSEConnection, userClients } from '../../utils/sse.js';

const router = Router();

/**
 * SSE stream — push real-time notifications for the authenticated user.
 * GET /api/notifications/events
 */
router.get('/events', authenticate, (req, res) => {
  const userId = req.user.userId;
  const cleanup = initSSEConnection(res, userId, userClients);
  req.on('close', cleanup);
});

router.get('/', authenticate, async (req, res, next) => {
  try {
    const limit = req.query.limit || 50;
    const notifications = await listNotifications(req.user.userId, limit);
    const unreadCount = notifications.filter((n) => !n.read).length;
    res.json({ success: true, data: notifications, unreadCount });
  } catch (err) {
    next(err);
  }
});

router.patch('/:notifId/read', authenticate, async (req, res, next) => {
  try {
    const updated = await markNotificationRead(req.user.userId, req.params.notifId);
    if (!updated) throw new AppError('Notification not found', 404, 'NOT_FOUND');
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

router.post('/read-all', authenticate, async (req, res, next) => {
  try {
    const result = await markAllRead(req.user.userId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

export default router;
