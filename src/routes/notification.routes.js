const express = require("express");
const {
    getMyNotifications,
    markAsRead,
    markAllAsRead,
    getUnreadCount,
    snoozeNotification,
    getTodayDigest,
} = require("../controllers/notification.controller");

const { authenticate } = require("../middlewares/auth.middleware");

const router = express.Router();

router.use(authenticate);

router.get("/", getMyNotifications);

router.get("/unread-count", getUnreadCount);
router.get("/today-digest", getTodayDigest);
router.patch("/read-all", markAllAsRead);
router.patch("/:id/read", markAsRead);
router.patch("/:id/snooze", snoozeNotification);

module.exports = router;
