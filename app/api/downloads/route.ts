import { AppError, errorResponse } from "@/lib/security/errors";
export async function POST() { return errorResponse(new AppError("temporarily_unavailable", 503)); }
export const GET = POST;
