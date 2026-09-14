import { maintenanceRequest } from "@/lib/auth/maintenance-http";
import { maintainAdmin, type MaintenanceInput } from "@/lib/auth/maintenance";
import { readJson, objectInput } from "@/lib/security/request-policy";
import { errorResponse, jsonResponse } from "@/lib/security/errors";

export async function POST(request: Request) {
  try {
    const { db, operationDigest } = await maintenanceRequest(request);
    const input = objectInput(await readJson(request), ["action", "username", "passwordHash", "expectedCredentialVersion"]);
    return jsonResponse(await maintainAdmin(db, operationDigest, input as MaintenanceInput, Date.now()));
  } catch (error) { return errorResponse(error); }
}
