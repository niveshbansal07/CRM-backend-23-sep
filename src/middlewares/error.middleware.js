const errorHandler = (err, req, res, next) => {
    console.error("Error:", err);

    let statusCode = err.statusCode || 500;
    let message = err.message || "Internal Server Error";

    if (err.name === "ValidationError") {
        statusCode = 400;
        message = "Validation failed.";
    }

    if (err.code === 11000) {
        statusCode = 409;
        message = "Duplicate value already exists.";
    }

    res.status(statusCode).json({
        success: false,
        message,
        errors: err.errors || [],
        stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
    });
};

module.exports = errorHandler;