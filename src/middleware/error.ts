import { NextFunction, Request, Response } from "express"

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
    console.error(err)
    const status = err.statusCode || 500
    res.status(status).json({ success: false, message: err.message || 'Server Error' })
}


