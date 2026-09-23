const jwt = require("jsonwebtoken");
const env = require("../config/env");

const generateAccessToken = (user) => {
    return jwt.sign(
        {
            userId: user._id,
            role: user.role,
            companyId: user.companyId || null,
            email: user.email,
        },
        env.jwtAccessSecret,
        { expiresIn: env.accessTokenExpiry || "1d" }
    );
};

const generateRefreshToken = (user) => {
    return jwt.sign(
        {
            userId: user._id,
            tokenType: "refresh",
        },
        env.jwtRefreshSecret,
        { expiresIn: env.refreshTokenExpiry || "7d" }
    );
};

module.exports = {
    generateAccessToken,
    generateRefreshToken,
};