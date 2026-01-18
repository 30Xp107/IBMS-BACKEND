class ErrorHandler extends Error {
    statusCode: number
    constructor(message: any, statusCode: number) {
        super(message)
        this.statusCode = statusCode

        // @ts-ignore
        if (Error.captureStackTrace) {
            // @ts-ignore
            Error.captureStackTrace(this, this.constructor)
        }
    }
}

export default ErrorHandler


