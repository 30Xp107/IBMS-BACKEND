import { NextFunction, Request, Response } from "express"

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
    console.error('Error Handler caught:', err)
    
    const status = err.statusCode || 500
    const message = err.message || 'Internal Server Error'
    
    // In production, don't leak stack traces
    const isProd = process.env.NODE_ENV === 'production'
    
    res.status(status).json({ 
        success: false, 
        message: message,
        ...(isProd ? {} : { stack: err.stack })
    })
}


