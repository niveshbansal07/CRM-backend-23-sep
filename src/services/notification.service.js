const Notification = require("../models/Notification");
const User = require("../models/User");
const ApiError = require("../utils/ApiError");

const APPROVAL_PRIORITY = [
    "hr_head",
    "hr_manager",
    "hr_general",
    "sub_admin",
    "company_admin",
];

let socketServer = null;

const setSocketServer = (io) => {
    socketServer = io;
};

const findEmployeeRequestReceivers = async (companyId) => {
    if (!companyId) return [];

    const receivers = [];

    for (const role of APPROVAL_PRIORITY) {
        const users = await User.find({
            companyId,
            role,
            status: "active",
            deletedAt: null,
        }).select("_id fullName email role");

        if (users.length > 0) {
            receivers.push(...users);
            break;
        }
    }

    if (receivers.length === 0) {
        const superAdmins = await User.find({
            role: "super_admin",
            status: "active",
            deletedAt: null,
        }).select("_id fullName email role");

        receivers.push(...superAdmins);
    }

    return receivers;
};

const createNotification = async ({
    companyId = null,
    tenantId = null,
    receiverId,
    userId,
    senderId = null,
    type,
    title,
    message,
    body,
    data = {},
    referenceType = null,
    referenceId = null,
}) => {
    const targetUserId = receiverId || userId;
    const targetTenantId = companyId || tenantId;
    if (!targetUserId) return null;

    const notification = await Notification.create({
        companyId: targetTenantId,
        tenantId: targetTenantId,
        receiverId: targetUserId,
        userId: targetUserId,
        senderId,
        type,
        title,
        message: message || body || title,
        data: {
            ...data,
            ...(referenceType ? { referenceType } : {}),
            ...(referenceId ? { referenceId } : {}),
        },
        referenceType,
        referenceId,
    });

    if (socketServer) {
        socketServer.to(`user:${targetUserId}`).emit("notification", {
            id: notification._id,
            type,
            title,
            body: notification.message,
            message: notification.message,
            referenceType,
            referenceId,
            createdAt: notification.createdAt,
        });
    }

    return notification;
};

const notifyMany = async ({ receivers, companyId, senderId, type, title, message, data }) => {
    if (!Array.isArray(receivers) || receivers.length === 0) return [];

    const docs = receivers.map((user) => ({
        companyId,
        tenantId: companyId,
        receiverId: user._id,
        userId: user._id,
        senderId,
        type,
        title,
        message,
        data,
    }));

    return Notification.insertMany(docs);
};

const getUserNotifications = async (userId, { page = 1, limit = 20 } = {}) => {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const skip = (safePage - 1) * safeLimit;
    const filter = { receiverId: userId, deletedAt: null };
    const [items, total] = await Promise.all([
        Notification.find(filter).sort({ isRead: 1, createdAt: -1 }).skip(skip).limit(safeLimit),
        Notification.countDocuments(filter),
    ]);

    return {
        items,
        pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) },
    };
};

const markAsRead = async (notificationId, userId) => {
    const notification = await Notification.findOneAndUpdate(
        { _id: notificationId, receiverId: userId, deletedAt: null },
        { isRead: true, readAt: new Date() },
        { new: true }
    );
    if (!notification) throw new ApiError(404, "Notification not found");
    return notification;
};

const markAllAsRead = async (userId) => {
    const result = await Notification.updateMany(
        { receiverId: userId, isRead: false, deletedAt: null },
        { $set: { isRead: true, readAt: new Date() } }
    );
    return { updated: result.modifiedCount || 0 };
};

const getUnreadCount = async (userId) => ({
    count: await Notification.countDocuments({ receiverId: userId, isRead: false, deletedAt: null }),
});

const snoozeNotification = async (notificationId, userId, snoozeMinutes) => {
    const minutes = Number(snoozeMinutes);
    if (![15, 30, 60, 120].includes(minutes)) {
        throw new ApiError(400, "Snooze minutes must be 15, 30, 60, or 120");
    }

    const notification = await Notification.findOne({ _id: notificationId, receiverId: userId, deletedAt: null });
    if (!notification) throw new ApiError(404, "Notification not found");

    const snoozedUntil = new Date(Date.now() + minutes * 60 * 1000);
    notification.isSnoozed = true;
    notification.snoozedUntil = snoozedUntil;
    notification.isRead = true;
    notification.readAt = notification.readAt || new Date();
    await notification.save();

    return notification;
};

module.exports = {
    findEmployeeRequestReceivers,
    createNotification,
    notifyMany,
    getUserNotifications,
    markAsRead,
    markAllAsRead,
    getUnreadCount,
    snoozeNotification,
    setSocketServer,
};
