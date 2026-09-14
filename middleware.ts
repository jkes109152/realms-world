import { bindings } from "@/lib/db/client";
import { canonicalPageRedirect } from "@/lib/security/canonical-page";

export function middleware(request: Request) {
  return canonicalPageRedirect(request, bindings()) ?? undefined;
}

export const config = { matcher: ["/", "/admin/:path*"] };
