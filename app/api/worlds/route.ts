import { AppError, errorResponse } from "@/lib/security/errors";
export async function GET() { return errorResponse(new AppError("temporarily_unavailable", 503)); }
