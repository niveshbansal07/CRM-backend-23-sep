const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const env = require("./config/env");

const routes = require("./routes");
const notFound = require("./middlewares/notFound.middleware");
const errorHandler = require("./middlewares/error.middleware");

const app = express();

app.use(
    cors({
        origin: env.frontendUrl,
        credentials: true,
    })
);

app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true, limit: "12mb" }));
app.use(morgan(env.nodeEnv === "development" ? "dev" : "combined"));

app.get("/", (req, res) => {
    res.status(200).json({
        success: true,
        message: "TrackField CRM Backend Running",
    });
});

app.use("/api", routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
