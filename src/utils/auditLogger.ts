import { AuditLog } from "../models/auditLog.model";
import { Request } from "express";

export const logAudit = async (
  req: Request,
  action: string,
  module: string,
  record_id: string,
  old_value?: string,
  new_value?: string,
  field_name?: string
) => {
  try {
    const user = (req as any).user;
    if (!user) return;

    // Set default field_name if missing based on action
    let finalFieldName = field_name;
    if (!finalFieldName) {
      if (action === "CREATE") finalFieldName = "All Fields (Initial)";
      else if (action === "DELETE") finalFieldName = "All Fields (Deleted)";
      else if (action === "UPDATE") finalFieldName = "Modified Fields";
    }

    await AuditLog.create({
      user_id: user._id,
      user_name: user.name,
      user_role: user.role,
      action,
      module,
      record_id,
      old_value,
      new_value,
      field_name: finalFieldName
    });
  } catch (error) {
    console.error("Audit logging failed:", error);
  }
};
