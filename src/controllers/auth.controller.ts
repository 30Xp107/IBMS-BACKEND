import { NextFunction, Request, Response } from "express";
import { Area } from "../models/area.model";
import userModel from "../models/user.model";
import {
  signAccessToken,
  signRefreshToken,
  attachTokens,
  verifyRefreshToken,
  getCookieOptions,
} from "../utils/jwt";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import ErrorHandler from "../utils/ErrorHandler";
import { logAudit } from "../utils/auditLogger";
import { catchAsync } from "../utils/catchAsync";
dotenv.config();

export const register = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { idNumber, name, email, password } = req.body;
    const existing = await userModel.findOne({ email });
    if (existing) return next(new ErrorHandler("Email Already Used", 400)); 
    // Create user with default status "pending" - they cannot login until approved
    const user = await userModel.create({ idNumber, name, email, password });

    await logAudit(req, "CREATE", "users", user.id, "", JSON.stringify({ idNumber, name, email }));

    // Don't log them in - they need admin approval first
    res.status(201).json({
      success: true,
      message: "Registration successful. Please wait for admin approval.",
    });
  }
);

export const login = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { email, password } = req.body;
    const user = await userModel.findOne({ email }).select("+password").populate("assigned_areas", "name");
    if (!user) return next(new ErrorHandler("Account doesn't exist", 401));
    const ok = await user.comparePassword(password);
    if (!ok) return next(new ErrorHandler("Invalid Credentials", 401));

    // Check if user is approved - prevent login if pending or rejected
    const userStatus = user.status || "pending";
    if (userStatus === "pending") {
      return next(
        new ErrorHandler(
          "Account pending approval. Please wait for admin approval.",
          403
        )
      );
    }
    if (userStatus === "rejected") {
      return next(
        new ErrorHandler(
          "Account has been rejected. Please contact administrator.",
          403
        )
      );
    }

    const access = signAccessToken({ id: user._id });
    const refresh = signRefreshToken({ id: user._id });
    attachTokens(res, access, refresh);

    await logAudit(req, "LOGIN", "users", user.id, "", "User logged in");

    res.json({
      success: true,
      user: {
        id: user._id,
        idNumber: user.idNumber,
        name: user.name,
        email: user.email,
        role: user.role,
        status: userStatus,
        assigned_areas: (user.assigned_areas || []).map((area: any) => 
          (area && typeof area === 'object' && 'name' in area) ? area.name : String(area)
        ),
      },
    });
  }
);

export const logout = (req: Request, res: Response) => {
  const cookieOptions = getCookieOptions();
  res.clearCookie("access_token", cookieOptions);
  res.clearCookie("refresh_token", cookieOptions);
  res.json({ success: true, message: "Logged out" });
};

export const refreshToken = catchAsync(async (req: Request, res: Response) => {
  const token = req.cookies?.refresh_token as string | undefined;
  if (!token)
    return res
      .status(401)
      .json({ success: false, message: "No refresh token" });
  const decoded = verifyRefreshToken(token) as any;
  const access = signAccessToken({ id: decoded.id });
  const refresh = signRefreshToken({ id: decoded.id });
  attachTokens(res, access, refresh);
  return res.json({ success: true, refresh });
});

export const updateUser = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { idNumber, name, email, password, role } = req.body;
    const user = await userModel.findById(id);

    if (!user) return next(new ErrorHandler("User not found", 404));

    const oldData = JSON.stringify({
      idNumber: user.idNumber,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      assigned_areas: user.assigned_areas
    });

    if (email) {
      const isEmailExist = await userModel.findOne({ email });

      if (isEmailExist && isEmailExist._id.toString() !== id)
        return next(new ErrorHandler("Email already exists", 400));
      user.email = email;
    }

    if (idNumber) user.idNumber = idNumber;
    if (name) user.name = name;
    if (password) user.password = password;
    if (role) user.role = role as "user" | "admin";
    
    await user.save();

    await logAudit(
      req,
      "UPDATE",
      "users",
      user.id,
      oldData,
      JSON.stringify({ name: user.name, email: user.email, role: user.role })
    );

    const { password: pass, ...updatedUser } = (user as any)._doc;

    return res.json({ success: true, updatedUser });
  }
);

