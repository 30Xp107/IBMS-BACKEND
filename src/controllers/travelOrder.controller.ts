import { Request, Response } from 'express';
import { TravelOrder } from '../models/travelOrder.model';
import userModel from '../models/user.model';
import { catchAsync } from '../utils/catchAsync';
import { Area } from '../models/area.model';
import { SystemConfig } from '../models/systemConfig.model';

// Create a new Travel Order
export const createTravelOrder = catchAsync(async (req: Request, res: Response) => {
  const { participants, date_from, date_to, destination, purpose } = req.body;
  const requester = (req as any).user._id;

  // Validate dates
  if (new Date(date_to) < new Date(date_from)) {
    return res.status(400).json({ message: "To Date cannot be earlier than From Date" });
  }

  // Validate destination (basic check)
  if (!destination?.region || !destination?.province || !destination?.municipality) {
    return res.status(400).json({ message: "Destination Region, Province and Municipality are required" });
  }

  // Prevent duplicate creation (idempotency check)
  // Check if a similar TO was created in the last 10 seconds
  const tenSecondsAgo = new Date(Date.now() - 10000);
  const existingTO = await TravelOrder.findOne({
    requester,
    purpose,
    date_from,
    date_to,
    'destination.region': destination.region,
    'destination.province': destination.province,
    'destination.municipality': destination.municipality,
    createdAt: { $gte: tenSecondsAgo }
  });

  if (existingTO) {
    return res.status(409).json({ message: "A similar travel order was already created recently. Please wait a moment." });
  }

  // Fetch default signatory from system configuration
  let approver = null;
  const signatoryConfig = await SystemConfig.findOne({ key: "travel_order_signatory" });
  if (signatoryConfig && signatoryConfig.value) {
    approver = signatoryConfig.value;
  }

  const travelOrder = await TravelOrder.create({
    requester,
    participants: participants || [], // Can be empty if just the requester
    date_from,
    date_to,
    destination,
    purpose,
    approver // Automatically assign the default signatory
  });

  res.status(201).json(travelOrder);
});

// Get all Travel Orders (filtered by role)
export const getTravelOrders = catchAsync(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { status, search } = req.query;

  let query: any = {};

  // Admin sees all
  // Approver sees assigned to them
  // Requester/Participant sees their own
  if (user.role === 'admin') {
    // No restriction
  } else {
    // If not admin, check if user is approver OR requester OR participant
    query.$or = [
      { requester: user._id },
      { participants: user._id },
      { approver: user._id }
    ];
  }

  if (status && status !== 'all') {
    query.status = status;
  }

  const travelOrders = await TravelOrder.find(query)
    .populate('requester', 'name email')
    .populate('participants', 'name email')
    .populate('approver', 'name email')
    .sort({ createdAt: -1 });

  res.status(200).json(travelOrders);
});

// Update Status (Approve/Reject)
export const updateTravelOrderStatus = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;
  const user = (req as any).user;

  const travelOrder = await TravelOrder.findById(id);
  if (!travelOrder) {
    return res.status(404).json({ message: "Travel Order not found" });
  }

  // Only assigned approver can approve/reject
  if (travelOrder.approver?.toString() !== user._id.toString() && user.role !== 'admin') {
     return res.status(403).json({ message: "Only the assigned approver can update the status" });
  }

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ message: "Invalid status" });
  }

  travelOrder.status = status;
  await travelOrder.save();

  res.status(200).json(travelOrder);
});

// Assign Approver (Admin only)
export const assignApprover = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { approverId } = req.body;
  
  // Middleware likely handles checking if user is admin, but double check logic here or assume route protection
  // Assuming route is protected by restrictTo('admin')

  const travelOrder = await TravelOrder.findById(id);
  if (!travelOrder) {
    return res.status(404).json({ message: "Travel Order not found" });
  }

  const approver = await userModel.findById(approverId);
  if (!approver) {
    return res.status(404).json({ message: "Approver user not found" });
  }

  travelOrder.approver = approver._id as any;
  await travelOrder.save();

  res.status(200).json(travelOrder);
});

// Helper to get users for selection
export const getUsersForSelection = catchAsync(async (req: Request, res: Response) => {
  const users = await userModel.find({ status: 'approved' }).select('_id name email role');
  res.status(200).json(users);
});

export const getRegions = catchAsync(async (req: Request, res: Response) => {
  const regions = await Area.find({ type: 'region' }).sort({ name: 1 }).select('name code');
  res.status(200).json(regions);
});

// Helper to get provinces/municipalities from Area model
export const getProvinces = catchAsync(async (req: Request, res: Response) => {
  const { region } = req.query;
  let query: any = { type: 'province' };

  if (region) {
    const regArea = await Area.findOne({ type: 'region', name: region });
    if (regArea) {
      query.parent_code = regArea.code;
    }
  }

  const provinces = await Area.find(query).sort({ name: 1 }).select('name code');
  res.status(200).json(provinces);
});

export const getMunicipalities = catchAsync(async (req: Request, res: Response) => {
  const { province } = req.query;
  let query: any = { type: 'municipality' };
  
  if (province) {
    // Assuming province passed is the name or code. Let's find the province Area first to get its code/id if needed
    // Or if the Area model stores parent_code/parent_id
    // Based on area.model.ts: parent_code exists.
    // If province name is passed, find its code first.
    const provArea = await Area.findOne({ type: 'province', name: province });
    if (provArea) {
      query.parent_code = provArea.code;
    }
  }

  const municipalities = await Area.find(query).sort({ name: 1 }).select('name code');
  res.status(200).json(municipalities);
});
