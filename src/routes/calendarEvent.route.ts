import express from "express";
import {
  getCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from "../controllers/calendarEvent.controller";
import { isAuthenticated } from "../middleware/auth";

const router = express.Router();

router.use(isAuthenticated);

router.route("/")
  .get(getCalendarEvents)
  .post(createCalendarEvent);

router.route("/:id")
  .put(updateCalendarEvent)
  .delete(deleteCalendarEvent);

export default router;