export const getMe = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user) {
      return next(new ErrorHandler("User not found", 404));
    }

    // Since we removed populate from isAuthenticated middleware for performance,
    // we populate here only when specifically requested by /me.
    // userModel.populate works on plain objects (from .lean()) too.
    const fullUser = await userModel.populate(user, { path: "assigned_areas", select: "name" });
    
    if (!fullUser) {
      return next(new ErrorHandler("User not found", 404));
    }

    res.status(200).json({
      success: true,
      user: {
        id: fullUser._id,
        idNumber: fullUser.idNumber,
        name: fullUser.name,
        email: fullUser.email,
        role: fullUser.role,
        status: fullUser.status,
        assigned_areas: (fullUser.assigned_areas || []).map((area: any) => 
          (area && typeof area === 'object' && 'name' in area) ? area.name : String(area)
        ),
      },
    });
  }
);

export const getuser = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { page = 1, limit = 10, search, status, sort = "createdAt", order = "desc" } = req.query;

    const query: any = {};
    
    // Determine sort object
    const sortField = sort as string;
    const sortOrder = order === "asc" ? 1 : -1;
    const sortObj: any = {};
    
    // Add secondary sort for stability
    if (sortField === "name") {
      sortObj["name"] = sortOrder;
      sortObj["createdAt"] = -1;
    } else {
      sortObj[sortField] = sortOrder;
      if (sortField !== "createdAt") {
        sortObj["createdAt"] = -1;
      }
    }
    sortObj["_id"] = -1; // Final fallback for absolute stability
    if (search) {
      query.$or = [
        { idNumber: { $regex: search as string, $options: "i" } },
        { name: { $regex: search as string, $options: "i" } },
        { email: { $regex: search as string, $options: "i" } },
      ];
    }
    if (status) {
      query.status = status;
    }

    if (limit === "all") {
      const users = await userModel
        .find(query)
        .select("-password")
        .populate("assigned_areas", "name")
        .sort(sortObj);
      return res.status(200).json({ success: true, users, total: users.length });
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const [users, total] = await Promise.all([
      userModel
        .find(query)
        .select("-password")
        .populate("assigned_areas", "name")
        .sort(sortObj)
        .skip(skip)
        .limit(limitNum),
      userModel.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      total,
      users,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  }
);

export const approveUser = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { status, assigned_areas, role, idNumber, name, email, password } = req.body;

    const user = await userModel.findById(id);
    if (!user) {
      return next(new ErrorHandler("User not found", 404));
    }

    const oldData = JSON.stringify({
      idNumber: user.idNumber,
      status: user.status,
      assigned_areas: user.assigned_areas,
      role: user.role,
      name: user.name,
      email: user.email
    });

    if (status) user.status = status as "pending" | "approved" | "rejected";
    if (assigned_areas && Array.isArray(assigned_areas)) {
      // Filter out invalid IDs and remove duplicates
      const uniqueAreas = [...new Set(assigned_areas)]
        .map(id => String(id))
        .filter(areaId => areaId && areaId.match(/^[0-9a-fA-F]{24}$/));
      user.assigned_areas = uniqueAreas;
    }
    if (role) user.role = role as "user" | "admin";
    
    // Add support for name, email, and password updates
    if (idNumber) user.idNumber = idNumber;
    if (name) user.name = name;
    if (email) {
      const isEmailExist = await userModel.findOne({ email });
      if (isEmailExist && isEmailExist._id.toString() !== id) {
        return next(new ErrorHandler("Email already exists", 400));
      }
      user.email = email;
    }
    if (password) user.password = password;

    await user.save();

    await logAudit(
      req,
      "UPDATE",
      "users",
      user.id,
      oldData,
      JSON.stringify({ idNumber, status, assigned_areas: user.assigned_areas, role, name, email })
    );

    const updatedUser = await userModel.findById(id).select("-password").populate("assigned_areas", "name");
    res.status(200).json({ success: true, user: updatedUser });
  }
);

export const deleteUser = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    const user = await userModel.findByIdAndDelete(id);
    if (!user) {
      return next(new ErrorHandler("User not found", 404));
    }

    await logAudit(req, "DELETE", "users", user.id, JSON.stringify(user), "");

    res.status(200).json({ success: true, message: "User deleted" });
  }
);
