import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import userModel from "../models/user.model";
import dotenv from "dotenv";
import ErrorHandler from "../utils/ErrorHandler";
dotenv.config();

const ACCESS_SECRET = process.env.ACCESS_TOKEN_SECRET || "access_secret";

export interface AuthRequest extends Request {
  user?: any;
}

export const isAuthenticated = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = req.cookies?.access_token as string | undefined;
    if (!token)
      return res
        .status(401)
        .json({ success: false, message: "Not authenticated" });
    const decoded = jwt.verify(token, ACCESS_SECRET) as any;
    const user = await userModel.findById(decoded.id).select("-password").populate("assigned_areas", "name");
    if (!user)
      return res
        .status(401)
        .json({ success: false, message: "User not found" });
    
    // Check if user is approved - prevent access if pending or rejected
    const userStatus = user.status || 'pending';
    if (userStatus === 'pending') {
      return res
        .status(403)
        .json({ success: false, message: "Account pending approval" });
    }
    if (userStatus === 'rejected') {
      return res
        .status(403)
        .json({ success: false, message: "Account has been rejected" });
    }
    
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
};

export const authorizeRoles = (...roles: string[]) => {
  return (req:AuthRequest, res:Response, next:NextFunction) => {
      if(!roles.includes(req.user?.role || '')) {
          return next(new ErrorHandler(`Role: ${req.user?.role} is not allowed to access this resource`, 403))
      }
      next()
  }
}


