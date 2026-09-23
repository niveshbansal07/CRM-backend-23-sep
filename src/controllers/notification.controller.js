const notificationService = require("../services/notification.service");

const getMyNotifications = async (req, res, next) => {
    try {
        const result = await notificationService.getUserNotifications(req.user._id, req.query);
        res.status(200).json({
            success: true,
            message: "Notifications fetched successfully.",
            data: result.items,
            pagination: result.pagination,
        });
    } catch (error) {
        next(error);
    }
};

const markAsRead = async (req, res, next) => {
    try {
        const notification = await notificationService.markAsRead(req.params.id, req.user._id);
        res.status(200).json({
            success: true,
            message: "Notification marked as read.",
            data: notification,
        });
    } catch (error) {
        next(error);
    }
};

const markAllAsRead = async (req, res, next) => {
    try {
        const result = await notificationService.markAllAsRead(req.user._id);
        res.status(200).json({
            success: true,
            message: "All notifications marked as read.",
            data: result,
        });
    } catch (error) {
        next(error);
    }
};

const getUnreadCount = async (req, res, next) => {
    try {
        const result = await notificationService.getUnreadCount(req.user._id);
        res.status(200).json({
            success: true,
            message: "Unread count fetched successfully.",
            data: result,
        });
    } catch (error) {
        next(error);
    }
};

const snoozeNotification = async (req, res, next) => {
    try {
        const notification = await notificationService.snoozeNotification(
            req.params.id,
            req.user._id,
            req.body.snoozeMinutes
        );
        res.status(200).json({
            success: true,
            message: "Notification snoozed successfully.",
            data: notification,
        });
    } catch (error) {
        next(error);
    }
};

const getTodayDigest = async (req, res, next) => {
    try {
        res.status(200).json({
            success: true,
            message: "Sales follow-up digest has been removed.",
            data: [],
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getMyNotifications,
    markAsRead,
    markAllAsRead,
    getUnreadCount,
    snoozeNotification,
    getTodayDigest,
};
