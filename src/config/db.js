const mongoose = require("mongoose");
const env = require("./env");

const connectDB = async () => {
  const conn = await mongoose.connect(env.mongoUri, {
    autoIndex: env.mongoAutoIndex,
    autoCreate: false,
  });

  console.log(`MongoDB Connected: ${conn.connection.host}`);
};

module.exports = connectDB;
