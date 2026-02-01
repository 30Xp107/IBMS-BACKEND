import express from 'express';
import { isAuthenticated as protect, authorizeRoles as restrictTo } from '../middleware/auth';
import { 
  createTravelOrder, 
  getTravelOrders, 
  updateTravelOrderStatus, 
  assignApprover,
  getUsersForSelection,
  getRegions,
  getProvinces,
  getMunicipalities
} from '../controllers/travelOrder.controller';

const router = express.Router();

router.use(protect);

router.route('/')
  .post(createTravelOrder)
  .get(getTravelOrders);

router.patch('/:id/status', updateTravelOrderStatus);

router.patch('/:id/approver', restrictTo('admin'), assignApprover);

router.get('/users', getUsersForSelection);
router.get('/regions', getRegions);
router.get('/provinces', getProvinces);
router.get('/municipalities', getMunicipalities);

export default router;
