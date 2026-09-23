class ApiResponse {
    constructor(statusCode, message = "Success", data = null) {
        this.statusCode = statusCode;
        this.success = true;
        this.message = message;
        this.data = data;
    }
}

module.exports = ApiResponse;